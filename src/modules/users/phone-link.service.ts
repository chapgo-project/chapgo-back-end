import crypto from 'node:crypto';
import { config } from '../../core/config.js';
import { AppError, ErrorCode, err } from '../../core/errors.js';
import { hashToken, generateOtpCode } from '../../core/tokens.js';
import { messenger } from '../../core/messaging.js';
import { OtpChallengeModel } from '../auth/session.model.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';

function minutes(n: number): Date {
  return new Date(Date.now() + n * 60_000);
}

export async function phoneTaken(phone: string, exceptUserId: string): Promise<boolean> {
  const taken = await UserModel.findOne({
    deletedAt: null,
    _id: { $ne: exceptUserId },
    $or: [{ phone }, { pendingPhone: phone }],
  })
    .select('_id')
    .lean();
  return Boolean(taken);
}

export async function findUserByPhone(phone: string) {
  return UserModel.findOne({
    deletedAt: null,
    $or: [{ phone }, { pendingPhone: phone }],
  });
}

async function sendPhoneCode(userId: string, phone: string) {
  const recent = await OtpChallengeModel.findOne({
    identifier: phone,
    purpose: 'phone_verify',
    consumedAt: null,
  })
    .sort({ lastSentAt: -1 })
    .lean();

  if (
    recent?.lastSentAt &&
    Date.now() - recent.lastSentAt.getTime() < config.OTP_RESEND_COOLDOWN_SEC * 1000
  ) {
    throw err.custom(429, ErrorCode.RATE_LIMITED, 'Patientez avant de demander un nouveau code.');
  }

  await OtpChallengeModel.updateMany(
    { identifier: phone, purpose: 'phone_verify', consumedAt: null },
    { consumedAt: new Date() },
  );

  const code = generateOtpCode(6);
  await OtpChallengeModel.create({
    identifier: phone,
    channel: 'sms',
    purpose: 'phone_verify',
    codeHash: hashToken(code),
    maxAttempts: config.OTP_MAX_ATTEMPTS,
    userId,
    expiresAt: minutes(config.OTP_TTL_MIN),
    lastSentAt: new Date(),
  });

  await messenger.sendSms(phone, `Votre code ChapGo : ${code}`);
}

export async function requestPhoneLink(userId: string, phone: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();

  if (user.phone && user.phone === phone && user.phoneVerifiedAt) {
    throw err.validation("C'est déjà votre numéro.", 'phone');
  }
  if (await phoneTaken(phone, userId)) {
    throw err.conflict(
      ErrorCode.PHONE_ALREADY_EXISTS,
      'Ce numéro est déjà utilisé.',
      'phone',
    );
  }

  user.pendingPhone = phone;
  await user.save();
  await sendPhoneCode(userId, phone);

  return {
    user: toUserDto(user.toObject()),
    phone,
    resendDelaySeconds: config.OTP_RESEND_COOLDOWN_SEC,
  };
}

export async function resendPhoneLink(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user?.pendingPhone) {
    throw err.validation("Aucune modification de numéro en attente.");
  }
  if (await phoneTaken(user.pendingPhone, userId)) {
    throw err.conflict(
      ErrorCode.PHONE_ALREADY_EXISTS,
      'Ce numéro est déjà utilisé.',
      'phone',
    );
  }
  await sendPhoneCode(userId, user.pendingPhone);
  return {
    user: toUserDto(user.toObject()),
    phone: user.pendingPhone,
    resendDelaySeconds: config.OTP_RESEND_COOLDOWN_SEC,
  };
}

export async function verifyPhoneLink(userId: string, phone: string, code: string) {
  const challenge = await OtpChallengeModel.findOne({
    identifier: phone,
    purpose: 'phone_verify',
    userId,
    consumedAt: null,
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw err.custom(410, ErrorCode.CODE_EXPIRED, 'Ce code a expiré. Demandez-en un nouveau.');
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw err.custom(410, ErrorCode.CODE_EXPIRED, 'Ce code a expiré. Demandez-en un nouveau.');
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw err.custom(
      429,
      ErrorCode.TOO_MANY_ATTEMPTS,
      'Trop de tentatives. Demandez un nouveau code.',
    );
  }

  const matches = crypto.timingSafeEqual(
    Buffer.from(challenge.codeHash),
    Buffer.from(hashToken(code)),
  );
  if (!matches) {
    challenge.attempts += 1;
    await challenge.save();
    const left = challenge.maxAttempts - challenge.attempts;
    throw new AppError({
      status: 401,
      code: ErrorCode.INVALID_CODE,
      message:
        left > 0
          ? `Code incorrect. Il vous reste ${left} tentative${left > 1 ? 's' : ''}.`
          : 'Trop de tentatives. Demandez un nouveau code.',
      details: { attemptsLeft: Math.max(0, left) },
    });
  }

  if (await phoneTaken(phone, userId)) {
    throw err.conflict(
      ErrorCode.PHONE_ALREADY_EXISTS,
      'Ce numéro est déjà utilisé.',
      'phone',
    );
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();
  user.phone = phone;
  user.phoneVerifiedAt = new Date();
  user.pendingPhone = null;
  await user.save();
  return toUserDto(user.toObject());
}

export async function cancelPhoneLink(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();
  await OtpChallengeModel.updateMany(
    { userId, purpose: 'phone_verify', consumedAt: null },
    { consumedAt: new Date() },
  );
  user.pendingPhone = null;
  await user.save();
  return toUserDto(user.toObject());
}

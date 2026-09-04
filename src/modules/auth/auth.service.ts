import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { config } from '../../core/config.js';
import { AppError, ErrorCode, err } from '../../core/errors.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import {
  generateOtpCode, generateRefreshToken, hashToken, issueAccessToken, type Role,
} from '../../core/tokens.js';
import { logger } from '../../core/logger.js';
import { emailMessage, generateLinkToken, messenger, appUrl, type EmailMessage } from '../../core/messaging.js';
import { verifyGoogleIdToken } from '../../core/google.js';
import { UserModel } from '../users/user.model.js';
import { applyConfirmedEmail } from '../users/email-change.service.js';
import { findUserByPhone } from '../users/phone-link.service.js';
import { OtpChallengeModel, RefreshTokenModel } from './session.model.js';
import type { DeviceInfoInput, LoginInput, RegisterInput } from './auth.schema.js';

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

function minutes(n: number): Date {
  return new Date(Date.now() + n * 60_000);
}
function days(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

export interface SessionPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Issues an access/refresh pair and records the refresh family. */
async function issueSession(user: {
  _id: Types.ObjectId | string;
  role: Role;
  garageId?: Types.ObjectId | string | null;
}, opts: {
  familyId?: string;
  rotatedFrom?: string;
  device?: DeviceInfoInput;
  deviceLabel?: string | null;
  platform?: string | null;
} = {}): Promise<SessionPair> {
  const access = issueAccessToken({
    userId: String(user._id),
    role: user.role,
    ...(user.garageId ? { garageId: String(user.garageId) } : {}),
  });

  const refresh = generateRefreshToken();
  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: refresh.hash,
    familyId: opts.familyId ?? crypto.randomUUID(),
    rotatedFrom: opts.rotatedFrom ?? null,
    deviceLabel: opts.device?.label ?? opts.deviceLabel ?? null,
    platform: opts.device?.platform ?? opts.platform ?? 'unknown',
    lastActiveAt: new Date(),
    expiresAt: days(config.REFRESH_TOKEN_TTL_DAYS),
  });

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: access.expiresIn,
  };
}

/* ─────────────────────────── Email signup ─────────────────────────── */

export async function register(input: RegisterInput) {
  const existing = await UserModel.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Cette adresse e-mail est déjà utilisée.',
      'email',
    );
  }
  if (input.phone) {
    const byPhone = await UserModel.findOne({
      deletedAt: null,
      $or: [{ phone: input.phone }, { pendingPhone: input.phone }],
    })
      .select('_id')
      .lean();
    if (byPhone) {
      throw err.conflict(ErrorCode.PHONE_ALREADY_EXISTS, 'Ce numéro est déjà utilisé.', 'phone');
    }
  }

  const user = await UserModel.create({
    role: 'owner',
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? null,
    passwordHash: await hashPassword(input.password),
    passwordChangedAt: new Date(),
  });

  const email = await sendEmailVerification(String(user._id), input.email);

  // No session before verification: the app shows screen O16.
  return {
    userId: String(user._id),
    verificationRequired: true,
    verificationChannel: 'email' as const,
    expiresAt: minutes(60),
    email,
  };
}

export async function sendEmailVerification(userId: string, email: string): Promise<EmailMessage> {
  const { token, hash } = generateLinkToken();
  await OtpChallengeModel.create({
    identifier: email,
    channel: 'email',
    purpose: 'email_verify',
    codeHash: hash,
    maxAttempts: 5,
    userId,
    expiresAt: minutes(60),
  });
  const message = emailMessage(
    email,
    'Confirmez votre adresse ChapGo',
    `Confirmez votre adresse : ${appUrl(`/auth/verify-email?token=${token}`)}`,
  );
  if (process.env.NODE_ENV === 'test') await messenger.sendEmail(message.to, message.subject, message.body);
  return message;
}

export async function verifyEmail(token: string): Promise<SessionPair & { emailChanged: boolean }> {
  const hash = hashToken(token);
  const challenge = await OtpChallengeModel.findOne({
    codeHash: hash,
    purpose: { $in: ['email_verify', 'email_change'] },
    consumedAt: null,
  });

  if (!challenge) {
    throw err.custom(410, ErrorCode.TOKEN_ALREADY_USED, 'Ce lien a déjà été utilisé.');
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw err.custom(410, ErrorCode.TOKEN_EXPIRED, 'Ce lien de vérification a expiré.');
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  if (challenge.purpose === 'email_change') {
    const user = await applyConfirmedEmail(String(challenge.userId), challenge.identifier);
    return { ...(await issueSession(user)), emailChanged: true };
  }

  const user = await UserModel.findById(challenge.userId);
  if (!user) throw err.notFound('Compte introuvable.');
  user.emailVerifiedAt = new Date();
  await user.save();

  // Opens the session directly: asking someone to sign in seconds after
  // confirming their address is friction with no security benefit.
  return { ...(await issueSession(user)), emailChanged: false };
}

/* ──────────────────────────── Email login ─────────────────────────── */

export async function login(input: LoginInput): Promise<{ session: SessionPair; user: unknown }> {
  const user = await UserModel.findOne({ email: input.email, deletedAt: null });

  // Same error whichever field is wrong — never disclose which.
  const invalid = () =>
    err.custom(401, ErrorCode.INVALID_CREDENTIALS, "L'e-mail ou le mot de passe est incorrect.");

  if (!user?.passwordHash) throw invalid();

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw err.custom(
      423,
      ErrorCode.ACCOUNT_LOCKED,
      'Compte temporairement bloqué après plusieurs tentatives. Réessayez dans quelques minutes.',
    );
  }

  const okPassword = await verifyPassword(user.passwordHash, input.password);
  if (!okPassword) {
    user.failedLoginCount += 1;
    if (user.failedLoginCount >= MAX_FAILED_LOGINS) {
      user.lockedUntil = minutes(LOCK_MINUTES);
      user.failedLoginCount = 0;
    }
    await user.save();

    const left = MAX_FAILED_LOGINS - user.failedLoginCount;
    throw new AppError({
      status: 401,
      code: ErrorCode.INVALID_CREDENTIALS,
      message: "L'e-mail ou le mot de passe est incorrect.",
      details: left > 0 && left <= 3 ? { attemptsLeft: left } : undefined,
    });
  }

  if (!user.emailVerifiedAt) {
    throw err.custom(
      403,
      ErrorCode.ACCOUNT_NOT_VERIFIED,
      "Confirmez votre adresse e-mail avant de vous connecter.",
    );
  }

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();

  return { session: await issueSession(user, { device: input.device }), user };
}

/* ───────────────────────── Refresh & logout ──────────────────────── */

export async function refresh(token: string, device?: DeviceInfoInput): Promise<SessionPair> {
  const hash = hashToken(token);
  const stored = await RefreshTokenModel.findOne({ tokenHash: hash });

  const invalid = () =>
    err.custom(401, ErrorCode.REFRESH_TOKEN_INVALID, 'Votre session a expiré. Reconnectez-vous.');

  if (!stored) throw invalid();

  /**
   * Reuse of an already-rotated token means the token was captured. Revoke
   * the entire family: better to sign a legitimate user out than to leave an
   * attacker holding a live session.
   */
  if (stored.revokedAt) {
    await RefreshTokenModel.updateMany(
      { familyId: stored.familyId, revokedAt: null },
      { revokedAt: new Date() },
    );
    throw invalid();
  }

  if (stored.expiresAt.getTime() < Date.now()) throw invalid();

  const user = await UserModel.findById(stored.userId);
  if (!user || user.deletedAt) throw invalid();

  stored.revokedAt = new Date();
  await stored.save();

  return issueSession(user, {
    familyId: stored.familyId,
    rotatedFrom: hash,
    device,
    deviceLabel: stored.deviceLabel,
    platform: stored.platform,
  });
}

export async function logout(refreshTokenValue?: string): Promise<void> {
  // Logout must never fail visibly: the client purges local state regardless.
  if (!refreshTokenValue) return;
  const stored = await RefreshTokenModel.findOne({
    tokenHash: hashToken(refreshTokenValue),
  }).select('familyId').lean();
  if (!stored) return;
  await RefreshTokenModel.updateMany(
    { familyId: stored.familyId, revokedAt: null },
    { revokedAt: new Date() },
  );
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await RefreshTokenModel.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });
}

/* ───────────────────────── Password recovery ─────────────────────── */

export async function forgotPassword(email: string): Promise<EmailMessage | null> {
  const user = await UserModel.findOne({ email, deletedAt: null }).select('_id').lean();

  // ALWAYS returns without error, even for an unknown address — otherwise
  // the endpoint confirms which addresses have accounts. The screen copy
  // says so explicitly: « Si un compte existe pour cette adresse… ».
  if (!user) return null;

  // A new request invalidates unused reset links so only the latest works.
  await OtpChallengeModel.updateMany(
    { identifier: email, purpose: 'password_reset', consumedAt: null },
    { consumedAt: new Date() },
  );

  const { token, hash } = generateLinkToken();
  await OtpChallengeModel.create({
    identifier: email,
    channel: 'email',
    purpose: 'password_reset',
    codeHash: hash,
    maxAttempts: 5,
    userId: user._id,
    expiresAt: minutes(60),
  });

  const resetUrl = appUrl(`/auth/reset?token=${token}`);
  const message = emailMessage(
    email,
    'Réinitialisez votre mot de passe ChapGo',
    [
      'Vous avez demandé à réinitialiser votre mot de passe ChapGo.',
      '',
      'Ouvrez ce lien pour en choisir un nouveau (valable 1 heure) :',
      resetUrl,
      '',
      "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    ].join('\n'),
  );
  if (process.env.NODE_ENV === 'test') await messenger.sendEmail(message.to, message.subject, message.body);
  return message;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const challenge = await OtpChallengeModel.findOne({
    codeHash: hashToken(token),
    purpose: 'password_reset',
    consumedAt: null,
  });

  if (!challenge) {
    throw err.custom(410, ErrorCode.TOKEN_ALREADY_USED, 'Ce lien a déjà été utilisé.');
  }
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw err.custom(410, ErrorCode.TOKEN_EXPIRED, 'Ce lien a expiré. Demandez-en un nouveau.');
  }

  const user = await UserModel.findById(challenge.userId);
  if (!user) throw err.notFound('Compte introuvable.');

  user.passwordHash = await hashPassword(password);
  user.passwordChangedAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();

  challenge.consumedAt = new Date();
  await challenge.save();

  // A password change invalidates every session: if the reset followed a
  // compromise, leaving other devices signed in defeats the purpose.
  await revokeAllSessions(String(user._id));
}

/* ────────────────────────── Phone / SMS ──────────────────────────── */

export interface PhoneChallengeResult {
  phone: string;
  isNewAccount: boolean;
  resendDelaySeconds: number;
  expiresAt: Date;
}

export async function requestPhoneCode(phone: string): Promise<PhoneChallengeResult> {
  const existing = await findUserByPhone(phone);

  // Server-side cooldown. The client countdown is a convenience, not the guard.
  const recent = await OtpChallengeModel.findOne({
    identifier: phone,
    purpose: 'phone_login',
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

  // Supersede any pending challenge for this number.
  await OtpChallengeModel.updateMany(
    { identifier: phone, purpose: 'phone_login', consumedAt: null },
    { consumedAt: new Date() },
  );

  const code = generateOtpCode(6);
  await OtpChallengeModel.create({
    identifier: phone,
    channel: 'sms',
    purpose: 'phone_login',
    codeHash: hashToken(code),
    maxAttempts: config.OTP_MAX_ATTEMPTS,
    userId: existing?._id ?? null,
    expiresAt: minutes(config.OTP_TTL_MIN),
    lastSentAt: new Date(),
  });

  await messenger.sendSms(phone, `Votre code ChapGo : ${code}`);

  return {
    phone,
    /**
     * Tells the app whether to route to profile completion (O19) or straight
     * into the application. It does reveal whether a number is registered —
     * acceptable because the caller already holds the number, and it avoids
     * a second round trip on a slow network.
     */
    isNewAccount: !existing,
    resendDelaySeconds: config.OTP_RESEND_COOLDOWN_SEC,
    expiresAt: minutes(config.OTP_TTL_MIN),
  };
}

export async function verifyPhoneCode(
  phone: string,
  code: string,
  device?: DeviceInfoInput,
): Promise<{ session: SessionPair; user: unknown; isNewAccount: boolean }> {
  const challenge = await OtpChallengeModel.findOne({
    identifier: phone,
    purpose: 'phone_login',
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

  challenge.consumedAt = new Date();
  await challenge.save();

  let user = challenge.userId ? await UserModel.findById(challenge.userId) : null;
  let isNewAccount = false;

  if (!user) {
    user = await UserModel.create({
      role: 'owner',
      firstName: '',
      lastName: '',
      phone,
      phoneVerifiedAt: new Date(),
    });
    isNewAccount = true;
  } else {
    user.phone = phone;
    user.phoneVerifiedAt = new Date();
    user.pendingPhone = null;
    await user.save();
  }

  return { session: await issueSession(user, { device }), user, isNewAccount };
}

/* ────────────────────────── Google OAuth ─────────────────────────── */

export async function loginWithGoogle(
  idToken: string,
  device?: DeviceInfoInput,
): Promise<{ session: SessionPair; user: unknown; isNewAccount: boolean }> {
  const profile = await verifyGoogleIdToken(idToken);

  const byGoogle = await UserModel.findOne({ googleId: profile.googleId, deletedAt: null });
  if (byGoogle) {
    return { session: await issueSession(byGoogle, { device }), user: byGoogle, isNewAccount: false };
  }

  const byEmail = await UserModel.findOne({
    deletedAt: null,
    $or: [{ email: profile.email }, { pendingEmail: profile.email }],
  });
  if (byEmail) {
    if (byEmail.googleId && byEmail.googleId !== profile.googleId) {
      throw err.conflict(
        ErrorCode.EMAIL_ALREADY_EXISTS,
        'Cette adresse e-mail est déjà liée à un autre compte.',
        'email',
      );
    }
    byEmail.googleId = profile.googleId;
    if (byEmail.email !== profile.email) {
      byEmail.email = profile.email;
      byEmail.pendingEmail = null;
    }
    byEmail.emailVerifiedAt = byEmail.emailVerifiedAt ?? new Date();
    if (!byEmail.firstName) byEmail.firstName = profile.firstName;
    if (!byEmail.lastName) byEmail.lastName = profile.lastName;
    await byEmail.save();
    return { session: await issueSession(byEmail, { device }), user: byEmail, isNewAccount: false };
  }

  const user = await UserModel.create({
    role: 'owner',
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    googleId: profile.googleId,
    emailVerifiedAt: new Date(),
  });

  return { session: await issueSession(user, { device }), user, isNewAccount: true };
}


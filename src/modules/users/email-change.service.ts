import { err, ErrorCode } from '../../core/errors.js';
import { logger } from '../../core/logger.js';
import { verifyGoogleIdToken } from '../../core/google.js';
import { verifyPassword } from '../../core/password.js';
import { emailMessage, generateLinkToken, messenger, appUrl, type EmailMessage } from '../../core/messaging.js';
import { OtpChallengeModel } from '../auth/session.model.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';

function minutes(n: number): Date {
  return new Date(Date.now() + n * 60_000);
}

async function emailTaken(email: string, exceptUserId: string): Promise<boolean> {
  const taken = await UserModel.findOne({
    email,
    deletedAt: null,
    _id: { $ne: exceptUserId },
  })
    .select('_id')
    .lean();
  return Boolean(taken);
}

/**
 * Password account → current password.
 * Google-only → a fresh Google ID token for the linked account.
 * Either is enough when both are linked.
 * Phone-only adding a first address → the live session is enough.
 */
async function assertEmailChangeProof(
  user: {
    passwordHash?: string | null;
    googleId?: string | null;
    email?: string | null;
    emailVerifiedAt?: Date | null;
  },
  input: { password?: string; googleIdToken?: string },
) {
  const replacingVerified = Boolean(user.email && user.emailVerifiedAt);
  if (!replacingVerified) return;

  if (user.passwordHash && input.password) {
    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      throw err.custom(401, ErrorCode.INVALID_CREDENTIALS, 'Mot de passe incorrect.', {
        field: 'password',
      });
    }
    return;
  }

  if (user.googleId && input.googleIdToken) {
    const profile = await verifyGoogleIdToken(input.googleIdToken);
    if (profile.googleId !== user.googleId) {
      throw err.custom(
        401,
        ErrorCode.GOOGLE_TOKEN_INVALID,
        'Connectez-vous avec le compte Google déjà lié à ChapGo.',
      );
    }
    return;
  }

  if (user.passwordHash) {
    throw err.validation('Saisissez votre mot de passe pour changer d’adresse.', 'password');
  }
  if (user.googleId) {
    throw err.validation(
      'Confirmez avec Google pour changer d’adresse e-mail.',
      'googleIdToken',
    );
  }
}

async function sendChangeLink(userId: string, newEmail: string): Promise<EmailMessage> {
  await OtpChallengeModel.updateMany(
    { userId, purpose: 'email_change', consumedAt: null },
    { consumedAt: new Date() },
  );

  const { token, hash } = generateLinkToken();
  await OtpChallengeModel.create({
    identifier: newEmail,
    channel: 'email',
    purpose: 'email_change',
    codeHash: hash,
    maxAttempts: 5,
    userId,
    expiresAt: minutes(60),
  });

  const message = emailMessage(
    newEmail,
    'Confirmez votre nouvelle adresse ChapGo',
    `Confirmez votre nouvelle adresse : ${appUrl(`/auth/verify-email?token=${token}`)}`,
  );
  if (process.env.NODE_ENV === 'test') await messenger.sendEmail(message.to, message.subject, message.body);
  return message;
}

export async function requestEmailChange(
  userId: string,
  input: { email: string; password?: string; googleIdToken?: string },
) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();

  const next = input.email.trim().toLowerCase();
  if (user.email && next === user.email) {
    throw err.validation('C’est déjà votre adresse e-mail.', 'email');
  }
  if (await emailTaken(next, userId)) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Cette adresse e-mail est déjà utilisée.',
      'email',
    );
  }

  await assertEmailChangeProof(user, input);

  const previous = user.email;
  user.pendingEmail = next;
  await user.save();

  let email: EmailMessage;
  try {
    email = await sendChangeLink(userId, next);
  } catch (cause) {
    logger.error({ err: cause }, 'email change confirmation failed');
    user.pendingEmail = null;
    await user.save();
    throw err.custom(
      503,
      ErrorCode.PROVIDER_UNAVAILABLE,
      'Impossible d’envoyer l’e-mail de confirmation. Réessayez.',
    );
  }

  if (previous) {
    try {
      if (process.env.NODE_ENV === 'test') {
        await messenger.sendEmail(
          previous,
          'Changement d’adresse e-mail ChapGo',
          'Une demande de changement d’adresse e-mail a été faite sur votre compte ChapGo. '
          + 'Votre adresse actuelle reste valable jusqu’à confirmation de la nouvelle. '
          + 'Si ce n’est pas vous, changez votre mot de passe depuis l’application.',
        );
      }
    } catch (cause) {
      logger.error({ err: cause }, 'email change notice to previous address failed');
    }
  }

  return { ...toUserDto(user.toObject()), emailMessage: email };
}

export async function resendEmailChange(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user?.pendingEmail) {
    throw err.validation('Aucune modification d’e-mail en attente.');
  }
  if (await emailTaken(user.pendingEmail, userId)) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Cette adresse e-mail est déjà utilisée.',
      'email',
    );
  }
  const email = await sendChangeLink(userId, user.pendingEmail);
  return { ...toUserDto(user.toObject()), emailMessage: email };
}

export async function cancelEmailChange(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();
  await OtpChallengeModel.updateMany(
    { userId, purpose: 'email_change', consumedAt: null },
    { consumedAt: new Date() },
  );
  user.pendingEmail = null;
  await user.save();
  return toUserDto(user.toObject());
}

export async function applyConfirmedEmail(userId: string, newEmail: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.notFound('Compte introuvable.');
  if (await emailTaken(newEmail, userId)) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Cette adresse e-mail est déjà utilisée.',
      'email',
    );
  }
  user.email = newEmail;
  user.emailVerifiedAt = new Date();
  user.pendingEmail = null;
  await user.save();
  return user;
}

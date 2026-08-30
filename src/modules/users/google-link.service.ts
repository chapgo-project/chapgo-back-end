import { err, ErrorCode } from '../../core/errors.js';
import { verifyGoogleIdToken } from '../../core/google.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';

/**
 * Attach a Google identity to the signed-in account (Settings → Link Google).
 * Unauthenticated Google sign-in still lives in auth.service — it *finds*
 * an account by email; this endpoint *adds* Google to the current one.
 */
export async function linkGoogleAccount(userId: string, idToken: string) {
  const profile = await verifyGoogleIdToken(idToken);
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();

  if (user.googleId && user.googleId !== profile.googleId) {
    throw err.conflict(
      ErrorCode.GOOGLE_TOKEN_INVALID,
      'Ce compte est déjà lié à un autre compte Google.',
    );
  }

  const byGoogle = await UserModel.findOne({
    googleId: profile.googleId,
    deletedAt: null,
  }).select('_id').lean();
  if (byGoogle && String(byGoogle._id) !== userId) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Ce compte Google est déjà lié à un autre utilisateur.',
    );
  }

  const byEmail = await UserModel.findOne({
    email: profile.email,
    deletedAt: null,
  }).select('_id').lean();
  if (byEmail && String(byEmail._id) !== userId) {
    throw err.conflict(
      ErrorCode.EMAIL_ALREADY_EXISTS,
      'Cette adresse Google appartient déjà à un autre compte.',
      'email',
    );
  }

  user.googleId = profile.googleId;
  if (!user.email) {
    user.email = profile.email;
    user.emailVerifiedAt = new Date();
    user.pendingEmail = null;
  } else if (user.email === profile.email) {
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  }
  if (!user.firstName) user.firstName = profile.firstName;
  if (!user.lastName) user.lastName = profile.lastName;
  await user.save();
  return toUserDto(user.toObject());
}

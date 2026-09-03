import { err, ErrorCode } from '../../core/errors.js';
import {
  AVATAR_EAGER,
  AVATAR_MAX_BYTES,
  avatarPublicId,
  destroyImage,
  isCloudinaryConfigured,
  signUpload,
} from '../../core/cloudinary.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';

function requireCloudinary() {
  if (!isCloudinaryConfigured()) {
    throw err.custom(
      503,
      ErrorCode.PROVIDER_UNAVAILABLE,
      "Le stockage des photos n'est pas configuré.",
    );
  }
}

export function createAvatarSign(userId: string) {
  requireCloudinary();
  const publicId = avatarPublicId(userId);
  const signed = signUpload({
    public_id: publicId,
    overwrite: 'true',
    invalidate: 'true',
    eager: AVATAR_EAGER,
  });
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`,
    publicId,
    maxBytes: AVATAR_MAX_BYTES,
    fields: {
      api_key: signed.apiKey,
      timestamp: String(signed.timestamp),
      signature: signed.signature,
      public_id: publicId,
      overwrite: 'true',
      invalidate: 'true',
      eager: AVATAR_EAGER,
    },
  };
}

export async function confirmAvatar(userId: string, publicId: string, version: number) {
  if (publicId !== avatarPublicId(userId)) {
    throw err.validation('Identifiant photo invalide.', 'publicId');
  }
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();
  user.avatarPublicId = publicId;
  user.avatarVersion = version;
  await user.save();
  return toUserDto(user.toObject());
}

export async function deleteAvatar(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw err.unauthenticated();
  const previous = user.avatarPublicId;
  user.avatarPublicId = null;
  user.avatarVersion = null;
  await user.save();
  if (previous) {
    try {
      await destroyImage(String(previous));
    } catch {
      // Account state is already cleared; Cloudinary cleanup is best-effort.
    }
  }
  return toUserDto(user.toObject());
}

export async function purgeStoredAvatar(publicId: string | null | undefined) {
  if (!publicId) return;
  try {
    await destroyImage(String(publicId));
  } catch {
    // Soft-delete must not fail because a CDN call timed out.
  }
}

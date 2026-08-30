import type { Types } from 'mongoose';
import { avatarDeliveryUrl } from '../../core/cloudinary.js';

/**
 * Serialization. `id` not `_id`, and never a hash.
 *
 * Field names match lib/shared/models/user.dart exactly — a rename here
 * breaks fromJson on the client.
 */
export function toUserDto(u: Record<string, any>) {
  return {
    id: String(u._id),
    role: u.role,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email ?? null,
    phone: u.phone ?? null,
    photoId: u.photoId ? String(u.photoId) : null,
    avatarUrl: avatarDeliveryUrl(u.avatarPublicId, u.avatarVersion),
    pendingEmail: u.pendingEmail ?? null,
    pendingPhone: u.pendingPhone ?? null,
    googleLinked: Boolean(u.googleId),
    emailVerified: Boolean(u.emailVerifiedAt),
    phoneVerified: Boolean(u.phoneVerifiedAt),
    garageId: u.garageId ? String(u.garageId) : null,
    preferences: {
      language: u.preferences?.language ?? 'fr',
      distanceUnit: u.preferences?.distanceUnit ?? 'km',
      currency: u.preferences?.currency ?? 'XOF',
      dateFormat: u.preferences?.dateFormat ?? 'dd/MM/yyyy',
    },
    notificationPrefs: {
      maintenance: u.notificationPrefs?.maintenance ?? true,
      checks: u.notificationPrefs?.checks ?? true,
      documents: u.notificationPrefs?.documents ?? true,
      inspection: u.notificationPrefs?.inspection ?? true,
      garage: u.notificationPrefs?.garage ?? true,
      garageEvents: u.notificationPrefs?.garage ?? true,
      mileagePrompt: u.notificationPrefs?.mileagePrompt ?? false,
      dailyDigestEnabled: u.notificationPrefs?.dailyDigestEnabled ?? true,
      dailyDigestHour: u.notificationPrefs?.dailyDigestHour ?? 9,
      promotions: u.notificationPrefs?.promotions ?? false,
    },
    createdAt: u.createdAt,
    hasPassword: Boolean(u.passwordHash),
  };
}

/**
 * Narrowed view for a garage.
 *
 * Only what the grant allows: a display name, and the phone only if the
 * owner shared it. No email, no address, no other vehicles.
 */
export function toCustomerDto(
  u: Record<string, any>,
  opts: { includePhone: boolean },
) {
  return {
    id: String(u._id),
    firstName: u.firstName,
    lastName: u.lastName,
    phone: opts.includePhone ? (u.phone ?? null) : null,
  };
}

export type UserId = Types.ObjectId | string;

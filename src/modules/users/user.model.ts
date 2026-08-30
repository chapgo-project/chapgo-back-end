import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ROLES } from '../../types/enums.js';

/**
 * ONE collection for owners, garage staff and admins.
 *
 * Two identity systems would duplicate every auth endpoint, and a garage
 * owner who also owns a car needs a single account.
 */
const UserSchema = new Schema(
  {
    role: { type: String, enum: ROLES, required: true, default: 'owner' },

    // Empty until SMS profile completion (O19). Email/Google always fill them.
    firstName: { type: String, required: false, trim: true, maxlength: 50, default: '' },
    lastName: { type: String, required: false, trim: true, maxlength: 50, default: '' },

    // Optional: an SMS signup has no email, an email signup no phone.
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, trim: true, default: null },

    passwordHash: { type: String, default: null },
    googleId: { type: String, default: null },

    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },

    /** Set while a change is waiting on the new inbox. Login still uses `email`. */
    pendingEmail: { type: String, lowercase: true, trim: true, default: null },

    /** Set while a new number is waiting on the SMS code. Login still uses `phone`. */
    pendingPhone: { type: String, trim: true, default: null },

    photoId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },

    /** Cloudinary public id (`chapgo/users/{id}/profile`) and asset version. */
    avatarPublicId: { type: String, default: null },
    avatarVersion: { type: Number, default: null },

    // Garage staff only.
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },

    preferences: {
      language: { type: String, default: 'fr' },
      distanceUnit: { type: String, enum: ['km', 'mi'], default: 'km' },
      currency: { type: String, default: 'XOF' },
      dateFormat: { type: String, default: 'dd/MM/yyyy' },
    },

    notificationPrefs: {
      maintenance: { type: Boolean, default: true },
      checks: { type: Boolean, default: true },
      documents: { type: Boolean, default: true },
      inspection: { type: Boolean, default: true },
      garage: { type: Boolean, default: true },
      mileagePrompt: { type: Boolean, default: false },
      dailyDigestEnabled: { type: Boolean, default: true },
      dailyDigestHour: { type: Number, min: 0, max: 23, default: 9 },
      // Commercial messages: OFF by default. Consent must be given, not assumed.
      promotions: { type: Boolean, default: false },
    },

    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    /**
     * Soft delete. Personal fields are cleared and the vehicle history is
     * anonymised but RETAINED — it belongs to the vehicle, and a future
     * owner has a legitimate claim to it.
     */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);

// Partial unique: a plain unique index would reject the second null.
UserSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
);
UserSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: 'string' } } },
);
UserSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } },
);
UserSchema.index({ garageId: 1 });

export type User = InferSchemaType<typeof UserSchema>;
export const UserModel = mongoose.models.User ?? mongoose.model('User', UserSchema);

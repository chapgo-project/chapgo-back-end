import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Refresh tokens.
 *
 * Server state is required: without it a stolen refresh token stays valid
 * for 30 days with no way to revoke. Only the HASH is stored, so a database
 * leak does not hand over live sessions.
 */
const RefreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    deviceLabel: { type: String, default: null },
    platform: { type: String, enum: ['ios', 'android', 'web', 'unknown'], default: 'unknown' },
    lastActiveAt: { type: Date, default: Date.now },
    /** Rotation chain: reuse of a rotated token revokes the whole family. */
    rotatedFrom: { type: String, default: null },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'refreshTokens' },
);

RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ familyId: 1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshToken = InferSchemaType<typeof RefreshTokenSchema>;
export const RefreshTokenModel =
  (mongoose.models.RefreshToken as mongoose.Model<RefreshToken> | undefined) ??
  mongoose.model<RefreshToken>('RefreshToken', RefreshTokenSchema);

/**
 * OTP and one-time link challenges.
 *
 * Attempt counting and expiry belong here, not in Flutter. The screens
 * already implement "3 attempts then locked" — this is what enforces it.
 */
const OtpChallengeSchema = new Schema(
  {
    /** Phone in E.164, or lowercase email. */
    identifier: { type: String, required: true },
    channel: { type: String, enum: ['sms', 'email'], required: true },
    purpose: {
      type: String,
      enum: ['phone_login', 'phone_verify', 'email_verify', 'email_change', 'password_reset'],
      required: true,
    },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, required: true },
    /** Set when the identifier belongs to an existing account. */
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'otpChallenges' },
);

OtpChallengeSchema.index({ identifier: 1, purpose: 1 });
OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OtpChallenge = InferSchemaType<typeof OtpChallengeSchema>;
export const OtpChallengeModel =
  (mongoose.models.OtpChallenge as mongoose.Model<OtpChallenge> | undefined) ??
  mongoose.model<OtpChallenge>('OtpChallenge', OtpChallengeSchema);

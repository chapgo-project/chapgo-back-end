import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from '../../types/enums.js';

/**
 * One feed. The alerts screen (H5) is `?critical=true` over this same
 * collection — a second collection would mean two things to keep in sync.
 */
const NotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 500 },
    critical: { type: Boolean, default: false },

    /** Deep link target: the app routes on these two fields. */
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },

    readAt: { type: Date, default: null },
    pushSentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'notifications' },
);

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, critical: 1, createdAt: -1 });

export type Notification = InferSchemaType<typeof NotificationSchema>;
export const NotificationModel =
  mongoose.models.Notification ?? mongoose.model('Notification', NotificationSchema);

/** Push registration. Prepared now, delivery wired later. */
const DeviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['ios', 'android'], required: true },
    token: { type: String, required: true, unique: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'deviceTokens' },
);

DeviceTokenSchema.index({ userId: 1 });

export const DeviceTokenModel =
  mongoose.models.DeviceToken ?? mongoose.model('DeviceToken', DeviceTokenSchema);

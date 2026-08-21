import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ACCESS_STATUSES } from '../../types/enums.js';

/**
 * THE garage permission mechanism.
 *
 * One collection; the two applications act on it from opposite sides — a
 * garage requests, an owner decides. Bound to an ownershipId so a vehicle
 * transfer invalidates every grant automatically.
 */
const AccessSchema = new Schema(
  {
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownershipId: { type: Schema.Types.ObjectId, ref: 'VehicleOwnership', required: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    status: { type: String, enum: ACCESS_STATUSES, required: true, default: 'pending' },
    /**
     * owner  — the owner scanned the garage QR: created directly as approved.
     * garage — the garage asked: pending until the owner decides.
     */
    requestedBy: { type: String, enum: ['owner', 'garage'], required: true },
    requestMessage: { type: String, default: null, maxlength: 500 },

    grantedAt: { type: Date, default: null },
    /** null = "until revoked", a legitimate choice for a habitual garage. */
    expiresAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },

    /** Per-grant scope, both default false. */
    sharePhone: { type: Boolean, default: false },
    shareHistoryBefore: { type: Boolean, default: false },

    expiryNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'garageVehicleAccesses' },
);

// On the hot path of EVERY garage request — see resolveVehicleScope.
AccessSchema.index({ garageId: 1, vehicleId: 1, status: 1 });
AccessSchema.index({ ownerUserId: 1, status: 1 });
AccessSchema.index({ expiresAt: 1 }, { sparse: true });

export type GarageVehicleAccess = InferSchemaType<typeof AccessSchema>;
export const AccessModel =
  mongoose.models.GarageVehicleAccess ??
  mongoose.model('GarageVehicleAccess', AccessSchema);

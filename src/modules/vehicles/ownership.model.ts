import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Ownership periods.
 *
 * The record follows the VEHICLE, not the owner. Every maintenance event and
 * mileage entry carries its ownershipId, so the app renders
 * "before / since my purchase" without inventing the boundary — and a garage
 * grant tied to a period dies automatically when the vehicle changes hands.
 */
const OwnershipSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date, required: true, default: Date.now },
    /** null = current period. */
    endedAt: { type: Date, default: null },

    /**
     * The owner's explicit choice to expose technical history created before
     * their purchase. Default false. Technical fields only — never a previous
     * owner's name, phone, email or address.
     */
    shareHistoryBefore: { type: Boolean, default: false },

    startMileage: { type: Number, default: null },
  },
  { timestamps: true, collection: 'vehicleOwnerships' },
);

OwnershipSchema.index({ vehicleId: 1, endedAt: 1 });
OwnershipSchema.index({ userId: 1, endedAt: 1 });
// At most one current period per vehicle.
OwnershipSchema.index(
  { vehicleId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null } },
);

export type Ownership = InferSchemaType<typeof OwnershipSchema>;
export const OwnershipModel =
  mongoose.models.VehicleOwnership ?? mongoose.model('VehicleOwnership', OwnershipSchema);

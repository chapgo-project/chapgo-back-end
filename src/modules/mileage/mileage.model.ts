import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { MILEAGE_SOURCES } from '../../types/enums.js';

/**
 * Mileage history. APPEND-ONLY.
 *
 * A correction adds an entry carrying its reason; nothing is overwritten.
 * This is precisely what makes the record credible to a future buyer — an
 * editable odometer history is worth nothing.
 */
const MileageSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownershipId: { type: Schema.Types.ObjectId, ref: 'VehicleOwnership', required: true },

    value: { type: Number, required: true, min: 0 },
    recordedAt: { type: Date, required: true, default: Date.now },

    /**
     * owner_manual   — typed by the owner, possibly from memory
     * garage_onsite  — read at the counter by a professional
     * intervention   — captured during an intervention
     *
     * This drives rule 2: the reference is the most recent reading taken ON
     * the vehicle, so a garage reading supersedes a remote owner entry
     * whatever the value.
     */
    source: { type: String, enum: MILEAGE_SOURCES, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorType: { type: String, enum: ['owner', 'garage'], required: true },
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },

    maintenanceEventId: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },

    estimated: { type: Boolean, default: false },
    note: { type: String, default: null, maxlength: 500 },

    /** Present only on a correction that lowers the value. */
    regressionReason: { type: String, default: null, maxlength: 500 },
    correctsEntryId: { type: Schema.Types.ObjectId, ref: 'MileageEntry', default: null },
  },
  { timestamps: true, collection: 'mileageEntries' },
);

MileageSchema.index({ vehicleId: 1, recordedAt: -1 });
MileageSchema.index({ maintenanceEventId: 1 }, { sparse: true });

export type MileageEntry = InferSchemaType<typeof MileageSchema>;
export const MileageModel =
  (mongoose.models.MileageEntry as mongoose.Model<MileageEntry> | undefined) ??
  mongoose.model<MileageEntry>('MileageEntry', MileageSchema);

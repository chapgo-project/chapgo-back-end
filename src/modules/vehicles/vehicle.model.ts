import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { FUELS, TRANSMISSIONS, HEALTH_STATUSES, VEHICLE_CONDITIONS, HISTORY_KNOWN } from '../../types/enums.js';

/** Uppercase, separators stripped — what garage search actually queries. */
export function normalizePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const HealthReasonSchema = new Schema(
  {
    code: { type: String, required: true },
    label: { type: String, required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], required: true },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null },
  },
  { _id: false },
);

const VehicleSchema = new Schema(
  {
    brand: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    version: { type: String, default: null, trim: true },
    year: { type: Number, required: true, min: 1950 },

    plate: { type: String, required: true, trim: true },
    /**
     * Indexed search field. A regex over the raw plate cannot use an index,
     * so "ABC" would never find "AB-204-CI" at scale — and finding a vehicle
     * in under 10 seconds is a stated product objective.
     */
    plateNormalized: { type: String, required: true },

    vin: { type: String, default: null, uppercase: true, trim: true },
    fuel: { type: String, enum: FUELS, required: true },
    transmission: { type: String, enum: TRANSMISSIONS, default: null },
    firstRegistrationAt: { type: Date, default: null },

    condition: { type: String, enum: VEHICLE_CONDITIONS, default: 'second_hand' },
    /** Drives the initial-assessment prompt for a second-hand purchase. */
    historyKnown: { type: String, enum: HISTORY_KNOWN, default: 'partial' },

    photoId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },

    /**
     * Denormalised from mileageEntries. Every dashboard read needs it, and
     * recomputing per request is wasteful. Written only through the mileage
     * service, never directly by a controller.
     */
    currentMileage: { type: Number, required: true, min: 0, default: 0 },
    currentMileageAt: { type: Date, default: Date.now },
    currentMileageSource: { type: String, default: 'owner_manual' },
    currentMileageEstimated: { type: Boolean, default: false },

    /**
     * Computed, cached, invalidated on any relevant write — never the source
     * of truth. Health is a pure function of reminders, documents and issues;
     * storing it as truth invites drift.
     */
    healthCache: {
      status: { type: String, enum: HEALTH_STATUSES, default: 'good' },
      reasons: { type: [HealthReasonSchema], default: [] },
      computedAt: { type: Date, default: null },
    },

    isPrimary: { type: Boolean, default: false },
    /** Archive rather than delete: a vehicle with history must not vanish. */
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'vehicles' },
);

VehicleSchema.index({ plateNormalized: 1 });
VehicleSchema.index({ vin: 1 }, { sparse: true });
VehicleSchema.index({ brand: 'text', model: 'text' });

VehicleSchema.pre('validate', function (next) {
  if (this.isModified('plate') && typeof this.plate === 'string') {
    this.plateNormalized = normalizePlate(this.plate);
  }
  next();
});

export type Vehicle = InferSchemaType<typeof VehicleSchema>;
export const VehicleModel = mongoose.models.Vehicle ?? mongoose.model('Vehicle', VehicleSchema);

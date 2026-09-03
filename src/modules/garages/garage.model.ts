import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { GARAGE_VERIFICATION, REGIONS } from '../../types/enums.js';

const OpeningHoursSchema = new Schema(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    open: { type: String, default: null },   // "08:00"
    close: { type: String, default: null },
    closed: { type: Boolean, default: false },
  },
  { _id: false },
);

const GarageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    managerName: { type: String, default: null, trim: true },
    email: { type: String, lowercase: true, trim: true, default: null },
    phone: { type: String, required: true, trim: true },

    address: { type: String, default: null, trim: true },
    commune: { type: String, default: null, trim: true },
    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },

    registrationNumber: { type: String, default: null, trim: true },
    logoId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    services: { type: [String], default: [] },
    openingHours: { type: [OpeningHoursSchema], default: [] },

    /**
     * An unverified garage reaches NO customer data. Enforced in middleware
     * on the whole garage router, not per route.
     */
    verificationStatus: { type: String, enum: GARAGE_VERIFICATION, default: 'pending' },
    verifiedAt: { type: Date, default: null },
    verifiedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },

    /** Selects the pricing grid. Derived from the country at signup. */
    region: { type: String, enum: REGIONS, default: 'CI' },

    /** Public QR payload the owner scans to grant access (screen G3). */
    connectCode: { type: String, unique: true, sparse: true },
  },
  { timestamps: true, collection: 'garages' },
);

GarageSchema.index({ location: '2dsphere' });
GarageSchema.index({ verificationStatus: 1, commune: 1 });

export type Garage = InferSchemaType<typeof GarageSchema>;
export const GarageModel =
  (mongoose.models.Garage as mongoose.Model<Garage> | undefined) ?? mongoose.model<Garage>('Garage', GarageSchema);

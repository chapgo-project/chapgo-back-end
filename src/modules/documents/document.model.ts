import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { DOCUMENT_TYPES } from '../../types/enums.js';

const DocumentSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownershipId: { type: Schema.Types.ObjectId, ref: 'VehicleOwnership', required: true },

    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    reference: { type: String, default: null, trim: true },
    issuer: { type: String, default: null, trim: true },

    issuedAt: { type: Date, default: null },
    /** Status (valid / expiring_soon / expired) is COMPUTED from this, never stored. */
    expiresAt: { type: Date, default: null },

    fileIds: { type: [Schema.Types.ObjectId], default: [] },
    reminderEnabled: { type: Boolean, default: true },

    /**
     * Default FALSE. A garage sees a document only if the owner deliberately
     * shared it — an insurance certificate is not maintenance data.
     */
    shareableWithGarages: { type: Boolean, default: false },

    note: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true, collection: 'documents' },
);

DocumentSchema.index({ vehicleId: 1, type: 1 });
DocumentSchema.index({ expiresAt: 1 }, { sparse: true });

export type VehicleDocument = InferSchemaType<typeof DocumentSchema>;
export const DocumentModel =
  (mongoose.models.VehicleDocument as mongoose.Model<VehicleDocument> | undefined) ??
  mongoose.model<VehicleDocument>('VehicleDocument', DocumentSchema);

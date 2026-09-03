import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * Claiming a garage-created record.
 *
 * NEVER auto-link on phone or email alone: a wrong match would hand one
 * person's vehicle history to another, an error with no acceptable recovery.
 * The customer claims it with a secure code.
 */
const InvitationSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    createdByGarageId: { type: Schema.Types.ObjectId, ref: 'Garage', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },

    /** Minimal record the garage typed. Not an account. */
    provisionalCustomer: {
      firstName: { type: String, default: null },
      lastName: { type: String, default: null },
      phone: { type: String, default: null },
      email: { type: String, default: null },
    },

    expiresAt: { type: Date, required: true },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'invitationCodes' },
);

InvitationSchema.index({ createdByGarageId: 1 });
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Invitation = InferSchemaType<typeof InvitationSchema>;
export const InvitationModel =
  (mongoose.models.InvitationCode as mongoose.Model<Invitation> | undefined) ??
  mongoose.model<Invitation>('InvitationCode', InvitationSchema);

/** Ownership transfer between two ChapGo users. */
const TransferSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled', 'expired'],
      default: 'pending',
    },
    /** What the seller agreed to pass on. Technical data only. */
    includeHistory: { type: Boolean, default: true },
    includeDocuments: { type: Boolean, default: false },
    includePhotos: { type: Boolean, default: true },

    expiresAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'transfers' },
);

TransferSchema.index({ vehicleId: 1, status: 1 });
TransferSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Transfer = InferSchemaType<typeof TransferSchema>;
export const TransferModel =
  (mongoose.models.Transfer as mongoose.Model<Transfer> | undefined) ??
  mongoose.model<Transfer>('Transfer', TransferSchema);

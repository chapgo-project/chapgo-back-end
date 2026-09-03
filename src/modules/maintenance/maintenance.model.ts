import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import {
  MAINTENANCE_TYPES, MAINTENANCE_CATEGORIES, PROVENANCES, MAINTENANCE_STATUSES,
  ASSESSMENT_RESULTS, ASSESSMENT_CATEGORIES,
} from '../../types/enums.js';

/**
 * A replaced part. EMBEDDED, not a collection.
 *
 * A part never exists without the intervention that fitted it, and it is
 * always read with it. The parts-tracking screen is served by an aggregation
 * over these arrays, not by a join.
 */
const PartSchema = new Schema(
  {
    category: { type: String, required: true },
    label: { type: String, required: true, trim: true },
    brand: { type: String, default: null, trim: true },
    reference: { type: String, default: null, trim: true },
    quantity: { type: Number, default: 1, min: 1 },
    price: { type: Number, default: null, min: 0 },
    warrantyMonths: { type: Number, default: null },
    oldPhotoId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    newPhotoId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    nextCheckMileage: { type: Number, default: null },
    nextCheckDate: { type: Date, default: null },
    note: { type: String, default: null, maxlength: 500 },
  },
  { _id: true },
);

/** One line of the mechanical assessment. Embedded for the same reason. */
const AssessmentItemSchema = new Schema(
  {
    itemId: { type: String, required: true },
    category: { type: String, enum: ASSESSMENT_CATEGORIES, required: true },
    label: { type: String, required: true },
    result: { type: String, enum: ASSESSMENT_RESULTS, required: true },
    note: { type: String, default: null, maxlength: 500 },
    recommendedAction: { type: String, default: null },
    estimatedCost: { type: Number, default: null },
    photoIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

/**
 * Electronic diagnostic. Fault codes are free text typed by the mechanic —
 * no device integration in V1.
 */
const DiagnosticSchema = new Schema(
  {
    method: { type: String, enum: ['manual', 'imported', 'device'], required: true },
    summary: { type: String, default: null, maxlength: 2000 },
    faultCodes: { type: [String], default: [] },
    components: { type: [String], default: [] },
    reportId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    /**
     * Anything auto-extracted from an imported report stays a draft until a
     * mechanic confirms it — an OCR mistake in a vehicle record is worse
     * than no data.
     */
    extractionConfirmed: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Technical inspection fields. A subtype, not a separate collection. */
const InspectionSchema = new Schema(
  {
    result: { type: String, enum: ['pass', 'pass_with_defects', 'fail'], required: true },
    centre: { type: String, default: null },
    defects: { type: [String], default: [] },
    observations: { type: String, default: null, maxlength: 2000 },
    nextDueDate: { type: Date, default: null },
    retestRequired: { type: Boolean, default: false },
    retestDueDate: { type: Date, default: null },
    reportId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
  },
  { _id: false },
);

/** A future service the garage proposes. Becomes a PROPOSED reminder. */
const RecommendationSchema = new Schema(
  {
    label: { type: String, required: true },
    category: { type: String, default: null },
    dueDate: { type: Date, default: null },
    dueMileage: { type: Number, default: null },
    urgency: { type: String, enum: ['normal', 'soon', 'urgent'], default: 'normal' },
    estimatedCost: { type: Number, default: null },
  },
  { _id: false },
);

/**
 * THE central collection.
 *
 * One resource for owner- and garage-authored records, separated by
 * `provenance`. Routine checks (type: check) and technical inspections
 * (type: inspection) are subtypes — an inspection IS an event on the vehicle
 * timeline and must appear there.
 */
const MaintenanceSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownershipId: { type: Schema.Types.ObjectId, ref: 'VehicleOwnership', required: true },

    type: { type: String, enum: MAINTENANCE_TYPES, required: true },
    category: { type: String, enum: MAINTENANCE_CATEGORIES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 4000 },

    performedAt: { type: Date, required: true },
    mileage: { type: Number, required: true, min: 0 },

    provenance: { type: String, enum: PROVENANCES, required: true },
    status: { type: String, enum: MAINTENANCE_STATUSES, required: true, default: 'accepted' },

    /** Set when a professional performed it — a partner garage or a free-text name. */
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },
    garageName: { type: String, default: null, trim: true },

    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorType: { type: String, enum: ['owner', 'garage'], required: true },

    cost: { type: Number, default: null, min: 0 },
    currency: { type: String, default: 'XOF' },

    parts: { type: [PartSchema], default: [] },
    assessment: { type: [AssessmentItemSchema], default: [] },
    diagnostic: { type: DiagnosticSchema, default: null },
    inspection: { type: InspectionSchema, default: null },
    recommendations: { type: [RecommendationSchema], default: [] },

    photoIds: { type: [Schema.Types.ObjectId], default: [] },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Attachment', default: null },
    documentIds: { type: [Schema.Types.ObjectId], default: [] },

    resolvesIssueId: { type: Schema.Types.ObjectId, ref: 'VehicleIssue', default: null },
    completesReminderId: { type: Schema.Types.ObjectId, ref: 'Reminder', default: null },

    /**
     * Versioning. Once accepted, a record is append-only: a correction
     * creates a NEW document linked by correctedFromId, and the original
     * gets supersededById. Both stay readable. This is what makes the
     * logbook worth anything at resale.
     */
    version: { type: Number, default: 1 },
    correctedFromId: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },
    supersededById: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },
    correctionReason: { type: String, default: null, maxlength: 1000 },

    submittedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    disputedAt: { type: Date, default: null },
    disputeReason: { type: String, default: null, maxlength: 1000 },

    /** Soft delete, 24h window for an owner's own entry. */
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'maintenanceEvents' },
);

MaintenanceSchema.index({ vehicleId: 1, performedAt: -1 });
MaintenanceSchema.index({ vehicleId: 1, status: 1 });
MaintenanceSchema.index({ garageId: 1, createdAt: -1 });
MaintenanceSchema.index({ vehicleId: 1, type: 1, performedAt: -1 });
MaintenanceSchema.index({ correctedFromId: 1 }, { sparse: true });

/** True only for an owner's own, still-unlocked record. */
MaintenanceSchema.methods.isEditableBy = function (
  actor: { userId: string; role: string },
): boolean {
  if (this.deletedAt) return false;
  if (this.provenance === 'garage_verified') return false; // locked once accepted
  if (this.provenance === 'user') return String(this.authorId) === actor.userId;
  return this.status === 'draft' || this.status === 'correction_requested';
};

export type MaintenanceEvent = InferSchemaType<typeof MaintenanceSchema>;
export const MaintenanceModel =
  (mongoose.models.MaintenanceEvent as mongoose.Model<MaintenanceEvent> | undefined) ??
  mongoose.model<MaintenanceEvent>('MaintenanceEvent', MaintenanceSchema);

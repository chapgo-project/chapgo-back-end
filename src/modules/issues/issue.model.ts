import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ISSUE_STATUSES, ISSUE_SEVERITIES, ISSUE_CATEGORIES } from '../../types/enums.js';

const StatusChangeSchema = new Schema(
  {
    from: { type: String, enum: ISSUE_STATUSES, default: null },
    to: { type: String, enum: ISSUE_STATUSES, required: true },
    at: { type: Date, required: true, default: Date.now },
    byUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

/**
 * A reported problem, followed over time.
 *
 * The whole point is the trail: reported → to check → repair planned →
 * resolved, with the intervention that resolved it linked both ways.
 */
const IssueSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    ownershipId: { type: Schema.Types.ObjectId, ref: 'VehicleOwnership', required: true },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 4000 },
    category: { type: String, enum: ISSUE_CATEGORIES, default: 'other' },
    severity: { type: String, enum: ISSUE_SEVERITIES, default: 'medium' },

    reportedAt: { type: Date, required: true, default: Date.now },
    reportedMileage: { type: Number, default: null },

    status: { type: String, enum: ISSUE_STATUSES, required: true, default: 'watching' },
    statusHistory: { type: [StatusChangeSchema], default: [] },

    reportedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reportedByType: { type: String, enum: ['owner', 'garage'], default: 'owner' },

    photoIds: { type: [Schema.Types.ObjectId], default: [] },

    /** Set on resolution. One of the two is required — see the service. */
    resolvedByEventId: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },
    resolutionNote: { type: String, default: null, maxlength: 1000 },
    resolvedAt: { type: Date, default: null },

    /** True when the issue came out of a two-tap routine check. */
    fromCheck: { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'vehicleIssues' },
);

IssueSchema.index({ vehicleId: 1, status: 1 });
IssueSchema.index({ vehicleId: 1, reportedAt: -1 });

export type VehicleIssue = InferSchemaType<typeof IssueSchema>;
export const IssueModel =
  (mongoose.models.VehicleIssue as mongoose.Model<VehicleIssue> | undefined) ??
  mongoose.model<VehicleIssue>('VehicleIssue', IssueSchema);

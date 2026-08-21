import mongoose, { Schema } from 'mongoose';

/**
 * Append-only trail of every garage action against customer data.
 *
 * Admin-only, never exposed through the public API. 24-month retention by
 * TTL. This is what makes a dispute answerable.
 */
const AuditSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorType: { type: String, enum: ['owner', 'garage', 'admin', 'system'], required: true },
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },

    action: { type: String, required: true },      // access.granted, vehicle.read…
    resourceType: { type: String, required: true },
    resourceId: { type: String, required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },

    ip: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: null },

    at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 730 },
  },
  { collection: 'auditLogs' },
);

AuditSchema.index({ garageId: 1, at: -1 });
AuditSchema.index({ vehicleId: 1, at: -1 });
AuditSchema.index({ actorId: 1, at: -1 });

export const AuditModel = mongoose.models.AuditLog ?? mongoose.model('AuditLog', AuditSchema);

/** Fire-and-forget: an audit failure must never fail the request. */
export function audit(entry: {
  actorId: string;
  actorType: 'owner' | 'garage' | 'admin' | 'system';
  action: string;
  resourceType: string;
  resourceId: string;
  garageId?: string | null;
  vehicleId?: string | null;
  ip?: string | null;
  meta?: unknown;
}): void {
  void AuditModel.create(entry).catch(() => undefined);
}

import { VehicleModel } from './vehicle.model.js';
import { ReminderModel } from '../reminders/reminder.model.js';
import { DocumentModel } from '../documents/document.model.js';
import { IssueModel } from '../issues/issue.model.js';
import { deriveStatus } from '../reminders/status.js';
import { isStale } from '../mileage/mileage.service.js';
import type { HealthStatus } from '../../types/enums.js';

export interface HealthReason {
  code: string;
  label: string;
  severity: 'info' | 'warning' | 'critical';
  targetType?: string;
  targetId?: string;
}

/**
 * Vehicle health.
 *
 * QUALITATIVE, deliberately — no numeric score. A score out of 100 implies a
 * mechanical diagnosis ChapGo cannot perform; the user needs to understand
 * WHY, which is what `reasons` carries.
 *
 * Computed server-side (one rule, not two codebases), cached on the vehicle,
 * invalidated on any relevant write. Never the source of truth.
 */
export async function computeHealth(vehicleId: string): Promise<{
  status: HealthStatus;
  reasons: HealthReason[];
  computedAt: Date;
}> {
  const vehicle = await VehicleModel.findById(vehicleId)
    .select('currentMileage currentMileageAt')
    .lean();
  if (!vehicle) return { status: 'good', reasons: [], computedAt: new Date() };

  const [reminders, documents, issues] = await Promise.all([
    ReminderModel.find({
      vehicleId,
      enabled: true,
      status: { $nin: ['completed', 'cancelled', 'proposed'] },
    }).lean(),
    DocumentModel.find({ vehicleId, expiresAt: { $ne: null } })
      .select('type label expiresAt')
      .lean(),
    IssueModel.find({ vehicleId, status: { $ne: 'resolved' } })
      .select('title severity status')
      .lean(),
  ]);

  const reasons: HealthReason[] = [];
  let critical = false;
  let warning = false;

  for (const r of reminders) {
    const d = deriveStatus({
      rule: r.rule,
      dueDate: r.dueDate ?? null,
      dueMileage: r.dueMileage ?? null,
      currentMileage: vehicle.currentMileage,
      currentMileageAt: vehicle.currentMileageAt ?? null,
      status: r.status,
      postponedTo: r.postponedTo ?? null,
    });

    if (d.status === 'overdue') {
      critical = true;
      reasons.push({
        code: 'reminder_overdue',
        label: `${r.label} — en retard`,
        severity: 'critical',
        targetType: 'reminder',
        targetId: String(r._id),
      });
    } else if (d.status === 'due_soon') {
      warning = true;
      const detail =
        d.kmLeft !== null && d.kmLeft >= 0 && !d.mileageStale
          ? `dans ${d.kmLeft.toLocaleString('fr-FR')} km`
          : d.daysLeft !== null
            ? `dans ${d.daysLeft} jour${d.daysLeft > 1 ? 's' : ''}`
            : 'bientôt';
      reasons.push({
        code: 'reminder_due_soon',
        label: `${r.label} ${detail}`,
        severity: 'warning',
        targetType: 'reminder',
        targetId: String(r._id),
      });
    }
  }

  const now = Date.now();
  for (const doc of documents) {
    if (!doc.expiresAt) continue;
    const daysLeft = Math.ceil((doc.expiresAt.getTime() - now) / 86_400_000);
    if (daysLeft < 0) {
      critical = true;
      reasons.push({
        code: 'document_expired',
        label: `${doc.label} — expiré`,
        severity: 'critical',
        targetType: 'document',
        targetId: String(doc._id),
      });
    } else if (daysLeft <= 30) {
      warning = true;
      reasons.push({
        code: 'document_expiring',
        label: `${doc.label} — expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}`,
        severity: 'warning',
        targetType: 'document',
        targetId: String(doc._id),
      });
    }
  }

  for (const issue of issues) {
    if (issue.severity === 'high' || issue.status === 'to_check') {
      warning = true;
      reasons.push({
        code: 'issue_open',
        label: `${issue.title} — à vérifier`,
        severity: issue.severity === 'high' ? 'critical' : 'warning',
        targetType: 'issue',
        targetId: String(issue._id),
      });
      if (issue.severity === 'high') critical = true;
    }
  }

  // A mileage nobody has updated is itself worth surfacing: half the
  // reminder logic depends on it.
  if (isStale(vehicle.currentMileageAt)) {
    reasons.push({
      code: 'mileage_stale',
      label: "Kilométrage non mis à jour depuis plus de 2 mois",
      severity: 'info',
      targetType: 'vehicle',
      targetId: vehicleId,
    });
  }

  const status: HealthStatus = critical ? 'action_required' : warning ? 'attention' : 'good';

  // Ordered by severity, capped at 4 — the screen shows a short list, and a
  // wall of reasons is not read.
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  const sorted = reasons.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 4);

  const computedAt = new Date();
  await VehicleModel.updateOne(
    { _id: vehicleId },
    { healthCache: { status, reasons: sorted, computedAt } },
  );

  return { status, reasons: sorted, computedAt };
}

/** Returns the cache when fresh, recomputes when invalidated or older than 6h. */
export async function getHealth(vehicleId: string) {
  const v = await VehicleModel.findById(vehicleId).select('healthCache').lean();
  const cached = v?.healthCache;

  const fresh =
    cached?.computedAt && Date.now() - cached.computedAt.getTime() < 6 * 3_600_000;

  if (fresh) {
    return {
      status: cached.status,
      reasons: cached.reasons ?? [],
      computedAt: cached.computedAt,
    };
  }
  return computeHealth(vehicleId);
}

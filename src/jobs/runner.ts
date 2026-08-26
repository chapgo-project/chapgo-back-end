import { connectDb, disconnectDb } from '../core/db.js';
import { logger } from '../core/logger.js';
import { config } from '../core/config.js';
import { VehicleModel } from '../modules/vehicles/vehicle.model.js';
import { ReminderModel } from '../modules/reminders/reminder.model.js';
import { DocumentModel } from '../modules/documents/document.model.js';
import { AccessModel } from '../modules/access/access.model.js';
import { AttachmentModel } from '../modules/attachments/attachment.model.js';
import { NotificationModel } from '../modules/notifications/notification.model.js';
import { OwnershipModel } from '../modules/vehicles/ownership.model.js';
import { deriveStatus } from '../modules/reminders/status.js';
import { computeHealth } from '../modules/vehicles/health.service.js';
import { IssueModel } from '../modules/issues/issue.model.js';
import { createNotification, flushDigestNotifications } from '../modules/notifications/notification.service.js';

/**
 * Scheduled work. Runs as a SEPARATE Render cron service.
 *
 * A sleeping web service runs no cron, and silently stopped reminders are
 * this product's worst failure mode: the app looks fine while doing nothing.
 * Each job is isolated so one failure does not cancel the rest.
 */

async function ownerOf(vehicleId: unknown): Promise<string | null> {
  const o = await OwnershipModel.findOne({ vehicleId, endedAt: null }).select('userId').lean();
  return o ? String(o.userId) : null;
}

/** Recompute reminder statuses and notify. */
async function sweepReminders(): Promise<number> {
  const reminders = await ReminderModel.find({
    enabled: true,
    status: { $nin: ['completed', 'cancelled', 'proposed'] },
  }).lean();

  let notified = 0;

  for (const r of reminders) {
    const vehicle = await VehicleModel.findById(r.vehicleId)
      .select('currentMileage currentMileageAt brand model archivedAt')
      .lean();
    if (!vehicle || vehicle.archivedAt) continue;

    const derived = deriveStatus({
      rule: r.rule,
      dueDate: r.dueDate ?? null,
      dueMileage: r.dueMileage ?? null,
      currentMileage: vehicle.currentMileage,
      currentMileageAt: vehicle.currentMileageAt ?? null,
      status: r.status,
      postponedTo: r.postponedTo ?? null,
    });

    if (derived.status !== r.status) {
      await ReminderModel.updateOne({ _id: r._id }, { status: derived.status });
    }

    const shouldNotify =
      (derived.status === 'due_soon' || derived.status === 'overdue') &&
      // At most one notification per reminder per week.
      (!r.lastNotifiedAt || Date.now() - r.lastNotifiedAt.getTime() > 7 * 86_400_000);

    if (!shouldNotify) continue;

    const userId = await ownerOf(r.vehicleId);
    if (!userId) continue;

    const notification = await createNotification({
      userId,
      type: derived.status === 'overdue' ? 'reminder_overdue' : 'reminder_due_soon',
      title: derived.status === 'overdue' ? `${r.label} — en retard` : `${r.label} à prévoir`,
      body: `${vehicle.brand} ${vehicle.model}`,
      critical: derived.status === 'overdue',
      targetType: 'reminder',
      targetId: String(r._id),
      vehicleId: r.vehicleId,
      preference: r.category === 'technical_inspection' ? 'inspection' : 'maintenance',
    });
    if (!notification) continue;
    await ReminderModel.updateOne({ _id: r._id }, { lastNotifiedAt: new Date() });
    notified++;
  }
  return notified;
}

/** Document expiry. */
async function sweepDocuments(): Promise<number> {
  const soon = new Date(Date.now() + 30 * 86_400_000);
  const docs = await DocumentModel.find({
    reminderEnabled: true,
    expiresAt: { $ne: null, $lte: soon },
  }).lean();

  let notified = 0;
  for (const d of docs) {
    const userId = await ownerOf(d.vehicleId);
    if (!userId) continue;

    const expired = d.expiresAt!.getTime() < Date.now();

    // Avoid re-notifying the same document within a week.
    const recent = await NotificationModel.findOne({
      userId,
      targetType: 'document',
      targetId: String(d._id),
      createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
    }).lean();
    if (recent) continue;

    await createNotification({
      userId,
      type: expired ? 'document_expired' : 'document_expiring',
      title: expired ? `${d.label} — expiré` : `${d.label} expire bientôt`,
      body: expired
        ? 'Ce document doit être renouvelé.'
        : `Expire le ${d.expiresAt!.toLocaleDateString('fr-FR')}.`,
      critical: expired,
      targetType: 'document',
      targetId: String(d._id),
      vehicleId: d.vehicleId,
      preference: 'documents',
    });
    notified++;
  }
  return notified;
}

/** Expire garage grants, warn 7 days ahead. */
async function sweepAccess(): Promise<{ expired: number; warned: number }> {
  const now = new Date();

  const expiredResult = await AccessModel.updateMany(
    { status: 'approved', expiresAt: { $ne: null, $lt: now } },
    { status: 'expired' },
  );

  const soon = new Date(Date.now() + 7 * 86_400_000);
  const expiring = await AccessModel.find({
    status: 'approved',
    expiresAt: { $ne: null, $lte: soon, $gte: now },
    expiryNotifiedAt: null,
  }).lean();

  for (const a of expiring) {
    await AccessModel.updateOne({ _id: a._id }, { expiryNotifiedAt: new Date() });
  }

  return { expired: expiredResult.modifiedCount, warned: expiring.length };
}

/** Stale mileage — half the reminder logic depends on it. */
async function sweepStaleMileage(): Promise<number> {
  const threshold = new Date(Date.now() - config.MILEAGE_STALE_DAYS * 86_400_000);
  const vehicles = await VehicleModel.find({
    archivedAt: null,
    currentMileageAt: { $lt: threshold },
  })
    .select('_id brand model')
    .lean();

  let notified = 0;
  for (const v of vehicles) {
    const userId = await ownerOf(v._id);
    if (!userId) continue;

    const recent = await NotificationModel.findOne({
      userId,
      type: 'mileage_stale',
      vehicleId: v._id,
      createdAt: { $gte: new Date(Date.now() - 30 * 86_400_000) },
    }).lean();
    if (recent) continue;

    await createNotification({
      userId,
      type: 'mileage_stale',
      title: 'Mettez à jour votre kilométrage',
      body: `${v.brand} ${v.model} — sans mise à jour depuis plus de 2 mois. Vos rappels en dépendent.`,
      targetType: 'vehicle',
      targetId: String(v._id),
      vehicleId: v._id,
      preference: 'mileagePrompt',
    });
    notified++;
  }
  return notified;
}

/** Notify once per open issue until the owner changes its status. */
async function sweepPendingIssues(): Promise<number> {
  const issues = await IssueModel.find({ status: { $in: ['to_check', 'repair_planned'] } })
    .select('_id vehicleId title reportedById')
    .lean();
  let notified = 0;
  for (const issue of issues) {
    const userId = await ownerOf(issue.vehicleId);
    if (!userId) continue;
    const recent = await NotificationModel.findOne({
      userId,
      type: 'pending_issue',
      targetId: String(issue._id),
      createdAt: { $gte: new Date(Date.now() - 7 * 86_400_000) },
    }).lean();
    if (recent) continue;
    await createNotification({
      userId,
      type: 'pending_issue',
      title: 'Problème à traiter',
      body: issue.title,
      targetType: 'issue',
      targetId: String(issue._id),
      vehicleId: issue.vehicleId,
      preference: 'checks',
    });
    notified++;
  }
  return notified;
}

/** Notify owners when a garage proposes a future maintenance action. */
async function sweepGarageProposals(): Promise<number> {
  const proposals = await ReminderModel.find({ status: 'proposed', enabled: true })
    .select('_id vehicleId label')
    .lean();
  let notified = 0;
  for (const proposal of proposals) {
    const userId = await ownerOf(proposal.vehicleId);
    if (!userId) continue;
    const recent = await NotificationModel.findOne({
      userId,
      type: 'garage_event_proposed',
      targetId: String(proposal._id),
    }).lean();
    if (recent) continue;
    await createNotification({
      userId,
      type: 'garage_event_proposed',
      title: 'Nouvelle proposition du garage',
      body: proposal.label,
      targetType: 'reminder',
      targetId: String(proposal._id),
      vehicleId: proposal.vehicleId,
      preference: 'garage',
    });
    notified++;
  }
  return notified;
}

/** Orphaned uploads: abandoned forms leave them, storage is billed anyway. */
async function sweepOrphanAttachments(): Promise<number> {
  const cutoff = new Date(Date.now() - 86_400_000);
  const result = await AttachmentModel.deleteMany({
    status: 'pending',
    createdAt: { $lt: cutoff },
  });
  return result.deletedCount;
}

/** Refresh invalidated health caches. */
async function sweepHealth(): Promise<number> {
  const vehicles = await VehicleModel.find({
    archivedAt: null,
    $or: [{ 'healthCache.computedAt': null }, { 'healthCache.computedAt': { $exists: false } }],
  })
    .select('_id')
    .limit(500)
    .lean();

  for (const v of vehicles) await computeHealth(String(v._id));
  return vehicles.length;
}

async function main() {
  await connectDb();
  const started = Date.now();

  // Each job isolated: one failure must not cancel the others.
  const jobs: [string, () => Promise<unknown>][] = [
    ['reminders', sweepReminders],
    ['documents', sweepDocuments],
    ['access', sweepAccess],
    ['staleMileage', sweepStaleMileage],
    ['pendingIssues', sweepPendingIssues],
    ['garageProposals', sweepGarageProposals],
    ['notificationDigest', flushDigestNotifications],
    ['orphanAttachments', sweepOrphanAttachments],
    ['health', sweepHealth],
  ];

  for (const [name, fn] of jobs) {
    try {
      const result = await fn();
      logger.info({ job: name, result }, 'job done');
    } catch (e) {
      // Logged, not thrown: a failing sweep must not stop the rest.
      logger.error({ job: name, err: e }, 'job failed');
    }
  }

  logger.info({ ms: Date.now() - started }, 'all jobs finished');
  await disconnectDb();
  process.exit(0);
}

void main().catch((e) => {
  logger.fatal({ err: e }, 'job runner crashed');
  process.exit(1);
});

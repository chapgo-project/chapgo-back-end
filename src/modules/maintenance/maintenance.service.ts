import { withTransaction } from '../../core/db.js';
import { AppError, ErrorCode, err } from '../../core/errors.js';
import { MaintenanceModel } from './maintenance.model.js';
import { ReminderModel } from '../reminders/reminder.model.js';
import { IssueModel } from '../issues/issue.model.js';
import { VehicleModel } from '../vehicles/vehicle.model.js';
import { NotificationModel } from '../notifications/notification.model.js';
import { SubscriptionModel } from '../subscriptions/subscription.model.js';
import { MileageModel } from '../mileage/mileage.model.js';
import { referenceReading } from '../mileage/mileage.service.js';
import { nextOccurrence } from '../reminders/status.js';
import type { VehicleScope } from '../../core/authorization.js';
import type { Actor } from '../../core/authMiddleware.js';

export interface CreateEventInput {
  type: 'service' | 'repair' | 'part' | 'check' | 'inspection';
  category: string;
  title: string;
  description?: string | null;
  performedAt: Date;
  mileage: number;
  performedBy: 'self' | 'garage';
  garageId?: string | null;
  garageName?: string | null;
  cost?: number | null;
  parts?: unknown[];
  assessment?: unknown[];
  diagnostic?: unknown;
  inspection?: unknown;
  recommendations?: { label: string; dueDate?: Date | null; dueMileage?: number | null; urgency?: string }[];
  photoIds?: string[];
  invoiceId?: string | null;
  documentIds?: string[];
  resolvesIssueId?: string | null;
  completesReminderId?: string | null;
  nextDueDate?: Date | null;
  nextDueMileage?: number | null;
  /** Garage only: keep the record private until submitted. */
  asDraft?: boolean;
  confirmJump?: boolean;
}

/**
 * RULE 5 — creating an event is a TRANSACTION.
 *
 * One call can write: the event, a mileage entry, a closed reminder, the
 * next reminder, a resolved issue, the vehicle's currentMileage, an
 * invalidated healthCache, notifications, and a subscription counter.
 * Nine writes across six collections. Half-applied, the record is
 * inconsistent — a closed reminder with no event to justify it.
 */
export async function createEvent(
  scope: VehicleScope,
  actor: Actor,
  input: CreateEventInput,
) {
  if (input.performedAt.getTime() > Date.now() + 86_400_000) {
    throw err.validation("La date ne peut pas être dans le futur.", 'performedAt');
  }

  const reference = await referenceReading(scope.vehicleId);
  if (reference && input.mileage < reference.value && !input.confirmJump) {
    throw new AppError({
      status: 422,
      code: ErrorCode.MILEAGE_REGRESSION,
      message: `Le kilométrage doit être supérieur au dernier relevé (${reference.value.toLocaleString('fr-FR')} km).`,
      field: 'mileage',
      details: { referenceValue: reference.value },
    });
  }

  const isGarage = scope.actorKind === 'garage';
  const draft = isGarage && input.asDraft !== false;

  return withTransaction(async (session) => {
    const [event] = await MaintenanceModel.create(
      [
        {
          vehicleId: scope.vehicleId,
          ownershipId: scope.ownershipId,
          type: input.type,
          category: input.category,
          title: input.title,
          description: input.description ?? null,
          performedAt: input.performedAt,
          mileage: input.mileage,
          provenance: isGarage ? 'garage' : 'user',
          status: draft ? 'draft' : 'accepted',
          garageId: input.performedBy === 'garage' ? (input.garageId ?? actor.garageId ?? null) : null,
          garageName: input.garageName ?? null,
          authorId: actor.userId,
          authorType: isGarage ? 'garage' : 'owner',
          cost: input.cost ?? null,
          parts: input.parts ?? [],
          assessment: input.assessment ?? [],
          diagnostic: input.diagnostic ?? null,
          inspection: input.inspection ?? null,
          recommendations: input.recommendations ?? [],
          photoIds: input.photoIds ?? [],
          invoiceId: input.invoiceId ?? null,
          documentIds: input.documentIds ?? [],
          resolvesIssueId: input.resolvesIssueId ?? null,
          completesReminderId: input.completesReminderId ?? null,
          acceptedAt: draft ? null : new Date(),
        },
      ],
      { session },
    );

    // A draft is private to the garage: no side effects until it is accepted.
    if (draft) return event!;

    await applySideEffects(scope, actor, event!, input, session);
    return event!;
  });
}

/** Everything an accepted event triggers. Runs inside the caller's transaction. */
async function applySideEffects(
  scope: VehicleScope,
  actor: Actor,
  event: Record<string, any>,
  input: Partial<CreateEventInput>,
  session: import('mongoose').ClientSession,
) {
  // 1 · Mileage entry, attributed to the intervention.
  await MileageModel.create(
    [
      {
        vehicleId: scope.vehicleId,
        ownershipId: scope.ownershipId,
        value: event.mileage,
        recordedAt: event.performedAt,
        source: 'intervention',
        authorId: actor.userId,
        authorType: scope.actorKind === 'garage' ? 'garage' : 'owner',
        garageId: event.garageId ?? null,
        maintenanceEventId: event._id,
      },
    ],
    { session },
  );

  // 2 · Vehicle mileage, if this reading is the most recent.
  const vehicle = await VehicleModel.findById(scope.vehicleId).session(session);
  if (vehicle && (!vehicle.currentMileageAt || event.performedAt >= vehicle.currentMileageAt)) {
    vehicle.currentMileage = event.mileage;
    vehicle.currentMileageAt = event.performedAt;
    vehicle.currentMileageSource = 'intervention';
    vehicle.currentMileageEstimated = false;
  }
  // 3 · Health depends on all of the above: invalidate, never recompute inline.
  if (vehicle) {
    vehicle.set('healthCache.computedAt', null);
    await vehicle.save({ session });
  }

  // 4 · Close the reminder and generate the next occurrence.
  if (input.completesReminderId) {
    const reminder = await ReminderModel.findOne({
      _id: input.completesReminderId,
      vehicleId: scope.vehicleId,
    }).session(session);

    if (reminder) {
      reminder.status = 'completed';
      reminder.completedAt = new Date();
      reminder.completedByEventId = event._id;
      await reminder.save({ session });

      const next = nextOccurrence({
        intervalMonths: reminder.intervalMonths ?? null,
        intervalKm: reminder.intervalKm ?? null,
        completedAt: event.performedAt,
        completedMileage: event.mileage,
      });

      if (next) {
        await ReminderModel.create(
          [
            {
              vehicleId: scope.vehicleId,
              category: reminder.category,
              label: reminder.label,
              dueDate: next.dueDate,
              dueMileage: next.dueMileage,
              rule: next.rule,
              intervalMonths: reminder.intervalMonths,
              intervalKm: reminder.intervalKm,
              status: 'upcoming',
              source: 'system',
            },
          ],
          { session },
        );
      }
    }
  }

  // 5 · Resolve the linked issue — both directions, so the trail reads
  //     from either end.
  if (input.resolvesIssueId) {
    const issue = await IssueModel.findOne({
      _id: input.resolvesIssueId,
      vehicleId: scope.vehicleId,
    }).session(session);

    if (issue && issue.status !== 'resolved') {
      issue.statusHistory.push({
        from: issue.status,
        to: 'resolved',
        at: new Date(),
        byUserId: actor.userId as never,
        note: `Résolu par : ${event.title}`,
      } as never);
      issue.status = 'resolved';
      issue.resolvedByEventId = event._id;
      issue.resolvedAt = new Date();
      await issue.save({ session });
    }
  }

  // 6 · A garage recommendation becomes a PROPOSED reminder, never an active
  //     one — RULE 7, the guard against garages driving return visits.
  const proposals = [
    ...(input.recommendations ?? []),
    ...(input.nextDueDate || input.nextDueMileage
      ? [{ label: event.title, dueDate: input.nextDueDate, dueMileage: input.nextDueMileage }]
      : []),
  ];

  for (const p of proposals) {
    if (!p.dueDate && !p.dueMileage) continue;
    await ReminderModel.create(
      [
        {
          vehicleId: scope.vehicleId,
          category: event.category,
          label: p.label,
          dueDate: p.dueDate ?? null,
          dueMileage: p.dueMileage ?? null,
          rule: p.dueDate && p.dueMileage ? 'first_of' : p.dueDate ? 'date_only' : 'mileage_only',
          // Owner-created events activate directly; a garage only proposes.
          status: scope.actorKind === 'garage' ? 'proposed' : 'upcoming',
          source: scope.actorKind === 'garage' ? 'garage' : 'user',
          proposedByGarageId: scope.actorKind === 'garage' ? actor.garageId : null,
          proposedFromEventId: event._id,
        },
      ],
      { session },
    );
  }

  // 7 · Notify the owner when a professional record lands.
  if (scope.actorKind === 'garage') {
    await NotificationModel.create(
      [
        {
          userId: scope.ownerUserId,
          type: 'intervention_accepted',
          title: 'Intervention ajoutée à votre carnet',
          body: `${event.title} — ${event.mileage.toLocaleString('fr-FR')} km`,
          targetType: 'maintenance',
          targetId: String(event._id),
          vehicleId: scope.vehicleId,
        },
      ],
      { session },
    );

    // 8 · Cumulative counter, never a rolling window.
    if (actor.garageId) {
      await SubscriptionModel.updateOne(
        { garageId: actor.garageId },
        { $inc: { interventionCount: 1 } },
        { session, upsert: true },
      );
    }
  }
}

/**
 * RULE 4 — an accepted professional record is append-only.
 *
 * PATCH is refused for the garage AND for the owner. A correction creates a
 * NEW version; the original keeps supersededById and stays readable. This is
 * what makes the logbook worth anything at resale.
 */
export async function updateEvent(
  scope: VehicleScope,
  actor: Actor,
  eventId: string,
  patch: Record<string, unknown>,
) {
  const event = await MaintenanceModel.findOne({ _id: eventId, vehicleId: scope.vehicleId });
  if (!event || event.deletedAt) throw err.notFound('Intervention introuvable.');

  const editable =
    (event.provenance === 'user' && String(event.authorId) === actor.userId) ||
    (event.provenance === 'garage' &&
      ['draft', 'correction_requested'].includes(event.status) &&
      String(event.garageId ?? '') === String(actor.garageId ?? ''));

  if (!editable) {
    throw new AppError({
      status: 409,
      code: ErrorCode.EVENT_LOCKED,
      message:
        "Cette intervention a été validée et ne peut plus être modifiée. Utilisez une correction — l'historique sera conservé.",
    });
  }

  Object.assign(event, patch);
  await event.save();
  return event;
}

/** Correction: a new version, linked both ways. */
export async function correctEvent(
  scope: VehicleScope,
  actor: Actor,
  eventId: string,
  input: { reason: string; patch: Record<string, unknown> },
) {
  return withTransaction(async (session) => {
    const original = await MaintenanceModel.findOne({
      _id: eventId,
      vehicleId: scope.vehicleId,
    }).session(session);
    if (!original) throw err.notFound('Intervention introuvable.');
    if (original.supersededById) {
      throw err.conflict(ErrorCode.CONFLICT, 'Cette intervention a déjà été corrigée.');
    }

    const base = original.toObject();
    delete (base as { _id?: unknown })._id;
    delete (base as { createdAt?: unknown }).createdAt;
    delete (base as { updatedAt?: unknown }).updatedAt;

    const [corrected] = await MaintenanceModel.create(
      [
        {
          ...base,
          ...input.patch,
          version: (original.version ?? 1) + 1,
          correctedFromId: original._id,
          supersededById: null,
          correctionReason: input.reason,
          authorId: actor.userId,
          status: original.status === 'accepted' ? 'accepted' : 'pending_owner_review',
        },
      ],
      { session },
    );

    original.supersededById = corrected!._id;
    await original.save({ session });

    await VehicleModel.updateOne(
      { _id: scope.vehicleId },
      { 'healthCache.computedAt': null },
      { session },
    );

    return corrected!;
  });
}

/** Garage submits a draft for owner review. */
export async function submitEvent(scope: VehicleScope, actor: Actor, eventId: string) {
  const event = await MaintenanceModel.findOne({ _id: eventId, vehicleId: scope.vehicleId });
  if (!event) throw err.notFound('Intervention introuvable.');
  if (!['draft', 'correction_requested'].includes(event.status)) {
    throw err.conflict(ErrorCode.CONFLICT, 'Cette intervention a déjà été envoyée.');
  }

  // Validation runs HERE, not on every draft save: a half-filled draft is legitimate.
  if (!event.title || !event.category || !event.performedAt) {
    throw err.validation('Complétez le titre, la catégorie et la date avant d\'envoyer.');
  }
  const hasSubstance =
    Boolean(event.description) || event.parts.length > 0 || event.assessment.length > 0;
  if (!hasSubstance) {
    throw err.validation(
      'Ajoutez une description, des pièces ou un bilan avant d\'envoyer au client.',
    );
  }

  event.status = 'pending_owner_review';
  event.submittedAt = new Date();
  await event.save();

  await NotificationModel.create({
    userId: scope.ownerUserId,
    type: 'intervention_submitted',
    title: 'Un garage souhaite ajouter une intervention',
    body: `${event.title} — ${event.mileage.toLocaleString('fr-FR')} km`,
    critical: false,
    targetType: 'maintenance',
    targetId: String(event._id),
    vehicleId: scope.vehicleId,
  });

  return event;
}

/** Owner accepts: the record joins the timeline and side effects apply. */
export async function acceptEvent(scope: VehicleScope, actor: Actor, eventId: string) {
  return withTransaction(async (session) => {
    const event = await MaintenanceModel.findOne({
      _id: eventId,
      vehicleId: scope.vehicleId,
      status: 'pending_owner_review',
    }).session(session);
    if (!event) throw err.notFound('Intervention introuvable ou déjà traitée.');

    event.status = 'accepted';
    event.provenance = 'garage_verified'; // locked from now on
    event.acceptedAt = new Date();
    await event.save({ session });

    await applySideEffects(
      scope,
      { ...actor, garageId: String(event.garageId ?? '') || undefined },
      event,
      {
        completesReminderId: event.completesReminderId ? String(event.completesReminderId) : null,
        resolvesIssueId: event.resolvesIssueId ? String(event.resolvesIssueId) : null,
        recommendations: event.recommendations as never,
      },
      session,
    );

    return event;
  });
}

/** Owner disputes: the record does NOT enter the logbook. */
export async function disputeEvent(
  scope: VehicleScope,
  eventId: string,
  reason: string,
) {
  const event = await MaintenanceModel.findOne({
    _id: eventId,
    vehicleId: scope.vehicleId,
    status: 'pending_owner_review',
  });
  if (!event) throw err.notFound('Intervention introuvable ou déjà traitée.');

  event.status = 'correction_requested';
  event.disputedAt = new Date();
  event.disputeReason = reason;
  await event.save();

  return event;
}

/** Timeline. Superseded versions are hidden; the chain stays reachable. */
export async function listEvents(
  scope: VehicleScope,
  opts: { limit?: number; cursor?: string; type?: string } = {},
) {
  const limit = opts.limit ?? 20;
  const filter: Record<string, unknown> = {
    vehicleId: scope.vehicleId,
    deletedAt: null,
    supersededById: null,
    // A garage never sees another garage's unsubmitted draft.
    status: { $ne: 'draft' },
  };
  if (!scope.includeHistoryBefore) filter.ownershipId = scope.ownershipId;
  if (opts.type) filter.type = opts.type;
  if (opts.cursor) filter.performedAt = { $lt: new Date(opts.cursor) };

  const items = await MaintenanceModel.find(filter)
    .sort({ performedAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  const page = items.slice(0, limit);
  return {
    items: page,
    hasMore,
    cursor: hasMore ? page[page.length - 1]?.performedAt?.toISOString() ?? null : null,
  };
}

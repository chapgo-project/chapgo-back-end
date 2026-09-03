import { Router } from 'express';
import { handler, ok, okList } from '../../core/http.js';
import { validateBody, validateQuery, query } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { resolveVehicleScope, assertCanWrite } from '../../core/authorization.js';
import { idempotent } from '../../core/idempotency.js';
import { err } from '../../core/errors.js';
import { audit } from '../admin/audit.model.js';
import { MaintenanceModel } from './maintenance.model.js';
import { toEventDto } from './maintenance.dto.js';
import * as S from './maintenance.schema.js';
import * as svc from './maintenance.service.js';

/**
 * Mounted twice on purpose:
 *   /vehicles/:vehicleId/maintenance   list + create
 *   /maintenance/:id                   read + write on one record
 *
 * ONE resource for owner- and garage-authored records. A /garage/maintenance
 * mirror would duplicate validation, versioning and the timeline.
 */
export const maintenanceRouter = Router();
maintenanceRouter.use(requireAuth, requireLiveAccount);

/** Resolves the scope from an event id — used by every :id route. */
async function scopeOfEvent(req: import('express').Request, forWrite = false) {
  const event = await MaintenanceModel.findById(req.params.id).select('vehicleId').lean();
  if (!event) throw err.notFound('Intervention introuvable.');
  const scope = await resolveVehicleScope(actorOf(req), String(event.vehicleId), { forWrite });
  return scope;
}

/** GET /maintenance/proposals — screen G10, awaiting owner review. */
maintenanceRouter.get(
  '/proposals',
  handler(async (req, res) => {
    const actor = actorOf(req);
    // Owner-side: everything pending across all of their vehicles.
    const { OwnershipModel } = await import('../vehicles/ownership.model.js');
    const ownerships = await OwnershipModel.find({ userId: actor.userId, endedAt: null })
      .select('vehicleId')
      .lean();

    const items = await MaintenanceModel.find({
      vehicleId: { $in: ownerships.map((o) => o.vehicleId) },
      status: 'pending_owner_review',
    })
      .sort({ submittedAt: -1 })
      .lean();

    return okList(res, items.map((e) => toEventDto(e, actor)), { total: items.length });
  }),
);

maintenanceRouter.get(
  '/:id',
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req);
    const event = await MaintenanceModel.findById(req.params.id).lean();
    if (!event || event.deletedAt) throw err.notFound('Intervention introuvable.');

    // A draft belongs to the garage that wrote it, and to nobody else.
    if (event.status === 'draft' && String(event.garageId ?? '') !== String(actorOf(req).garageId ?? '')) {
      throw err.notFound('Intervention introuvable.');
    }
    return ok(res, toEventDto(event, actorOf(req), scope));
  }),
);

maintenanceRouter.patch(
  '/:id',
  validateBody(S.UpdateEventBody),
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req, true);
    const event = await svc.updateEvent(scope, actorOf(req), req.params.id!, req.body);
    return ok(res, toEventDto(event.toObject(), actorOf(req), scope));
  }),
);

/** POST /maintenance/:id/correct — a NEW version; the original is preserved. */
maintenanceRouter.post(
  '/:id/correct',
  validateBody(S.CorrectEventBody),
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req, true);
    const corrected = await svc.correctEvent(scope, actorOf(req), req.params.id!, req.body);
    return ok(res, toEventDto(corrected.toObject(), actorOf(req), scope), 201);
  }),
);

/** GET /maintenance/:id/history — the whole correction chain. */
maintenanceRouter.get(
  '/:id/history',
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req);
    const chain: Record<string, any>[] = [];

    let current = await MaintenanceModel.findById(req.params.id).lean();
    // Walk back to the original.
    while (current?.correctedFromId) {
      const prev = await MaintenanceModel.findById(current.correctedFromId).lean();
      if (!prev) break;
      chain.unshift(prev);
      current = prev;
    }
    // Then forward to the newest.
    current = await MaintenanceModel.findById(req.params.id).lean();
    while (current) {
      chain.push(current);
      if (!current.supersededById) break;
      current = await MaintenanceModel.findById(current.supersededById).lean();
    }

    const seen = new Set<string>();
    const unique = chain.filter((e) => {
      const id = String(e._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    return okList(res, unique.map((e) => toEventDto(e, actorOf(req), scope)), {
      total: unique.length,
    });
  }),
);

/** POST /maintenance/:id/submit — garage sends a draft for review. */
maintenanceRouter.post(
  '/:id/submit',
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req, true);
    if (scope.actorKind !== 'garage') throw err.forbidden();
    const event = await svc.submitEvent(scope, actorOf(req), req.params.id!);

    audit({
      actorId: actorOf(req).userId,
      actorType: 'garage',
      garageId: actorOf(req).garageId ?? null,
      action: 'intervention.submitted',
      resourceType: 'maintenance',
      resourceId: String(event._id),
      vehicleId: scope.vehicleId,
      ip: req.ip ?? null,
    });

    return ok(res, toEventDto(event.toObject(), actorOf(req), scope));
  }),
);

/** POST /maintenance/:id/accept — owner accepts; side effects apply. */
maintenanceRouter.post(
  '/:id/accept',
  idempotent,
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req);
    if (scope.actorKind !== 'owner') throw err.forbidden('Seul le propriétaire peut accepter.');
    const event = await svc.acceptEvent(scope, actorOf(req), req.params.id!);
    return ok(res, toEventDto(event.toObject(), actorOf(req), scope));
  }),
);

/** POST /maintenance/:id/dispute — the record does NOT enter the logbook. */
maintenanceRouter.post(
  '/:id/dispute',
  validateBody(S.DisputeBody),
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req);
    if (scope.actorKind !== 'owner') throw err.forbidden();
    const event = await svc.disputeEvent(scope, req.params.id!, req.body.reason);
    return ok(res, toEventDto(event.toObject(), actorOf(req), scope));
  }),
);

/** DELETE /maintenance/:id — soft, 24h window, own records only. */
maintenanceRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const scope = await scopeOfEvent(req, true);
    const actor = actorOf(req);
    const event = await MaintenanceModel.findById(req.params.id);
    if (!event) throw err.notFound('Intervention introuvable.');

    const own = event.provenance === 'user' && String(event.authorId) === actor.userId;
    const withinWindow = Date.now() - event.createdAt.getTime() < 86_400_000;

    if (!own || !withinWindow) {
      throw err.conflict(
        'EVENT_LOCKED',
        own
          ? 'Passé 24 heures, une intervention ne peut plus être supprimée. Utilisez une correction.'
          : "Vous ne pouvez pas supprimer une intervention que vous n'avez pas créée.",
      );
    }

    event.deletedAt = new Date();
    await event.save();
    return ok(res, { success: true });
  }),
);

/* ── Nested under a vehicle ────────────────────────────────────────── */

export const vehicleMaintenanceRouter = Router({ mergeParams: true });
vehicleMaintenanceRouter.use(requireAuth, requireLiveAccount);

vehicleMaintenanceRouter.get(
  '/',
  validateQuery(S.ListEventQuery),
  handler(async (req, res) => {
    const scope = await resolveVehicleScope(actorOf(req), req.params.vehicleId!);
    const q = query<typeof S.ListEventQuery>(req);
    const { items, hasMore, cursor } = await svc.listEvents(scope, q);
    return okList(res, items.map((e) => toEventDto(e, actorOf(req), scope)), { hasMore, cursor });
  }),
);

vehicleMaintenanceRouter.post(
  '/',
  idempotent,
  validateBody(S.CreateEventBody),
  handler(async (req, res) => {
    const actor = actorOf(req);
    const scope = await resolveVehicleScope(actor, req.params.vehicleId!, { forWrite: true });
    assertCanWrite(scope);

    const event = await svc.createEvent(scope, actor, req.body);

    if (scope.actorKind === 'garage') {
      audit({
        actorId: actor.userId,
        actorType: 'garage',
        garageId: actor.garageId ?? null,
        action: 'intervention.created',
        resourceType: 'maintenance',
        resourceId: String(event._id),
        vehicleId: scope.vehicleId,
        ip: req.ip ?? null,
      });
    }

    return ok(res, toEventDto(event.toObject(), actor, scope), 201);
  }),
);

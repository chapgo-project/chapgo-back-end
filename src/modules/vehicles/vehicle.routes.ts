import { Router } from 'express';
import { z } from 'zod';
import { handler, ok, okList } from '../../core/http.js';
import { validateBody, validateQuery, query } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { resolveVehicleScope, assertCanWrite } from '../../core/authorization.js';
import { idempotent } from '../../core/idempotency.js';
import { audit } from '../admin/audit.model.js';
import * as S from './vehicle.schema.js';
import * as svc from './vehicle.service.js';
import { toVehicleDto } from './vehicle.dto.js';
import { getHealth } from './health.service.js';
import * as mileage from '../mileage/mileage.service.js';
import { VehicleModel } from './vehicle.model.js';

export const vehicleRouter = Router();
vehicleRouter.use(requireAuth, requireLiveAccount);

/** GET /vehicles — the owner's list. */
vehicleRouter.get(
  '/',
  validateQuery(S.ListQuery),
  handler(async (req, res) => {
    const q = query<typeof S.ListQuery>(req);
    const items = await svc.listVehiclesOf(actorOf(req).userId, q.includeArchived);
    return okList(res, items.map((v) => toVehicleDto(v)), { total: items.length });
  }),
);

/** POST /vehicles — screens V8–V11. */
vehicleRouter.post(
  '/',
  idempotent,
  validateBody(S.CreateVehicleBody),
  handler(async (req, res) => {
    const vehicle = await svc.createVehicle(actorOf(req).userId, req.body);
    return ok(res, toVehicleDto(vehicle.toObject()), 201);
  }),
);

/**
 * GET /vehicles/:id — SAME endpoint for owner and garage.
 *
 * The scope narrows the response; a /garage/vehicles/:id mirror would fork
 * the serialization and drift within weeks.
 */
vehicleRouter.get(
  '/:id',
  handler(async (req, res) => {
    const actor = actorOf(req);
    const scope = await resolveVehicleScope(actor, req.params.id!);

    if (scope.actorKind === 'garage') {
      audit({
        actorId: actor.userId,
        actorType: 'garage',
        garageId: actor.garageId ?? null,
        action: 'vehicle.read',
        resourceType: 'vehicle',
        resourceId: scope.vehicleId,
        vehicleId: scope.vehicleId,
        ip: req.ip ?? null,
      });
    }

    const vehicle = await VehicleModel.findById(scope.vehicleId).lean();
    return ok(res, toVehicleDto(vehicle!, scope));
  }),
);

vehicleRouter.patch(
  '/:id',
  validateBody(S.UpdateVehicleBody),
  handler(async (req, res) => {
    const scope = await resolveVehicleScope(actorOf(req), req.params.id!, { forWrite: true });
    if (scope.actorKind !== 'owner') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Seul le propriétaire peut modifier ce véhicule.' },
      });
    }
    assertCanWrite(scope);
    const vehicle = await VehicleModel.findByIdAndUpdate(scope.vehicleId, req.body, { new: true });
    return ok(res, toVehicleDto(vehicle!.toObject(), scope));
  }),
);

vehicleRouter.post(
  '/:id/primary',
  handler(async (req, res) => {
    await svc.setPrimary(actorOf(req).userId, req.params.id!);
    return ok(res, { success: true });
  }),
);

vehicleRouter.post(
  '/:id/archive',
  handler(async (req, res) => {
    const scope = await resolveVehicleScope(actorOf(req), req.params.id!);
    if (scope.actorKind !== 'owner') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Action réservée au propriétaire.' } });
    }
    await svc.archiveVehicle(scope.vehicleId);
    return ok(res, { success: true });
  }),
);

/** GET /vehicles/:id/health — computed and cached, never client-written. */
vehicleRouter.get(
  '/:id/health',
  handler(async (req, res) => {
    const scope = await resolveVehicleScope(actorOf(req), req.params.id!);
    return ok(res, await getHealth(scope.vehicleId));
  }),
);

/* ─────────────────────────── Mileage ─────────────────────────────── */

vehicleRouter.get(
  '/:id/mileage',
  validateQuery(S.ListQuery),
  handler(async (req, res) => {
    const scope = await resolveVehicleScope(actorOf(req), req.params.id!);
    const q = query<typeof S.ListQuery>(req);
    const { items, hasMore } = await mileage.listMileage(scope, q.limit, q.cursor);
    return okList(
      res,
      items.map((m) => ({
        id: String(m._id),
        value: m.value,
        recordedAt: m.recordedAt,
        source: m.source,
        authorType: m.authorType,
        estimated: m.estimated,
        note: m.note,
        maintenanceEventId: m.maintenanceEventId ? String(m.maintenanceEventId) : null,
        regressionReason: m.regressionReason ?? null,
      })),
      { hasMore },
    );
  }),
);

/** POST /vehicles/:id/mileage — screen A8. Idempotency-Key required. */
vehicleRouter.post(
  '/:id/mileage',
  idempotent,
  validateBody(S.AddMileageBody),
  handler(async (req, res) => {
    const actor = actorOf(req);
    const scope = await resolveVehicleScope(actor, req.params.id!, { forWrite: true });
    assertCanWrite(scope);

    const entry = await mileage.addMileage(scope, actor, {
      value: req.body.value,
      recordedAt: req.body.recordedAt,
      // A garage reading is taken at the counter; an owner's may be from memory.
      source: scope.actorKind === 'garage' ? 'garage_onsite' : 'owner_manual',
      estimated: req.body.estimated,
      note: req.body.note,
      confirmJump: req.body.confirmJump,
    });

    const vehicle = await VehicleModel.findById(scope.vehicleId).lean();
    return ok(
      res,
      {
        entry: { id: String(entry._id), value: entry.value, recordedAt: entry.recordedAt },
        vehicle: toVehicleDto(vehicle!, scope),
      },
      201,
    );
  }),
);

import { Router } from 'express';
import { handler, ok } from '../../core/http.js';
import { validateBody } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { resolveVehicleScope } from '../../core/authorization.js';
import { CorrectMileageBody } from '../vehicles/vehicle.schema.js';
import { MileageModel } from './mileage.model.js';
import * as svc from './mileage.service.js';

export const mileageRouter = Router();
mileageRouter.use(requireAuth, requireLiveAccount);

/**
 * PATCH /mileage/:id — the ONLY path allowed to lower a value, and only with
 * a reason. Adds a correcting entry; the original stays.
 */
mileageRouter.patch(
  '/:id',
  validateBody(CorrectMileageBody),
  handler(async (req, res) => {
    const entry = await MileageModel.findById(req.params.id).select('vehicleId').lean();
    if (!entry) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Relevé introuvable.' } });

    const actor = actorOf(req);
    const scope = await resolveVehicleScope(actor, String(entry.vehicleId), { forWrite: true });

    const correction = await svc.correctMileage(scope, actor, req.params.id!, req.body);
    return ok(res, { id: String(correction._id), value: correction.value }, 201);
  }),
);

import type { VehicleScope } from '../../core/authorization.js';
import { isStale } from '../mileage/mileage.service.js';

/**
 * Vehicle serialization, SCOPED.
 *
 * A garage reads the same endpoint as the owner — duplicating it would fork
 * the serialization — but the response is narrowed here, in one place,
 * rather than by conditionals sprinkled through controllers.
 */
export function toVehicleDto(v: Record<string, any>, scope?: VehicleScope) {
  const base = {
    id: String(v._id),
    brand: v.brand,
    model: v.model,
    version: v.version ?? null,
    year: v.year,
    plate: v.plate,
    vin: v.vin ?? null,
    fuel: v.fuel,
    transmission: v.transmission ?? null,
    firstRegistrationAt: v.firstRegistrationAt ?? null,
    condition: v.condition,
    historyKnown: v.historyKnown,
    photoId: v.photoId ? String(v.photoId) : null,
    currentMileage: v.currentMileage,
    currentMileageAt: v.currentMileageAt,
    currentMileageSource: v.currentMileageSource,
    currentMileageEstimated: v.currentMileageEstimated,
    /**
     * The app shows "update your mileage" instead of "overdue" when this is
     * true — the backend must not claim a mileage threshold was crossed on
     * data two months old.
     */
    mileageStale: isStale(v.currentMileageAt),
    health: {
      status: v.healthCache?.status ?? 'good',
      reasons: v.healthCache?.reasons ?? [],
      computedAt: v.healthCache?.computedAt ?? null,
    },
    isPrimary: Boolean(v.isPrimary),
    archived: Boolean(v.archivedAt),
    createdAt: v.createdAt,
  };

  if (scope?.actorKind !== 'garage') return base;

  // Garage view: no VIN (identity-adjacent, used for registration lookups)
  // and no primary flag (it concerns the owner's own list, not this garage).
  const { vin, isPrimary, ...garageView } = base;
  return garageView;
}

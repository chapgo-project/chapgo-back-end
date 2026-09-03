import type { ClientSession } from 'mongoose';
import { config } from '../../core/config.js';
import { AppError, ErrorCode, err } from '../../core/errors.js';
import { MileageModel } from './mileage.model.js';
import { VehicleModel } from '../vehicles/vehicle.model.js';
import type { VehicleScope } from '../../core/authorization.js';
import type { MileageSource } from '../../types/enums.js';

export interface AddMileageInput {
  value: number;
  recordedAt?: Date;
  source: MileageSource;
  estimated?: boolean;
  note?: string | null;
  maintenanceEventId?: string | null;
  /** Set by the client after confirming an implausible-jump warning. */
  confirmJump?: boolean;
}

/**
 * The reference reading.
 *
 * RULE 2 — not the highest value, the most recent reading taken ON the
 * vehicle. A garage reading at the counter supersedes a remote owner entry
 * whatever the value, because a mechanic in front of the odometer is more
 * reliable than a recollection.
 */
export async function referenceReading(vehicleId: string) {
  const onSite = await MileageModel.findOne({
    vehicleId,
    source: { $in: ['garage_onsite', 'intervention'] },
  })
    .sort({ recordedAt: -1 })
    .lean();

  const latest = await MileageModel.findOne({ vehicleId }).sort({ recordedAt: -1 }).lean();

  if (!onSite) return latest;
  if (!latest) return onSite;

  // An on-site reading wins unless the owner recorded something more recent.
  return latest.recordedAt > onSite.recordedAt ? latest : onSite;
}

/**
 * Adds a reading. Append-only.
 *
 * RULE 1 — a value below the reference is rejected. An implausible jump
 * returns a SOFT warning the client confirms rather than a hard rejection:
 * a genuinely neglected car exists, and refusing its real mileage would
 * make the app unusable for exactly the drivers who need it.
 */
export async function addMileage(
  scope: VehicleScope,
  actor: { userId: string; role: string; garageId?: string },
  input: AddMileageInput,
  session?: ClientSession,
) {
  const reference = await referenceReading(scope.vehicleId);
  const recordedAt = input.recordedAt ?? new Date();

  if (recordedAt.getTime() > Date.now() + 60_000) {
    throw err.validation('La date ne peut pas être dans le futur.', 'recordedAt');
  }

  if (reference && input.value < reference.value) {
    throw new AppError({
      status: 422,
      code: ErrorCode.MILEAGE_REGRESSION,
      message: `Le kilométrage doit être supérieur au précédent (${reference.value.toLocaleString('fr-FR')} km).`,
      field: 'mileage',
      details: {
        referenceValue: reference.value,
        referenceAt: reference.recordedAt,
        referenceSource: reference.source,
      },
    });
  }

  if (
    reference &&
    input.value - reference.value > config.MILEAGE_JUMP_WARN_KM &&
    !input.confirmJump
  ) {
    throw new AppError({
      status: 409,
      code: ErrorCode.MILEAGE_IMPLAUSIBLE,
      message: `Cet écart est important (+${(input.value - reference.value).toLocaleString('fr-FR')} km). Confirmez si c'est correct.`,
      field: 'mileage',
      details: { referenceValue: reference.value, requiresConfirmation: true },
    });
  }

  const [entry] = await MileageModel.create(
    [
      {
        vehicleId: scope.vehicleId,
        ownershipId: scope.ownershipId,
        value: input.value,
        recordedAt,
        source: input.source,
        authorId: actor.userId,
        authorType: scope.actorKind === 'garage' ? 'garage' : 'owner',
        garageId: actor.garageId ?? null,
        maintenanceEventId: input.maintenanceEventId ?? null,
        estimated: input.estimated ?? false,
        note: input.note ?? null,
      },
    ],
    session ? { session } : {},
  );

  // Denormalised onto the vehicle: every dashboard read needs it. Written
  // only here, never by a controller.
  const isNewReference =
    !reference || recordedAt >= reference.recordedAt || input.value > reference.value;

  if (isNewReference) {
    await VehicleModel.updateOne(
      { _id: scope.vehicleId },
      {
        currentMileage: input.value,
        currentMileageAt: recordedAt,
        currentMileageSource: input.source,
        currentMileageEstimated: input.estimated ?? false,
        // Health depends on mileage: invalidate rather than recompute inline.
        'healthCache.computedAt': null,
      },
      session ? { session } : {},
    );
  }

  return entry;
}

/**
 * Correction. The ONLY path allowed to lower a value, and only with a reason.
 * Adds an entry rather than editing one — the trail is the point.
 */
export async function correctMileage(
  scope: VehicleScope,
  actor: { userId: string; role: string },
  entryId: string,
  input: { value: number; reason: string },
) {
  const original = await MileageModel.findOne({ _id: entryId, vehicleId: scope.vehicleId });
  if (!original) throw err.notFound('Relevé introuvable.');

  const [correction] = await MileageModel.create([
    {
      vehicleId: scope.vehicleId,
      ownershipId: scope.ownershipId,
      value: input.value,
      recordedAt: original.recordedAt,
      source: original.source,
      authorId: actor.userId,
      authorType: scope.actorKind === 'garage' ? 'garage' : 'owner',
      estimated: original.estimated,
      regressionReason: input.reason,
      correctsEntryId: original._id,
    },
  ]);

  const reference = await referenceReading(scope.vehicleId);
  if (reference) {
    await VehicleModel.updateOne(
      { _id: scope.vehicleId },
      {
        currentMileage: reference.value,
        currentMileageAt: reference.recordedAt,
        currentMileageSource: reference.source,
        'healthCache.computedAt': null,
      },
    );
  }

  return correction;
}

/** True when nothing was recorded for MILEAGE_STALE_DAYS. */
export function isStale(currentMileageAt: Date | null | undefined): boolean {
  if (!currentMileageAt) return true;
  const age = Date.now() - currentMileageAt.getTime();
  return age > config.MILEAGE_STALE_DAYS * 86_400_000;
}

export async function listMileage(scope: VehicleScope, limit = 50, cursor?: string) {
  const filter: Record<string, unknown> = { vehicleId: scope.vehicleId };
  if (!scope.includeHistoryBefore) filter.ownershipId = scope.ownershipId;
  if (cursor) filter.recordedAt = { $lt: new Date(cursor) };

  const items = await MileageModel.find(filter)
    .sort({ recordedAt: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = items.length > limit;
  return { items: items.slice(0, limit), hasMore };
}

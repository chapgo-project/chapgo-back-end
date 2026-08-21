import { withTransaction } from '../../core/db.js';
import { ErrorCode, err } from '../../core/errors.js';
import { VehicleModel, normalizePlate } from './vehicle.model.js';
import { OwnershipModel } from './ownership.model.js';
import { MileageModel } from '../mileage/mileage.model.js';
import type { z } from 'zod';
import type { CreateVehicleBody } from './vehicle.schema.js';

type CreateInput = z.infer<typeof CreateVehicleBody>;

/**
 * Creates a vehicle, its first ownership period and its first mileage entry.
 *
 * Three collections, one transaction: a vehicle with no ownership period is
 * unreachable by every authorization path, and a vehicle with no mileage
 * entry has a currentMileage nothing justifies.
 */
export async function createVehicle(userId: string, input: CreateInput) {
  const plateNormalized = normalizePlate(input.plate);

  // Uniqueness per owner, not globally: two ChapGo users may legitimately
  // record the same plate across a sale before the transfer is done.
  const existing = await VehicleModel.aggregate([
    { $match: { plateNormalized, archivedAt: null } },
    {
      $lookup: {
        from: 'vehicleOwnerships',
        localField: '_id',
        foreignField: 'vehicleId',
        as: 'ownerships',
      },
    },
    { $match: { 'ownerships.userId': { $exists: true } } },
    { $limit: 5 },
  ]);

  const clash = existing.some((v: { ownerships?: { userId: unknown; endedAt: Date | null }[] }) =>
    v.ownerships?.some((o) => String(o.userId) === userId && o.endedAt === null),
  );
  if (clash) {
    throw err.conflict(
      ErrorCode.PLATE_ALREADY_EXISTS,
      'Ce véhicule est déjà enregistré dans votre compte.',
      'plate',
    );
  }

  return withTransaction(async (session) => {
    const hasVehicle = await OwnershipModel.exists({ userId, endedAt: null }).session(session);

    const [vehicle] = await VehicleModel.create(
      [
        {
          brand: input.brand,
          model: input.model,
          version: input.version ?? null,
          year: input.year,
          plate: input.plate.toUpperCase(),
          plateNormalized,
          vin: input.vin ?? null,
          fuel: input.fuel,
          transmission: input.transmission ?? null,
          firstRegistrationAt: input.firstRegistrationAt ?? null,
          condition: input.condition,
          historyKnown: input.historyKnown,
          photoId: input.photoId ?? null,
          currentMileage: input.currentMileage,
          currentMileageAt: new Date(),
          currentMileageSource: 'owner_manual',
          currentMileageEstimated: input.mileageEstimated,
          isPrimary: !hasVehicle, // first vehicle becomes primary
        },
      ],
      { session },
    );

    const [ownership] = await OwnershipModel.create(
      [
        {
          vehicleId: vehicle!._id,
          userId,
          startedAt: new Date(),
          startMileage: input.currentMileage,
          shareHistoryBefore: false,
        },
      ],
      { session },
    );

    await MileageModel.create(
      [
        {
          vehicleId: vehicle!._id,
          ownershipId: ownership!._id,
          value: input.currentMileage,
          recordedAt: new Date(),
          source: 'owner_manual',
          authorId: userId,
          authorType: 'owner',
          estimated: input.mileageEstimated,
          note: 'Kilométrage initial',
        },
      ],
      { session },
    );

    return vehicle!;
  });
}

export async function listVehiclesOf(userId: string, includeArchived = false) {
  const ownerships = await OwnershipModel.find({ userId, endedAt: null })
    .select('vehicleId')
    .lean();
  const ids = ownerships.map((o) => o.vehicleId);
  if (ids.length === 0) return [];

  const filter: Record<string, unknown> = { _id: { $in: ids } };
  if (!includeArchived) filter.archivedAt = null;

  return VehicleModel.find(filter).sort({ isPrimary: -1, createdAt: -1 }).lean();
}

export async function setPrimary(userId: string, vehicleId: string) {
  const owns = await OwnershipModel.exists({ userId, vehicleId, endedAt: null });
  if (!owns) throw err.notFound('Véhicule introuvable.');

  const ownerships = await OwnershipModel.find({ userId, endedAt: null })
    .select('vehicleId')
    .lean();

  await VehicleModel.updateMany(
    { _id: { $in: ownerships.map((o) => o.vehicleId) } },
    { isPrimary: false },
  );
  await VehicleModel.updateOne({ _id: vehicleId }, { isPrimary: true });
}

/**
 * Archive, not delete.
 *
 * A vehicle carrying history must not vanish: the record belongs to the
 * vehicle, and a future owner has a claim to it.
 */
export async function archiveVehicle(vehicleId: string) {
  await VehicleModel.updateOne({ _id: vehicleId }, { archivedAt: new Date(), isPrimary: false });
}

/** Plate search for a garage. Uses plateNormalized, so a prefix matches. */
export async function searchByPlate(fragment: string, limit = 10) {
  const normalized = normalizePlate(fragment);
  if (normalized.length < 3) return [];

  return VehicleModel.find({
    plateNormalized: { $regex: `^${normalized}`, $options: 'i' },
    archivedAt: null,
  })
    .select('_id brand model year plate currentMileage')
    .limit(limit)
    .lean();
}

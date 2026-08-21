import { Types } from 'mongoose';
import { AppError, ErrorCode, err } from './errors.js';
import type { Actor } from './authMiddleware.js';
import { VehicleModel } from '../modules/vehicles/vehicle.model.js';
import { OwnershipModel } from '../modules/vehicles/ownership.model.js';
import { AccessModel } from '../modules/access/access.model.js';

/**
 * Layer 3 — resource authorization.
 *
 * WRITTEN ONCE, ON PURPOSE. Every vehicle-scoped route calls
 * resolveVehicleScope(); re-implementing the check per controller is how one
 * route eventually ships without it, and that single route is the breach.
 *
 * The returned scope also drives SERIALIZATION: a garage reads the same
 * endpoint as the owner, but the response is narrowed (see toVehicleDto).
 */
export interface VehicleScope {
  vehicleId: string;
  /** Ownership period the actor is allowed to read. */
  ownershipId: string;
  /** Owner of the current period. */
  ownerUserId: string;

  actorKind: 'owner' | 'garage';
  canWrite: boolean;

  /** Garage only — the grant that authorised this read. */
  accessId?: string;
  garageId?: string;

  /**
   * Whether history from BEFORE the current ownership may be returned.
   * Technical fields only — never a previous owner's identity.
   */
  includeHistoryBefore: boolean;
  /** Whether the owner's phone may be exposed to the garage. */
  includeOwnerPhone: boolean;
  /** Whether documents not flagged shareable may be returned. */
  includeAllDocuments: boolean;
}

export async function resolveVehicleScope(
  actor: Actor,
  vehicleId: string,
  opts: { forWrite?: boolean } = {},
): Promise<VehicleScope> {
  if (!Types.ObjectId.isValid(vehicleId)) throw err.notFound('Véhicule introuvable.');

  const vehicle = await VehicleModel.findById(vehicleId).select('_id archivedAt').lean();
  if (!vehicle) throw err.notFound('Véhicule introuvable.');

  const ownership = await OwnershipModel.findOne({ vehicleId, endedAt: null })
    .select('_id userId shareHistoryBefore')
    .lean();
  if (!ownership) throw err.notFound('Véhicule introuvable.');

  const ownershipId = String(ownership._id);
  const ownerUserId = String(ownership.userId);

  // ── Owner path ────────────────────────────────────────────────────
  if (actor.role === 'owner') {
    if (ownerUserId !== actor.userId) {
      // Deliberately the same message as a missing vehicle: confirming that
      // a vehicle exists but belongs to someone else leaks information.
      throw err.notFound('Véhicule introuvable.');
    }
    return {
      vehicleId,
      ownershipId,
      ownerUserId,
      actorKind: 'owner',
      canWrite: !vehicle.archivedAt,
      includeHistoryBefore: true,
      includeOwnerPhone: true,
      includeAllDocuments: true,
    };
  }

  // ── Admin path ────────────────────────────────────────────────────
  if (actor.role === 'admin') {
    return {
      vehicleId,
      ownershipId,
      ownerUserId,
      actorKind: 'owner',
      canWrite: false, // support reads, never writes on a customer record
      includeHistoryBefore: true,
      includeOwnerPhone: true,
      includeAllDocuments: true,
    };
  }

  // ── Garage path ───────────────────────────────────────────────────
  if (!actor.garageId) throw err.forbidden();

  const access = await AccessModel.findOne({
    garageId: actor.garageId,
    vehicleId,
    status: 'approved',
  })
    .select('_id expiresAt ownershipId sharePhone shareHistoryBefore')
    .lean();

  if (!access) {
    throw new AppError({
      status: 403,
      code: ErrorCode.ACCESS_DENIED,
      message: "Vous n'avez pas accès à ce véhicule.",
    });
  }

  // `expiresAt: null` means "until revoked" — a legitimate owner choice.
  if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
    throw new AppError({
      status: 403,
      code: ErrorCode.ACCESS_EXPIRED,
      message: 'Votre accès à ce véhicule a expiré. Demandez un nouvel accès.',
    });
  }

  // The grant is bound to an ownership period. After a transfer the period
  // changes, so a grant from the seller cannot reach the buyer's record —
  // enforced here as well as by the revocation on transfer.
  if (String(access.ownershipId) !== ownershipId) {
    throw new AppError({
      status: 403,
      code: ErrorCode.ACCESS_DENIED,
      message: 'Ce véhicule a changé de propriétaire. Un nouvel accès est nécessaire.',
    });
  }

  return {
    vehicleId,
    ownershipId,
    ownerUserId,
    actorKind: 'garage',
    canWrite: !vehicle.archivedAt && (opts.forWrite ?? false) !== false,
    accessId: String(access._id),
    garageId: actor.garageId,
    // Both the owner's standing preference and the per-grant choice must allow it.
    includeHistoryBefore: Boolean(ownership.shareHistoryBefore && access.shareHistoryBefore),
    includeOwnerPhone: Boolean(access.sharePhone),
    includeAllDocuments: false,
  };
}

/** Throws unless the scope permits writing. */
export function assertCanWrite(scope: VehicleScope): void {
  if (!scope.canWrite) {
    throw err.forbidden("Ce véhicule est archivé ou vous n'avez pas le droit d'écrire.");
  }
}

/**
 * Mongo filter restricting a vehicle's sub-resources to the readable
 * ownership periods.
 *
 * Used by maintenance, mileage and issue queries so the narrowing happens in
 * the database rather than after the fact — filtering in JavaScript is how
 * an accidental leak survives review.
 */
export async function ownershipFilter(
  scope: VehicleScope,
): Promise<Record<string, unknown>> {
  if (scope.includeHistoryBefore) return { vehicleId: scope.vehicleId };
  return { vehicleId: scope.vehicleId, ownershipId: scope.ownershipId };
}

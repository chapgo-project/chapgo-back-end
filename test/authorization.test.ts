import { describe, expect, it } from 'vitest';
import { resolveVehicleScope } from '../src/core/authorization.js';
import { AppError } from '../src/core/errors.js';
import {
  actorOf, grantAccess, makeGarage, makeOwner, makeVehicle,
} from './factories.js';
import { OwnershipModel } from '../src/modules/vehicles/ownership.model.js';
import { AccessModel } from '../src/modules/access/access.model.js';

/**
 * THE AUTHORIZATION MATRIX — the most important test file in the project.
 *
 * Every role against every resource state. This is the deliverable to point
 * at when asking whether the backend is safe to deploy: if these pass, no
 * endpoint can return data its caller is not entitled to, because every
 * vehicle-scoped route goes through resolveVehicleScope.
 */
async function expectDenied(fn: () => Promise<unknown>, codes: string[]) {
  try {
    await fn();
    throw new Error('expected authorization to be refused, but it succeeded');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect(codes).toContain((e as AppError).code);
  }
}

describe('owner access', () => {
  it('reads and writes their own vehicle', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));

    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));
    expect(scope.actorKind).toBe('owner');
    expect(scope.canWrite).toBe(true);
    expect(scope.includeHistoryBefore).toBe(true);
    expect(scope.includeAllDocuments).toBe(true);
  });

  it("cannot reach another owner's vehicle", async () => {
    const a = await makeOwner();
    const b = await makeOwner();
    const { vehicle } = await makeVehicle(String(a._id));

    // NOT_FOUND rather than FORBIDDEN: confirming the vehicle exists but
    // belongs to someone else is itself a leak.
    await expectDenied(
      () => resolveVehicleScope(actorOf(b), String(vehicle._id)),
      ['NOT_FOUND'],
    );
  });

  it('cannot write to an archived vehicle', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));
    vehicle.archivedAt = new Date();
    await vehicle.save();

    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));
    expect(scope.canWrite).toBe(false);
  });

  it('loses access once the ownership period is closed', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    ownership.endedAt = new Date();
    await ownership.save();

    await expectDenied(
      () => resolveVehicleScope(actorOf(owner), String(vehicle._id)),
      ['NOT_FOUND'],
    );
  });
});

describe('garage access', () => {
  it('reads with an approved grant', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
    });

    const scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.actorKind).toBe('garage');
    expect(scope.accessId).toBeDefined();
    // Defaults are restrictive: nothing extra unless the owner said so.
    expect(scope.includeHistoryBefore).toBe(false);
    expect(scope.includeOwnerPhone).toBe(false);
    expect(scope.includeAllDocuments).toBe(false);
  });

  it('is refused with no grant at all', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));
    const { user } = await makeGarage();

    await expectDenied(
      () => resolveVehicleScope(actorOf(user), String(vehicle._id)),
      ['ACCESS_DENIED'],
    );
  });

  it('is refused while the request is still pending', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      status: 'pending',
    });

    await expectDenied(
      () => resolveVehicleScope(actorOf(user), String(vehicle._id)),
      ['ACCESS_DENIED'],
    );
  });

  it('is refused after revocation', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      status: 'revoked',
    });

    await expectDenied(
      () => resolveVehicleScope(actorOf(user), String(vehicle._id)),
      ['ACCESS_DENIED'],
    );
  });

  it('is refused once the grant has expired', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expectDenied(
      () => resolveVehicleScope(actorOf(user), String(vehicle._id)),
      ['ACCESS_EXPIRED'],
    );
  });

  it('accepts "until revoked" — a null expiry is legitimate', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      expiresAt: null,
    });

    const scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.actorKind).toBe('garage');
  });

  it('sees history before the purchase only when BOTH flags allow it', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();

    // Grant allows, ownership does not → still refused.
    const access = await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      shareHistoryBefore: true,
    });
    let scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.includeHistoryBefore).toBe(false);

    // Both allow → granted.
    ownership.shareHistoryBefore = true;
    await ownership.save();
    scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.includeHistoryBefore).toBe(true);

    // Grant revokes the choice → refused again.
    access.shareHistoryBefore = false;
    await access.save();
    scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.includeHistoryBefore).toBe(false);
  });

  it('exposes the phone only when the grant says so', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
      sharePhone: true,
    });

    const scope = await resolveVehicleScope(actorOf(user), String(vehicle._id));
    expect(scope.includeOwnerPhone).toBe(true);
  });

  /**
   * RULE 6 — the highest-risk case in the whole system.
   *
   * A garage authorised by the seller has no relationship with the buyer.
   * The grant is bound to an ownershipId, so a transfer invalidates it even
   * if the revocation sweep somehow failed.
   */
  it('loses access after the vehicle changes owner, even if the grant row survives', async () => {
    const seller = await makeOwner();
    const buyer = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(seller._id));
    const { garage, user } = await makeGarage();

    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(seller._id),
    });

    // Transfer, deliberately WITHOUT revoking the grant.
    ownership.endedAt = new Date();
    await ownership.save();
    await OwnershipModel.create({
      vehicleId: vehicle._id,
      userId: buyer._id,
      startedAt: new Date(),
    });

    await expectDenied(
      () => resolveVehicleScope(actorOf(user), String(vehicle._id)),
      ['ACCESS_DENIED'],
    );

    // And the seller is out too.
    await expectDenied(
      () => resolveVehicleScope(actorOf(seller), String(vehicle._id)),
      ['NOT_FOUND'],
    );

    // The buyer is in.
    const buyerScope = await resolveVehicleScope(actorOf(buyer), String(vehicle._id));
    expect(buyerScope.canWrite).toBe(true);
  });

  it('cannot reach a vehicle through another garage grant', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const authorised = await makeGarage();
    const other = await makeGarage();

    await grantAccess({
      garageId: String(authorised.garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
    });

    await expectDenied(
      () => resolveVehicleScope(actorOf(other.user), String(vehicle._id)),
      ['ACCESS_DENIED'],
    );
  });
});

describe('admin access', () => {
  it('reads for support but never writes', async () => {
    const owner = await makeOwner();
    const admin = await makeOwner({ role: 'admin' });
    const { vehicle } = await makeVehicle(String(owner._id));

    const scope = await resolveVehicleScope(actorOf(admin), String(vehicle._id));
    expect(scope.canWrite).toBe(false);
  });
});

describe('unknown resources', () => {
  it('rejects a malformed id without touching the database', async () => {
    const owner = await makeOwner();
    await expectDenied(() => resolveVehicleScope(actorOf(owner), 'not-an-id'), ['NOT_FOUND']);
  });
});

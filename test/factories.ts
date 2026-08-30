import { UserModel } from '../src/modules/users/user.model.js';
import { GarageModel } from '../src/modules/garages/garage.model.js';
import { VehicleModel, normalizePlate } from '../src/modules/vehicles/vehicle.model.js';
import { OwnershipModel } from '../src/modules/vehicles/ownership.model.js';
import { MileageModel } from '../src/modules/mileage/mileage.model.js';
import { AccessModel } from '../src/modules/access/access.model.js';
import { hashPassword } from '../src/core/password.js';
import { hashToken, issueAccessToken } from '../src/core/tokens.js';
import { OtpChallengeModel } from '../src/modules/auth/session.model.js';

let seq = 0;
const next = () => ++seq;

export async function makeOwner(overrides: Record<string, unknown> = {}) {
  const n = next();
  return UserModel.create({
    role: 'owner',
    firstName: 'Marc',
    lastName: `Kouassi${n}`,
    email: `owner${n}@example.ci`,
    phone: `+2250700000${String(n).padStart(3, '0')}`,
    passwordHash: await hashPassword('motdepasse1'),
    emailVerifiedAt: new Date(),
    ...overrides,
  });
}

export async function makeGarage(
  opts: { verified?: boolean } = {},
): Promise<{ garage: any; user: any }> {
  const n = next();
  const garage = await GarageModel.create({
    name: `Garage ${n}`,
    phone: `+2252100000${String(n).padStart(3, '0')}`,
    commune: 'Cocody',
    verificationStatus: opts.verified === false ? 'pending' : 'verified',
    verifiedAt: opts.verified === false ? null : new Date(),
    region: 'CI',
    connectCode: `GRG${n}`,
  });

  const user = await UserModel.create({
    role: 'garage',
    firstName: 'Mécano',
    lastName: `${n}`,
    email: `garage${n}@example.ci`,
    passwordHash: await hashPassword('motdepasse1'),
    emailVerifiedAt: new Date(),
    garageId: garage._id,
  });

  return { garage, user };
}

/** Vehicle + current ownership + first mileage entry, as the service does. */
export async function makeVehicle(ownerId: string, mileage = 84_200) {
  const n = next();
  const plate = `AB${String(n).padStart(3, '0')}CI`;

  const vehicle = await VehicleModel.create({
    brand: 'Toyota',
    model: 'Yaris',
    year: 2018,
    plate,
    plateNormalized: normalizePlate(plate),
    fuel: 'petrol',
    currentMileage: mileage,
    currentMileageAt: new Date(),
    currentMileageSource: 'owner_manual',
  });

  const ownership = await OwnershipModel.create({
    vehicleId: vehicle._id,
    userId: ownerId,
    startedAt: new Date(),
    startMileage: mileage,
  });

  await MileageModel.create({
    vehicleId: vehicle._id,
    ownershipId: ownership._id,
    value: mileage,
    recordedAt: new Date(),
    source: 'owner_manual',
    authorId: ownerId,
    authorType: 'owner',
  });

  return { vehicle, ownership };
}

export async function grantAccess(opts: {
  garageId: string;
  vehicleId: string;
  ownershipId: string;
  ownerUserId: string;
  status?: 'pending' | 'approved' | 'revoked' | 'expired';
  expiresAt?: Date | null;
  shareHistoryBefore?: boolean;
  sharePhone?: boolean;
}) {
  return AccessModel.create({
    garageId: opts.garageId,
    vehicleId: opts.vehicleId,
    ownershipId: opts.ownershipId,
    ownerUserId: opts.ownerUserId,
    status: opts.status ?? 'approved',
    requestedBy: 'owner',
    grantedAt: new Date(),
    expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
    shareHistoryBefore: opts.shareHistoryBefore ?? false,
    sharePhone: opts.sharePhone ?? false,
  });
}

export function bearer(user: { _id: unknown; role: string; garageId?: unknown }) {
  const { token } = issueAccessToken({
    userId: String(user._id),
    role: user.role as 'owner' | 'garage' | 'admin',
    ...(user.garageId ? { garageId: String(user.garageId) } : {}),
  });
  return `Bearer ${token}`;
}

export function actorOf(user: { _id: unknown; role: string; garageId?: unknown }) {
  return {
    userId: String(user._id),
    role: user.role as 'owner' | 'garage' | 'admin',
    ...(user.garageId ? { garageId: String(user.garageId) } : {}),
  };
}

export async function peekOtp(identifier: string, purpose?: string) {
  const challenge = await OtpChallengeModel.findOne({
    identifier,
    consumedAt: null,
    ...(purpose ? { purpose } : {}),
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!challenge) return '';
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = String(i).padStart(6, '0');
    if (hashToken(candidate) === challenge.codeHash) return candidate;
  }
  return '';
}

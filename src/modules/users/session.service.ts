import { hashToken } from '../../core/tokens.js';
import { err } from '../../core/errors.js';
import { RefreshTokenModel } from '../auth/session.model.js';

/** Access tokens last 15 minutes — treat that window as "still active". */
const ACTIVE_WINDOW_MS = 15 * 60 * 1000;

function fallbackLabel(platform?: string | null): string {
  switch (platform) {
    case 'ios':
      return 'iPhone';
    case 'android':
      return 'Android';
    case 'web':
      return 'Web';
    default:
      return 'ChapGo';
  }
}

function asDate(value: unknown, fallback: Date): Date {
  return value instanceof Date ? value : fallback;
}

export type DeviceSessionDto = {
  id: string;
  deviceLabel: string;
  platform: string;
  lastActiveAt: Date;
  createdAt: Date;
  current: boolean;
  active: boolean;
};

export async function listDeviceSessions(
  userId: string,
  currentRefresh?: string,
): Promise<DeviceSessionDto[]> {
  const tokens = await RefreshTokenModel.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActiveAt: -1, createdAt: -1 })
    .lean();

  let currentFamily: string | undefined;
  if (currentRefresh && currentRefresh.length >= 20) {
    const stored = await RefreshTokenModel.findOne({
      userId,
      tokenHash: hashToken(currentRefresh),
    })
      .select('familyId revokedAt')
      .lean();
    if (stored) {
      currentFamily = stored.familyId;
      if (!stored.revokedAt) {
        await RefreshTokenModel.updateOne(
          { _id: stored._id },
          { lastActiveAt: new Date() },
        );
      }
    }
  }

  const byFamily = new Map<string, (typeof tokens)[number]>();
  for (const token of tokens) {
    const existing = byFamily.get(token.familyId);
    if (!existing) {
      byFamily.set(token.familyId, token);
      continue;
    }
    const tokenActive = asDate(token.lastActiveAt, token.createdAt);
    const existingActive = asDate(existing.lastActiveAt, existing.createdAt);
    if (tokenActive.getTime() >= existingActive.getTime()) {
      byFamily.set(token.familyId, token);
    }
  }

  const now = Date.now();
  const sessions = [...byFamily.values()].map((token) => {
    const lastActiveAt = token.familyId === currentFamily
      ? new Date()
      : asDate(token.lastActiveAt, token.createdAt);
    return {
      id: token.familyId,
      deviceLabel: token.deviceLabel || fallbackLabel(token.platform),
      platform: token.platform || 'unknown',
      lastActiveAt,
      createdAt: token.createdAt,
      current: token.familyId === currentFamily,
      active: now - lastActiveAt.getTime() < ACTIVE_WINDOW_MS,
    };
  });

  sessions.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
  });

  return sessions;
}

export async function revokeDeviceSession(userId: string, familyId: string): Promise<void> {
  const result = await RefreshTokenModel.updateMany(
    { userId, familyId, revokedAt: null },
    { revokedAt: new Date() },
  );
  if (!result.matchedCount) {
    throw err.notFound('Appareil introuvable.');
  }
}

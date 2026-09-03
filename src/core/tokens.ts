import crypto from 'node:crypto';
import { config } from './config.js';

export type Role = 'owner' | 'garage' | 'admin';

export interface AccessClaims {
  sub: string;          // user id
  role: Role;
  garageId?: string;
  iat: number;
  exp: number;
}

/**
 * Minimal HS256 JWT, implemented directly.
 *
 * Deliberate: jsonwebtoken pulls a dependency tree for two operations we
 * need exactly once each, and its callback API invites mistakes. Everything
 * here uses timing-safe comparison.
 */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: object, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verify<T>(token: string, secret: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload as T;
  } catch {
    return null;
  }
}

export function issueAccessToken(input: {
  userId: string;
  role: Role;
  garageId?: string;
}): { token: string; expiresIn: number } {
  const expiresIn = config.ACCESS_TOKEN_TTL_MIN * 60;
  const now = Math.floor(Date.now() / 1000);
  const token = sign(
    {
      sub: input.userId,
      role: input.role,
      ...(input.garageId ? { garageId: input.garageId } : {}),
      iat: now,
      exp: now + expiresIn,
    },
    config.JWT_ACCESS_SECRET,
  );
  return { token, expiresIn };
}

export function verifyAccessToken(token: string): AccessClaims | null {
  return verify<AccessClaims>(token, config.JWT_ACCESS_SECRET);
}

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * They must be revocable, and only the HASH is stored — a database leak
 * must not hand over live sessions.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Numeric OTP. crypto.randomInt is uniform; Math.random is not. */
export function generateOtpCode(digits = 6): string {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

/** Short human-typable code for transfers and garage invitations. */
export function generateShortCode(length = 7): string {
  // No I, O, 0, 1 — they are misread when typed from a screen or paper.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

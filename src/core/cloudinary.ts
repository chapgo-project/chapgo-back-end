import crypto from 'node:crypto';
import { config } from './config.js';

/** Face-aware square derived on upload so the first profile paint is CDN-ready. */
export const AVATAR_EAGER = 'c_fill,g_face,w_512,h_512,q_auto,f_auto';

export const AVATAR_MAX_BYTES = 2_500_000;

function creds() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || config.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY || config.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET || config.CLOUDINARY_API_SECRET,
  };
}

export function isCloudinaryConfigured(): boolean {
  const c = creds();
  return Boolean(c.cloudName && c.apiKey && c.apiSecret);
}

/** Stable public id so a new photo overwrites the previous one (no orphaned assets). */
export function avatarPublicId(userId: string): string {
  return `chapgo/users/${userId}/profile`;
}

/**
 * Cloudinary signed-upload digest: sorted `key=value` pairs + API secret, SHA-1.
 * Booleans must be the same strings the client will POST (`true`, not `1`).
 */
export function signParams(
  params: Record<string, string | number>,
  apiSecret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .filter((key) => {
      const value = params[key];
      return value !== '' && value !== undefined && value !== null;
    })
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

export function signUpload(params: Record<string, string>) {
  const c = creds();
  const timestamp = Math.floor(Date.now() / 1000);
  const payload: Record<string, string | number> = { ...params, timestamp };
  return {
    cloudName: c.cloudName,
    apiKey: c.apiKey,
    timestamp,
    signature: signParams(payload, c.apiSecret),
  };
}

/** Canonical delivery URL (no transform). The client adds size/format on demand. */
export function avatarDeliveryUrl(
  publicId: string | null | undefined,
  version?: number | null,
): string | null {
  const { cloudName } = creds();
  if (!cloudName || !publicId) return null;
  const v = version ? `v${version}/` : '';
  return `https://res.cloudinary.com/${cloudName}/image/upload/${v}${publicId}`;
}

export async function destroyImage(publicId: string): Promise<void> {
  if (!isCloudinaryConfigured()) return;
  const c = creds();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ public_id: publicId, timestamp }, c.apiSecret);
  const body = new URLSearchParams({
    public_id: publicId,
    api_key: c.apiKey,
    timestamp: String(timestamp),
    signature,
  });
  await fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/image/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

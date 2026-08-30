import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { AppError, ErrorCode, err } from './errors.js';
import { logger } from './logger.js';

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  picture?: string;
}

/**
 * Verifies a Google ID token from the Flutter SDK (`google_sign_in`).
 *
 * Audience must match one of the app's OAuth client IDs (iOS, Android, Web).
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const audiences = config.GOOGLE_CLIENT_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (audiences.length === 0) {
    throw err.custom(
      503,
      ErrorCode.PROVIDER_UNAVAILABLE,
      'La connexion Google n\'est pas configurée.',
    );
  }

  try {
    const client = new OAuth2Client();
    const ticket = await client.verifyIdToken({
      idToken,
      audience: audiences,
    });
    const payload = ticket.getPayload();

    if (!payload?.sub || !payload.email) {
      throw err.custom(
        401,
        ErrorCode.GOOGLE_TOKEN_INVALID,
        'Impossible de vérifier le compte Google.',
      );
    }

    if (payload.email_verified === false) {
      throw err.custom(
        401,
        ErrorCode.GOOGLE_TOKEN_INVALID,
        'Cette adresse Google n\'est pas vérifiée.',
      );
    }

    const email = payload.email.toLowerCase();
    const local = email.split('@')[0] ?? 'utilisateur';

    return {
      googleId: payload.sub,
      email,
      emailVerified: true,
      firstName: (payload.given_name ?? local).trim() || local,
      lastName: (payload.family_name ?? '').trim() || 'ChapGo',
      picture: payload.picture,
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    logger.warn(
      { err: e instanceof Error ? e.message : 'unknown' },
      'Google ID token verification failed',
    );
    throw err.custom(
      401,
      ErrorCode.GOOGLE_TOKEN_INVALID,
      'Jeton Google invalide ou expiré.',
    );
  }
}

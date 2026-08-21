import type { NextFunction, Request, Response } from 'express';
import { err, ErrorCode, AppError } from './errors.js';
import { verifyAccessToken, type Role } from './tokens.js';
import { UserModel } from '../modules/users/user.model.js';
import { GarageModel } from '../modules/garages/garage.model.js';

export interface Actor {
  userId: string;
  role: Role;
  garageId?: string;
}

export interface AuthedRequest extends Request {
  actor: Actor;
}

/** Attaches an actor when a Bearer token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  const claims = verifyAccessToken(header.slice(7));
  if (!claims) return next();

  (req as AuthedRequest).actor = {
    userId: claims.sub,
    role: claims.role,
    ...(claims.garageId ? { garageId: claims.garageId } : {}),
  };
  next();
}

/** Layer 1 — a valid access token on a live account. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(err.unauthenticated('Authentification requise.'));

  const claims = verifyAccessToken(header.slice(7));
  if (!claims) return next(err.unauthenticated());

  (req as AuthedRequest).actor = {
    userId: claims.sub,
    role: claims.role,
    ...(claims.garageId ? { garageId: claims.garageId } : {}),
  };
  next();
}

/**
 * Confirms the account still exists and is not deleted.
 *
 * A token stays cryptographically valid for 15 minutes after an account is
 * deleted — for anything destructive, that window is too wide.
 */
export async function requireLiveAccount(req: Request, _res: Response, next: NextFunction) {
  const { actor } = req as AuthedRequest;
  const user = await UserModel.findById(actor.userId).select('_id deletedAt').lean();
  if (!user || user.deletedAt) return next(err.unauthenticated('Ce compte n\'existe plus.'));
  next();
}

/** Layer 2 — role. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { actor } = req as AuthedRequest;
    if (!roles.includes(actor.role)) return next(err.forbidden());
    next();
  };
}

/**
 * Layer 2b — a garage account whose garage ChapGo has verified.
 *
 * Applied as middleware on the whole garage router rather than per route:
 * one route shipped without it is the entire breach.
 */
export async function requireVerifiedGarage(req: Request, _res: Response, next: NextFunction) {
  const { actor } = req as AuthedRequest;
  if (actor.role !== 'garage' || !actor.garageId) return next(err.forbidden());

  const garage = await GarageModel.findById(actor.garageId).select('verificationStatus').lean();
  if (!garage) return next(err.forbidden());

  if (garage.verificationStatus !== 'verified') {
    return next(
      new AppError({
        status: 403,
        code: ErrorCode.GARAGE_NOT_VALIDATED,
        message:
          "Votre garage n'est pas encore validé par ChapGo. Vous ne pouvez pas accéder aux dossiers clients.",
      }),
    );
  }
  next();
}

export function actorOf(req: Request): Actor {
  return (req as AuthedRequest).actor;
}

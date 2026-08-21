import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError, ErrorCode } from './errors.js';
import { logger } from './logger.js';
import { isProd } from './config.js';

/** Success envelope. The Flutter client unwraps `data` on every response. */
export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}

/** Paginated envelope. */
export function okList<T>(
  res: Response,
  data: T[],
  meta: { page?: number; perPage?: number; total?: number; hasMore?: boolean; cursor?: string | null },
) {
  return res.status(200).json({ data, meta });
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function handler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req as T, res, next).catch(next);
  };
}

/**
 * Single error responder. Every failure leaves the API in the same shape:
 * { error: { code, message, field? } }.
 */
export function errorMiddleware(
  e: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  // Deliberate, already carries a French message.
  if (e instanceof AppError) {
    return res.status(e.status).json({
      error: { code: e.code, message: e.message, field: e.field, details: e.details },
    });
  }

  // Boundary validation. Report the first issue only: the app shows one
  // inline error at a time, and a list of six is noise.
  if (e instanceof ZodError) {
    const first = e.issues[0];
    return res.status(422).json({
      error: {
        code: ErrorCode.VALIDATION_FAILED,
        message: first?.message ?? 'Requête invalide.',
        field: first?.path.filter((p) => typeof p === 'string').join('.') || undefined,
      },
    });
  }

  // Duplicate key — surface which field, the app needs it.
  if (e instanceof mongoose.mongo.MongoServerError && e.code === 11000) {
    const field = Object.keys((e as { keyPattern?: Record<string, unknown> }).keyPattern ?? {})[0];
    const known: Record<string, { code: keyof typeof ErrorCode; message: string }> = {
      email: { code: 'EMAIL_ALREADY_EXISTS', message: 'Cette adresse e-mail est déjà utilisée.' },
      phone: { code: 'PHONE_ALREADY_EXISTS', message: 'Ce numéro est déjà utilisé.' },
      plateNormalized: { code: 'PLATE_ALREADY_EXISTS', message: 'Ce véhicule est déjà enregistré.' },
    };
    const hit = field ? known[field] : undefined;
    return res.status(409).json({
      error: {
        code: hit ? ErrorCode[hit.code] : ErrorCode.CONFLICT,
        message: hit?.message ?? 'Cette valeur existe déjà.',
        field,
      },
    });
  }

  if (e instanceof mongoose.Error.CastError) {
    return res.status(404).json({
      error: { code: ErrorCode.NOT_FOUND, message: 'Ressource introuvable.' },
    });
  }

  logger.error({ err: e }, 'unhandled error');
  return res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL,
      message: 'Une erreur est survenue. Réessayez dans un instant.',
      ...(isProd ? {} : { details: { raw: String(e) } }),
    },
  });
}

/** 404 for unmatched routes, in the same envelope. */
export function notFoundMiddleware(_req: Request, res: Response) {
  return res.status(404).json({
    error: { code: ErrorCode.NOT_FOUND, message: 'Ressource introuvable.' },
  });
}

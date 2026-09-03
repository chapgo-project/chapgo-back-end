import rateLimit from 'express-rate-limit';
import { ErrorCode } from './errors.js';
import { isTest } from './config.js';

/**
 * Rate limits keyed on IP AND identifier.
 *
 * IP alone is useless behind a mobile carrier NAT, where thousands of users
 * share an address; identifier alone is trivially rotated.
 */
function limiter(opts: { windowMs: number; max: number; keyExtra?: (req: any) => string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: isTest ? 10_000 : opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const extra = opts.keyExtra?.(req) ?? '';
      return `${req.ip ?? 'noip'}:${extra}`;
    },
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: ErrorCode.RATE_LIMITED,
          message: 'Trop de tentatives. Patientez quelques minutes.',
        },
      });
    },
  });
}

const identifier = (req: any): string =>
  String(req.body?.email ?? req.body?.phone ?? req.body?.code ?? '');

/** Login, register, password reset. */
export const authLimiter = limiter({ windowMs: 15 * 60_000, max: 5, keyExtra: identifier });

/** OTP request — the expensive one: every call may send a paid SMS. */
export const otpRequestLimiter = limiter({ windowMs: 15 * 60_000, max: 4, keyExtra: identifier });

/** OTP verification. */
export const otpVerifyLimiter = limiter({ windowMs: 15 * 60_000, max: 10, keyExtra: identifier });

/**
 * Plate and code lookup.
 *
 * Without this, the endpoint is an oracle: iterate plates and learn which
 * vehicles are registered on ChapGo.
 */
export const lookupLimiter = limiter({ windowMs: 60_000, max: 20 });

/** Upload creation — guards storage cost. */
export const uploadLimiter = limiter({ windowMs: 60_000, max: 60 });

/** Account export — a few JSON dumps per hour is enough. */
export const exportLimiter = limiter({ windowMs: 60 * 60_000, max: 5 });

/** Everything else. */
export const globalLimiter = limiter({ windowMs: 60_000, max: 300 });

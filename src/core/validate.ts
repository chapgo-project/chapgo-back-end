import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Boundary validation. Nothing untyped reaches a service.
 *
 * The parsed value REPLACES req.body / req.query, so unknown keys are
 * stripped — a client cannot slip `status` or `provenance` into a payload
 * and have it persisted.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(parsed.error);
    // Express types query as ParsedQs; the parsed shape is what handlers read.
    (req as unknown as { validatedQuery: z.infer<S> }).validatedQuery = parsed.data;
    next();
  };
}

/** Typed accessor for a validated query, avoiding a cast per handler. */
export function query<S extends ZodTypeAny>(req: Request): z.infer<S> {
  return (req as unknown as { validatedQuery: z.infer<S> }).validatedQuery;
}

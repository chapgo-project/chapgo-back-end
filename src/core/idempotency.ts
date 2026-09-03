import type { NextFunction, Request, Response } from 'express';
import mongoose, { type InferSchemaType } from 'mongoose';
import { logger } from './logger.js';

/**
 * Idempotency for unsafe writes.
 *
 * NOT optional here. Abidjan mobile networks retry, and a duplicated
 * intervention or mileage entry is visible to the customer and damages the
 * record's credibility. The client sends a UUID; the original response is
 * replayed for 24 hours.
 */
const IdempotencySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    status: { type: Number, required: true },
    body: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  { collection: 'idempotencyKeys' },
);

export type IdempotencyKey = InferSchemaType<typeof IdempotencySchema>;
export const IdempotencyModel =
  (mongoose.models.IdempotencyKey as mongoose.Model<IdempotencyKey> | undefined) ??
  mongoose.model<IdempotencyKey>('IdempotencyKey', IdempotencySchema);

export function idempotent(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  if (!key) return next();

  const actor = (req as { actor?: { userId: string } }).actor;
  const userId = actor?.userId ?? 'anonymous';

  void (async () => {
    try {
      const existing = await IdempotencyModel.findOne({ key }).lean();
      if (existing) {
        // Same key, different request: the client reused a key by mistake.
        if (existing.userId !== userId || existing.path !== req.path) {
          return res.status(409).json({
            error: {
              code: 'CONFLICT',
              message: 'Cette clé a déjà été utilisée pour une autre requête.',
            },
          });
        }
        res.setHeader('Idempotent-Replay', 'true');
        return res.status(existing.status).json(existing.body);
      }

      // Capture the response so a retry can be replayed.
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          void IdempotencyModel.create({
            key,
            userId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            body,
          }).catch((e: unknown) => logger.warn({ err: e }, 'idempotency store failed'));
        }
        return originalJson(body);
      };
      next();
    } catch (e) {
      logger.warn({ err: e }, 'idempotency check failed, continuing');
      next();
    }
  })();
}

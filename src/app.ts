import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './core/logger.js';
import { config, isTest } from './core/config.js';
import { globalLimiter } from './core/rateLimit.js';
import { errorMiddleware, notFoundMiddleware, ok } from './core/http.js';
import { dbHealthy } from './core/db.js';

import { authRouter } from './modules/auth/auth.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { vehicleRouter } from './modules/vehicles/vehicle.routes.js';
import { mileageRouter } from './modules/mileage/mileage.routes.js';
import { maintenanceRouter, vehicleMaintenanceRouter } from './modules/maintenance/maintenance.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // Render sits behind a proxy; req.ip must be real
  app.use(helmet());
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: '1mb' })); // binaries never transit the API
  if (!isTest) app.use(pinoHttp({ logger }));
  if (!isTest) app.use(globalLimiter);

  /**
   * Health check for Render.
   *
   * Checks MONGO CONNECTIVITY, not just process liveness — a running process
   * that cannot reach its database is not healthy, and Render should restart it.
   */
  app.get('/healthz', (_req, res) => {
    const healthy = dbHealthy();
    return res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      db: healthy ? 'up' : 'down',
      env: config.NODE_ENV,
      uptime: Math.round(process.uptime()),
    });
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', userRouter);
  v1.use('/vehicles/:vehicleId/maintenance', vehicleMaintenanceRouter);
  v1.use('/vehicles', vehicleRouter);
  v1.use('/mileage', mileageRouter);
  v1.use('/maintenance', maintenanceRouter);

  app.use('/api/v1', v1);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}

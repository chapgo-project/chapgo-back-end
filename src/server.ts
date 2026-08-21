import { createApp } from './app.js';
import { config } from './core/config.js';
import { connectDb, disconnectDb } from './core/db.js';
import { logger } from './core/logger.js';

async function main() {
  await connectDb();

  const app = createApp();
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'chapgo-api listening');
  });

  // Render sends SIGTERM on deploy: finish in-flight requests before exiting,
  // otherwise a deploy drops whatever was mid-transaction.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      void disconnectDb().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main().catch((e) => {
  logger.fatal({ err: e }, 'failed to start');
  process.exit(1);
});

import mongoose from 'mongoose';
import { config, isTest } from './config.js';
import { logger } from './logger.js';

/**
 * Mongo connection.
 *
 * A REPLICA SET is required: completing a maintenance event writes across
 * six collections inside a transaction (see maintenance/service.ts). A
 * standalone mongod rejects transactions outright, so this is not optional
 * even in local development.
 */
export async function connectDb(uri = config.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true);
  // Fail fast rather than queue for 30s on an unreachable database.
  mongoose.set('bufferCommands', false);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8_000,
    maxPoolSize: 20,
    retryWrites: true,
  });

  if (!isTest) logger.info('mongo connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.connection.close();
}

export function dbHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Runs `fn` in a transaction.
 *
 * Used by every multi-collection write. Half-applied, the vehicle record is
 * inconsistent — a closed reminder with no event to justify it, or a
 * mileage entry the vehicle does not reflect.
 */
export async function withTransaction<T>(
  fn: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

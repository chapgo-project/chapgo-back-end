import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

/**
 * In-memory Mongo as a REPLICA SET, not a standalone.
 *
 * Several services run inside a transaction (see maintenance.service). A
 * standalone mongod rejects transactions outright, so a single-node
 * memory server would fail every one of those tests for the wrong reason.
 */
let replset: MongoMemoryReplSet;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET ??= 'test-secret-at-least-32-characters-long!!';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-chars!!';

  replset = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  process.env.MONGODB_URI = replset.getUri();

  const { connectDb } = await import('../src/core/db.js');
  await connectDb(replset.getUri());
});

beforeEach(async () => {
  // Clear rather than drop: dropping loses the indexes, and several rules
  // (partial unique on email, one current ownership per vehicle) are
  // enforced BY those indexes.
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await replset?.stop();
});

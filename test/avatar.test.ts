import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signParams } from '../src/core/cloudinary.js';
import { makeOwner, bearer } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';

const app = createApp();
const api = () => request(app);

const CLOUD = {
  CLOUDINARY_CLOUD_NAME: 'chapgo-test',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
};

function withCloudinary() {
  const previous = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  Object.assign(process.env, CLOUD);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

describe('cloudinary signature', () => {
  it('matches Cloudinary SHA-1 of sorted params + secret', () => {
    const params = { overwrite: 'true', public_id: 'chapgo/users/abc/profile', timestamp: 1700000000 };
    const expected = createHash('sha1')
      .update('overwrite=true&public_id=chapgo/users/abc/profile&timestamp=1700000000test-secret')
      .digest('hex');
    expect(signParams(params, 'test-secret')).toBe(expected);
  });
});

describe('POST /users/me/avatar/sign', () => {
  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it('returns 503 when Cloudinary is not configured', async () => {
    const user = await makeOwner();
    const res = await api()
      .post('/api/v1/users/me/avatar/sign')
      .set('Authorization', bearer(user));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('returns fields the app can POST unchanged to Cloudinary', async () => {
    const restore = withCloudinary();
    const user = await makeOwner();
    const res = await api()
      .post('/api/v1/users/me/avatar/sign')
      .set('Authorization', bearer(user));
    restore();

    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.uploadUrl).toBe('https://api.cloudinary.com/v1_1/chapgo-test/image/upload');
    expect(data.publicId).toBe(`chapgo/users/${user._id}/profile`);
    expect(data.fields.public_id).toBe(data.publicId);
    expect(data.fields.overwrite).toBe('true');
    expect(data.fields.api_key).toBe(CLOUD.CLOUDINARY_API_KEY);
    expect(data.fields.signature).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe('POST /users/me/avatar', () => {
  it('rejects a public id that is not this user\'s slot', async () => {
    const user = await makeOwner();
    const res = await api()
      .post('/api/v1/users/me/avatar')
      .set('Authorization', bearer(user))
      .send({ publicId: 'chapgo/users/someone-else/profile', version: 1 });
    expect(res.status).toBe(422);
  });

  it('stores version and exposes avatarUrl on the user DTO', async () => {
    const restore = withCloudinary();
    const user = await makeOwner();
    const publicId = `chapgo/users/${user._id}/profile`;
    const res = await api()
      .post('/api/v1/users/me/avatar')
      .set('Authorization', bearer(user))
      .send({ publicId, version: 1_700_000_001 });

    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toBe(
      `https://res.cloudinary.com/chapgo-test/image/upload/v1700000001/${publicId}`,
    );

    const me = await api().get('/api/v1/users/me').set('Authorization', bearer(user));
    expect(me.body.data.avatarUrl).toBe(res.body.data.avatarUrl);
    restore();

    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.avatarPublicId).toBe(publicId);
    expect(stored?.avatarVersion).toBe(1_700_000_001);
  });
});

describe('DELETE /users/me/avatar', () => {
  it('clears the photo without calling Cloudinary when unset', async () => {
    const user = await makeOwner();
    const res = await api()
      .delete('/api/v1/users/me/avatar')
      .set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.data.avatarUrl).toBeNull();
  });
});

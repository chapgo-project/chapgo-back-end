import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner, bearer } from './factories.js';
import { RefreshTokenModel } from '../src/modules/auth/session.model.js';

const app = createApp();
const api = () => request(app);

async function login(email: string, device: {
  id?: string;
  label: string;
  platform: 'ios' | 'android';
}) {
  const res = await api().post('/api/v1/auth/login').send({
    email,
    password: 'motdepasse1',
    device,
  });
  expect(res.status).toBe(200);
  return res.body.data as { accessToken: string; refreshToken: string };
}

describe('connected devices / sessions', () => {
  it('lists one row per device family and marks the current device', async () => {
    const user = await makeOwner();
    const phone = await login(user.email, { label: 'iPhone 15', platform: 'ios' });
    const tablet = await login(user.email, { label: 'Pixel 8', platform: 'android' });

    const listed = await api()
      .get('/api/v1/users/me/sessions')
      .set('Authorization', `Bearer ${phone.accessToken}`)
      .set('X-ChapGo-Refresh', phone.refreshToken);

    expect(listed.status).toBe(200);
    const sessions = listed.body.data as Array<{
      id: string;
      deviceLabel: string;
      current: boolean;
      active: boolean;
    }>;
    expect(sessions).toHaveLength(2);
    const current = sessions.find((s) => s.current);
    const other = sessions.find((s) => !s.current);
    expect(current?.deviceLabel).toBe('iPhone 15');
    expect(current?.active).toBe(true);
    expect(other?.deviceLabel).toBe('Pixel 8');
  });

  it('revoking a device logs that family out on refresh', async () => {
    const user = await makeOwner();
    const keep = await login(user.email, { label: 'iPhone', platform: 'ios' });
    const drop = await login(user.email, { label: 'Old phone', platform: 'android' });

    const listed = await api()
      .get('/api/v1/users/me/sessions')
      .set('Authorization', `Bearer ${keep.accessToken}`)
      .set('X-ChapGo-Refresh', keep.refreshToken);
    const other = (listed.body.data as Array<{ id: string; current: boolean }>).find((s) => !s.current);
    expect(other).toBeTruthy();

    const revoked = await api()
      .delete(`/api/v1/users/me/sessions/${other!.id}`)
      .set('Authorization', `Bearer ${keep.accessToken}`);
    expect(revoked.status).toBe(200);

    const refresh = await api().post('/api/v1/auth/refresh').send({
      refreshToken: drop.refreshToken,
    });
    expect(refresh.status).toBe(401);

    const still = await api().post('/api/v1/auth/refresh').send({
      refreshToken: keep.refreshToken,
    });
    expect(still.status).toBe(200);
  });

  it('groups rotated refresh tokens as a single device', async () => {
    const user = await makeOwner();
    const first = await login(user.email, { label: 'iPhone', platform: 'ios' });
    const rotated = await api().post('/api/v1/auth/refresh').send({
      refreshToken: first.refreshToken,
      device: { label: 'iPhone', platform: 'ios' },
    });
    expect(rotated.status).toBe(200);

    const listed = await api()
      .get('/api/v1/users/me/sessions')
      .set('Authorization', `Bearer ${rotated.body.data.accessToken}`)
      .set('X-ChapGo-Refresh', rotated.body.data.refreshToken);

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].current).toBe(true);
    expect(await RefreshTokenModel.countDocuments({ userId: user._id })).toBe(2);
  });

  it('updates the existing device session after logout and a later login', async () => {
    const user = await makeOwner();
    const device = { id: 'iphone-15-device-id', label: 'iPhone 15', platform: 'ios' as const };
    const first = await login(user.email, device);

    const logout = await api().post('/api/v1/auth/logout').send({
      refreshToken: first.refreshToken,
    });
    expect(logout.status).toBe(200);

    const second = await login(user.email, device);
    const listed = await api()
      .get('/api/v1/users/me/sessions')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .set('X-ChapGo-Refresh', second.refreshToken);

    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].deviceLabel).toBe('iPhone 15');
  });

  it('stores passwordChangedAt and biometric preference', async () => {
    const user = await makeOwner({ passwordChangedAt: new Date('2025-03-01T00:00:00.000Z') });
    const me = await api().get('/api/v1/users/me').set('Authorization', bearer(user));
    expect(me.status).toBe(200);
    expect(me.body.data.passwordChangedAt).toBeTruthy();
    expect(me.body.data.biometricEnabled).toBe(false);

    const prefs = await api()
      .patch('/api/v1/users/me/preferences')
      .set('Authorization', bearer(user))
      .send({ biometricEnabled: true });
    expect(prefs.status).toBe(200);
    expect(prefs.body.data.biometricEnabled).toBe(true);
  });

  it('lets a Google-only account set its first email password', async () => {
    const user = await makeOwner({ passwordHash: null, googleSubject: 'google-subject' });

    const setPassword = await api()
      .post('/api/v1/users/me/password')
      .set('Authorization', bearer(user))
      .send({ newPassword: 'nouveau123' });
    expect(setPassword.status).toBe(200);

    const loginWithPassword = await api().post('/api/v1/auth/login').send({
      email: user.email,
      password: 'nouveau123',
    });
    expect(loginWithPassword.status).toBe(200);
  });
});

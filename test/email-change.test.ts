import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner, bearer } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { messenger } from '../src/core/messaging.js';

const app = createApp();
const api = () => request(app);

function tokenFrom(spy: ReturnType<typeof vi.spyOn>, to: string) {
  const call = spy.mock.calls.find((entry) => entry[0] === to);
  const body = call?.[2] as string | undefined;
  return body?.match(/token=([^&\s]+)/)?.[1];
}

describe('verified email change', () => {
  it('keeps the login address until the new inbox confirms the link', async () => {
    const user = await makeOwner({ email: 'actuel@example.ci' });
    const spy = vi.spyOn(messenger, 'sendEmail').mockResolvedValue();

    const requested = await api()
      .post('/api/v1/users/me/email')
      .set('Authorization', bearer(user))
      .send({ email: 'nouveau@example.ci', password: 'motdepasse1' });

    expect(requested.status).toBe(200);
    expect(requested.body.data.email).toBe('actuel@example.ci');
    expect(requested.body.data.pendingEmail).toBe('nouveau@example.ci');
    expect(requested.body.data.emailVerified).toBe(true);

    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.email).toBe('actuel@example.ci');
    expect(stored?.pendingEmail).toBe('nouveau@example.ci');

    const notice = spy.mock.calls.find((entry) => entry[0] === 'actuel@example.ci');
    expect(notice).toBeTruthy();

    const token = tokenFrom(spy, 'nouveau@example.ci');
    expect(token).toBeTruthy();
    spy.mockRestore();

    const confirmed = await api().post('/api/v1/auth/verify-email').send({ token });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.emailChanged).toBe(true);

    const me = await api().get('/api/v1/users/me').set('Authorization', bearer(user));
    expect(me.body.data.email).toBe('nouveau@example.ci');
    expect(me.body.data.pendingEmail).toBeNull();
    expect(me.body.data.emailVerified).toBe(true);

    const oldLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'actuel@example.ci', password: 'motdepasse1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nouveau@example.ci', password: 'motdepasse1' });
    expect(newLogin.status).toBe(200);
  });

  it('refuses a change without the current password', async () => {
    const user = await makeOwner({ email: 'mdp@example.ci' });
    const res = await api()
      .post('/api/v1/users/me/email')
      .set('Authorization', bearer(user))
      .send({ email: 'autre@example.ci' });
    expect(res.status).toBe(422);
    expect(res.body.error.field).toBe('password');

    const stored = await UserModel.findById(user._id).lean();
    expect(stored?.email).toBe('mdp@example.ci');
    expect(stored?.pendingEmail).toBeNull();
  });

  it('does not apply an email sent on PATCH /users/me', async () => {
    const user = await makeOwner({ email: 'stable@example.ci' });
    const res = await api()
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ firstName: 'Marc', email: 'voleur@example.ci' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('stable@example.ci');
  });

  it('lets a phone account add a first address without a password', async () => {
    const user = await makeOwner({
      email: null,
      emailVerifiedAt: null,
      passwordHash: null,
    });
    const spy = vi.spyOn(messenger, 'sendEmail').mockResolvedValue();

    const res = await api()
      .post('/api/v1/users/me/email')
      .set('Authorization', bearer(user))
      .send({ email: 'apres-sms@example.ci' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBeNull();
    expect(res.body.data.pendingEmail).toBe('apres-sms@example.ci');
    expect(tokenFrom(spy, 'apres-sms@example.ci')).toBeTruthy();
    spy.mockRestore();
  });

  it('cancels a pending change and keeps the current login address', async () => {
    const user = await makeOwner({ email: 'garde@example.ci' });
    vi.spyOn(messenger, 'sendEmail').mockResolvedValue();

    await api()
      .post('/api/v1/users/me/email')
      .set('Authorization', bearer(user))
      .send({ email: 'temp@example.ci', password: 'motdepasse1' });

    const cancelled = await api()
      .delete('/api/v1/users/me/email/pending')
      .set('Authorization', bearer(user));

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.email).toBe('garde@example.ci');
    expect(cancelled.body.data.pendingEmail).toBeNull();
    vi.restoreAllMocks();
  });
});

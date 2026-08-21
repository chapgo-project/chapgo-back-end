import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner, bearer } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { OtpChallengeModel } from '../src/modules/auth/session.model.js';
import { hashToken } from '../src/core/tokens.js';

const app = createApp();
const api = () => request(app);

describe('registration & login', () => {
  it('registers without opening a session', async () => {
    const res = await api().post('/api/v1/auth/register').send({
      firstName: 'Marc',
      lastName: 'Kouassi',
      email: 'nouveau@example.ci',
      password: 'motdepasse1',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.verificationRequired).toBe(true);
    // No token before verification: the app shows screen O16.
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('refuses a duplicate email with the field named', async () => {
    await makeOwner({ email: 'pris@example.ci' });
    const res = await api().post('/api/v1/auth/register').send({
      firstName: 'Marc',
      lastName: 'Kouassi',
      email: 'pris@example.ci',
      password: 'motdepasse1',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(res.body.error.field).toBe('email');
  });

  it('rejects a weak password with a French message', async () => {
    const res = await api().post('/api/v1/auth/register').send({
      firstName: 'Marc',
      lastName: 'Kouassi',
      email: 'faible@example.ci',
      password: 'court',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/caractères/);
  });

  it('signs in and returns a session', async () => {
    const user = await makeOwner({ email: 'connexion@example.ci' });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'connexion@example.ci', password: 'motdepasse1' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.id).toBe(String(user._id));
    // Never leak the hash.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('never says WHICH credential was wrong', async () => {
    await makeOwner({ email: 'connu@example.ci' });

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'connu@example.ci', password: 'mauvais123' });
    const unknownEmail = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'inconnu@example.ci', password: 'motdepasse1' });

    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
  });

  it('refuses login before the address is verified', async () => {
    await makeOwner({ email: 'pasverifie@example.ci', emailVerifiedAt: null });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'pasverifie@example.ci', password: 'motdepasse1' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
  });
});

describe('rule 9 — recovery reveals nothing', () => {
  it('answers identically for a known and an unknown address', async () => {
    await makeOwner({ email: 'existe@example.ci' });

    const known = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'existe@example.ci' });
    const unknown = await api()
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'jamais@example.ci' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });
});

describe('refresh rotation', () => {
  it('rotates the token and refuses the old one', async () => {
    await makeOwner({ email: 'rotation@example.ci' });
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'rotation@example.ci', password: 'motdepasse1' });

    const first = login.body.data.refreshToken as string;
    const rotated = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);

    const second = rotated.body.data.refreshToken as string;
    expect(second).not.toBe(first);

    // Reuse of a rotated token means it was captured: the whole family dies.
    const reuse = await api().post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);

    const afterBreach = await api().post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterBreach.status).toBe(401);
  });
});

describe('SMS authentication', () => {
  it('tells the app whether the number is new', async () => {
    const res = await api()
      .post('/api/v1/auth/phone/request-code')
      .send({ phone: '+2250799887766' });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(true);
    expect(res.body.data.resendDelaySeconds).toBeGreaterThan(0);
  });

  it('recognises an existing number', async () => {
    await makeOwner({ phone: '+2250711223344' });
    const res = await api()
      .post('/api/v1/auth/phone/request-code')
      .send({ phone: '+2250711223344' });

    expect(res.body.data.isNewAccount).toBe(false);
  });

  it('counts attempts and locks after 3 — server-side, not in Flutter', async () => {
    const phone = '+2250755443322';
    await api().post('/api/v1/auth/phone/request-code').send({ phone });

    for (let i = 0; i < 3; i++) {
      const res = await api()
        .post('/api/v1/auth/phone/verify-code')
        .send({ phone, code: '000000' });
      expect(res.body.error.code).toBe('INVALID_CODE');
      expect(res.body.error.details.attemptsLeft).toBe(2 - i);
    }

    const locked = await api()
      .post('/api/v1/auth/phone/verify-code')
      .send({ phone, code: '000000' });
    expect(locked.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('creates an incomplete account on a valid code for a new number', async () => {
    const phone = '+2250766554433';
    await api().post('/api/v1/auth/phone/request-code').send({ phone });

    // Read the code from the challenge — the console messenger only logs it.
    const challenge = await OtpChallengeModel.findOne({ identifier: phone }).lean();
    let code = '';
    for (let i = 0; i < 1_000_000; i++) {
      const candidate = String(i).padStart(6, '0');
      if (hashToken(candidate) === challenge!.codeHash) {
        code = candidate;
        break;
      }
    }
    expect(code).not.toBe('');

    const res = await api().post('/api/v1/auth/phone/verify-code').send({ phone, code });
    expect(res.status).toBe(200);
    // The app routes to profile completion (O19) on this flag.
    expect(res.body.data.isNewAccount).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
  });
});

describe('protected routes', () => {
  it('refuses an unauthenticated call', async () => {
    const res = await api().get('/api/v1/users/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a malformed token', async () => {
    const res = await api().get('/api/v1/users/me').set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
  });

  it('refuses a token whose account was deleted', async () => {
    const user = await makeOwner();
    const token = bearer(user);
    await UserModel.updateOne({ _id: user._id }, { deletedAt: new Date() });

    const res = await api().get('/api/v1/users/me').set('Authorization', token);
    expect(res.status).toBe(401);
  });

  it('accepts a valid token', async () => {
    const user = await makeOwner();
    const res = await api().get('/api/v1/users/me').set('Authorization', bearer(user));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(String(user._id));
  });
});

describe('rule 8 — deletion anonymises, it does not erase', () => {
  it('clears personal fields and keeps the account row', async () => {
    const user = await makeOwner();
    const res = await api()
      .delete('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ password: 'motdepasse1', confirm: true });

    expect(res.status).toBe(200);

    const after = await UserModel.findById(user._id).lean();
    expect(after).not.toBeNull();     // row retained
    expect(after!.email).toBeNull();
    expect(after!.phone).toBeNull();
    expect(after!.deletedAt).toBeTruthy();
  });

  it('refuses without the password', async () => {
    const user = await makeOwner();
    const res = await api()
      .delete('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ confirm: true });

    expect(res.status).toBe(401);
  });
});

describe('health check', () => {
  it('reports database connectivity, not just liveness', async () => {
    const res = await api().get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.db).toBe('up');
  });
});

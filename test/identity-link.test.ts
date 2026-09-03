import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner, bearer, peekOtp } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';
import type { GoogleProfile } from '../src/core/google.js';

vi.mock('../src/core/google.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

const { verifyGoogleIdToken } = await import('../src/core/google.js');

const app = createApp();
const api = () => request(app);

function googleProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    googleId: 'google-sub-xyz',
    email: 'xyz@example.com',
    emailVerified: true,
    firstName: 'Awa',
    lastName: 'Diallo',
    ...overrides,
  };
}

describe('account linking — email, phone, Google', () => {
  beforeEach(() => {
    vi.mocked(verifyGoogleIdToken).mockReset();
  });

  it('signs into the email account when Google uses the same address', async () => {
    await api().post('/api/v1/auth/register').send({
      firstName: 'Awa',
      lastName: 'Diallo',
      email: 'xyz@example.com',
      password: 'motdepasse1',
    });
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(googleProfile());

    const res = await api().post('/api/v1/auth/google').send({
      idToken: 'valid-google-id-token-xxxxxxxxxx',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(false);
    expect(res.body.data.user.email).toBe('xyz@example.com');
    expect(res.body.data.user.googleLinked).toBe(true);
    expect(await UserModel.countDocuments({ email: 'xyz@example.com', deletedAt: null })).toBe(1);
  });

  it('lets SMS login reach the email account once the number is verified', async () => {
    const phone = '+2250700112233';
    await api().post('/api/v1/auth/register').send({
      firstName: 'Awa',
      lastName: 'Diallo',
      email: 'sms-link@example.com',
      password: 'motdepasse1',
      phone,
    });

    await api().post('/api/v1/auth/phone/request-code').send({ phone });
    const code = await peekOtp(phone, 'phone_login');
    const res = await api().post('/api/v1/auth/phone/verify-code').send({ phone, code });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(false);
    expect(res.body.data.user.email).toBe('sms-link@example.com');
    expect(res.body.data.user.phone).toBe(phone);
    expect(res.body.data.user.phoneVerified).toBe(true);
  });

  it('links a new number from the profile after the SMS code, then accepts SMS login', async () => {
    const user = await makeOwner({ phone: null, phoneVerifiedAt: null });
    const phone = '+22503082070254';

    const requested = await api()
      .post('/api/v1/users/me/phone/request-code')
      .set('Authorization', bearer(user))
      .send({ phone });
    expect(requested.status).toBe(200);
    expect(requested.body.data.user.phone).toBeNull();
    expect(requested.body.data.user.pendingPhone).toBe(phone);

    const code = await peekOtp(phone, 'phone_verify');
    const verified = await api()
      .post('/api/v1/users/me/phone/verify-code')
      .set('Authorization', bearer(user))
      .send({ phone, code });
    expect(verified.status).toBe(200);
    expect(verified.body.data.phone).toBe(phone);
    expect(verified.body.data.phoneVerified).toBe(true);

    await api().post('/api/v1/auth/phone/request-code').send({ phone });
    const loginCode = await peekOtp(phone, 'phone_login');
    const login = await api()
      .post('/api/v1/auth/phone/verify-code')
      .send({ phone, code: loginCode });
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(String(user._id));
    expect(login.body.data.isNewAccount).toBe(false);
  });

  it('does not apply a phone sent on PATCH /users/me', async () => {
    const user = await makeOwner({ phone: '+2250700000999' });
    const res = await api()
      .patch('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ firstName: 'Marc', phone: '+2250700000888' });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('+2250700000999');
  });

  it('links Google from a signed-in phone account without creating a second user', async () => {
    const user = await makeOwner({
      email: null,
      emailVerifiedAt: null,
      googleId: null,
      phone: '+2250700555666',
      phoneVerifiedAt: new Date(),
    });
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(
      googleProfile({ googleId: 'google-sub-phone', email: 'phone.user@example.com' }),
    );

    const res = await api()
      .post('/api/v1/users/me/google')
      .set('Authorization', bearer(user))
      .send({ idToken: 'valid-google-id-token-xxxxxxxxxx' });

    expect(res.status).toBe(200);
    expect(res.body.data.googleLinked).toBe(true);
    expect(res.body.data.email).toBe('phone.user@example.com');
    expect(res.body.data.phone).toBe('+2250700555666');

    vi.mocked(verifyGoogleIdToken).mockResolvedValue(
      googleProfile({ googleId: 'google-sub-phone', email: 'phone.user@example.com' }),
    );
    const googleLogin = await api().post('/api/v1/auth/google').send({
      idToken: 'valid-google-id-token-xxxxxxxxxx',
    });
    expect(googleLogin.body.data.user.id).toBe(String(user._id));
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';
import type { GoogleProfile } from '../src/core/google.js';

vi.mock('../src/core/google.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

const { verifyGoogleIdToken } = await import('../src/core/google.js');

const app = createApp();
const api = () => request(app);

function profile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    googleId: 'google-sub-1',
    email: 'marc.google@example.ci',
    emailVerified: true,
    firstName: 'Marc',
    lastName: 'Kouassi',
    ...overrides,
  };
}

describe('Google authentication', () => {
  beforeEach(() => {
    vi.mocked(verifyGoogleIdToken).mockReset();
  });

  it('creates an account and opens a session', async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(profile());

    const res = await api().post('/api/v1/auth/google').send({
      idToken: 'valid-google-id-token-xxxxxxxxxx',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.isNewAccount).toBe(true);
    expect(res.body.data.user.email).toBe('marc.google@example.ci');
    expect(res.body.data.user.emailVerified).toBe(true);

    const stored = await UserModel.findOne({ email: 'marc.google@example.ci' }).lean();
    expect(stored?.googleId).toBe('google-sub-1');
  });

  it('signs in an existing Google account without creating a duplicate', async () => {
    await makeOwner({
      email: 'marc.google@example.ci',
      googleId: 'google-sub-1',
    });
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(profile());

    const res = await api().post('/api/v1/auth/google').send({
      idToken: 'valid-google-id-token-xxxxxxxxxx',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(false);
    expect(await UserModel.countDocuments({ email: 'marc.google@example.ci' })).toBe(1);
  });

  it('links Google to an existing email account', async () => {
    const user = await makeOwner({ email: 'lien@example.ci', googleId: null });
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(
      profile({ googleId: 'google-sub-link', email: 'lien@example.ci' }),
    );

    const res = await api().post('/api/v1/auth/google').send({
      idToken: 'valid-google-id-token-xxxxxxxxxx',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(false);
    expect(res.body.data.user.id).toBe(String(user._id));

    const after = await UserModel.findById(user._id).lean();
    expect(after?.googleId).toBe('google-sub-link');
  });

  it('rejects a malformed token with the field named', async () => {
    const res = await api().post('/api/v1/auth/google').send({ idToken: 'short' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

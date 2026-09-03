import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { makeOwner, makeVehicle, bearer } from './factories.js';
import { UserModel } from '../src/modules/users/user.model.js';
import { OwnershipModel } from '../src/modules/vehicles/ownership.model.js';

const app = createApp();
const api = () => request(app);

describe('POST /users/me/export', () => {
  it('returns downloadable CSV and PDF logbooks', async () => {
    const user = await makeOwner();
    await makeVehicle(String(user._id));

    const res = await api()
      .post('/api/v1/users/me/export')
      .set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.data.csvFileName).toMatch(/chapgo-carnets-.*\.csv/);
    expect(res.body.data.pdfFileName).toMatch(/chapgo-carnets-.*\.pdf/);
    expect(res.body.data.csvDownloadUrl).toContain('format=csv');
    expect(res.body.data.pdfDownloadUrl).toContain('format=pdf');
    expect(res.body.data.emailed).toBe(true);

    const csvUrl = new URL(res.body.data.csvDownloadUrl);
    const pdfUrl = new URL(res.body.data.pdfDownloadUrl);

    const csv = await api().get(`${csvUrl.pathname}${csvUrl.search}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/csv/);
    expect(csv.text).toContain('Date,Vehicle,Plate,Odometer,Kind,Fuel,Cost');
    expect(csv.text).toContain('odometer');

    const pdf = await api().get(`${pdfUrl.pathname}${pdfUrl.search}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects an expired or unknown token', async () => {
    const res = await api().get('/api/v1/exports/not-a-real-token');
    expect(res.status).toBe(410);
  });
});

describe('DELETE /users/me', () => {
  it('lets a Google account confirm without a password', async () => {
    const user = await makeOwner({
      passwordHash: null,
      googleId: 'google-sub-delete',
    });
    await makeVehicle(String(user._id));

    const res = await api()
      .delete('/api/v1/users/me')
      .set('Authorization', bearer(user))
      .send({ confirm: true });

    expect(res.status).toBe(200);

    const after = await UserModel.findById(user._id).lean();
    expect(after?.deletedAt).toBeTruthy();
    expect(after?.googleId).toBeNull();
    expect(after?.email).toBeNull();

    const open = await OwnershipModel.find({ userId: user._id, endedAt: null });
    expect(open).toHaveLength(0);
  });
});

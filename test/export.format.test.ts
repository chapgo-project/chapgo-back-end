import { describe, expect, it } from 'vitest';
import { snapshotFromCollections, toCsv, toPdf } from '../src/modules/users/export.format.js';

const snapshot = snapshotFromCollections({
  exportedAt: new Date('2026-08-30T12:00:00.000Z'),
  account: { firstName: 'Marc', lastName: 'Kouassi', email: 'marc@example.ci' },
  currency: 'XOF',
  vehicles: [
    {
      _id: 'veh1',
      brand: 'Toyota',
      model: 'Yaris',
      year: 2018,
      plate: 'AB001CI',
      fuel: 'petrol',
      currentMileage: 85000,
    },
  ],
  mileage: [
    { vehicleId: 'veh1', value: 84200, recordedAt: '2026-01-10', source: 'owner_manual' },
  ],
  maintenance: [
    {
      vehicleId: 'veh1',
      performedAt: '2026-02-01',
      mileage: 85000,
      title: 'Vidange',
      category: 'oil_change',
      cost: 45000,
      currency: 'XOF',
      garageName: 'Garage Test',
    },
  ],
  documents: [],
  issues: [],
  reminders: [],
});

describe('logbook CSV / PDF', () => {
  it('puts date, odometer, fuel, cost and maintenance on CSV rows', () => {
    const csv = toCsv(snapshot);
    expect(csv).toContain('Date,Vehicle,Plate,Odometer,Kind,Fuel,Cost,Currency,Maintenance,Notes');
    expect(csv).toContain('2026-01-10,Toyota Yaris,AB001CI,84200,odometer,,,XOF,,');
    expect(csv).toContain(
      '2026-02-01,Toyota Yaris,AB001CI,85000,maintenance,,45000,XOF,Vidange,oil_change · Garage Test',
    );
  });

  it('builds a PDF report (not an interchange file)', () => {
    const pdf = toPdf(snapshot);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(200);
    expect(pdf.toString('latin1')).toContain('0056006900640061006e00670065');
  });
});

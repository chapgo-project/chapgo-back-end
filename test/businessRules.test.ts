import { describe, expect, it } from 'vitest';
import { AppError } from '../src/core/errors.js';
import { resolveVehicleScope } from '../src/core/authorization.js';
import { addMileage, correctMileage, referenceReading, isStale } from '../src/modules/mileage/mileage.service.js';
import { createEvent, updateEvent, correctEvent, submitEvent, acceptEvent } from '../src/modules/maintenance/maintenance.service.js';
import { deriveStatus, nextOccurrence } from '../src/modules/reminders/status.js';
import { computeHealth } from '../src/modules/vehicles/health.service.js';
import { MileageModel } from '../src/modules/mileage/mileage.model.js';
import { MaintenanceModel } from '../src/modules/maintenance/maintenance.model.js';
import { ReminderModel } from '../src/modules/reminders/reminder.model.js';
import { IssueModel } from '../src/modules/issues/issue.model.js';
import { VehicleModel } from '../src/modules/vehicles/vehicle.model.js';
import { actorOf, grantAccess, makeGarage, makeOwner, makeVehicle } from './factories.js';

/** The 10 rules from the brief, each with its failure case. */

describe('rule 1 — mileage never regresses silently', () => {
  it('rejects a lower value', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_200);
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    await expect(
      addMileage(scope, actorOf(owner), { value: 80_000, source: 'owner_manual' }),
    ).rejects.toMatchObject({ code: 'MILEAGE_REGRESSION', field: 'mileage' });
  });

  it('accepts a higher value and updates the vehicle', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_200);
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    await addMileage(scope, actorOf(owner), { value: 88_120, source: 'owner_manual' });

    const updated = await VehicleModel.findById(vehicle._id).lean();
    expect(updated!.currentMileage).toBe(88_120);
  });

  it('warns rather than rejects on an implausible jump, and accepts on confirmation', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_200);
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    // A soft warning: a genuinely neglected car exists, and refusing its real
    // mileage would make the app unusable for the drivers who need it most.
    await expect(
      addMileage(scope, actorOf(owner), { value: 200_000, source: 'owner_manual' }),
    ).rejects.toMatchObject({ code: 'MILEAGE_IMPLAUSIBLE' });

    const entry = await addMileage(scope, actorOf(owner), {
      value: 200_000,
      source: 'owner_manual',
      confirmJump: true,
    });
    expect(entry.value).toBe(200_000);
  });

  it('a correction may lower the value, but only with a reason, and keeps the original', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_200);
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    const wrong = await addMileage(scope, actorOf(owner), { value: 94_200, source: 'owner_manual' });
    const fixed = await correctMileage(scope, actorOf(owner), String(wrong._id), {
      value: 84_900,
      reason: 'Erreur de saisie : 94 au lieu de 84',
    });

    expect(fixed.value).toBe(84_900);
    expect(fixed.regressionReason).toBeTruthy();

    // Append-only: nothing was overwritten.
    const all = await MileageModel.find({ vehicleId: vehicle._id }).lean();
    expect(all).toHaveLength(3);
  });

  it('rejects a future date', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    await expect(
      addMileage(scope, actorOf(owner), {
        value: 90_000,
        source: 'owner_manual',
        recordedAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('rule 2 — the reference is the most recent reading taken on the vehicle', () => {
  it('a garage reading supersedes a later owner entry of lower value', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id), 84_000);

    // Garage reads the counter today.
    await MileageModel.create({
      vehicleId: vehicle._id,
      ownershipId: ownership._id,
      value: 86_000,
      recordedAt: new Date(),
      source: 'garage_onsite',
      authorId: owner._id,
      authorType: 'garage',
    });

    const reference = await referenceReading(String(vehicle._id));
    expect(reference!.value).toBe(86_000);
    expect(reference!.source).toBe('garage_onsite');
  });

  it('flags a stale reading', () => {
    expect(isStale(new Date(Date.now() - 90 * 86_400_000))).toBe(true);
    expect(isStale(new Date())).toBe(false);
    expect(isStale(null)).toBe(true);
  });
});

describe('rule 3 — reminder status is derived, and honest about stale mileage', () => {
  const base = {
    status: 'upcoming' as const,
    postponedTo: null,
    currentMileage: 84_000,
    currentMileageAt: new Date(),
  };

  it('first_of triggers on whichever comes first', () => {
    const byDate = deriveStatus({
      ...base,
      rule: 'first_of',
      dueDate: new Date(Date.now() - 86_400_000),
      dueMileage: 99_000,
    });
    expect(byDate.status).toBe('overdue');

    const byMileage = deriveStatus({
      ...base,
      rule: 'first_of',
      dueDate: new Date(Date.now() + 400 * 86_400_000),
      dueMileage: 80_000,
    });
    expect(byMileage.status).toBe('overdue');
  });

  /**
   * The rule that separates a credible product from a guessing one: with a
   * two-month-old odometer, we do NOT claim the mileage threshold was crossed.
   */
  it('does not claim a mileage threshold when the reading is stale', () => {
    const stale = deriveStatus({
      ...base,
      currentMileageAt: new Date(Date.now() - 90 * 86_400_000),
      rule: 'mileage_only',
      dueDate: null,
      dueMileage: 80_000, // apparently overdue
    });

    expect(stale.mileageStale).toBe(true);
    expect(stale.status).toBe('upcoming'); // NOT overdue
  });

  it('leaves terminal states alone', () => {
    for (const status of ['completed', 'cancelled', 'proposed'] as const) {
      const d = deriveStatus({ ...base, status, rule: 'date_only', dueDate: new Date(0), dueMileage: null });
      expect(d.status).toBe(status);
    }
  });

  it('computes the next occurrence from the interval', () => {
    const next = nextOccurrence({
      intervalMonths: 12,
      intervalKm: 15_000,
      completedAt: new Date('2026-06-14'),
      completedMileage: 84_200,
    });
    expect(next!.dueMileage).toBe(99_200);
    expect(next!.rule).toBe('first_of');
  });
});

describe('rules 4 & 5 — accepted records are append-only, and creation is transactional', () => {
  async function garageOnVehicle() {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id), 84_200);
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
    });
    return { owner, vehicle, garage, garageUser: user };
  }

  it('one create writes the event, a mileage entry, closes the reminder and generates the next', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_200);
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    const reminder = await ReminderModel.create({
      vehicleId: vehicle._id,
      category: 'oil_change',
      label: 'Vidange',
      dueMileage: 84_000,
      rule: 'mileage_only',
      intervalKm: 15_000,
      status: 'overdue',
      source: 'user',
    });

    await createEvent(scope, actorOf(owner), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange moteur',
      performedAt: new Date(),
      mileage: 84_300,
      performedBy: 'self',
      completesReminderId: String(reminder._id),
    });

    const closed = await ReminderModel.findById(reminder._id).lean();
    expect(closed!.status).toBe('completed');

    const generated = await ReminderModel.findOne({
      vehicleId: vehicle._id,
      status: 'upcoming',
      category: 'oil_change',
    }).lean();
    expect(generated!.dueMileage).toBe(99_300);

    const mileageEntry = await MileageModel.findOne({
      vehicleId: vehicle._id,
      source: 'intervention',
    }).lean();
    expect(mileageEntry!.value).toBe(84_300);
  });

  it('resolves a linked issue in both directions', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    const issue = await IssueModel.create({
      vehicleId: vehicle._id,
      ownershipId: ownership._id,
      title: 'Bruit au freinage',
      status: 'to_check',
      reportedById: owner._id,
    });

    const event = await createEvent(scope, actorOf(owner), {
      type: 'repair',
      category: 'brake_pads',
      title: 'Plaquettes avant remplacées',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'garage',
      garageName: 'Garage Kouassi',
      resolvesIssueId: String(issue._id),
    });

    const resolved = await IssueModel.findById(issue._id).lean();
    expect(resolved!.status).toBe('resolved');
    expect(String(resolved!.resolvedByEventId)).toBe(String(event._id));
    expect(resolved!.statusHistory).toHaveLength(1);
  });

  it('a garage draft is invisible and has no side effects until submitted', async () => {
    const { vehicle, garageUser } = await garageOnVehicle();
    const scope = await resolveVehicleScope(actorOf(garageUser), String(vehicle._id), { forWrite: true });

    await createEvent(scope, actorOf(garageUser), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'garage',
      asDraft: true,
    });

    // No mileage entry: a draft must not move the odometer.
    const fromIntervention = await MileageModel.findOne({
      vehicleId: vehicle._id,
      source: 'intervention',
    }).lean();
    expect(fromIntervention).toBeNull();
  });

  it('refuses to submit an empty draft', async () => {
    const { vehicle, garageUser } = await garageOnVehicle();
    const scope = await resolveVehicleScope(actorOf(garageUser), String(vehicle._id), { forWrite: true });

    const draft = await createEvent(scope, actorOf(garageUser), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'garage',
      asDraft: true,
    });

    await expect(
      submitEvent(scope, actorOf(garageUser), String(draft._id)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('locks the record once the owner accepts — for the garage AND the owner', async () => {
    const { owner, vehicle, garageUser } = await garageOnVehicle();
    const garageScope = await resolveVehicleScope(actorOf(garageUser), String(vehicle._id), { forWrite: true });

    const draft = await createEvent(garageScope, actorOf(garageUser), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange complète',
      description: 'Huile 5W30 et filtre',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'garage',
      asDraft: true,
    });

    await submitEvent(garageScope, actorOf(garageUser), String(draft._id));

    const ownerScope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));
    await acceptEvent(ownerScope, actorOf(owner), String(draft._id));

    const accepted = await MaintenanceModel.findById(draft._id).lean();
    expect(accepted!.provenance).toBe('garage_verified');

    // Garage cannot edit.
    await expect(
      updateEvent(garageScope, actorOf(garageUser), String(draft._id), { title: 'Autre' }),
    ).rejects.toMatchObject({ code: 'EVENT_LOCKED' });

    // Neither can the owner.
    await expect(
      updateEvent(ownerScope, actorOf(owner), String(draft._id), { title: 'Autre' }),
    ).rejects.toMatchObject({ code: 'EVENT_LOCKED' });
  });

  it('a correction creates a new version and preserves the original', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));
    const scope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));

    const original = await createEvent(scope, actorOf(owner), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'self',
    });

    const corrected = await correctEvent(scope, actorOf(owner), String(original._id), {
      reason: 'Kilométrage erroné',
      patch: { mileage: 85_400 },
    });

    expect(corrected.version).toBe(2);
    expect(String(corrected.correctedFromId)).toBe(String(original._id));

    const preserved = await MaintenanceModel.findById(original._id).lean();
    expect(String(preserved!.supersededById)).toBe(String(corrected._id));
    expect(preserved!.mileage).toBe(85_000); // untouched
  });
});

describe('rule 7 — a garage proposes, it does not impose', () => {
  it('a garage recommendation lands as proposed, an owner one as active', async () => {
    const owner = await makeOwner();
    const { vehicle, ownership } = await makeVehicle(String(owner._id));
    const { garage, user } = await makeGarage();
    await grantAccess({
      garageId: String(garage._id),
      vehicleId: String(vehicle._id),
      ownershipId: String(ownership._id),
      ownerUserId: String(owner._id),
    });

    const garageScope = await resolveVehicleScope(actorOf(user), String(vehicle._id), { forWrite: true });
    const draft = await createEvent(garageScope, actorOf(user), {
      type: 'service',
      category: 'oil_change',
      title: 'Vidange',
      description: 'Faite',
      performedAt: new Date(),
      mileage: 85_000,
      performedBy: 'garage',
      recommendations: [{ label: 'Prochaine vidange', dueMileage: 100_000, urgency: 'normal' }],
      asDraft: true,
    });

    await submitEvent(garageScope, actorOf(user), String(draft._id));
    const ownerScope = await resolveVehicleScope(actorOf(owner), String(vehicle._id));
    await acceptEvent(ownerScope, actorOf(owner), String(draft._id));

    const proposed = await ReminderModel.findOne({
      vehicleId: vehicle._id,
      label: 'Prochaine vidange',
    }).lean();
    expect(proposed!.status).toBe('proposed');   // NOT active
    expect(proposed!.source).toBe('garage');
  });
});

describe('vehicle health — qualitative, with reasons', () => {
  it('reports action_required with a reason when a reminder is overdue', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id), 84_000);

    await ReminderModel.create({
      vehicleId: vehicle._id,
      category: 'oil_change',
      label: 'Vidange',
      dueDate: new Date(Date.now() - 10 * 86_400_000),
      rule: 'date_only',
      status: 'upcoming',
      source: 'user',
    });

    const health = await computeHealth(String(vehicle._id));
    expect(health.status).toBe('action_required');
    expect(health.reasons.some((r) => r.code === 'reminder_overdue')).toBe(true);
  });

  it('reports good with nothing pending', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));
    const health = await computeHealth(String(vehicle._id));
    expect(health.status).toBe('good');
  });

  it('caps reasons at 4 — the screen shows a short list', async () => {
    const owner = await makeOwner();
    const { vehicle } = await makeVehicle(String(owner._id));

    for (let i = 0; i < 8; i++) {
      await ReminderModel.create({
        vehicleId: vehicle._id,
        category: 'oil_change',
        label: `Rappel ${i}`,
        dueDate: new Date(Date.now() - 86_400_000),
        rule: 'date_only',
        status: 'upcoming',
        source: 'user',
      });
    }

    const health = await computeHealth(String(vehicle._id));
    expect(health.reasons.length).toBeLessThanOrEqual(4);
  });
});

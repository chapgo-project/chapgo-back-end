import { config } from '../../core/config.js';
import type { ReminderRule, ReminderStatus } from '../../types/enums.js';

export interface DerivedStatus {
  status: ReminderStatus;
  /** True when the mileage side of the rule cannot be trusted. */
  mileageStale: boolean;
  daysLeft: number | null;
  kmLeft: number | null;
}

/**
 * RULE 3 — status is DERIVED, and honest about what it does not know.
 *
 * A client never writes `status`. And when the mileage has not been updated
 * for MILEAGE_STALE_DAYS, we do NOT claim the mileage threshold was crossed:
 * the app then says "update your mileage" instead of "overdue". Pretending to
 * know is how a maintenance app loses credibility.
 */
export function deriveStatus(input: {
  rule: ReminderRule;
  dueDate: Date | null;
  dueMileage: number | null;
  currentMileage: number;
  currentMileageAt: Date | null;
  status: ReminderStatus;
  postponedTo: Date | null;
  now?: Date;
}): DerivedStatus {
  const now = input.now ?? new Date();

  // Terminal states are never recomputed.
  if (input.status === 'completed' || input.status === 'cancelled' || input.status === 'proposed') {
    return { status: input.status, mileageStale: false, daysLeft: null, kmLeft: null };
  }

  const mileageAge = input.currentMileageAt
    ? now.getTime() - input.currentMileageAt.getTime()
    : Infinity;
  const mileageStale = mileageAge > config.MILEAGE_STALE_DAYS * 86_400_000;

  const effectiveDate = input.postponedTo ?? input.dueDate;

  const daysLeft = effectiveDate
    ? Math.ceil((effectiveDate.getTime() - now.getTime()) / 86_400_000)
    : null;
  const kmLeft =
    input.dueMileage !== null ? input.dueMileage - input.currentMileage : null;

  const dateOverdue = daysLeft !== null && daysLeft < 0;
  const dateSoon = daysLeft !== null && daysLeft <= config.REMINDER_DUE_SOON_DAYS;

  // The mileage side counts only when the reading is fresh enough to mean something.
  const mileageUsable = kmLeft !== null && !mileageStale;
  const mileageOverdue = mileageUsable && kmLeft! < 0;
  const mileageSoon = mileageUsable && kmLeft! <= config.REMINDER_DUE_SOON_KM;

  let overdue: boolean;
  let soon: boolean;

  switch (input.rule) {
    case 'date_only':
      overdue = dateOverdue;
      soon = dateSoon;
      break;
    case 'mileage_only':
      overdue = mileageOverdue;
      soon = mileageSoon;
      break;
    case 'first_of':
      // Due when the FIRST of the two is reached.
      overdue = dateOverdue || mileageOverdue;
      soon = dateSoon || mileageSoon;
      break;
  }

  let status: ReminderStatus = 'upcoming';
  if (overdue) status = 'overdue';
  else if (soon) status = 'due_soon';
  else if (input.postponedTo) status = 'postponed';

  return { status, mileageStale, daysLeft, kmLeft };
}

/** Next occurrence after completion, from the interval. */
export function nextOccurrence(input: {
  intervalMonths: number | null;
  intervalKm: number | null;
  completedAt: Date;
  completedMileage: number;
}): { dueDate: Date | null; dueMileage: number | null; rule: ReminderRule } | null {
  const dueDate = input.intervalMonths
    ? new Date(
        new Date(input.completedAt).setMonth(input.completedAt.getMonth() + input.intervalMonths),
      )
    : null;
  const dueMileage = input.intervalKm ? input.completedMileage + input.intervalKm : null;

  if (!dueDate && !dueMileage) return null;

  const rule: ReminderRule =
    dueDate && dueMileage ? 'first_of' : dueDate ? 'date_only' : 'mileage_only';

  return { dueDate, dueMileage, rule };
}

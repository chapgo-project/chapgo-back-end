import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { REMINDER_RULES, REMINDER_STATUSES, REMINDER_SOURCES, MAINTENANCE_CATEGORIES } from '../../types/enums.js';

/**
 * Reminders.
 *
 * `status` is DERIVED — see reminders/status.ts. A client never writes it,
 * and the schema keeps it only as a cached projection so lists can be
 * filtered in the database.
 */
const ReminderSchema = new Schema(
  {
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
    category: { type: String, enum: MAINTENANCE_CATEGORIES, required: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },

    dueDate: { type: Date, default: null },
    dueMileage: { type: Number, default: null, min: 0 },
    /**
     * first_of — due when the FIRST of date or mileage is reached.
     * Example: oil change at 15 000 km OR 12 months.
     */
    rule: { type: String, enum: REMINDER_RULES, required: true },

    /** Interval used to generate the next occurrence on completion. */
    intervalMonths: { type: Number, default: null },
    intervalKm: { type: Number, default: null },

    status: { type: String, enum: REMINDER_STATUSES, required: true, default: 'upcoming' },
    source: { type: String, enum: REMINDER_SOURCES, required: true, default: 'user' },

    /**
     * A garage recommendation lands as status: proposed. The owner activates
     * or dismisses it — a garage cannot create an active reminder, which is
     * the guard against garages driving return visits by notification.
     */
    proposedByGarageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },
    proposedFromEventId: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },

    postponedTo: { type: Date, default: null },
    postponeCount: { type: Number, default: 0 },

    completedAt: { type: Date, default: null },
    completedByEventId: { type: Schema.Types.ObjectId, ref: 'MaintenanceEvent', default: null },

    enabled: { type: Boolean, default: true },
    lastNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'reminders' },
);

ReminderSchema.index({ vehicleId: 1, status: 1 });
ReminderSchema.index({ dueDate: 1 });
ReminderSchema.index({ vehicleId: 1, category: 1 });

export type Reminder = InferSchemaType<typeof ReminderSchema>;
export const ReminderModel =
  mongoose.models.Reminder ?? mongoose.model('Reminder', ReminderSchema);

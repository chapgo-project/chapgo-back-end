import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { MAINTENANCE_TYPES, MAINTENANCE_CATEGORIES, ASSESSMENT_CATEGORIES } from '../../types/enums.js';

/**
 * Intervention templates.
 *
 * Schema built now even though the feature ships with the paid plan:
 * retrofitting it into maintenanceEvents later is the expensive path.
 * garageId null = one of the 8 ChapGo default families.
 */
const TemplateSchema = new Schema(
  {
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', default: null },
    family: { type: String, required: true },   // entretien, freinage, pneus…
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: MAINTENANCE_TYPES, required: true },
    category: { type: String, enum: MAINTENANCE_CATEGORIES, required: true },

    assessmentItems: {
      type: [
        new Schema(
          {
            itemId: { type: String, required: true },
            category: { type: String, enum: ASSESSMENT_CATEGORIES, required: true },
            label: { type: String, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    commonParts: {
      type: [
        new Schema(
          {
            category: { type: String, required: true },
            label: { type: String, required: true },
            brand: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Expected photo slots: before, after, worn part. */
    photoSlots: { type: [String], default: [] },
    recommendation: { type: String, default: null, maxlength: 1000 },

    /** Proposed, never imposed — the owner-approval rule still applies. */
    nextDueMonths: { type: Number, default: null },
    nextDueKm: { type: Number, default: null },

    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'interventionTemplates' },
);

TemplateSchema.index({ garageId: 1, family: 1 });

export type InterventionTemplate = InferSchemaType<typeof TemplateSchema>;
export const TemplateModel =
  (mongoose.models.InterventionTemplate as mongoose.Model<InterventionTemplate> | undefined) ??
  mongoose.model<InterventionTemplate>('InterventionTemplate', TemplateSchema);

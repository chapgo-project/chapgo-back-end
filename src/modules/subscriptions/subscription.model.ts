import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { PLANS, REGIONS } from '../../types/enums.js';

/**
 * Garage subscription.
 *
 * Counters are CUMULATIVE TOTALS, never a rolling window. Billing on recent
 * activity would push a garage to delete records to stay under a threshold —
 * the exact opposite of what the product promises.
 */
const SubscriptionSchema = new Schema(
  {
    garageId: { type: Schema.Types.ObjectId, ref: 'Garage', required: true, unique: true },
    plan: { type: String, enum: PLANS, required: true, default: 'discovery' },

    /** The grid entry bought at. A price change must not silently reprice. */
    pricingPlanId: { type: Schema.Types.ObjectId, ref: 'PricingPlan', default: null },

    customerCount: { type: Number, default: 0 },
    interventionCount: { type: Number, default: 0 },

    startedAt: { type: Date, default: Date.now },
    renewsAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ['active', 'past_due', 'cancelled'],
      default: 'active',
    },
    /** No time-limited trial: habit converts, a countdown does not. */
  },
  { timestamps: true, collection: 'subscriptions' },
);

export type Subscription = InferSchemaType<typeof SubscriptionSchema>;
export const SubscriptionModel =
  (mongoose.models.Subscription as mongoose.Model<Subscription> | undefined) ??
  mongoose.model<Subscription>('Subscription', SubscriptionSchema);

/**
 * Regional pricing grid.
 *
 * NO amount in code or in the app. Changing a price becomes a data change,
 * with no release. amountMinor is in the SMALLEST unit: FCFA has no
 * decimals, EUR has two — a single float produces wrong rounding.
 */
const PricingPlanSchema = new Schema(
  {
    plan: { type: String, enum: PLANS, required: true },
    region: { type: String, enum: REGIONS, required: true },
    currency: { type: String, required: true },       // XOF, EUR
    amountMinor: { type: Number, required: true },    // 5000 → 5 000 FCFA · 2490 → 24,90 €
    period: { type: String, enum: ['month', 'year'], default: 'month' },
    validFrom: { type: Date, required: true, default: Date.now },
    validTo: { type: Date, default: null },
  },
  { timestamps: true, collection: 'pricingPlans' },
);

PricingPlanSchema.index({ region: 1, plan: 1, validFrom: -1 });

export type PricingPlan = InferSchemaType<typeof PricingPlanSchema>;
export const PricingPlanModel =
  (mongoose.models.PricingPlan as mongoose.Model<PricingPlan> | undefined) ??
  mongoose.model<PricingPlan>('PricingPlan', PricingPlanSchema);

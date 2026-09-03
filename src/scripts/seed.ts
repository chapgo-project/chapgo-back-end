import { connectDb, disconnectDb } from '../core/db.js';
import { logger } from '../core/logger.js';
import { TemplateModel } from '../modules/templates/template.model.js';
import { PricingPlanModel } from '../modules/subscriptions/subscription.model.js';

/**
 * Reference data. Idempotent — safe to re-run on every deploy.
 *
 * The 8 template families and the pricing grid. Prices live HERE, in data,
 * never in code or in the app: changing one is then a data change with no
 * release.
 */

const TEMPLATES = [
  { family: 'entretien', name: 'Vidange standard', type: 'service', category: 'oil_change',
    nextDueMonths: 12, nextDueKm: 15_000,
    assessmentItems: [
      { itemId: 'oil_level', category: 'fluids', label: 'Niveau d\'huile' },
      { itemId: 'oil_filter', category: 'engine', label: 'Filtre à huile' },
      { itemId: 'coolant', category: 'fluids', label: 'Liquide de refroidissement' },
    ],
    commonParts: [
      { category: 'oil_filter', label: 'Filtre à huile' },
      { category: 'oil_change', label: 'Huile moteur 5W30' },
    ],
    photoSlots: ['before', 'after'] },

  { family: 'entretien', name: 'Révision annuelle', type: 'service', category: 'manufacturer_service',
    nextDueMonths: 12, nextDueKm: 15_000,
    assessmentItems: [
      { itemId: 'engine_general', category: 'engine', label: 'État général moteur' },
      { itemId: 'brakes', category: 'braking', label: 'Système de freinage' },
      { itemId: 'tyres', category: 'tyres', label: 'Usure des pneus' },
      { itemId: 'battery', category: 'battery', label: 'Batterie' },
      { itemId: 'lights', category: 'lighting', label: 'Éclairage' },
      { itemId: 'fluids', category: 'fluids', label: 'Niveaux' },
    ],
    commonParts: [
      { category: 'oil_filter', label: 'Filtre à huile' },
      { category: 'air_filter', label: 'Filtre à air' },
      { category: 'cabin_filter', label: 'Filtre habitacle' },
    ],
    photoSlots: ['before', 'after'] },

  { family: 'freinage', name: 'Plaquettes avant', type: 'repair', category: 'brake_pads',
    nextDueKm: 30_000,
    assessmentItems: [
      { itemId: 'pads_front', category: 'braking', label: 'Plaquettes avant' },
      { itemId: 'discs_front', category: 'braking', label: 'Disques avant' },
    ],
    commonParts: [{ category: 'brake_pads', label: 'Plaquettes avant' }],
    photoSlots: ['part_old', 'part_new'] },

  { family: 'freinage', name: 'Plaquettes + disques', type: 'repair', category: 'brake_discs',
    nextDueKm: 60_000,
    commonParts: [
      { category: 'brake_pads', label: 'Plaquettes' },
      { category: 'brake_discs', label: 'Disques' },
    ],
    photoSlots: ['part_old', 'part_new'] },

  { family: 'pneus', name: 'Changement de pneus', type: 'repair', category: 'tyre_replacement',
    nextDueKm: 40_000,
    assessmentItems: [{ itemId: 'tyre_wear', category: 'tyres', label: 'Usure' }],
    commonParts: [{ category: 'tyre_replacement', label: 'Pneu' }],
    photoSlots: ['part_old', 'part_new'] },

  { family: 'pneus', name: 'Permutation', type: 'service', category: 'tyre_rotation',
    nextDueKm: 10_000, photoSlots: [] },

  { family: 'climatisation', name: 'Recharge climatisation', type: 'service', category: 'air_conditioning',
    nextDueMonths: 24,
    assessmentItems: [{ itemId: 'ac_performance', category: 'air_conditioning', label: 'Performance' }],
    photoSlots: [] },

  { family: 'batterie', name: 'Remplacement batterie', type: 'repair', category: 'battery',
    nextDueMonths: 48,
    assessmentItems: [
      { itemId: 'battery_voltage', category: 'battery', label: 'Tension' },
      { itemId: 'alternator', category: 'battery', label: 'Alternateur' },
    ],
    commonParts: [{ category: 'battery', label: 'Batterie' }],
    photoSlots: ['part_old', 'part_new'] },

  { family: 'distribution', name: 'Kit de distribution', type: 'repair', category: 'timing_belt',
    nextDueKm: 120_000, nextDueMonths: 60,
    commonParts: [
      { category: 'timing_belt', label: 'Courroie de distribution' },
      { category: 'other', label: 'Pompe à eau' },
    ],
    photoSlots: ['part_old', 'part_new'] },

  { family: 'controle_technique', name: 'Pré-contrôle technique', type: 'check', category: 'technical_inspection',
    assessmentItems: [
      { itemId: 'lights', category: 'lighting', label: 'Éclairage' },
      { itemId: 'brakes', category: 'braking', label: 'Freinage' },
      { itemId: 'tyres', category: 'tyres', label: 'Pneumatiques' },
      { itemId: 'suspension', category: 'suspension', label: 'Suspension' },
      { itemId: 'exhaust', category: 'exhaust', label: 'Échappement' },
      { itemId: 'bodywork', category: 'bodywork', label: 'Carrosserie' },
    ],
    photoSlots: [] },

  { family: 'diagnostic', name: 'Diagnostic électronique', type: 'service', category: 'diagnostic',
    assessmentItems: [{ itemId: 'fault_codes', category: 'engine', label: 'Codes défaut' }],
    photoSlots: [] },
];

/**
 * Working assumptions, to revise after the pilots. Deliberately data.
 * amountMinor is in the SMALLEST unit: FCFA has no decimals, EUR has two.
 */
const PRICING = [
  { plan: 'garage', region: 'CI', currency: 'XOF', amountMinor: 5_000 },
  { plan: 'garage_pro', region: 'CI', currency: 'XOF', amountMinor: 15_000 },
  { plan: 'garage', region: 'FR', currency: 'EUR', amountMinor: 2_490 },
  { plan: 'garage_pro', region: 'FR', currency: 'EUR', amountMinor: 5_990 },
];

async function main() {
  await connectDb();

  for (const t of TEMPLATES) {
    await TemplateModel.updateOne(
      { garageId: null, name: t.name },
      { $set: { ...t, garageId: null } },
      { upsert: true },
    );
  }
  logger.info({ count: TEMPLATES.length }, 'intervention templates seeded');

  for (const p of PRICING) {
    await PricingPlanModel.updateOne(
      { plan: p.plan, region: p.region, validTo: null },
      { $set: { ...p, period: 'month', validFrom: new Date(), validTo: null } },
      { upsert: true },
    );
  }
  logger.info({ count: PRICING.length }, 'pricing plans seeded');

  await disconnectDb();
}

void main().catch((e) => {
  logger.fatal({ err: e }, 'seed failed');
  process.exit(1);
});

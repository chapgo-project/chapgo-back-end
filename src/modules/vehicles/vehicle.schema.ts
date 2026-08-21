import { z } from 'zod';
import { FUELS, TRANSMISSIONS, VEHICLE_CONDITIONS, HISTORY_KNOWN } from '../../types/enums.js';

const currentYear = new Date().getFullYear();

export const CreateVehicleBody = z.object({
  brand: z.string().trim().min(1, 'Indiquez la marque.').max(60),
  model: z.string().trim().min(1, 'Indiquez le modèle.').max(60),
  version: z.string().trim().max(60).optional().nullable(),
  year: z.coerce
    .number()
    .int()
    .min(1950, 'Année invalide.')
    .max(currentYear + 1, 'Année invalide.'),
  plate: z.string().trim().min(3, "Immatriculation invalide.").max(20),
  vin: z
    .string()
    .trim()
    .length(17, 'Le VIN comporte 17 caractères.')
    .optional()
    .nullable(),
  fuel: z.enum(FUELS),
  transmission: z.enum(TRANSMISSIONS).optional().nullable(),
  firstRegistrationAt: z.coerce.date().optional().nullable(),
  condition: z.enum(VEHICLE_CONDITIONS).default('second_hand'),
  historyKnown: z.enum(HISTORY_KNOWN).default('partial'),
  photoId: z.string().optional().nullable(),
  currentMileage: z.coerce
    .number()
    .int()
    .min(0)
    .max(2_000_000, 'Kilométrage invalide.'),
  mileageEstimated: z.boolean().default(false),
});

export const UpdateVehicleBody = CreateVehicleBody.partial().omit({
  currentMileage: true,
  mileageEstimated: true,
});

export const AddMileageBody = z.object({
  value: z.coerce.number().int().min(0).max(2_000_000),
  recordedAt: z.coerce.date().optional(),
  estimated: z.boolean().default(false),
  note: z.string().max(500).optional().nullable(),
  /** Sent after the client confirms an implausible-jump warning. */
  confirmJump: z.boolean().default(false),
});

export const CorrectMileageBody = z.object({
  value: z.coerce.number().int().min(0).max(2_000_000),
  reason: z.string().trim().min(3, 'Indiquez la raison de la correction.').max(500),
});

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  includeArchived: z.coerce.boolean().default(false),
});

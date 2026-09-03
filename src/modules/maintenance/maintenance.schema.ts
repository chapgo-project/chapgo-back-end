import { z } from 'zod';
import { MAINTENANCE_TYPES, MAINTENANCE_CATEGORIES, ASSESSMENT_RESULTS, ASSESSMENT_CATEGORIES } from '../../types/enums.js';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Identifiant invalide.');

const PartInput = z.object({
  category: z.string().min(1),
  label: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(60).optional().nullable(),
  reference: z.string().trim().max(60).optional().nullable(),
  quantity: z.coerce.number().int().min(1).default(1),
  price: z.coerce.number().min(0).optional().nullable(),
  warrantyMonths: z.coerce.number().int().min(0).optional().nullable(),
  oldPhotoId: objectId.optional().nullable(),
  newPhotoId: objectId.optional().nullable(),
  nextCheckMileage: z.coerce.number().int().min(0).optional().nullable(),
  nextCheckDate: z.coerce.date().optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

const AssessmentInput = z.object({
  itemId: z.string().min(1),
  category: z.enum(ASSESSMENT_CATEGORIES),
  label: z.string().min(1).max(120),
  result: z.enum(ASSESSMENT_RESULTS),
  note: z.string().max(500).optional().nullable(),
  recommendedAction: z.string().max(120).optional().nullable(),
  estimatedCost: z.coerce.number().min(0).optional().nullable(),
  photoIds: z.array(objectId).default([]),
});

const DiagnosticInput = z.object({
  method: z.enum(['manual', 'imported', 'device']),
  summary: z.string().max(2000).optional().nullable(),
  faultCodes: z.array(z.string().max(20)).default([]),
  components: z.array(z.string().max(60)).default([]),
  reportId: objectId.optional().nullable(),
  extractionConfirmed: z.boolean().default(false),
});

const InspectionInput = z.object({
  result: z.enum(['pass', 'pass_with_defects', 'fail']),
  centre: z.string().max(120).optional().nullable(),
  defects: z.array(z.string().max(200)).default([]),
  observations: z.string().max(2000).optional().nullable(),
  nextDueDate: z.coerce.date().optional().nullable(),
  retestRequired: z.boolean().default(false),
  retestDueDate: z.coerce.date().optional().nullable(),
  reportId: objectId.optional().nullable(),
});

const RecommendationInput = z.object({
  label: z.string().trim().min(1).max(120),
  category: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  dueMileage: z.coerce.number().int().min(0).optional().nullable(),
  urgency: z.enum(['normal', 'soon', 'urgent']).default('normal'),
  estimatedCost: z.coerce.number().min(0).optional().nullable(),
});

export const CreateEventBody = z.object({
  type: z.enum(MAINTENANCE_TYPES),
  category: z.enum(MAINTENANCE_CATEGORIES),
  title: z.string().trim().min(2, 'Indiquez un titre.').max(120),
  description: z.string().max(4000).optional().nullable(),
  performedAt: z.coerce.date(),
  mileage: z.coerce.number().int().min(0).max(2_000_000),
  performedBy: z.enum(['self', 'garage']).default('self'),
  garageId: objectId.optional().nullable(),
  garageName: z.string().trim().max(120).optional().nullable(),
  cost: z.coerce.number().min(0).optional().nullable(),

  parts: z.array(PartInput).max(30).default([]),
  assessment: z.array(AssessmentInput).max(60).default([]),
  diagnostic: DiagnosticInput.optional().nullable(),
  inspection: InspectionInput.optional().nullable(),
  recommendations: z.array(RecommendationInput).max(20).default([]),

  photoIds: z.array(objectId).max(10, '10 photos maximum.').default([]),
  invoiceId: objectId.optional().nullable(),
  documentIds: z.array(objectId).max(10).default([]),

  resolvesIssueId: objectId.optional().nullable(),
  completesReminderId: objectId.optional().nullable(),
  nextDueDate: z.coerce.date().optional().nullable(),
  nextDueMileage: z.coerce.number().int().min(0).optional().nullable(),

  asDraft: z.boolean().optional(),
  confirmJump: z.boolean().default(false),
});

export const UpdateEventBody = CreateEventBody.partial();

export const CorrectEventBody = z.object({
  reason: z.string().trim().min(3, 'Indiquez la raison de la correction.').max(1000),
  patch: UpdateEventBody,
});

export const DisputeBody = z.object({
  reason: z.string().trim().min(3, 'Précisez ce qui doit être corrigé.').max(1000),
});

export const ListEventQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  type: z.enum(MAINTENANCE_TYPES).optional(),
});

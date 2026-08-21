import type { VehicleScope } from '../../core/authorization.js';

/**
 * Serialization. Field names mirror lib/shared/models/maintenance_event.dart.
 *
 * `isEditable` is computed HERE rather than left to the client: the app
 * shows or hides the edit button from this flag, and duplicating the rule in
 * Dart would let the two drift.
 */
export function toEventDto(
  e: Record<string, any>,
  actor: { userId: string; garageId?: string },
  scope?: VehicleScope,
) {
  const isOwnUserRecord = e.provenance === 'user' && String(e.authorId) === actor.userId;
  const isOwnGarageDraft =
    e.provenance === 'garage' &&
    ['draft', 'correction_requested'].includes(e.status) &&
    String(e.garageId ?? '') === String(actor.garageId ?? '');

  return {
    id: String(e._id),
    vehicleId: String(e.vehicleId),
    /** Lets the app group "before / since my purchase" without guessing. */
    ownershipId: String(e.ownershipId),

    type: e.type,
    category: e.category,
    title: e.title,
    description: e.description ?? null,
    performedAt: e.performedAt,
    mileage: e.mileage,

    provenance: e.provenance,
    status: e.status,
    /** Drives the "Ajouté par vous" / "Intervention garage vérifiée" badge. */
    authorType: e.authorType,
    garageId: e.garageId ? String(e.garageId) : null,
    garageName: e.garageName ?? null,

    cost: e.cost ?? null,
    currency: e.currency ?? 'XOF',

    parts: (e.parts ?? []).map((p: Record<string, any>) => ({
      id: String(p._id),
      category: p.category,
      label: p.label,
      brand: p.brand ?? null,
      reference: p.reference ?? null,
      quantity: p.quantity,
      price: p.price ?? null,
      warrantyMonths: p.warrantyMonths ?? null,
      oldPhotoId: p.oldPhotoId ? String(p.oldPhotoId) : null,
      newPhotoId: p.newPhotoId ? String(p.newPhotoId) : null,
      nextCheckMileage: p.nextCheckMileage ?? null,
      nextCheckDate: p.nextCheckDate ?? null,
      note: p.note ?? null,
    })),
    assessment: e.assessment ?? [],
    diagnostic: e.diagnostic ?? null,
    inspection: e.inspection ?? null,
    recommendations: e.recommendations ?? [],

    photoIds: (e.photoIds ?? []).map(String),
    invoiceId: e.invoiceId ? String(e.invoiceId) : null,
    documentIds: (e.documentIds ?? []).map(String),

    resolvesIssueId: e.resolvesIssueId ? String(e.resolvesIssueId) : null,
    completesReminderId: e.completesReminderId ? String(e.completesReminderId) : null,

    version: e.version ?? 1,
    correctedFromId: e.correctedFromId ? String(e.correctedFromId) : null,
    supersededById: e.supersededById ? String(e.supersededById) : null,
    correctionReason: e.correctionReason ?? null,

    /** False for anything accepted — RULE 4, append-only from then on. */
    isEditable: (isOwnUserRecord || isOwnGarageDraft) && !e.deletedAt,
    /** True once accepted: the app then offers "Corriger" instead of "Modifier". */
    isCorrectable: e.status === 'accepted' && !e.supersededById,

    submittedAt: e.submittedAt ?? null,
    acceptedAt: e.acceptedAt ?? null,
    disputeReason: e.disputeReason ?? null,
    createdAt: e.createdAt,
  };
}

/**
 * Enum values. These strings cross the wire to Flutter, where
 * lib/shared/models/enums.dart parses them. Renaming one breaks the app
 * silently — add, never rename.
 */
export const ROLES = ['owner', 'garage', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const FUELS = ['petrol', 'diesel', 'hybrid', 'electric', 'lpg', 'other'] as const;
export const TRANSMISSIONS = ['manual', 'automatic', 'other'] as const;
export const VEHICLE_CONDITIONS = ['new', 'second_hand'] as const;
export const HISTORY_KNOWN = ['full', 'partial', 'none'] as const;

export const MILEAGE_SOURCES = ['owner_manual', 'garage_onsite', 'intervention'] as const;
export type MileageSource = (typeof MILEAGE_SOURCES)[number];

export const MAINTENANCE_TYPES = ['service', 'repair', 'part', 'check', 'inspection'] as const;
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_CATEGORIES = [
  'oil_change', 'oil_filter', 'air_filter', 'cabin_filter', 'fuel_filter',
  'spark_plugs', 'timing_belt', 'accessory_belt', 'manufacturer_service',
  'brake_pads', 'brake_discs', 'brake_fluid', 'brake_check',
  'tyre_replacement', 'tyre_rotation', 'tyre_pressure', 'wheel_alignment', 'wheel_balancing',
  'coolant', 'washer_fluid', 'gearbox_oil', 'adblue',
  'battery', 'wipers', 'lights', 'air_conditioning', 'suspension',
  'exhaust', 'clutch', 'technical_inspection', 'diagnostic', 'bodywork', 'other',
] as const;

/**
 * provenance — who authored the record. Drives editability and the badge the
 * app shows. `garage_verified` is set only after the owner accepts.
 */
export const PROVENANCES = ['user', 'garage', 'garage_verified'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const MAINTENANCE_STATUSES = [
  'draft',                 // garage is still working on it, invisible to the owner
  'pending_owner_review',
  'accepted',
  'correction_requested',
  'cancelled',
] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export const REMINDER_RULES = ['date_only', 'mileage_only', 'first_of'] as const;
export type ReminderRule = (typeof REMINDER_RULES)[number];

export const REMINDER_STATUSES = [
  'proposed',    // suggested by a garage, awaiting owner activation
  'upcoming',
  'due_soon',
  'overdue',
  'completed',
  'postponed',
  'cancelled',
] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

export const REMINDER_SOURCES = ['user', 'system', 'garage'] as const;

export const ISSUE_STATUSES = ['watching', 'to_check', 'repair_planned', 'resolved'] as const;
export const ISSUE_SEVERITIES = ['low', 'medium', 'high'] as const;
export const ISSUE_CATEGORIES = [
  'noise', 'warning_light', 'tyre', 'leak', 'braking',
  'electrical', 'bodywork', 'mechanical', 'other',
] as const;

export const DOCUMENT_TYPES = [
  'insurance', 'registration', 'inspection', 'licence', 'purchase', 'invoice', 'other',
] as const;

export const HEALTH_STATUSES = ['good', 'attention', 'action_required'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export const ACCESS_STATUSES = ['pending', 'approved', 'rejected', 'expired', 'revoked'] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const GARAGE_VERIFICATION = ['pending', 'verified', 'rejected', 'suspended'] as const;

export const ATTACHMENT_OWNERS = [
  'vehicle', 'maintenance', 'part', 'issue', 'document', 'user', 'garage',
] as const;
export const ATTACHMENT_PURPOSES = [
  'vehicle_photo', 'maintenance_photo', 'part_photo_old', 'part_photo_new',
  'before_photo', 'after_photo', 'invoice', 'document',
  'inspection_report', 'diagnostic_report', 'profile_photo', 'garage_logo',
] as const;

export const ASSESSMENT_RESULTS = ['ok', 'monitor', 'worn', 'defective', 'urgent', 'not_checked'] as const;
export const ASSESSMENT_CATEGORIES = [
  'engine', 'braking', 'tyres', 'steering', 'suspension', 'transmission',
  'exhaust', 'air_conditioning', 'bodywork', 'lighting', 'fluids', 'battery',
] as const;

export const NOTIFICATION_TYPES = [
  'reminder_due_soon', 'reminder_overdue', 'document_expiring', 'document_expired',
  'inspection_due', 'retest_due', 'mileage_stale',
  'pending_issue', 'garage_event_proposed',
  'garage_access_requested', 'access_approved', 'access_rejected', 'access_revoked',
  'access_expiring', 'intervention_submitted', 'intervention_accepted',
  'correction_requested', 'correction_submitted', 'transfer_completed', 'follow_up',
] as const;

export const PLANS = ['discovery', 'garage', 'garage_pro'] as const;
export type Plan = (typeof PLANS)[number];

export const REGIONS = ['CI', 'FR', 'default'] as const;

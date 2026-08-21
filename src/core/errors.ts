/**
 * Error codes shared with the Flutter client.
 *
 * These strings are matched by the app's ApiException mapper — renaming one
 * silently breaks an error state in the UI. Add, do not rename.
 */
export const ErrorCode = {
  // Auth
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  PHONE_ALREADY_EXISTS: 'PHONE_ALREADY_EXISTS',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  INVALID_CODE: 'INVALID_CODE',
  CODE_EXPIRED: 'CODE_EXPIRED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_ALREADY_USED: 'TOKEN_ALREADY_USED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',

  // Authorization
  FORBIDDEN: 'FORBIDDEN',
  ACCESS_DENIED: 'ACCESS_DENIED',
  ACCESS_EXPIRED: 'ACCESS_EXPIRED',
  ACCESS_ALREADY_EXISTS: 'ACCESS_ALREADY_EXISTS',
  ACCESS_ALREADY_DECIDED: 'ACCESS_ALREADY_DECIDED',
  GARAGE_NOT_VALIDATED: 'GARAGE_NOT_VALIDATED',

  // Resources
  NOT_FOUND: 'NOT_FOUND',
  VEHICLE_NOT_FOUND: 'VEHICLE_NOT_FOUND',
  PLATE_ALREADY_EXISTS: 'PLATE_ALREADY_EXISTS',
  INVALID_VIN: 'INVALID_VIN',
  CONFLICT: 'CONFLICT',

  // Business rules
  MILEAGE_REGRESSION: 'MILEAGE_REGRESSION',
  MILEAGE_IMPLAUSIBLE: 'MILEAGE_IMPLAUSIBLE',
  EVENT_LOCKED: 'EVENT_LOCKED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  FEATURE_NOT_IN_PLAN: 'FEATURE_NOT_IN_PLAN',

  // Files
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UPLOAD_EXPIRED: 'UPLOAD_EXPIRED',
  ATTACHMENT_LIMIT_REACHED: 'ATTACHMENT_LIMIT_REACHED',

  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * The only error type thrown deliberately.
 *
 * `message` is FRENCH and displayed to the user as-is — the Flutter screens
 * render it without translation. `field` lets the app show the error inline
 * on the offending input instead of as a toast.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly field?: string;
  readonly details?: Record<string, unknown>;

  constructor(opts: {
    status: number;
    code: ErrorCodeValue;
    message: string;
    field?: string;
    details?: Record<string, unknown>;
  }) {
    super(opts.message);
    this.name = 'AppError';
    this.status = opts.status;
    this.code = opts.code;
    this.field = opts.field;
    this.details = opts.details;
  }
}

/** Shorthands for the cases used most. */
export const err = {
  unauthenticated: (message = 'Votre session a expiré.') =>
    new AppError({ status: 401, code: ErrorCode.UNAUTHENTICATED, message }),

  forbidden: (message = "Vous n'avez pas accès à cette ressource.") =>
    new AppError({ status: 403, code: ErrorCode.FORBIDDEN, message }),

  notFound: (message = 'Ressource introuvable.') =>
    new AppError({ status: 404, code: ErrorCode.NOT_FOUND, message }),

  validation: (message: string, field?: string) =>
    new AppError({ status: 422, code: ErrorCode.VALIDATION_FAILED, message, field }),

  conflict: (code: ErrorCodeValue, message: string, field?: string) =>
    new AppError({ status: 409, code, message, field }),

  custom: (
    status: number,
    code: ErrorCodeValue,
    message: string,
    extra?: { field?: string; details?: Record<string, unknown> },
  ) => new AppError({ status, code, message, ...extra }),
};

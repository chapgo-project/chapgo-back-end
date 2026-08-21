import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable, validated once at boot.
 *
 * The process refuses to start on a missing or malformed value rather than
 * failing on the first request that needs it — a missing JWT secret must be
 * a deploy failure, not a 500 in production three hours later.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'at least 32 chars — use: openssl rand -base64 48'),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  STORAGE_ENDPOINT: z.string().default(''),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: z.string().default('chapgo-dev'),
  STORAGE_ACCESS_KEY_ID: z.string().default(''),
  STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
  SIGNED_URL_TTL_MIN: z.coerce.number().int().positive().default(15),

  SMS_PROVIDER: z.enum(['console', 'http', 'twilio']).default('console'),
  SMS_API_KEY: z.string().default(''),
  SMS_SENDER_ID: z.string().default('ChapGo'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM: z.string().default(''),

  EMAIL_PROVIDER: z.enum(['console', 'http', 'resend', 'brevo']).default('console'),
  EMAIL_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('no-reply@chapgo.ci'),
  APP_PUBLIC_URL: z.string().default('https://app.chapgo.ci'),

  /** Comma-separated OAuth client IDs (iOS, Android, Web). */
  GOOGLE_CLIENT_IDS: z.string().default(''),

  // Business thresholds. In config because they will be tuned after the
  // pilots — a literal buried in a service is where they go to die.
  REMINDER_DUE_SOON_DAYS: z.coerce.number().int().positive().default(30),
  REMINDER_DUE_SOON_KM: z.coerce.number().int().positive().default(1000),
  MILEAGE_STALE_DAYS: z.coerce.number().int().positive().default(60),
  MILEAGE_JUMP_WARN_KM: z.coerce.number().int().positive().default(50_000),
  ACCESS_DEFAULT_DAYS: z.coerce.number().int().positive().default(7),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  OTP_TTL_MIN: z.coerce.number().int().positive().default(10),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive().default(45),

  SENTRY_DSN: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment:\n${issues}\n\nSee .env.example.`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

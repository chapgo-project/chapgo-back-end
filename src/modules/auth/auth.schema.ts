import { z } from 'zod';

/**
 * Boundary schemas. Mirror the Flutter payloads exactly — a divergence here
 * means editing Dart models, which is more expensive than matching.
 */
const password = z
  .string()
  .min(8, '8 caractères minimum.')
  .regex(/[A-Za-z]/, 'Ajoutez au moins une lettre.')
  .regex(/[0-9]/, 'Ajoutez au moins un chiffre.');

const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide.');

/** E.164. The app normalises before sending; validated again here. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Numéro de téléphone invalide.');

const name = z.string().trim().min(2, 'Ce champ est trop court.').max(50);

export const RegisterBody = z.object({
  firstName: name,
  lastName: name,
  email,
  password,
  phone: phone.optional(),
});

export const DeviceInfo = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  platform: z.enum(['ios', 'android', 'web', 'unknown']).optional(),
});

export type DeviceInfoInput = z.infer<typeof DeviceInfo>;

export const LoginBody = z.object({
  email,
  password: z.string().min(1, 'Saisissez votre mot de passe.'),
  device: DeviceInfo.optional(),
});

export const RefreshBody = z.object({
  refreshToken: z.string().min(20),
  device: DeviceInfo.optional(),
});

export const ForgotPasswordBody = z.object({ email });

export const ResetPasswordBody = z.object({
  token: z.string().min(10),
  password,
});

export const VerifyEmailBody = z.object({ token: z.string().min(10) });

export const EmailVerificationStatusBody = z.object({ email });

export const ResendVerificationBody = z.object({
  /** Present when the user is correcting a typo in their address. */
  email: email.optional(),
  /** Unauthenticated resend after signup: the address currently on the account. */
  previousEmail: email.optional(),
});

export const PhoneRequestBody = z.object({ phone });

export const PhoneVerifyBody = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Le code doit comporter 6 chiffres.'),
  device: DeviceInfo.optional(),
});

export const GoogleBody = z.object({
  idToken: z.string().min(20, 'Jeton Google manquant.'),
  device: DeviceInfo.optional(),
});

export const VerifyOtpBody = z.object({
  code: z.string().regex(/^\d{6}$/, 'Le code doit comporter 6 chiffres.'),
});

export type RegisterInput = z.infer<typeof RegisterBody>;
export type LoginInput = z.infer<typeof LoginBody>;
export type PhoneVerifyInput = z.infer<typeof PhoneVerifyBody>;

import { Router } from 'express';
import { z } from 'zod';
import { handler, ok } from '../../core/http.js';
import { validateBody } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { err, ErrorCode } from '../../core/errors.js';
import { exportLimiter, uploadLimiter, authLimiter, otpRequestLimiter, otpVerifyLimiter } from '../../core/rateLimit.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { listDeviceSessions, revokeDeviceSession } from './session.service.js';
import { deleteAccount, requestLogbookExport } from './account.service.js';
import { confirmAvatar, createAvatarSign, deleteAvatar } from './avatar.service.js';
import {
  cancelEmailChange,
  requestEmailChange,
  resendEmailChange,
} from './email-change.service.js';
import {
  cancelPhoneLink,
  requestPhoneLink,
  resendPhoneLink,
  verifyPhoneLink,
} from './phone-link.service.js';
import { linkGoogleAccount } from './google-link.service.js';

export const userRouter = Router();
userRouter.use(requireAuth, requireLiveAccount);

const UpdateProfileBody = z.object({
  firstName: z.string().trim().min(2).max(50).optional(),
  lastName: z.string().trim().min(2).max(50).optional(),
});

const PhoneLinkBody = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Numéro invalide.'),
});

const PhoneLinkVerifyBody = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Numéro invalide.'),
  code: z.string().regex(/^\d{6}$/, 'Le code doit comporter 6 chiffres.'),
});

const LinkGoogleBody = z.object({
  idToken: z.string().min(20, 'Jeton Google manquant.'),
});

const ChangeEmailBody = z.object({
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.'),
  password: z.string().min(1).optional(),
  googleIdToken: z.string().min(20).optional(),
});

const ConfirmAvatarBody = z.object({
  publicId: z.string().min(1),
  version: z.coerce.number().int().positive(),
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z
    .string()
    .min(8, '8 caractères minimum.')
    .regex(/[A-Za-z]/, 'Ajoutez au moins une lettre.')
    .regex(/[0-9]/, 'Ajoutez au moins un chiffre.'),
});

const NotificationPrefsBody = z
  .object({
    maintenance: z.boolean().optional(),
    checks: z.boolean().optional(),
    documents: z.boolean().optional(),
    inspection: z.boolean().optional(),
    garage: z.boolean().optional(),
    garageEvents: z.boolean().optional(),
    mileagePrompt: z.boolean().optional(),
    dailyDigestEnabled: z.boolean().optional(),
    dailyDigestHour: z.number().int().min(0).max(23).optional(),
    promotions: z.boolean().optional(),
  })
  .transform(({ garage, garageEvents, ...rest }) => ({
    ...rest,
    ...(garage !== undefined || garageEvents !== undefined
      ? { garage: garage ?? garageEvents }
      : {}),
  }));

const PreferencesBody = z.object({
  language: z.string().max(5).optional(),
  distanceUnit: z.enum(['km', 'mi']).optional(),
  currency: z.string().max(5).optional(),
  dateFormat: z.string().max(20).optional(),
  biometricEnabled: z.boolean().optional(),
});

const DeleteBody = z.object({
  password: z.string().optional(),
  confirm: z.literal(true),
});

/** GET /users/me — also validates a stored session at app start. */
userRouter.get(
  '/me',
  handler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId).lean();
    if (!user) throw err.unauthenticated();
    return ok(res, toUserDto(user));
  }),
);

userRouter.get(
  '/me/sessions',
  handler(async (req, res) => {
    const refresh = req.header('x-chapgo-refresh') ?? undefined;
    return ok(res, await listDeviceSessions(actorOf(req).userId, refresh));
  }),
);

userRouter.delete(
  '/me/sessions/:familyId',
  handler(async (req, res) => {
    const familyId = req.params.familyId;
    if (!familyId) throw err.notFound('Appareil introuvable.');
    await revokeDeviceSession(actorOf(req).userId, familyId);
    return ok(res, { success: true });
  }),
);

/**
 * PATCH /users/me — also serves PROFILE COMPLETION after an SMS signup.
 *
 * No separate /auth/complete-profile endpoint: completing a profile is
 * updating a user, and a second endpoint would duplicate validation and the
 * email uniqueness check.
 */
userRouter.patch(
  '/me',
  validateBody(UpdateProfileBody),
  handler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId);
    if (!user) throw err.unauthenticated();

    if (req.body.firstName !== undefined) user.firstName = req.body.firstName;
    if (req.body.lastName !== undefined) user.lastName = req.body.lastName;
    await user.save();
    return ok(res, toUserDto(user.toObject()));
  }),
);

/**
 * POST /users/me/email — request a verified change.
 * The login address does not move until the new inbox opens the link.
 */
userRouter.post(
  '/me/email',
  authLimiter,
  validateBody(ChangeEmailBody),
  handler(async (req, res) => {
    const result = await requestEmailChange(actorOf(req).userId, req.body);
    const { emailMessage, ...user } = result;
    return ok(res, req.header('X-Email-Delivery') === 'app'
      ? { user, email: emailMessage }
      : user);
  }),
);

userRouter.post(
  '/me/email/resend',
  authLimiter,
  handler(async (req, res) => {
    const result = await resendEmailChange(actorOf(req).userId);
    const { emailMessage, ...user } = result;
    return ok(res, req.header('X-Email-Delivery') === 'app'
      ? { user, email: emailMessage }
      : user);
  }),
);

userRouter.delete(
  '/me/email/pending',
  handler(async (req, res) => {
    return ok(res, await cancelEmailChange(actorOf(req).userId));
  }),
);

userRouter.post(
  '/me/phone/request-code',
  otpRequestLimiter,
  validateBody(PhoneLinkBody),
  handler(async (req, res) => {
    return ok(res, await requestPhoneLink(actorOf(req).userId, req.body.phone));
  }),
);

userRouter.post(
  '/me/phone/resend-code',
  otpRequestLimiter,
  handler(async (req, res) => {
    return ok(res, await resendPhoneLink(actorOf(req).userId));
  }),
);

userRouter.post(
  '/me/phone/verify-code',
  otpVerifyLimiter,
  validateBody(PhoneLinkVerifyBody),
  handler(async (req, res) => {
    return ok(
      res,
      await verifyPhoneLink(actorOf(req).userId, req.body.phone, req.body.code),
    );
  }),
);

userRouter.delete(
  '/me/phone/pending',
  handler(async (req, res) => {
    return ok(res, await cancelPhoneLink(actorOf(req).userId));
  }),
);

userRouter.post(
  '/me/google',
  authLimiter,
  validateBody(LinkGoogleBody),
  handler(async (req, res) => {
    return ok(res, await linkGoogleAccount(actorOf(req).userId, req.body.idToken));
  }),
);

/**
 * POST /users/me/avatar/sign — short-lived Cloudinary upload params.
 * The API secret never reaches the device.
 */
userRouter.post(
  '/me/avatar/sign',
  uploadLimiter,
  handler(async (req, res) => {
    return ok(res, createAvatarSign(actorOf(req).userId));
  }),
);

/** POST /users/me/avatar — persist the public id after a successful upload. */
userRouter.post(
  '/me/avatar',
  uploadLimiter,
  validateBody(ConfirmAvatarBody),
  handler(async (req, res) => {
    const user = await confirmAvatar(
      actorOf(req).userId,
      req.body.publicId,
      req.body.version,
    );
    return ok(res, user);
  }),
);

userRouter.delete(
  '/me/avatar',
  handler(async (req, res) => {
    return ok(res, await deleteAvatar(actorOf(req).userId));
  }),
);

userRouter.post(
  '/me/password',
  validateBody(PasswordBody),
  handler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId);
    if (!user) throw err.unauthenticated();

    if (user.passwordHash) {
      const valid = req.body.currentPassword &&
        await verifyPassword(user.passwordHash, req.body.currentPassword);
      if (!valid) {
        throw err.custom(
          401,
          ErrorCode.INVALID_CREDENTIALS,
          'Mot de passe actuel incorrect.',
          { field: 'currentPassword' },
        );
      }
    }

    user.passwordHash = await hashPassword(req.body.newPassword);
    user.passwordChangedAt = new Date();
    await user.save();

    // Every other device is signed out: a password change usually follows a
    // suspicion, and leaving sessions open defeats it.
    await revokeAllSessions(String(user._id));
    return ok(res, { success: true });
  }),
);

userRouter.patch(
  '/me/notification-preferences',
  validateBody(NotificationPrefsBody),
  handler(async (req, res) => {
    const user = await UserModel.findByIdAndUpdate(
      actorOf(req).userId,
      { $set: Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`notificationPrefs.${k}`, v])) },
      { new: true },
    );
    return ok(res, toUserDto(user!.toObject()));
  }),
);

userRouter.patch(
  '/me/preferences',
  validateBody(PreferencesBody),
  handler(async (req, res) => {
    const user = await UserModel.findByIdAndUpdate(
      actorOf(req).userId,
      { $set: Object.fromEntries(Object.entries(req.body).map(([k, v]) => [`preferences.${k}`, v])) },
      { new: true },
    );
    return ok(res, toUserDto(user!.toObject()));
  }),
);

/**
 * POST /users/me/export — CSV (interchange) + PDF (readable report).
 * Download links are valid 24 h and emailed when an address exists.
 */
userRouter.post(
  '/me/export',
  exportLimiter,
  handler(async (req, res) => {
    const result = await requestLogbookExport(actorOf(req).userId, req);
    if (req.header('X-Email-Delivery') === 'app') return ok(res, result);
    const { email, ...legacy } = result;
    return ok(res, legacy);
  }),
);

/**
 * DELETE /users/me — RULE 8: anonymise, do not erase.
 *
 * Personal fields are cleared and sessions revoked, but vehicle history is
 * RETAINED: it belongs to the vehicle, and a future owner has a legitimate
 * claim to it. Deleting it would destroy the product's core promise.
 *
 * Password is required only when the account has one. Google / SMS accounts
 * confirm with `{ confirm: true }` alone.
 */
userRouter.delete(
  '/me',
  validateBody(DeleteBody),
  handler(async (req, res) => {
    await deleteAccount(actorOf(req).userId, req.body.password);
    return ok(res, { success: true });
  }),
);

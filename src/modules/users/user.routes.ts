import { Router } from 'express';
import { z } from 'zod';
import { handler, ok } from '../../core/http.js';
import { validateBody } from '../../core/validate.js';
import { actorOf, requireAuth, requireLiveAccount } from '../../core/authMiddleware.js';
import { hashPassword, verifyPassword } from '../../core/password.js';
import { err, ErrorCode } from '../../core/errors.js';
import { UserModel } from './user.model.js';
import { toUserDto } from './user.dto.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { OwnershipModel } from '../vehicles/ownership.model.js';
import { AccessModel } from '../access/access.model.js';

export const userRouter = Router();
userRouter.use(requireAuth, requireLiveAccount);

const UpdateProfileBody = z.object({
  firstName: z.string().trim().min(2).max(50).optional(),
  lastName: z.string().trim().min(2).max(50).optional(),
  email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Numéro invalide.').optional(),
  photoId: z.string().optional().nullable(),
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, '8 caractères minimum.')
    .regex(/[A-Za-z]/, 'Ajoutez au moins une lettre.')
    .regex(/[0-9]/, 'Ajoutez au moins un chiffre.'),
});

const NotificationPrefsBody = z.object({
  maintenance: z.boolean().optional(),
  checks: z.boolean().optional(),
  documents: z.boolean().optional(),
  inspection: z.boolean().optional(),
  garage: z.boolean().optional(),
  mileagePrompt: z.boolean().optional(),
  dailyDigestEnabled: z.boolean().optional(),
  dailyDigestHour: z.number().int().min(0).max(23).optional(),
  promotions: z.boolean().optional(),
});

const PreferencesBody = z.object({
  language: z.string().max(5).optional(),
  distanceUnit: z.enum(['km', 'mi']).optional(),
  currency: z.string().max(5).optional(),
  dateFormat: z.string().max(20).optional(),
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

    if (req.body.email && req.body.email !== user.email) {
      const taken = await UserModel.findOne({ email: req.body.email }).select('_id').lean();
      if (taken) {
        throw err.conflict(
          ErrorCode.EMAIL_ALREADY_EXISTS,
          'Cette adresse e-mail est déjà utilisée.',
          'email',
        );
      }
      // A new address is unverified until confirmed.
      user.emailVerifiedAt = null;
    }

    Object.assign(user, req.body);
    await user.save();
    return ok(res, toUserDto(user.toObject()));
  }),
);

userRouter.post(
  '/me/password',
  validateBody(PasswordBody),
  handler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId);
    if (!user?.passwordHash) throw err.unauthenticated();

    const valid = await verifyPassword(user.passwordHash, req.body.currentPassword);
    if (!valid) {
      throw err.custom(
        401,
        ErrorCode.INVALID_CREDENTIALS,
        'Mot de passe actuel incorrect.',
        { field: 'currentPassword' },
      );
    }

    user.passwordHash = await hashPassword(req.body.newPassword);
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
 * DELETE /users/me — RULE 8: anonymise, do not erase.
 *
 * Personal fields are cleared and sessions revoked, but vehicle history is
 * RETAINED: it belongs to the vehicle, and a future owner has a legitimate
 * claim to it. Deleting it would destroy the product's core promise.
 */
userRouter.delete(
  '/me',
  validateBody(DeleteBody),
  handler(async (req, res) => {
    const user = await UserModel.findById(actorOf(req).userId);
    if (!user) throw err.unauthenticated();

    if (user.passwordHash) {
      const valid = req.body.password
        ? await verifyPassword(user.passwordHash, req.body.password)
        : false;
      if (!valid) {
        throw err.custom(401, ErrorCode.INVALID_CREDENTIALS, 'Mot de passe incorrect.', {
          field: 'password',
        });
      }
    }

    const userId = String(user._id);

    // Ownership periods close, so the vehicles become unreachable by this
    // account while their history survives, tagged to an anonymous period.
    await OwnershipModel.updateMany({ userId, endedAt: null }, { endedAt: new Date() });
    await AccessModel.updateMany(
      { ownerUserId: userId, status: 'approved' },
      { status: 'revoked', revokedAt: new Date() },
    );

    user.firstName = 'Compte';
    user.lastName = 'supprimé';
    user.email = null;
    user.phone = null;
    user.passwordHash = null;
    user.photoId = null;
    user.deletedAt = new Date();
    await user.save();

    await revokeAllSessions(userId);
    return ok(res, { success: true });
  }),
);

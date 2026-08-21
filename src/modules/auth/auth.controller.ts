import type { Request, Response } from 'express';
import { handler, ok } from '../../core/http.js';
import { UserModel } from '../users/user.model.js';
import { toUserDto } from '../users/user.dto.js';
import * as svc from './auth.service.js';

export const register = handler(async (req: Request, res: Response) => {
  const result = await svc.register(req.body);
  return ok(res, result, 201);
});

export const login = handler(async (req: Request, res: Response) => {
  const { session, user } = await svc.login(req.body);
  return ok(res, { ...session, user: toUserDto(user as Record<string, any>) });
});

export const refresh = handler(async (req: Request, res: Response) => {
  const session = await svc.refresh(req.body.refreshToken);
  return ok(res, session);
});

export const logout = handler(async (req: Request, res: Response) => {
  await svc.logout(req.body?.refreshToken);
  return ok(res, { success: true });
});

export const forgotPassword = handler(async (req: Request, res: Response) => {
  await svc.forgotPassword(req.body.email);
  // Deliberately identical whether or not the account exists.
  return ok(res, { sent: true });
});

export const resetPassword = handler(async (req: Request, res: Response) => {
  await svc.resetPassword(req.body.token, req.body.password);
  return ok(res, { success: true });
});

export const verifyEmail = handler(async (req: Request, res: Response) => {
  const session = await svc.verifyEmail(req.body.token);
  return ok(res, session);
});

export const resendVerification = handler(async (req: Request, res: Response) => {
  const actor = (req as { actor?: { userId: string } }).actor;
  const requested = req.body.email as string | undefined;
  const previous = req.body.previousEmail as string | undefined;

  let user = actor?.userId
    ? await (UserModel as any).findById(actor.userId)
    : null;

  if (!user && previous) {
    user = await (UserModel as any).findOne({ email: previous, deletedAt: null });
  }
  if (!user && requested) {
    user = await (UserModel as any).findOne({ email: requested, deletedAt: null });
  }

  // Always 200 — this endpoint must not confirm whether an address exists.
  if (!user) return ok(res, { sent: true });

  const target = requested ?? user.email;
  if (!target) return ok(res, { sent: true });

  if (requested && requested !== user.email) {
    user.email = requested;
    user.emailVerifiedAt = null;
    await user.save();
  }

  await svc.sendEmailVerification(String(user._id), target);
  return ok(res, { sent: true });
});

export const requestPhoneCode = handler(async (req: Request, res: Response) => {
  const result = await svc.requestPhoneCode(req.body.phone);
  return ok(res, result);
});

export const verifyPhoneCode = handler(async (req: Request, res: Response) => {
  const { session, user, isNewAccount } = await svc.verifyPhoneCode(
    req.body.phone,
    req.body.code,
  );
  return ok(res, {
    ...session,
    isNewAccount,
    user: toUserDto(user as Record<string, any>),
  });
});

export const resendPhoneCode = handler(async (req: Request, res: Response) => {
  const result = await svc.requestPhoneCode(req.body.phone);
  return ok(res, result);
});

export const google = handler(async (req: Request, res: Response) => {
  const { session, user, isNewAccount } = await svc.loginWithGoogle(req.body.idToken);
  return ok(res, {
    ...session,
    isNewAccount,
    user: toUserDto(user as Record<string, any>),
  });
});

import type { Request, Response } from 'express';
import { handler, ok } from '../../core/http.js';
import { actorOf } from '../../core/authMiddleware.js';
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
  const actor = actorOf(req);
  const user = await UserModel.findById(actor.userId);
  if (!user) return ok(res, { sent: true });

  // An optional email in the body also CHANGES the pending address — this is
  // what backs "Modifier l'adresse e-mail" on screen O16, without a second
  // endpoint.
  const target = (req.body.email as string | undefined) ?? user.email;
  if (!target) return ok(res, { sent: true });

  if (req.body.email && req.body.email !== user.email) {
    user.email = req.body.email;
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

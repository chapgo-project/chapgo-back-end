import { Router } from 'express';
import { validateBody } from '../../core/validate.js';
import { requireAuth } from '../../core/authMiddleware.js';
import { authLimiter, otpRequestLimiter, otpVerifyLimiter } from '../../core/rateLimit.js';
import * as ctrl from './auth.controller.js';
import * as S from './auth.schema.js';

/**
 * 13 endpoints. Naming departs from the original proposal on purpose:
 *
 *   /auth/login/phone/request-code  →  /auth/phone/request-code
 *
 * The phone path also REGISTERS, so "login" was misleading. And GET /auth/me
 * does not exist: GET /users/me is the one canonical user resource.
 */
export const authRouter = Router();

authRouter.post('/register', authLimiter, validateBody(S.RegisterBody), ctrl.register);
authRouter.post('/login', authLimiter, validateBody(S.LoginBody), ctrl.login);
authRouter.post('/refresh', validateBody(S.RefreshBody), ctrl.refresh);
authRouter.post('/logout', ctrl.logout);

authRouter.post(
  '/forgot-password',
  authLimiter,
  validateBody(S.ForgotPasswordBody),
  ctrl.forgotPassword,
);
authRouter.post(
  '/reset-password',
  authLimiter,
  validateBody(S.ResetPasswordBody),
  ctrl.resetPassword,
);

authRouter.post('/verify-email', validateBody(S.VerifyEmailBody), ctrl.verifyEmail);
authRouter.post(
  '/resend-verification',
  requireAuth,
  validateBody(S.ResendVerificationBody),
  ctrl.resendVerification,
);

authRouter.post(
  '/phone/request-code',
  otpRequestLimiter,
  validateBody(S.PhoneRequestBody),
  ctrl.requestPhoneCode,
);
authRouter.post(
  '/phone/verify-code',
  otpVerifyLimiter,
  validateBody(S.PhoneVerifyBody),
  ctrl.verifyPhoneCode,
);
authRouter.post(
  '/phone/resend-code',
  otpRequestLimiter,
  validateBody(S.PhoneRequestBody),
  ctrl.resendPhoneCode,
);

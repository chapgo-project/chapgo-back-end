import crypto from 'node:crypto';
import { config } from './config.js';
import { ErrorCode, err } from './errors.js';
import { logger } from './logger.js';

/**
 * SMS and email, behind one interface so the auth service never knows
 * which vendor is in use.
 *
 * `console` logs the payload (OTP included) — required for local tests.
 * Production: Twilio for SMS, Resend for email.
 */
export interface Messenger {
  sendSms(to: string, body: string): Promise<void>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

class ConsoleMessenger implements Messenger {
  async sendSms(to: string, body: string): Promise<void> {
    logger.info({ channel: 'sms', to: mask(to), body }, 'message (console)');
  }
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    logger.info({ channel: 'email', to: mask(to), subject, body }, 'message (console)');
  }
}

class TwilioSms {
  async sendSms(to: string, body: string): Promise<void> {
    const sid = config.TWILIO_ACCOUNT_SID;
    const token = config.TWILIO_AUTH_TOKEN || config.SMS_API_KEY;
    const from = config.TWILIO_FROM || config.SMS_SENDER_ID;

    if (!sid || !token || !from) {
      throw err.custom(
        503,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "L'envoi de SMS n'est pas configuré.",
      );
    }

    const params = new URLSearchParams();
    params.set('To', to);
    params.set('Body', body);
    if (from.startsWith('MG')) params.set('MessagingServiceSid', from);
    else params.set('From', from);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      },
    );

    if (!res.ok) {
      logger.error({ status: res.status, to: mask(to) }, 'twilio sms failed');
      throw err.custom(
        502,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "Impossible d'envoyer le SMS. Réessayez dans un instant.",
      );
    }
  }
}

class ResendEmail {
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const apiKey = config.EMAIL_API_KEY;
    if (!apiKey) {
      throw err.custom(
        503,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "L'envoi d'e-mails n'est pas configuré.",
      );
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: [to],
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      logger.error({ status: res.status, to: mask(to) }, 'resend email failed');
      throw err.custom(
        502,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "Impossible d'envoyer l'e-mail. Réessayez dans un instant.",
      );
    }
  }
}

function mask(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
  }
  return `***${value.slice(-4)}`;
}

const consoleMessenger = new ConsoleMessenger();
const twilioSms = new TwilioSms();
const resendEmail = new ResendEmail();

const smsProvider: Pick<Messenger, 'sendSms'> =
  config.SMS_PROVIDER === 'console' ? consoleMessenger : twilioSms;

const emailProvider: Pick<Messenger, 'sendEmail'> =
  config.EMAIL_PROVIDER === 'console' ? consoleMessenger : resendEmail;

export const messenger: Messenger = {
  sendSms: (to, body) => smsProvider.sendSms(to, body),
  sendEmail: (to, subject, body) => emailProvider.sendEmail(to, subject, body),
};

/** One-time link token. Only the hash is stored. */
export function generateLinkToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}

export function appUrl(path: string): string {
  const base = config.APP_PUBLIC_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

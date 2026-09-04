import crypto from 'node:crypto';
import { config, isTest } from './config.js';
import { ErrorCode, err } from './errors.js';
import { logger } from './logger.js';
import { hashToken } from './tokens.js';

/**
 * SMS behind one interface. Email content is returned to the app, which owns
 * delivery because Render does not provide an SMTP relay.
 *
 * `console` logs the payload (OTP included) — required for local tests.
 * Email logging remains available in tests only.
 */
export interface Messenger {
  sendSms(to: string, body: string): Promise<void>;
  sendEmail(to: string, subject: string, body: string): Promise<void>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
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

function mask(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
  }
  return `***${value.slice(-4)}`;
}

const consoleMessenger = new ConsoleMessenger();
const twilioSms = new TwilioSms();

const smsProvider: Pick<Messenger, 'sendSms'> =
  isTest || config.SMS_PROVIDER === 'console' ? consoleMessenger : twilioSms;

export const messenger: Messenger = {
  sendSms: (to, body) => smsProvider.sendSms(to, body),
  sendEmail: (to, subject, body) => consoleMessenger.sendEmail(to, subject, body),
};

export function emailMessage(to: string, subject: string, body: string): EmailMessage {
  return { to, subject, body };
}

/** One-time link token. Only the hash is stored. */
export function generateLinkToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function appUrl(path: string): string {
  const base = config.APP_PUBLIC_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

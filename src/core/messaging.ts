import crypto from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

/**
 * SMS and email, behind one interface.
 *
 * `console` in development logs the code instead of sending it — an OTP flow
 * is otherwise untestable without a paid provider.
 *
 * NOTE FOR PRODUCTION: test Ivorian delivery rates before committing to a
 * provider. This is where OTP flows fail quietly — the API returns 200, the
 * SMS never lands, and the user is stuck on a screen that looks broken.
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

class HttpMessenger implements Messenger {
  async sendSms(to: string, body: string): Promise<void> {
    // Wire the chosen aggregator here. Kept as one method on purpose:
    // switching provider must not touch the auth service.
    throw new Error('SMS provider not configured — set SMS_PROVIDER=console or implement this.');
  }
  async sendEmail(_to: string, _subject: string, _body: string): Promise<void> {
    throw new Error('Email provider not configured.');
  }
}

function mask(value: string): string {
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${(local ?? '').slice(0, 2)}***@${domain ?? ''}`;
  }
  return `***${value.slice(-4)}`;
}

export const messenger: Messenger =
  config.SMS_PROVIDER === 'console' ? new ConsoleMessenger() : new HttpMessenger();

/** One-time link token. Only the hash is stored. */
export function generateLinkToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}

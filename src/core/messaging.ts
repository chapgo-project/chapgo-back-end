import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { config, isTest } from './config.js';
import { ErrorCode, err } from './errors.js';
import { logger } from './logger.js';

/**
 * SMS and email, behind one interface so the auth service never knows
 * which vendor is in use.
 *
 * `console` logs the payload (OTP included) — required for local tests.
 * Production: Twilio for SMS, Gmail SMTP or Brevo for email.
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

/** Brevo transactional email — POST /v3/smtp/email */
class BrevoEmail {
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    const apiKey = config.EMAIL_API_KEY;
    if (!apiKey) {
      throw err.custom(
        503,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "L'envoi d'e-mails n'est pas configuré.",
      );
    }

    const sender = parseFrom(config.EMAIL_FROM);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        textContent: body,
        htmlContent: toHtml(body),
      }),
    });

    if (!res.ok) {
      const detail = await brevoErrorDetail(res);
      logger.error({ status: res.status, detail, to: mask(to) }, 'brevo email failed');
      throw err.custom(
        502,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "Impossible d'envoyer l'e-mail. Réessayez dans un instant.",
      );
    }

    const accepted = (await res.json().catch(() => ({}))) as { messageId?: string };
    logger.info({ to: mask(to), messageId: accepted.messageId }, 'brevo email accepted');
  }
}

/** Gmail SMTP with an App Password from a personal Google account. */
class GmailEmail {
  async sendEmail(to: string, subject: string, body: string): Promise<void> {
    if (!config.GMAIL_USER || !config.GMAIL_APP_PASSWORD) {
      throw err.custom(
        503,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "L'envoi d'e-mails n'est pas configuré.",
      );
    }

    try {
      const result = await nodemailer
        .createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: config.GMAIL_USER,
            pass: config.GMAIL_APP_PASSWORD,
          },
        })
        .sendMail({
          from: config.EMAIL_FROM || config.GMAIL_USER,
          to,
          subject,
          text: body,
          html: toHtml(body),
        });

      logger.info({ to: mask(to), messageId: result.messageId }, 'gmail email accepted');
    } catch (cause) {
      logger.error({ err: cause, to: mask(to) }, 'gmail email failed');
      throw err.custom(
        502,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "Impossible d'envoyer l'e-mail. Réessayez dans un instant.",
      );
    }
  }
}

function parseFrom(from: string): { name: string; email: string } {
  const named = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (named) {
    return {
      name: (named[1] ?? 'ChapGo').replace(/^["']|["']$/g, '').trim() || 'ChapGo',
      email: (named[2] ?? '').trim(),
    };
  }
  return { name: 'ChapGo', email: from.trim() };
}

async function brevoErrorDetail(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { message?: string; code?: string };
    return [json.code, json.message].filter(Boolean).join(': ') || res.statusText;
  } catch {
    return res.statusText;
  }
}

function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1">$1</a>',
  );
  return `<p style="font-family:sans-serif;font-size:16px;line-height:1.5">${withLinks.replace(/\n/g, '<br/>')}</p>`;
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
const brevoEmail = new BrevoEmail();
const gmailEmail = new GmailEmail();

const smsProvider: Pick<Messenger, 'sendSms'> =
  isTest || config.SMS_PROVIDER === 'console' ? consoleMessenger : twilioSms;

const emailProvider: Pick<Messenger, 'sendEmail'> =
  isTest || config.EMAIL_PROVIDER === 'console'
    ? consoleMessenger
    : config.EMAIL_PROVIDER === 'gmail'
      ? gmailEmail
      : brevoEmail;

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

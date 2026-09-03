import pino from 'pino';
import { config, isProd } from './config.js';

/**
 * Structured logs. No PII: never log a phone, email, plate, token or
 * password — production logs are readable by more people than the database.
 */
function createLogger() {
  const options: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.code',
        'req.body.token',
        'req.body.refreshToken',
        'req.body.idToken',
        'req.body.email',
        'req.body.phone',
        '*.passwordHash',
        '*.tokenHash',
        '*.codeHash',
      ],
      censor: '[redacted]',
    },
  };

  if (isProd) return pino(options);

  try {
    return pino({
      ...options,
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  } catch {
    return pino(options);
  }
}

export const logger = createLogger();

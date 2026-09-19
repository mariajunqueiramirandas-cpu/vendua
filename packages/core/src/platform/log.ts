import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'core' }, // drop pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.secret', '*.password'],
    censor: '[redacted]',
  },
  serializers: { err: pino.stdSerializers.err },
});

export type Log = typeof log;

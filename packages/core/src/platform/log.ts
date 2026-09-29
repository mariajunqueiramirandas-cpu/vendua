import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'core' }, // drop pid/hostname noise
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.apiKey',
      '*.secret',
      '*.password',
    ],
    censor: '[redacted]',
  },
  serializers: { err: pino.stdSerializers.err },
});

export type Log = typeof log;

// libsignal (via baileys) console.info/warn's whole SessionEntry objects — ratchet and root keys — on every
// session open/close. Keep the event, drop the key material.
const SIGNAL_SESSION_NOISE =
  /^(closing|opening|removing old closed|migrating) session|^session already/i;
export function scrubSignalConsole(target: Pick<Console, 'info' | 'warn'> = console) {
  for (const level of ['info', 'warn'] as const) {
    const orig = target[level].bind(target);
    target[level] = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && SIGNAL_SESSION_NOISE.test(args[0]))
        return log.debug({ mod: 'signal' }, args[0].replace(/:$/, ''));
      orig(...args);
    };
  }
}
scrubSignalConsole();

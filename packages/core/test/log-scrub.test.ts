import { describe, expect, test } from 'bun:test';
import { scrubSignalConsole } from '../src/platform/log.ts';
import { windowCounter, clientIp } from '../src/platform/http.ts';

describe('scrubSignalConsole', () => {
  test('drops signal session objects, passes everything else', () => {
    const seen: unknown[][] = [];
    const fake = {
      info: (...a: unknown[]) => void seen.push(a),
      warn: (...a: unknown[]) => void seen.push(a),
    };
    scrubSignalConsole(fake as never);
    fake.info('Closing session:', { rootKey: Buffer.from('secret') });
    fake.warn('Session already closed', { privKey: 'x' });
    fake.info('unrelated', 1);
    expect(seen).toEqual([['unrelated', 1]]);
  });
});

describe('windowCounter', () => {
  test('allows max then refuses, per key', () => {
    const allow = windowCounter({ windowMs: 60_000, max: 2 });
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
  });
});

describe('clientIp', () => {
  const c = (xff: string) => ({ req: { header: () => xff } });
  test('skips trusted hops from the right; fails closed when the chain is short', () => {
    expect(
      clientIp(c('9.9.9.9, 1.1.1.1, 10.0.0.1'), { trustForwardedFor: true, proxyHops: 1 }),
    ).toBe('1.1.1.1');
    expect(clientIp(c('1.1.1.1'), { trustForwardedFor: true, proxyHops: 1 })).toBe('unknown');
    expect(clientIp(c('1.1.1.1'), {})).toBe('local');
  });
});

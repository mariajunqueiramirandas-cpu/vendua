import { afterEach, expect, test } from 'bun:test';
import { seal, unseal } from '../src/platform/secrets.ts';

const saved = process.env.VENDUA_SECRETS_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.VENDUA_SECRETS_KEY;
  else process.env.VENDUA_SECRETS_KEY = saved;
});

test('with VENDUA_SECRETS_KEY set, tokens sealed under the session-derived key still open', () => {
  delete process.env.VENDUA_SECRETS_KEY;
  const legacy = seal('APP_USR-legacy', 'session-secret');

  process.env.VENDUA_SECRETS_KEY = 'k'.repeat(64);
  expect(unseal(legacy, 'session-secret')).toBe('APP_USR-legacy');
  // new boxes use the dedicated key: they don't open under the session secret alone
  const fresh = seal('APP_USR-new', 'session-secret');
  expect(unseal(fresh, 'session-secret')).toBe('APP_USR-new');
  delete process.env.VENDUA_SECRETS_KEY;
  expect(unseal(fresh, 'session-secret')).toBeNull();
});

test('a box opens under neither a wrong key nor a tampered tag', () => {
  process.env.VENDUA_SECRETS_KEY = 'a'.repeat(64);
  const box = seal('APP_USR-x', 'session-secret');
  process.env.VENDUA_SECRETS_KEY = 'b'.repeat(64);
  expect(unseal(box, 'session-secret')).toBeNull();
  process.env.VENDUA_SECRETS_KEY = 'a'.repeat(64);
  expect(
    unseal({ ...box, tag: Buffer.alloc(16).toString('base64url') }, 'session-secret'),
  ).toBeNull();
  expect(unseal(box, 'other-session')).toBe('APP_USR-x');
});

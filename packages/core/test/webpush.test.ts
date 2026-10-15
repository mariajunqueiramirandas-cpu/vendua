import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { sendPushResult, vapidConfig, vapidPublicKey } from '../src/admin/webpush.ts';

const saved = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY };
const realFetch = globalThis.fetch;

async function pair() {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as CryptoKeyPair;
  return {
    pub: Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('base64url'),
    priv: (await crypto.subtle.exportKey('jwk', k.privateKey)).d!,
  };
}

const setKeys = (pub?: string, priv?: string) => {
  if (pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = pub;
  if (priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = priv;
};

describe('VAPID keys', () => {
  let a: { pub: string; priv: string };
  let b: { pub: string; priv: string };
  beforeAll(async () => {
    a = await pair();
    b = await pair();
  });
  afterEach(() => {
    setKeys(saved.pub, saved.priv);
    globalThis.fetch = realFetch;
  });

  test('a missing key turns push off and says which', () => {
    setKeys();
    expect(vapidPublicKey()).toBeNull();
    expect(vapidConfig().problem).toBe('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not set');
    setKeys(a.pub);
    expect(vapidConfig().problem).toBe('VAPID_PRIVATE_KEY is not set');
    setKeys(undefined, a.priv);
    expect(vapidConfig().problem).toBe('VAPID_PUBLIC_KEY is not set');
  });

  test('a key that is not a P-256 pair turns push off', () => {
    setKeys('not-a-key', a.priv);
    expect(vapidConfig().problem).toMatch(/VAPID_PUBLIC_KEY is not a base64url P-256/);
    setKeys(a.pub, 'c2hvcnQ');
    expect(vapidConfig().problem).toMatch(/VAPID_PRIVATE_KEY is not a base64url P-256/);
    setKeys(a.pub, b.priv);
    expect(vapidConfig().problem).toBe(
      'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not the same pair',
    );
    expect(vapidPublicKey()).toBeNull();
  });

  test('quotes, whitespace and standard base64 are forgiven; the browser gets base64url', () => {
    const std = Buffer.from(a.pub, 'base64url').toString('base64');
    setKeys(` "${std}"\n`, `'${a.priv}'`);
    expect(vapidConfig().problem).toBeNull();
    expect(vapidPublicKey()).toBe(a.pub);
  });

  test('a subscription made under another key is gone; any other refusal is an error', async () => {
    setKeys(a.pub, a.priv);
    let reply = new Response('', { status: 403 });
    globalThis.fetch = (async () => reply) as unknown as typeof fetch;
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const target = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url'),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    };
    expect(await sendPushResult(target, { title: 't' })).toEqual({
      result: 'error',
      detail: 'push service 403',
    });
    reply = new Response(
      'the key in the authorization header does not correspond to the sender ID used to subscribe this user.',
      { status: 403 },
    );
    expect(await sendPushResult(target, { title: 't' })).toEqual({
      result: 'gone',
      detail: 'push service 403: key changed',
    });
    reply = new Response('{"reason":"VapidPkHashMismatch"}', { status: 400 });
    expect((await sendPushResult(target, { title: 't' })).result).toBe('gone');
  });
});

// Web Push without a dependency: VAPID (RFC 8292) signs with ES256, the payload
// is encrypted per RFC 8291 (aes128gcm). Keys come from the environment:
//   VAPID_PUBLIC_KEY  — base64url uncompressed P-256 point (65 bytes)
//   VAPID_PRIVATE_KEY — base64url private scalar d (32 bytes)
//   VAPID_SUBJECT     — mailto: or https: contact for push services
// Without them push is off and the admin says so; sound + the live board still work.

const enc = new TextEncoder();
// ArrayBuffer-backed: WebCrypto's BufferSource rejects SharedArrayBuffer views
type Bytes = Uint8Array<ArrayBuffer>;

const b64u = {
  encode: (b: ArrayBuffer | Uint8Array) =>
    Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url'),
  decode: (s: string): Bytes => new Uint8Array(Buffer.from(s, 'base64url')),
};

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? process.env.VAPID_PUBLIC_KEY
    : null;
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  );
}

async function vapidAuth(endpoint: string, pub: string, priv: string, subject: string) {
  const aud = new URL(endpoint).origin;
  const point = b64u.decode(pub);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: priv,
    x: b64u.encode(point.slice(1, 33)),
    y: b64u.encode(point.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(
    enc.encode(
      JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }),
    ),
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${pub}`;
}

/** RFC 8291 aes128gcm body for one subscription. */
export async function encryptPayload(payload: Bytes, p256dh: string, auth: string, salt?: Bytes) {
  const uaPublic = b64u.decode(p256dh);
  const authSecret = b64u.decode(auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as unknown as Parameters<typeof crypto.subtle.deriveBits>[0],
      local.privateKey,
      256,
    ),
  );
  const prk = await hkdf(
    authSecret,
    shared,
    concat(enc.encode('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(s, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(s, prk, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      concat(payload, new Uint8Array([2])),
    ),
  );
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(s, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// The hosts browsers hand out as PushSubscription.endpoint: Chromium browsers (Chrome,
// Android, Samsung, Opera) → FCM; Firefox → Mozilla autopush; Safari → web.push.apple.com;
// Edge on Windows → WNS (wns2-*.notify.windows.com). Anything else would make Core POST
// to an address a merchant chose.
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];

export function isPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

export type PushResult = { result: 'ok' | 'gone' | 'error'; detail: string | null };

/** 'gone' = the browser dropped the subscription; delete it. */
export async function sendPush(
  target: PushTarget,
  message: object,
): Promise<'ok' | 'gone' | 'error'> {
  return (await sendPushResult(target, message)).result;
}

/** Like sendPush, with a short reason the admin can show when it didn't arrive. */
export async function sendPushResult(target: PushTarget, message: object): Promise<PushResult> {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return { result: 'error', detail: 'push not configured' };
  // rows saved before the allowlist: never sent to, and dropped like an unsubscribed device
  if (!isPushEndpoint(target.endpoint)) return { result: 'gone', detail: 'endpoint not allowed' };
  try {
    const body = await encryptPayload(
      enc.encode(JSON.stringify(message)),
      target.p256dh,
      target.auth,
    );
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuth(
          target.endpoint,
          pub,
          priv,
          process.env.VAPID_SUBJECT ?? 'mailto:suporte@vendua.com.br',
        ),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '300',
        urgency: 'high',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) return { result: 'error', detail: 'redirect' };
    if (res.status === 404 || res.status === 410)
      return { result: 'gone', detail: `push service ${res.status}` };
    return res.ok
      ? { result: 'ok', detail: null }
      : { result: 'error', detail: `push service ${res.status}` };
  } catch (err) {
    const name = (err as { name?: string }).name;
    return { result: 'error', detail: name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}

/** Which browser family a subscription lives in — push_subscriptions keeps no user agent. */
export function pushServiceLabel(endpoint: string): string {
  let host = '';
  try {
    host = new URL(endpoint).host;
  } catch {
    return 'Navegador';
  }
  if (host.endsWith('push.apple.com')) return 'Safari (iPhone/Mac)';
  if (host.endsWith('googleapis.com')) return 'Chrome/Android';
  if (host.endsWith('mozilla.com')) return 'Firefox';
  if (host.endsWith('notify.windows.com')) return 'Edge/Windows';
  return 'Navegador';
}

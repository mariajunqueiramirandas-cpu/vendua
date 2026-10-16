import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { connect, type ClientHttp2Session } from 'node:http2';
import type { PushResult } from './webpush.ts';

// The admin app's order alerts (ADR 0044 §5), straight to Apple and Google with no SDK:
// APNs over HTTP/2 with an ES256 provider token, FCM HTTP v1 with a service account's OAuth
// token. The app draws the alert itself (its own chime, "Aceitar" from the lock screen), so the
// message carries the same { title, body, tag, url, actions } a web push does. Secrets:
//   APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (the bundle id), APNS_SANDBOX=1 for
//   development builds; FCM_SERVICE_ACCOUNT_JSON. Without them that platform's alerts are off.

export interface NativeMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
  orderId?: string;
  threadId?: string;
  actions?: { action: string; title: string }[];
}

export interface NativeDevice {
  id: string;
  platform: 'ios' | 'android';
  token: string;
}

const raw = (v: string | undefined) => (v ?? '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2');

// ── APNs ───────────────────────────────────────────────────────────────────

type Apns = { key: KeyObject; keyId: string; teamId: string; topic: string; host: string };
let apnsParsed: { from: string; cfg: Apns | null } | null = null;

export function apnsConfig(): Apns | null {
  const p8 = raw(process.env.APNS_KEY_P8).replace(/\\n/g, '\n');
  const keyId = raw(process.env.APNS_KEY_ID);
  const teamId = raw(process.env.APNS_TEAM_ID);
  const topic = raw(process.env.APNS_TOPIC);
  const host =
    process.env.APNS_SANDBOX === '1' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const from = [p8, keyId, teamId, topic, host].join('|');
  if (apnsParsed?.from === from) return apnsParsed.cfg;
  let cfg: Apns | null = null;
  if (p8 && keyId && teamId && topic)
    try {
      cfg = { key: createPrivateKey(p8), keyId, teamId, topic, host };
    } catch {
      cfg = null;
    }
  apnsParsed = { from, cfg };
  return cfg;
}

let providerToken: { token: string; at: number; for: string } | null = null;

/** Apple wants the same token reused for 20–60 minutes, not one per push. */
function apnsJwt(cfg: Apns): string {
  const now = Math.floor(Date.now() / 1000);
  const forKey = `${cfg.teamId}|${cfg.keyId}`;
  if (providerToken && providerToken.for === forKey && now - providerToken.at < 40 * 60)
    return providerToken.token;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'ES256', kid: cfg.keyId })}.${b64({ iss: cfg.teamId, iat: now })}`;
  const sig = sign('sha256', Buffer.from(head), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  providerToken = { token: `${head}.${sig.toString('base64url')}`, at: now, for: forKey };
  return providerToken.token;
}

let h2: { host: string; session: ClientHttp2Session } | null = null;
function apnsSession(host: string): ClientHttp2Session {
  if (h2 && h2.host === host && !h2.session.closed && !h2.session.destroyed) return h2.session;
  const session = connect(`https://${host}`);
  session.on('error', () => session.destroy());
  // an idle connection is closed by Apple after a while: open a new one on the next push
  session.setTimeout(10 * 60_000, () => session.close());
  h2 = { host, session };
  return session;
}

/** What iOS shows and how loud (ADR 0044 §5): the kitchen chime and time-sensitive delivery
 *  for what needs the store now (a new order, a waiting shopper), the default sound otherwise. */
export function apnsPayload(m: NativeMessage) {
  const urgent = m.tag.startsWith('order-') || (m.tag.startsWith('vendedor-') && !!m.threadId);
  const category = m.actions?.some((a) => a.action === 'accept')
    ? 'ORDER'
    : m.actions?.some((a) => a.action === 'take')
      ? 'THREAD'
      : undefined;
  return {
    aps: {
      alert: { title: m.title, body: m.body },
      sound: m.tag.startsWith('order-') ? 'pedido-novo.caf' : 'default',
      'interruption-level': urgent ? 'time-sensitive' : 'active',
      'thread-id': m.tag,
      ...(category ? { category } : {}),
    },
    url: m.url,
    tag: m.tag,
    ...(m.orderId ? { orderId: m.orderId } : {}),
    ...(m.threadId ? { threadId: m.threadId } : {}),
  };
}

const APNS_GONE = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

async function sendApns(token: string, m: NativeMessage): Promise<PushResult> {
  const cfg = apnsConfig();
  if (!cfg) return { result: 'error', detail: 'apns not configured' };
  if (!/^[0-9a-f]{64,200}$/i.test(token)) return { result: 'gone', detail: 'bad apns token' };
  const body = JSON.stringify(apnsPayload(m));
  return new Promise<PushResult>((done) => {
    let session: ClientHttp2Session;
    try {
      session = apnsSession(cfg.host);
    } catch {
      return done({ result: 'error', detail: 'network error' });
    }
    const req = session.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsJwt(cfg)}`,
      'apns-topic': cfg.topic,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      // an alert nobody saw within the hour is stale (WhatsApp takes over for orders)
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
      // a newer alert for the same order or conversation replaces the old one
      'apns-collapse-id': m.tag.slice(0, 64),
      'content-type': 'application/json',
    });
    let status = 0;
    let text = '';
    const timer = setTimeout(() => {
      req.close();
      done({ result: 'error', detail: 'timeout' });
    }, 10_000);
    req.on('response', (h) => void (status = Number(h[':status'])));
    req.setEncoding('utf8');
    req.on('data', (d: string) => void (text += d));
    req.on('end', () => {
      clearTimeout(timer);
      if (status === 200) return done({ result: 'ok', detail: null });
      let reason = '';
      try {
        reason = (JSON.parse(text) as { reason?: string }).reason ?? '';
      } catch {
        /* no body */
      }
      if (status === 410 || APNS_GONE.has(reason))
        return done({ result: 'gone', detail: `apns ${status}${reason ? `: ${reason}` : ''}` });
      done({ result: 'error', detail: `apns ${status}${reason ? `: ${reason}` : ''}` });
    });
    req.on('error', () => {
      clearTimeout(timer);
      done({ result: 'error', detail: 'network error' });
    });
    req.end(body);
  });
}

// ── FCM ────────────────────────────────────────────────────────────────────

type Fcm = { projectId: string; clientEmail: string; key: KeyObject; tokenUri: string };
let fcmParsed: { from: string; cfg: Fcm | null } | null = null;

export function fcmConfig(): Fcm | null {
  const json = raw(process.env.FCM_SERVICE_ACCOUNT_JSON);
  if (fcmParsed?.from === json) return fcmParsed.cfg;
  let cfg: Fcm | null = null;
  if (json)
    try {
      const sa = JSON.parse(json) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
        token_uri?: string;
      };
      if (sa.project_id && sa.client_email && sa.private_key)
        cfg = {
          projectId: sa.project_id,
          clientEmail: sa.client_email,
          key: createPrivateKey(sa.private_key),
          tokenUri: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
        };
    } catch {
      cfg = null;
    }
  fcmParsed = { from: json, cfg };
  return cfg;
}

let access: { token: string; until: number; for: string } | null = null;

async function fcmAccessToken(cfg: Fcm): Promise<string> {
  if (access && access.for === cfg.clientEmail && access.until > Date.now() + 60_000)
    return access.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: cfg.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: cfg.tokenUri,
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = sign('sha256', Buffer.from(head), cfg.key).toString('base64url');
  const res = await fetch(cfg.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${head}.${sig}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`fcm oauth ${res.status}`);
  const out = (await res.json()) as { access_token: string; expires_in: number };
  access = {
    token: out.access_token,
    until: Date.now() + out.expires_in * 1000,
    for: cfg.clientEmail,
  };
  return access.token;
}

/** Data only: the app's own handler draws the alert, with the "Pedidos novos" channel's chime
 *  and vibration and its own "Aceitar" (ADR 0044 §5). FCM data values are strings. */
export function fcmMessage(token: string, m: NativeMessage) {
  const data: Record<string, string> = {
    title: m.title,
    body: m.body,
    tag: m.tag,
    url: m.url,
    ...(m.orderId ? { orderId: m.orderId } : {}),
    ...(m.threadId ? { threadId: m.threadId } : {}),
    ...(m.actions?.length ? { actions: JSON.stringify(m.actions) } : {}),
  };
  return {
    message: {
      token,
      data,
      android: { priority: 'high', ttl: '3600s', collapse_key: m.tag.slice(0, 64) },
    },
  };
}

async function sendFcm(token: string, m: NativeMessage): Promise<PushResult> {
  const cfg = fcmConfig();
  if (!cfg) return { result: 'error', detail: 'fcm not configured' };
  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await fcmAccessToken(cfg)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(fcmMessage(token, m)),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (res.ok) return { result: 'ok', detail: null };
    const text = await res.text().catch(() => '');
    // the app was uninstalled or its token rotated: FCM says UNREGISTERED (404), or the token
    // itself is malformed (400 with a registration-token message)
    if (
      res.status === 404 ||
      /UNREGISTERED/.test(text) ||
      (res.status === 400 && /registration token/i.test(text))
    )
      return { result: 'gone', detail: `fcm ${res.status}` };
    return { result: 'error', detail: `fcm ${res.status}` };
  } catch (err) {
    const name = (err as { name?: string }).name;
    return { result: 'error', detail: name === 'TimeoutError' ? 'timeout' : 'network error' };
  }
}

// ── both ───────────────────────────────────────────────────────────────────

/** Which app platforms Core can reach (GET /session `push`). */
export const nativePushConfigured = () => ({ ios: !!apnsConfig(), android: !!fcmConfig() });

/** 'gone' = the app was uninstalled or its token is dead: delete the device. */
export async function sendNativeResult(d: NativeDevice, m: NativeMessage): Promise<PushResult> {
  return d.platform === 'ios' ? sendApns(d.token, m) : sendFcm(d.token, m);
}

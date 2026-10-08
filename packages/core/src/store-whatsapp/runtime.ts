import { createDecipheriv } from 'node:crypto';
import type { Logger } from 'pino';
import type { BufferCodec } from './auth-store.ts';
import {
  ON_DEMAND_SYNC,
  type Creds,
  type SocketKeys,
  type MediaLimits,
  type WaMessage,
  type WaRuntime,
  type WaSocket,
} from './session.ts';

// The real baileys behind WaRuntime. Loaded once per process; tests use a fake runtime.

interface Baileys {
  default: (opts: Record<string, unknown>) => WaSocket;
  Browsers: { ubuntu(browser: string): [string, string, string] };
  BufferJSON: BufferCodec;
  initAuthCreds(): Creds;
  makeCacheableSignalKeyStore(store: SocketKeys, logger?: Logger): SocketKeys;
  normalizeMessageContent(content: unknown): unknown;
  getMediaKeys(
    mediaKey: Uint8Array | string,
    type: string,
  ): Promise<{ iv: Uint8Array; cipherKey: Uint8Array }>;
  fetchLatestWaWebVersion(opts?: RequestInit): Promise<{
    version: [number, number, number];
    isLatest: boolean;
    error?: unknown;
  }>;
  isJidGroup(jid: string | undefined): boolean | undefined;
  isJidBroadcast(jid: string | undefined): boolean | undefined;
  isJidNewsletter(jid: string | undefined): boolean | undefined;
  proto: { HistorySync: { HistorySyncType: Record<string, number> } };
}

const VERSION_TTL_MS = 60 * 60_000;
const MEDIA_HOST = 'mmg.whatsapp.net';
/** the 10-byte MAC WhatsApp appends, plus at most one block of padding */
const CIPHER_OVERHEAD = 26;

export interface MediaRef {
  type: 'audio' | 'image';
  url: string;
  mediaKey: Uint8Array | string;
}

class MediaHttpError extends Error {
  constructor(readonly status: number) {
    super(`media fetch failed (${status})`);
  }
}

const officialHost = (u: URL) =>
  u.protocol === 'https:' && !u.port && !u.username && u.hostname.endsWith('.whatsapp.net');

/** Where a media message's bytes are, only ever on WhatsApp's own CDN. The url and directPath are
 *  the sender's to set, and baileys fetches whatever host they name. */
export function mediaRef(content: unknown): MediaRef | null {
  if (!content || typeof content !== 'object') return null;
  for (const type of ['audio', 'image'] as const) {
    const m = (content as Record<string, unknown>)[`${type}Message`] as
      { url?: unknown; directPath?: unknown; mediaKey?: unknown } | null | undefined;
    if (!m || typeof m !== 'object') continue;
    const key = m.mediaKey;
    if (!(key instanceof Uint8Array) && !(typeof key === 'string' && key)) return null;
    let host = MEDIA_HOST;
    if (typeof m.url === 'string' && m.url) {
      const u = URL.canParse(m.url) ? new URL(m.url) : null;
      if (!u || !officialHost(u)) return null;
      host = u.hostname;
    }
    const raw =
      typeof m.directPath === 'string' && m.directPath.startsWith('/')
        ? `https://${host}${m.directPath}`
        : typeof m.url === 'string'
          ? m.url
          : null;
    const url = raw && URL.canParse(raw) ? new URL(raw) : null;
    return url && officialHost(url) && url.hostname === host
      ? { type, url: url.href, mediaKey: key }
      : null;
  }
  return null;
}

/** GET the url, reading at most `maxBytes` (after any decompression) before giving up. */
export async function fetchCapped(
  url: string,
  { maxBytes, signal }: MediaLimits,
  doFetch: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Uint8Array> {
  const res = await doFetch(url, { signal, headers: { Origin: 'https://web.whatsapp.com' } });
  const body = res.body;
  if (!res.ok || Number(res.headers.get('content-length') ?? 0) > maxBytes) {
    await body?.cancel().catch(() => undefined);
    if (!res.ok) throw new MediaHttpError(res.status);
    throw new Error('media over the size cap');
  }
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > maxBytes) throw new Error('media over the size cap');
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    throw e;
  }
  return Buffer.concat(parts, n);
}

export async function baileysRuntime(log: Logger): Promise<WaRuntime> {
  const b = (await import('baileys')) as unknown as Baileys;
  let version: { v: [number, number, number] | null; at: number } = { v: null, at: 0 };
  // WhatsApp rejects stale web clients at login (405): look the live version up, at most hourly,
  // and fall back to the one bundled with baileys when the lookup fails
  const currentVersion = async () => {
    if (Date.now() - version.at < VERSION_TTL_MS) return version.v;
    try {
      const res = await b.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8_000) });
      version = { v: res.isLatest ? res.version : version.v, at: Date.now() };
      if (!res.isLatest) log.warn({ err: res.error }, 'wa web version lookup failed — bundled');
    } catch (e) {
      log.warn({ err: e }, 'wa web version fetch failed — bundled');
      version = { v: version.v, at: Date.now() - VERSION_TTL_MS + 5 * 60_000 };
    }
    return version.v;
  };
  const level = process.env.BAILEYS_LOG_LEVEL ?? 'warn';
  // the first sync after linking carries the LID↔number map baileys needs to address chats; the
  // store's message history (recent, full) is none of our business and costs memory. On demand
  // only while a new contact's check waits for its own chat's answer
  const T = b.proto.HistorySync.HistorySyncType;
  if (T.ON_DEMAND !== ON_DEMAND_SYNC) throw new Error('baileys ON_DEMAND sync type moved');
  const skipped = new Set([T.RECENT, T.FULL]);
  return {
    codec: b.BufferJSON,
    initCreds: () => b.initAuthCreds(),
    normalize: (m) => b.normalizeMessageContent(m),
    download: async (message, sock, logger, limits) => {
      const once = async (m: WaMessage) => {
        const ref = mediaRef(b.normalizeMessageContent(m.message));
        if (!ref) throw new Error('media not on whatsapp');
        const enc = await fetchCapped(ref.url, {
          maxBytes: limits.maxBytes + CIPHER_OVERHEAD,
          signal: limits.signal,
        });
        if (enc.byteLength <= 10) return new Uint8Array();
        const { cipherKey, iv } = await b.getMediaKeys(ref.mediaKey, ref.type);
        const d = createDecipheriv('aes-256-cbc', cipherKey, iv);
        return Buffer.concat([d.update(enc.subarray(0, enc.byteLength - 10)), d.final()]);
      };
      try {
        return await once(message);
      } catch (e) {
        // an expired link: the sender's phone uploads it again
        if (!(e instanceof MediaHttpError) || (e.status !== 404 && e.status !== 410)) throw e;
        logger.info({ key: message.key }, 'media link expired — asking for a reupload');
        return once(await sock.updateMediaMessage(message));
      }
    },
    connect: async ({ creds, keys, logger, getMessage, wantsOnDemand, syncHistory }) => {
      const v = await currentVersion();
      const socketLog = logger.child({ mod: 'baileys' }, { level });
      return b.default({
        ...(v ? { version: v } : {}),
        auth: { creds, keys: b.makeCacheableSignalKeyStore(keys, socketLog) },
        // the canonical OS label: WhatsApp validates it strictly when linking by code
        browser: b.Browsers.ubuntu('Chrome'),
        logger: socketLog,
        // an "online" linked device silences the merchant's phone notifications — never claim it
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: ({ syncType }: { syncType?: number | null }) =>
          syncType === T.ON_DEMAND
            ? !!wantsOnDemand?.()
            : // a platform number imports its recent chats at pairing (the CRM's leads), as
              // Core's socket did on Baileys' defaults: everything but the FULL sync
              syncHistory?.()
              ? syncType !== T.FULL
              : !skipped.has(syncType ?? -1),
        // groups, broadcasts and channels are never decrypted
        shouldIgnoreJid: (jid: string) =>
          !!(b.isJidGroup(jid) || b.isJidBroadcast(jid) || b.isJidNewsletter(jid)),
        // each pairing ref lives a minute; WhatsApp still ends the window at ~3½ min
        qrTimeout: 60_000,
        generateHighQualityLinkPreview: false,
        getMessage,
      });
    },
  };
}

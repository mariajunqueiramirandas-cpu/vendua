import type { Logger } from 'pino';
import type { BufferCodec } from './auth-store.ts';
import type { Creds, SocketKeys, WaRuntime, WaSocket } from './session.ts';

// The real baileys behind WaRuntime. Loaded once per process; tests use a fake runtime.

interface Baileys {
  default: (opts: Record<string, unknown>) => WaSocket;
  Browsers: { ubuntu(browser: string): [string, string, string] };
  BufferJSON: BufferCodec;
  initAuthCreds(): Creds;
  makeCacheableSignalKeyStore(store: SocketKeys, logger?: Logger): SocketKeys;
  normalizeMessageContent(content: unknown): unknown;
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
  // store's message history (recent, full, on demand) is none of our business and costs memory
  const T = b.proto.HistorySync.HistorySyncType;
  const skipped = new Set([T.RECENT, T.FULL, T.ON_DEMAND]);
  return {
    codec: b.BufferJSON,
    initCreds: () => b.initAuthCreds(),
    normalize: (m) => b.normalizeMessageContent(m),
    connect: async ({ creds, keys, logger, getMessage }) => {
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
          !skipped.has(syncType ?? -1),
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

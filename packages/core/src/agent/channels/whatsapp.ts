import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';
import { controlTx } from '../../modules/control.ts';
import { emitControlEvent } from '../../modules/control-events.ts';
import { log } from '../../platform/log.ts';

const waLog = log.child({ mod: 'whatsapp' });

// baileys v7 in-process; auth state persists in wa_auth_state (survives
// restarts/redeploys with no filesystem). 'log' is the zero-credential dev driver.

interface BaileysSocket {
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string } }>;
  /** free server-side existence probe — the autocontact gate verifies numbers through it */
  onWhatsApp(jid: string): Promise<{ jid: string; exists: boolean }[] | undefined>;
  end(err?: Error): void;
  /** QR-scan alternative — only valid while the socket is unregistered (pre-'open') */
  requestPairingCode(phone: string): Promise<string>;
  /** server-side unpair — the socket then closes with a 401 (no auto-reconnect) */
  logout(): Promise<unknown>;
  /** The account once `open` — id/phoneNumber are jids ('5511…:dev@s.whatsapp.net'). */
  user?: { id?: string; phoneNumber?: string; name?: string } | undefined;
  ev: {
    on(
      event: 'connection.update',
      cb: (u: {
        connection?: string;
        qr?: string;
        /** QR pair confirmed server-side — whatsapp drops the stream with a 515 right after */
        isNewLogin?: boolean;
        lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      }) => void,
    ): void;
    on(event: 'creds.update', cb: () => void): void;
    on(
      event: 'messages.upsert',
      cb: (m: {
        type: string;
        messages: {
          key?: {
            remoteJid?: string;
            remoteJidAlt?: string;
            id?: string;
            fromMe?: boolean;
          };
          message?: unknown;
          pushName?: string;
        }[];
      }) => void,
    ): void;
    on(
      event: 'messaging-history.set',
      cb: (m: {
        chats?: unknown[];
        contacts?: { id?: string; name?: string; notify?: string; verifiedName?: string }[];
        messages?: {
          key?: {
            remoteJid?: string;
            remoteJidAlt?: string;
            id?: string;
            fromMe?: boolean;
          };
          message?: unknown;
          messageTimestamp?: number | string | { toNumber(): number };
          pushName?: string;
        }[];
        lidPnMappings?: { lid?: string; pn?: string }[];
        isLatest?: boolean;
        progress?: number;
        syncType?: number;
      }) => void,
    ): void;
  };
}

let socket: BaileysSocket | null = null;
let starting: Promise<BaileysSocket> | null = null;
// config fingerprint + gen of the in-flight start — a mismatched ensureSocket
// bumps startGen so the stale start self-terminates before publishing globals
let startingFingerprint: string | null = null;
let startingGen = 0;
let startGen = 0;
// last state the socket reported — 'off' when none runs or the session dropped/logged out
let connState: 'off' | 'connecting' | 'qr' | 'open' = 'off';
// socket owning the live reg stream — pairCode binds to this identity so a
// dead predecessor's 'qr' can't arm a code on the connecting replacement
let qrSocket: BaileysSocket | null = null;
// one-shot waiters resolved on each connState transition — pairCode parks on them
const connWaiters = new Set<() => void>();
function notifyConnWaiters() {
  for (const w of connWaiters) w();
  connWaiters.clear();
}
function waitForConnChange(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      connWaiters.delete(onFire);
      resolve();
    }, ms);
    const onFire = () => {
      clearTimeout(t);
      resolve();
    };
    connWaiters.add(onFire);
  });
}
// paired account once the socket is 'open' — lets Config show WHO is connected
let waMe: { phone: string | null; name: string | null } | null = null;
// held while any logoutWa is queued or running: nothing may install a socket
// or commit an auth write that would resurrect the wiped session
let loggingOut = false;
// in-flight auth writes — logoutWa drains them before wiping (a late commit
// would resurrect the session)
const pendingAuthWrites = new Set<Promise<unknown>>();
function trackAuthWrite<T>(p: Promise<T>): Promise<T> {
  pendingAuthWrites.add(p);
  void p.then(
    () => pendingAuthWrites.delete(p),
    () => pendingAuthWrites.delete(p),
  );
  return p;
}
export function waStatus(): string {
  return connState;
}

/** free existence probe — 'true' upgrades a derived number to verified;
 *  null = can't tell (never a negative). Never boots the socket. */
export async function whatsappRegistered(phone: string): Promise<boolean | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  const sock = socket;
  if (!sock || connState !== 'open') return null;
  try {
    // bounded wait — baileys's own ~60s timeout would hold discovery hostage
    const res = await Promise.race([
      sock.onWhatsApp(`${digits}@s.whatsapp.net`),
      new Promise<undefined>((r) => setTimeout(r, 8000)),
    ]);
    if (res === undefined) return null;
    return Boolean(res[0]?.exists);
  } catch (e) {
    waLog.warn({ err: e }, 'onWhatsApp probe failed');
    return null;
  }
}
export function waIdentity(): { phone: string | null; name: string | null } | null {
  return waMe;
}
// identity of the integration that opened `socket` — config changes must close it
let socketFingerprint: string | null = null;
let socketAccountId: string | null = null;
// generation bumped on each ownership transition — wa_qr is one global row and
// upserts drop strictly-older gens; wall-clock seeded + counter breaks same-ms ties
let waGen = 0;
function nextWaGen(): number {
  return (waGen = Math.max(Date.now(), waGen + 1));
}

function fingerprintOf(integration: IntegrationRow): string {
  return `${integration.id}:${(integration.config.accountId as string) ?? 'default'}:${integration.updated_at}`;
}

// a `me` only counts once pairing is server-confirmed (registered || account)
// — persisting an unconfirmed `me` forces the next start into a LOGIN → 401 dead-end
function pairingConfirmed(creds: { registered?: boolean; account?: unknown }): boolean {
  return !!creds.registered || !!creds.account;
}

type MessageHandler = (
  jid: string,
  text: string,
  providerId: string | null,
  pushName?: string,
  /** sender's complementary address (LID↔PN) so persistence converges a contact first seen under the other alias */
  altJid?: string,
) => Promise<void>;

const handlers: MessageHandler[] = [];
export function onInboundMessage(fn: MessageHandler) {
  handlers.push(fn);
}

// one message out of a messaging-history.set chunk — fromMe = the account's own echo, never answered
export interface HistoryMessage {
  jid: string;
  text: string;
  providerId: string;
  fromMe: boolean;
  pushName?: string;
  altJid?: string;
  sentAt?: Date;
}
type HistoryHandler = (m: HistoryMessage) => Promise<void>;
const historyHandlers: HistoryHandler[] = [];
// pairing-time sync is the only source of pre-socket messages; chunks dedupe by providerMessageId downstream
export function onHistoryMessage(fn: HistoryHandler) {
  historyHandlers.push(fn);
}

// one drain queue for every socket's history chunks — serializing keeps
// concurrent drains on the same unknown contact from minting duplicate leads
let historyTail: Promise<void> = Promise.resolve();

// DB-backed auth state — creds/signal keys round-trip through BufferJSON so Buffers survive jsonb
function dbAuthState(
  sql: Sql,
  accountId: string,
  bufferJSON: {
    replacer(k: string, v: unknown): unknown;
    reviver(k: string, v: unknown): unknown;
  },
) {
  return {
    read: async (category: string, name: string) => {
      const rows = await controlTx(
        sql,
        (tx) =>
          tx<
            { data: string }[]
          >`select data from wa_auth_state where account_id = ${accountId} and category = ${category} and name = ${name}`,
      );
      const raw = rows[0]?.data;
      if (raw == null) return null;
      return JSON.parse(JSON.stringify(raw), bufferJSON.reviver);
    },
    write: async (category: string, name: string, data: unknown) => {
      // during logoutWa the table delete must be the last write — writes no-op
      // in the window, in-flight ones get drained there
      if (loggingOut) return;
      const serialized = JSON.parse(JSON.stringify(data, bufferJSON.replacer));
      await trackAuthWrite(
        controlTx(
          sql,
          (tx) =>
            tx`insert into wa_auth_state (account_id, category, name, data)
               values (${accountId}, ${category}, ${name}, ${tx.json(serialized as never)})
               on conflict (account_id, category, name) do update set data = excluded.data`,
        ),
      );
    },
    delete: async (category: string, name: string) => {
      if (loggingOut) return;
      await trackAuthWrite(
        controlTx(
          sql,
          (tx) =>
            tx`delete from wa_auth_state where account_id = ${accountId} and category = ${category} and name = ${name}`,
        ),
      );
    },
  };
}

async function startSocket(sql: Sql, integration: IntegrationRow): Promise<BaileysSocket> {
  const myGen = startGen;
  const baileys = (await import('baileys')) as unknown as {
    default: (opts: Record<string, unknown>) => BaileysSocket;
    Browsers: { ubuntu(browser: string): [string, string, string] };
    initAuthCreds(): unknown;
    fetchLatestWaWebVersion(opts?: RequestInit): Promise<{
      version: [number, number, number];
      isLatest: boolean;
      error?: unknown;
    }>;
    BufferJSON: {
      replacer(k: string, v: unknown): unknown;
      reviver(k: string, v: unknown): unknown;
    };
    /** unwraps ephemeral/viewOnce/edited/documentWithCaption envelopes to the inner content */
    normalizeMessageContent(content: unknown): unknown;
  };
  const accountId = (integration.config.accountId as string) ?? 'default';
  const auth = dbAuthState(sql, accountId, baileys.BufferJSON);

  // fetch the live WA Web version — whatsapp rejects stale clients at
  // link/login (405); bounded timeout, bundled default on failure
  let version: [number, number, number] | undefined;
  try {
    const res = await baileys.fetchLatestWaWebVersion({ signal: AbortSignal.timeout(8_000) });
    if (res.isLatest) {
      version = res.version;
    } else {
      waLog.warn({ err: res.error }, 'wa web version lookup failed — using bundled default');
    }
  } catch (e) {
    waLog.warn({ err: e }, 'wa web version fetch failed — using bundled default');
  }

  // strip unconfirmed creds.me at load and in the writes below — see
  // pairingConfirmed; a QR-confirmed me survives so the 515 restart comes back through LOGIN
  const creds = ((await auth.read('creds', 'main')) ?? baileys.initAuthCreds()) as {
    registered?: boolean;
    account?: unknown;
    me?: unknown;
    platform?: unknown;
    signalIdentities?: unknown;
  };
  // 'account' without 'me' is legacy residue — drop it or it falsely
  // confirms the next provisional claim into the same 401 loop
  if (!creds.registered && creds.account && !creds.me) {
    waLog.warn('dropping orphaned creds.account — legacy incomplete QR state');
    delete creds.account;
  }
  if (!pairingConfirmed(creds)) {
    if (creds.me) {
      waLog.warn('dropping unconfirmed creds.me — would force a 401 login');
    }
    delete creds.me;
  }
  waLog.info({ accountId, version: version?.join('.') ?? 'bundled' }, 'socket connecting');
  const sock = baileys.default({
    ...(version ? { version } : {}),
    auth: {
      creds,
      keys: {
        // SignalKeyStore contract: id → key map
        get: async (type: string, ids: string[]) => {
          const out: Record<string, unknown> = {};
          for (const id of ids) out[id] = await auth.read(type, id);
          return out;
        },
        set: (data: Record<string, Record<string, unknown | null>>) =>
          Promise.all(
            Object.entries(data).flatMap(([cat, items]) =>
              Object.entries(items).map(([name, v]) =>
                v == null ? auth.delete(cat, name) : auth.write(cat, name, v),
              ),
            ),
          ).then(() => undefined),
      },
    },
    printQRInTerminal: false,
    // canonical OS label — whatsapp validates it strictly in the pairing-code
    // iq (custom labels got dead codes); QR tolerates them
    browser: baileys.Browsers.ubuntu('Chrome'),
    logger: log.child({ mod: 'baileys' }, { level: process.env.BAILEYS_LOG_LEVEL ?? 'warn' }),
  });

  // superseded while awaiting — end rather than publish globals for a stale config
  if (myGen !== startGen) {
    sock.end();
    throw new Error('socket start superseded by newer config');
  }
  // claim globals synchronously — the first connection.update only fires after
  // this returns, so handlers can identity-check and a replaced socket's late
  // close can't erase them
  socket = sock;
  socketFingerprint = fingerprintOf(integration);
  socketAccountId = accountId;
  const gen = nextWaGen();

  sock.ev.on('creds.update', () => {
    if (socket !== sock) return; // stale socket — a replacement owns globals
    if (loggingOut) return; // logoutWa owns the wipe — nothing persists
    const snapshot = { ...creds };
    if (!pairingConfirmed(snapshot)) delete snapshot.me;
    void auth.write('creds', 'main', snapshot);
  });
  sock.ev.on('connection.update', (u) => {
    if (socket !== sock) return; // stale socket — a replacement owns globals
    if (u.qr) {
      if (connState !== 'qr') waLog.info('qr emitted — awaiting scan or pairing code');
      connState = 'qr';
      qrSocket = sock;
      notifyConnWaiters();
      // emit after the QR write lands — the refetch it triggers must read it
      void persistQr(sql, accountId, u.qr, gen).then(() => emitControlEvent('channel.health'));
    }
    if (u.isNewLogin) {
      // the 515 that follows is the expected post-pairing restart — drop the dead QR
      waLog.info('pairing confirmed — whatsapp will restart the socket (515)');
      void persistQr(sql, accountId, null, gen).then(() => emitControlEvent('channel.health'));
    }
    if (u.connection === 'open') {
      connState = 'open';
      qrSocket = null;
      notifyConnWaiters();
      waMe = readIdentity(sock);
      waLog.info({ phone: waMe?.phone, name: waMe?.name }, 'socket open — account linked');
      void persistQr(sql, accountId, null, gen).then(() => emitControlEvent('channel.health'));
    }
    if (u.connection === 'close') {
      connState = 'off';
      qrSocket = null;
      notifyConnWaiters();
      socket = null;
      starting = null;
      socketFingerprint = null;
      socketAccountId = null;
      waMe = null;
      emitControlEvent('channel.health');
      // 401 = logged out (nothing to reconnect to until re-paired); otherwise
      // restart inbound instead of staying offline until an outbound send reopens it
      const statusCode = u.lastDisconnect?.error?.output?.statusCode;
      if (statusCode === 401) {
        waLog.warn({ statusCode }, 'socket closed by whatsapp (logged out) — re-pair required');
        // drop the server-granted identity so the next start re-registers and
        // can offer a QR (else login → 401 loop); crypto keys stay. Skipped
        // during logoutWa — it deletes the whole table itself.
        if (!loggingOut) {
          const tombstone = { ...creds };
          delete tombstone.me;
          delete tombstone.registered;
          delete tombstone.account;
          delete tombstone.platform;
          delete tombstone.signalIdentities;
          void auth.write('creds', 'main', tombstone);
        }
      } else {
        waLog.info({ statusCode }, 'socket closed — reconnecting in 5s');
      }
      if (statusCode !== 401) {
        setTimeout(() => {
          // re-read the integration — a disabled/re-pointed driver must not
          // come back on the captured config
          void getIntegration(sql, 'whatsapp')
            .then((fresh) => ensureSocket(sql, fresh))
            .catch((e) => waLog.error({ err: e }, 'reconnect failed'));
        }, 5_000);
      }
    }
  });
  sock.ev.on('messages.upsert', ({ type, messages }) => {
    // a detached socket (replaced or post-logout) must not keep delivering — its creds may be wiped
    if (socket !== sock) return;
    // 'append' is real inbound too — stanzas delivered while offline/syncing;
    // providerMessageId dedupes retries downstream
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      const key = m.key;
      // DMs only — group/broadcast JIDs would mint a lead per participant;
      // LID-addressed DMs carry the phone-number jid in remoteJidAlt
      const dm = key ? dmJid(key.remoteJid, key.remoteJidAlt) : null;
      if (!key || key.fromMe || !dm) continue;
      // no provider id = nothing to dedupe a retry on
      if (!key.id) continue;
      const text = extractText(baileys.normalizeMessageContent(m.message) ?? m.message);
      if (!text) continue;
      waLog.info({ from: maskPhone(dm.jid), type }, 'inbound message');
      for (const fn of handlers) {
        void fn(dm.jid, text, key.id, m.pushName, dm.alias);
      }
    }
  });
  sock.ev.on(
    'messaging-history.set',
    ({ messages, contacts, lidPnMappings, progress, isLatest }) => {
      // a detached socket must not keep importing — its creds may be wiped
      if (socket !== sock) return;
      // contact map → fromName fallback when the stanza carries no pushName
      const names = new Map<string, string>();
      for (const c of contacts ?? []) {
        const n = c.name ?? c.notify ?? c.verifiedName;
        if (c.id && n) names.set(c.id, n);
      }
      // LID↔PN pairs from the sync itself — alias when the stanza lacks remoteJidAlt
      const lidPn = new Map<string, string>();
      for (const m of lidPnMappings ?? []) {
        if (m.lid && m.pn) {
          lidPn.set(m.lid, m.pn);
          lidPn.set(m.pn, m.lid);
        }
      }
      // identity comes off the live socket — history can arrive before 'open' populates waMe
      const ownDigits = readIdentity(sock).phone;
      waLog.info(
        { msgs: messages?.length ?? 0, progress, isLatest },
        'history sync chunk received',
      );
      // accepted chunks always drain — ingest is jid-attributed CRM writes
      // needing no creds; teardown can lose it, not corrupt it
      historyTail = historyTail
        .then(async () => {
          for (const m of messages ?? []) {
            try {
              const key = m.key;
              const dm = key ? dmJid(key.remoteJid, key.remoteJidAlt) : null;
              if (!key?.id || !dm) continue;
              // self-chat = the account's own number — never a lead
              if (ownDigits && dm.jid.replace(/\D/g, '') === ownDigits) continue;
              const text = extractText(baileys.normalizeMessageContent(m.message) ?? m.message);
              if (!text) continue;
              // pushName on a fromMe stanza is OUR account name — use the contact map instead
              const pushName = key.fromMe
                ? names.get(key.remoteJid ?? '')
                : (m.pushName ?? names.get(key.remoteJid ?? ''));
              const altJid = dm.alias ?? lidPn.get(dm.jid);
              const sentAt = messageTs(m.messageTimestamp);
              const entry: HistoryMessage = {
                jid: dm.jid,
                text,
                providerId: key.id,
                fromMe: !!key.fromMe,
                ...(pushName ? { pushName } : {}),
                ...(altJid ? { altJid } : {}),
                ...(sentAt ? { sentAt } : {}),
              };
              for (const fn of historyHandlers) {
                // isolate per subscriber — one rejecting consumer must not skip the rest
                try {
                  await fn(entry);
                } catch (e) {
                  waLog.warn({ err: e, id: m.key?.id }, 'history message ingest failed');
                }
              }
            } catch (e) {
              waLog.warn({ err: e, id: m.key?.id }, 'history message ingest failed');
            }
          }
          waLog.info({ progress, isLatest }, 'history sync chunk ingested');
        })
        .catch((e) => waLog.error({ err: e }, 'history sync processing failed'));
    },
  );
  return sock;
}

// proto uint64 seconds → Date; tolerates Long-ish objects and stray ms (>1e12)
function messageTs(ts: number | string | { toNumber(): number } | undefined): Date | undefined {
  const n =
    typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : (ts?.toNumber?.() ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n > 1e12 ? n : n * 1000);
}

// DM jid pair — jid prefers the PN form (@s.whatsapp.net, what lead
// digit-matching wants), alias is the LID↔PN complement; group/broadcast reject
function dmJid(remoteJid?: string, remoteJidAlt?: string): { jid: string; alias?: string } | null {
  const dm = (j?: string) =>
    j && (j.endsWith('@s.whatsapp.net') || j.endsWith('@lid')) ? j : null;
  const a = dm(remoteJid);
  const b = dm(remoteJidAlt);
  const jid = a?.endsWith('@s.whatsapp.net') ? a : (b ?? a);
  if (!jid) return null;
  const alias = jid === a ? b : a;
  return alias && alias !== jid ? { jid, alias } : { jid };
}

// phone digits → '55…9988' for logs — correlatable without full PII
function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d.length > 6 ? `${d.slice(0, 2)}…${d.slice(-4)}` : '…';
}

// '5511…:dev@s.whatsapp.net' / lid jids → bare digits for display
function readIdentity(sock: BaileysSocket): {
  phone: string | null;
  name: string | null;
} {
  const u = sock.user;
  const raw = u?.phoneNumber ?? u?.id;
  const digits = raw?.split('@')[0]?.split(':')[0]?.replace(/\D/g, '');
  return { phone: digits || null, name: u?.name ?? null };
}

function extractText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const conv = m.conversation;
  if (typeof conv === 'string') return conv;
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return ext.text;
  return null;
}

async function persistQr(sql: Sql, accountId: string, qr: string | null, gen: number) {
  await controlTx(
    sql,
    (tx) =>
      tx`insert into control_settings (key, value) values (${'wa_qr'}, ${tx.json({ accountId, qr, gen } as never)})
         on conflict (key) do update set value = excluded.value
         where coalesce((control_settings.value ->> 'gen')::bigint, -1) <= ${gen}`,
  );
}

export async function ensureSocket(
  sql: Sql,
  integration: IntegrationRow | null,
): Promise<BaileysSocket | null> {
  const wanted =
    integration && integration.driver === 'baileys' && integration.enabled
      ? fingerprintOf(integration)
      : null;
  // config changed or driver disabled — close rather than keep sending through the stale account
  if (socket && socketFingerprint !== wanted) {
    waLog.info(
      { accountId: socketAccountId },
      'socket stopped — config changed or driver disabled',
    );
    try {
      socket.end();
    } catch {
      /* closing a dead socket */
    }
    socket = null;
    socketFingerprint = null;
    waMe = null;
    // the detached socket's own close early-returns — reset state here or
    // waStatus()/wa_qr keep reporting a dead socket
    connState = 'off';
    qrSocket = null;
    notifyConnWaiters();
    if (socketAccountId) void persistQr(sql, socketAccountId, null, nextWaGen());
    socketAccountId = null;
    emitControlEvent('channel.health');
  }
  // a pending start for a different config (or a superseded gen — e.g.
  // disable→re-enable mid-start) can't serve this request — bump the gen so
  // startSocket self-terminates, then reconcile once it settles
  const startUsable =
    starting !== null && startingFingerprint === wanted && startingGen === startGen;
  if (starting !== null && !startUsable) {
    startGen++;
    return starting.then(
      () => ensureSocket(sql, integration),
      () => ensureSocket(sql, integration),
    );
  }
  if (!wanted) return null;
  if (loggingOut) throw new Error('whatsapp logout em andamento');
  if (socket) return socket;
  if (!starting) {
    connState = 'connecting';
    qrSocket = null;
    notifyConnWaiters();
    startingFingerprint = wanted;
    startingGen = startGen;
    starting = startSocket(sql, integration!).then(
      (s) => {
        // globals were assigned inside startSocket — only the flag clears here
        starting = null;
        startingFingerprint = null;
        return s;
      },
      (err) => {
        // a failed start must not poison the flag — clear so the next attempt retries
        starting = null;
        startingFingerprint = null;
        connState = 'off';
        qrSocket = null;
        notifyConnWaiters();
        waLog.error({ err }, 'socket start failed');
        throw err;
      },
    );
  }
  return starting;
}

// same-number pair requests share one in-flight call — an overlapping
// requestPairingCode would silently kill the code the first caller is typing
const pairInFlight = new Map<string, Promise<string>>();

// pairing-code alternative to the QR scan — staff types the code in WhatsApp
// (aparelhos conectados → 'conectar com número'); only while unregistered
export async function pairCode(sql: Sql, phone: string): Promise<string> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new Error('número inválido — DDI+DDD+número, só dígitos');
  }
  const pending = pairInFlight.get(digits);
  if (pending) return pending;
  const p = (async () => {
    const deadline = Date.now() + 20_000;
    for (;;) {
      // re-read config + socket every pass — settings can change mid-wait
      const integration = await getIntegration(sql, 'whatsapp');
      const sock = await ensureSocket(sql, integration);
      if (!sock) throw new Error('driver baileys não está ativo');
      if (connState === 'open') throw new Error('whatsapp já está conectado');
      // the link_code iq registers only while the reg stream is live on THIS
      // socket (signaled by its first qr) — earlier sends race the handshake and die
      if (qrSocket === sock) {
        const code = await sock.requestPairingCode(digits);
        // short-lived bearer credential — never log it
        waLog.info({ phone: maskPhone(digits) }, 'pairing code issued');
        return code;
      }
      if (Date.now() >= deadline) {
        throw new Error('whatsapp ainda conectando — tente de novo em alguns segundos');
      }
      await waitForConnChange(Math.max(1, deadline - Date.now()));
    }
  })().finally(() => {
    if (pairInFlight.get(digits) === p) pairInFlight.delete(digits);
  });
  pairInFlight.set(digits, p);
  return p;
}

// logouts serialize on a chain; loggingOut stays held while ANY call is
// queued or running — a socket or auth write in the gap would be wiped mid-flight
let logoutDepth = 0;
let logoutChain: Promise<unknown> = Promise.resolve();

// unpair the linked device + wipe auth state so a different number can pair;
// logout()'s close is a 401 the reconnect logic leaves dead
export function logoutWa(sql: Sql, accountId: string): Promise<void> {
  logoutDepth += 1;
  loggingOut = true;
  const run = logoutChain.then(() => logoutOnce(sql, accountId));
  // swallow for the chain — the caller keeps their `run` result; a failed
  // logout must not poison serialization
  logoutChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    logoutDepth -= 1;
    if (logoutDepth === 0) loggingOut = false;
  });
}

async function logoutOnce(sql: Sql, accountId: string): Promise<void> {
  const s = socket;
  // unlink while the socket is still tracked — a rejected logout() leaves it
  // owned for retry; its close clears globals mid-await under the held flag
  if (s) {
    await s.logout();
  }
  // clear only what s still owns — its close may already have (idempotent)
  if (socket === s) {
    socket = null;
    socketFingerprint = null;
    socketAccountId = null;
    connState = 'off';
    qrSocket = null;
    notifyConnWaiters();
    waMe = null;
  }
  starting = null;
  try {
    s?.end();
  } catch {
    /* already closed */
  }
  // drain pre-flag writes so none commits after the wipe
  await Promise.allSettled([...pendingAuthWrites]);
  await controlTx(sql, async (tx) => {
    await tx`delete from wa_auth_state where account_id = ${accountId}`;
  });
  // gen-guarded clear — a plain delete could race a stale in-flight QR write
  await persistQr(sql, accountId, null, nextWaGen());
  waLog.info({ accountId }, 'logged out — auth state wiped');
}

export async function sendWhatsApp(
  sql: Sql,
  integration: IntegrationRow,
  to: string,
  text: string,
): Promise<string | null> {
  const driver = integration.driver;
  if (driver === 'log') {
    waLog.info({ to, text }, 'log-driver send');
    return `log:${crypto.randomUUID()}`;
  }
  if (driver === 'baileys') {
    const sock = await ensureSocket(sql, integration);
    if (!sock) throw new Error('baileys socket not started');
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    const res = await sock.sendMessage(jid, { text });
    waLog.info({ to: maskPhone(jid), id: res?.key?.id ?? null }, 'message sent');
    return res?.key?.id ?? null;
  }
  throw new Error(`unknown whatsapp driver: ${driver}`);
}

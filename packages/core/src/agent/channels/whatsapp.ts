import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';
import { controlTx } from '../../modules/control.ts';
import { emitControlEvent } from '../../modules/control-events.ts';
import { log } from '../../platform/log.ts';

const waLog = log.child({ mod: 'whatsapp' });

/**
 * agent/channels/whatsapp — Baileys v7, in-process. Auth state persists in
 * the `wa_auth_state` table (DB-backed replacement for the removed
 * useMultiFileAuthState), so session survives restarts/redeploys without a
 * filesystem. `log` driver is the zero-credential dev path.
 */

interface BaileysSocket {
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string } }>;
  /** Server-side existence probe — [{jid, exists}] — free and sends
   *  nothing; the autocontact gate verifies derived numbers through it. */
  onWhatsApp(jid: string): Promise<{ jid: string; exists: boolean }[] | undefined>;
  end(err?: Error): void;
  /** 8-char pairing code as an alternative to scanning the QR — only valid
   *  while the socket is unregistered (pre-`open`). */
  requestPairingCode(phone: string): Promise<string>;
  /** Server-side unpair — WhatsApp drops the linked device, then the
   *  socket closes with a 401 (no auto-reconnect). */
  logout(): Promise<unknown>;
  /** The account once `open` — id/phoneNumber are jids ('5511…:dev@s.whatsapp.net'). */
  user?: { id?: string; phoneNumber?: string; name?: string } | undefined;
  ev: {
    on(
      event: 'connection.update',
      cb: (u: {
        connection?: string;
        qr?: string;
        /** QR pairing confirmed server-side — whatsapp drops the stream
         *  with a 515 right after, and the reconnect must log in. */
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
/** Fingerprint of the config `starting` is building + its generation — a
 *  ensureSocket call wanting something else bumps startGen so the in-flight
 *  startSocket self-terminates before publishing globals for a stale config. */
let startingFingerprint: string | null = null;
let startingGen = 0;
let startGen = 0;
/** Last connection state the socket reported — 'off' when no socket is
 *  running or the session dropped/logged out. The Settings screen renders
 *  this instead of guessing from QR presence. */
let connState: 'off' | 'connecting' | 'qr' | 'open' = 'off';
/** The socket that currently owns a live reg stream — set with connState
 *  'qr', cleared on open/close/replace. pairCode binds its readiness to
 *  this identity: a 'qr' that belonged to a dead predecessor must not arm
 *  a code on the connecting replacement. */
let qrSocket: BaileysSocket | null = null;
/** One-shot waiters resolved on every connState transition — pairCode parks
 *  on them until the reg stream is live. */
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
/** The paired account once the socket is `open` — lets the Config screen
 *  say WHO is connected instead of implying enabled == working. */
let waMe: { phone: string | null; name: string | null } | null = null;
/** Held while any logoutWa call is queued or running: ensureSocket refuses
 *  to install a replacement the wipe would orphan, and auth writes are
 *  no-ops — nothing may commit after the table delete and resurrect the
 *  wiped session. Managed by the logoutDepth refcount inside logoutWa. */
let loggingOut = false;
/** Every write issued through `auth` lands here so logoutWa can drain
 *  in-flight commits before wiping: a write queued before `loggingOut`
 *  went up could otherwise commit after the delete. */
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

/** Free "is this number on WhatsApp" probe over the live socket — a
 *  registered answer upgrades a discovery-derived number to verified so
 *  the autocontact gate can treat it like a real wa.me find. null = can't
 *  tell (socket not open, probe failed): callers keep the number
 *  unverified, never treat it as a negative. Never boots the socket — a
 *  probe isn't worth a handshake. */
export async function whatsappRegistered(phone: string): Promise<boolean | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;
  const sock = socket;
  if (!sock || connState !== 'open') return null;
  try {
    const res = await sock.onWhatsApp(`${digits}@s.whatsapp.net`);
    return Boolean(res?.[0]?.exists);
  } catch (e) {
    waLog.warn({ err: e }, 'onWhatsApp probe failed');
    return null;
  }
}
export function waIdentity(): { phone: string | null; name: string | null } | null {
  return waMe;
}
/** identity of the integration that opened `socket` — config changes must
 *  close it, not keep sending through the old account. */
let socketFingerprint: string | null = null;
let socketAccountId: string | null = null;
/** Socket generation — bumps on every ownership transition. `wa_qr` is a
 *  single global row and last writer wins, so QR writes carry the writer's
 *  gen and the upsert drops strictly-older ones: a detached socket's late
 *  clear can't erase the replacement's fresh QR (or vice versa).
 *  Seeded by the wall clock so a process restart can't collide with the
 *  gen the surviving row carries; the counter breaks same-ms ties. */
let waGen = 0;
function nextWaGen(): number {
  return (waGen = Math.max(Date.now(), waGen + 1));
}

function fingerprintOf(integration: IntegrationRow): string {
  return `${integration.id}:${(integration.config.accountId as string) ?? 'default'}:${integration.updated_at}`;
}

/** A `me` only counts once the pairing is server-confirmed — baileys marks
 *  that two ways: `registered` flips true on the link-code notification
 *  path, `account` is decoded out of the QR pair-success stanza (rc14 never
 *  sets `registered` for QR pairs). A `me` with neither is a pending
 *  requestPairingCode claim: persisting it makes the next start take the
 *  LOGIN branch (creds.me → generateLoginNode) for an account that was
 *  never registered → 401 → dead socket, no QR. */
function pairingConfirmed(creds: { registered?: boolean; account?: unknown }): boolean {
  return !!creds.registered || !!creds.account;
}

type MessageHandler = (
  jid: string,
  text: string,
  providerId: string | null,
  pushName?: string,
  /** The sender's complementary address (the LID when `jid` is the PN form,
   *  or vice versa) so persistence can converge a contact it first saw
   *  under the other alias. */
  altJid?: string,
) => Promise<void>;

const handlers: MessageHandler[] = [];
export function onInboundMessage(fn: MessageHandler) {
  handlers.push(fn);
}

/** One message out of a `messaging-history.set` chunk — already filtered to
 *  DM text the same way the live upsert path filters. `fromMe` marks the
 *  account's own copy (recorded as an outbound echo, never answered). */
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
/** Subscribed once per history event — the pairing-time sync is the ONLY
 *  source of pre-socket messages; chunks arrive a few times per account
 *  lifetime and each is deduped by providerMessageId downstream. */
export function onHistoryMessage(fn: HistoryHandler) {
  historyHandlers.push(fn);
}

/** One queue for every socket's history chunks — Baileys emits several
 *  messaging-history.set events per pairing, each with up to thousands of
 *  stanzas, and a reconnect spawns a fresh socket while old chunks may still
 *  be draining. Serializing through a single tail is what keeps two
 *  concurrent drains carrying the same unknown contact from both missing
 *  the lookup and minting duplicate leads. */
let historyTail: Promise<void> = Promise.resolve();

/** DB-backed auth state. Baileys v7's initAuthCreds() +
 * SignalKeyStore-style read/write map onto our wa_auth_state rows. Creds and
 * signal keys carry Buffers — round-trip through BufferJSON so binary data
 * survives jsonb storage. */
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
      // During logoutWa the table delete must be the last write — a commit
      // landing after it resurrects the dead session, so writes are a no-op
      // for the window and the ones already in flight get drained there.
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
    /** Unwraps ephemeral/viewOnce/edited/documentWithCaption envelopes to
     *  the inner content — rc14 exports it from Utils/messages. */
    normalizeMessageContent(content: unknown): unknown;
  };
  const accountId = (integration.config.accountId as string) ?? 'default';
  const auth = dbAuthState(sql, accountId, baileys.BufferJSON);

  // WhatsApp rejects stale client versions at link/login (405; phone shows
  // "Couldn't link device") — the bundled version lags upstream, so fetch the
  // live WA Web version. Bounded timeout: a hung fetch must not stall the
  // socket. On failure baileys resolves with the bundled default + isLatest
  // false — fall back to it silently-identical to today, just logged.
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

  // Strip an unconfirmed `me` claim at load AND keep it out of the writes
  // below — see pairingConfirmed(). A QR-confirmed `me` (account present)
  // survives: that is what lets the post-pairing 515 restart come back
  // through the LOGIN branch instead of re-emitting a QR.
  const creds = ((await auth.read('creds', 'main')) ?? baileys.initAuthCreds()) as {
    registered?: boolean;
    account?: unknown;
    me?: unknown;
    platform?: unknown;
    signalIdentities?: unknown;
  };
  // `account` without `me` is residue from rows persisted before QR
  // pair-success kept its `me` — it never accompanies a live session (the
  // two are written atomically). Dropped, or it would falsely confirm the
  // next provisional claim into the same 401 loop it just escaped.
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
        // SignalKeyStore contract: id → key map (not an array).
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
    // Canonical OS label — WhatsApp validates companion_platform_display
    // strictly in the pairing-code IQ (400 bad-request, and the un-awaited
    // sendNode still returns a dead code). QR tolerates custom labels; the
    // code path doesn't. Custom branding here is what got us dead codes.
    browser: baileys.Browsers.ubuntu('Chrome'),
    logger: log.child({ mod: 'baileys' }, { level: process.env.BAILEYS_LOG_LEVEL ?? 'warn' }),
  });

  // A newer ensureSocket superseded this start while we awaited — end the
  // socket rather than publishing globals for a stale config.
  if (myGen !== startGen) {
    sock.end();
    throw new Error('socket start superseded by newer config');
  }
  // Claim module state synchronously — Baileys' first connection.update
  // fires on ws connect (always async, after this returns), so by then
  // `socket === sock` and every handler can identity-check against it. A
  // replaced socket's late `close` then can't erase the replacement's
  // globals or report it offline.
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
      // Emit after the QR write lands — the refetch it triggers must read it.
      void persistQr(sql, accountId, u.qr, gen).then(() => emitControlEvent('channel.health'));
    }
    if (u.isNewLogin) {
      // The 515 that follows is the expected post-pairing restart, not a
      // failure — say so in the log and drop the now-dead QR from the UI.
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
      // Baileys 401 = logged out — nothing to reconnect to until re-paired.
      // Otherwise the stream dropped: restart inbound delivery instead of
      // staying offline until an outbound send happens to reopen it.
      const statusCode = u.lastDisconnect?.error?.output?.statusCode;
      if (statusCode === 401) {
        waLog.warn({ statusCode }, 'socket closed by whatsapp (logged out) — re-pair required');
        // The persisted identity is dead: drop the server-granted fields so
        // the next start takes the registration branch and can offer a QR —
        // otherwise every reconnect re-runs login → 401 and re-pairing is
        // impossible without a logout() wipe. Crypto keys stay; only the
        // identity whatsapp granted that session goes. Skipped during
        // logoutWa — it deletes the whole table itself.
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
          // Re-read the integration instead of reconnecting with the config
          // captured at startSocket time — a disabled or re-pointed driver
          // must not come back on the old settings.
          void getIntegration(sql, 'whatsapp')
            .then((fresh) => ensureSocket(sql, fresh))
            .catch((e) => waLog.error({ err: e }, 'reconnect failed'));
        }, 5_000);
      }
    }
  });
  sock.ev.on('messages.upsert', ({ type, messages }) => {
    // A detached socket (replaced or post-logout) must not keep delivering
    // inbound messages — its creds may already be wiped.
    if (socket !== sock) return;
    // 'append' is real inbound too: whatsapp marks stanzas delivered while
    // the socket was offline/still syncing `offline`, and baileys emits them
    // as 'append' upserts. Replay safety comes from providerMessageId dedupe
    // downstream — a notify-only filter silently eats those messages.
    if (type !== 'notify' && type !== 'append') return;
    for (const m of messages) {
      const key = m.key;
      // Only direct chats — group (@g.us) and broadcast JIDs would mint leads
      // for every participant and reply into the group. DMs increasingly
      // arrive addressed by LID ('…@lid'): the phone-number jid then rides
      // in remoteJidAlt, which is the form lead digit-matching needs.
      const dm = key ? dmJid(key.remoteJid, key.remoteJidAlt) : null;
      if (!key || key.fromMe || !dm) continue;
      // No provider id = nothing to dedupe a retry on — skip rather than
      // insert a message we may see again.
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
      // A detached socket (replaced or post-logout) must not keep importing —
      // its creds may already be wiped.
      if (socket !== sock) return;
      // contact map → fromName fallback when the stanza carries no pushName.
      const names = new Map<string, string>();
      for (const c of contacts ?? []) {
        const n = c.name ?? c.notify ?? c.verifiedName;
        if (c.id && n) names.set(c.id, n);
      }
      // LID ↔ PN pairs from the sync itself — an alias when the stanza didn't
      // carry remoteJidAlt.
      const lidPn = new Map<string, string>();
      for (const m of lidPnMappings ?? []) {
        if (m.lid && m.pn) {
          lidPn.set(m.lid, m.pn);
          lidPn.set(m.pn, m.lid);
        }
      }
      // Identity comes off the live socket, not the module cache — history
      // can arrive before connState 'open' populates waMe.
      const ownDigits = readIdentity(sock).phone;
      waLog.info(
        { msgs: messages?.length ?? 0, progress, isLatest },
        'history sync chunk received',
      );
      // The accepted chunk joins the module tail and always drains — the
      // payload is already in-process and ingest needs no creds (it's
      // jid-attributed CRM writes), so teardown can't corrupt it, only lose
      // it. Disconnects and re-pairs never drop received history.
      historyTail = historyTail
        .then(async () => {
          for (const m of messages ?? []) {
            try {
              const key = m.key;
              const dm = key ? dmJid(key.remoteJid, key.remoteJidAlt) : null;
              if (!key?.id || !dm) continue;
              // Self-chat ("mensagens para você mesmo") is the account's own
              // number — never a lead.
              if (ownDigits && dm.jid.replace(/\D/g, '') === ownDigits) continue;
              const text = extractText(baileys.normalizeMessageContent(m.message) ?? m.message);
              if (!text) continue;
              // pushName on a fromMe stanza is OUR account name — a lead minted
              // from it would be named after the sender, not the contact.
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
                // Isolated per subscriber — one rejecting consumer must not
                // skip the entry for the rest.
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

/** proto uint64 seconds → Date; tolerates Long-ish objects and a stray ms
 *  value (anything past 1e12 is already milliseconds). */
function messageTs(ts: number | string | { toNumber(): number } | undefined): Date | undefined {
  const n =
    typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : (ts?.toNumber?.() ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n > 1e12 ? n : n * 1000);
}

/** The direct-chat jid pair for an inbound message: `jid` prefers the
 *  phone-number form (@s.whatsapp.net — the shape lead digit-matching
 *  wants), `alias` is the complementary address when the stanza carried one
 *  (remoteJid '…@lid' ↔ remoteJidAlt PN). A lid-only message still lands —
 *  group/broadcast/newsletter JIDs match neither form and are rejected. */
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

/** Phone digits → '55…9988' for logs — correlatable without full PII. */
function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d.length > 6 ? `${d.slice(0, 2)}…${d.slice(-4)}` : '…';
}

/** '5511…:dev@s.whatsapp.net' / lid jids → bare digits for display. */
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
  // Config changed or driver disabled — the live socket belongs to the old
  // config; close it instead of silently sending through the stale account.
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
    // The detached socket's own close event early-returns (it no longer
    // owns globals) — reset state here or waStatus()/wa_qr keep reporting
    // a socket that no longer exists.
    connState = 'off';
    qrSocket = null;
    notifyConnWaiters();
    if (socketAccountId) void persistQr(sql, socketAccountId, null, nextWaGen());
    socketAccountId = null;
    emitControlEvent('channel.health');
  }
  // A pending start for different config — or one already superseded (its
  // generation is stale even when the fingerprint matches again, e.g.
  // disable→re-enable mid-start) — can't serve this request. Bump the
  // generation so startSocket self-terminates before publishing globals,
  // then reconcile once it settles (also kills a socket that raced to
  // publish).
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
        // globals were assigned inside startSocket — only the flag clears
        starting = null;
        startingFingerprint = null;
        return s;
      },
      (err) => {
        // a failed start must not poison the flag — clear it so the next
        // send/pair attempt can retry.
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

/** Concurrent pair requests for the same number must share one in-flight
 *  call — each requestPairingCode overwrites creds.pairingCode, so an
 *  overlapping call would silently kill the code the first caller is
 *  already typing. Different numbers proceed: last request wins is what a
 *  deliberate "novo código" click means. */
const pairInFlight = new Map<string, Promise<string>>();

/** Pairing-code alternative to scanning the QR — staff enters their number
 *  and types the returned code in WhatsApp → aparelhos conectados →
 *  "conectar com número". Only works while the socket is unregistered. */
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
      // Re-read config and socket every pass — settings can change mid-wait
      // (a stale integration row would revive the old account), and the
      // socket resolved last pass may have been replaced since.
      const integration = await getIntegration(sql, 'whatsapp');
      const sock = await ensureSocket(sql, integration);
      if (!sock) throw new Error('driver baileys não está ativo');
      if (connState === 'open') throw new Error('whatsapp já está conectado');
      // The link_code iq only registers while the server-side reg stream is
      // live on THIS socket — signaled by its own first pair-device (qr).
      // Before that the send races the handshake and dies.
      if (qrSocket === sock) {
        const code = await sock.requestPairingCode(digits);
        // The code is a short-lived bearer credential — never log it.
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

// Logouts serialize on a chain: two concurrent calls must never interleave
// their wipes, and loggingOut has to stay held while ANY call is queued or
// running — a queued call still owns the window, so a replacement socket or
// auth write in that gap would be wiped mid-flight.
let logoutDepth = 0;
let logoutChain: Promise<unknown> = Promise.resolve();

/** Unpair the linked device and wipe stored auth state — the QR/pair flow
 *  can then pair a different number from scratch. logout() tells WhatsApp
 *  the device is gone (its close event is a 401, which the reconnect logic
 *  already leaves dead). */
export function logoutWa(sql: Sql, accountId: string): Promise<void> {
  logoutDepth += 1;
  loggingOut = true;
  const run = logoutChain.then(() => logoutOnce(sql, accountId));
  // Swallow for the chain — the caller still gets their own `run` result,
  // but a failed logout must not poison later calls' serialization.
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
  // Remote unlink while the socket is still tracked — if logout() rejects,
  // `socket` stays owned and `wa_auth_state` survives, so a retry retries
  // the unlink on the same live socket. s's own close event clears globals
  // mid-await; loggingOut is held for the whole wipe so its close can't
  // resurrect anything. A socket that wasn't tracked (null) just wipes.
  if (s) {
    await s.logout();
  }
  // Clear only what's still owned by s — its close event may already have
  // done it (idempotent), and nothing else could install a replacement
  // while the flag was held.
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
  // Writes queued before the flag went up can still be in flight — drain
  // so none commits after the wipe.
  await Promise.allSettled([...pendingAuthWrites]);
  await controlTx(sql, async (tx) => {
    await tx`delete from wa_auth_state where account_id = ${accountId}`;
  });
  // Clear through the gen-guarded path — a plain delete could be followed
  // by a stale in-flight QR write that re-creates the row.
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

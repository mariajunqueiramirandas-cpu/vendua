import type { Logger } from 'pino';
import { LeaseLost, type AuthStore, type BufferCodec } from './auth-store.ts';
import { jidForPhone, phoneForJid, phoneVariants, reconnectDelayMs } from './text.ts';

// One store's linked WhatsApp device. The gateway owns the lifecycle (start, pair, stop,
// logout); this class owns the socket and turns its events into store states. Everything the
// socket does is bounded: a stalled socket never settles its promises.

export type SessionState =
  'off' | 'connecting' | 'pairing' | 'open' | 'logged_out' | 'banned' | 'error';

export interface StateUpdate {
  state: SessionState;
  /** machine reason for the merchant screen: pair_expired, replaced, bad_session, … */
  detail?: string | null;
  phone?: string | null;
  name?: string | null;
  pairCode?: string | null;
  pairCodeExpiresAt?: Date | null;
}

export interface Inbound {
  /** national digits when the sender's number is known, else null */
  phone: string | null;
  text: string;
  id: string;
}

export interface Receipt {
  waId: string;
  status: 'delivered' | 'read';
}

export interface WaKey {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
}

/** The slice of a baileys socket the gateway uses — tests drive a fake with the same shape. */
export interface WaSocket {
  ev: {
    on(event: 'connection.update', cb: (u: ConnectionUpdate) => void): void;
    on(event: 'creds.update', cb: () => void): void;
    on(
      event: 'messages.upsert',
      cb: (m: { type: string; messages: { key?: WaKey; message?: unknown }[] }) => void,
    ): void;
    on(
      event: 'messages.update',
      cb: (u: { key?: WaKey; update?: { status?: number | null } }[]) => void,
    ): void;
  };
  user?: { id?: string; phoneNumber?: string; name?: string } | undefined;
  signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null> } };
  requestPairingCode(phone: string): Promise<string>;
  onWhatsApp(...jids: string[]): Promise<{ jid: string; exists: boolean }[] | undefined>;
  sendMessage(
    jid: string,
    content: { text: string },
    opts?: { messageId?: string },
  ): Promise<{ key?: { id?: string | null } } | undefined>;
  logout(): Promise<unknown>;
  end(err?: Error): void;
}

export interface ConnectionUpdate {
  connection?: string;
  qr?: string;
  isNewLogin?: boolean;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } | Error };
}

export interface Creds {
  registered?: boolean;
  account?: unknown;
  me?: unknown;
  [k: string]: unknown;
}

export interface SocketKeys {
  get(type: string, ids: string[]): Promise<Record<string, unknown>>;
  set(data: Record<string, Record<string, unknown | null>>): Promise<void>;
}

/** What the process needs from baileys: fresh creds, the Buffer codec and a socket. */
export interface WaRuntime {
  codec: BufferCodec;
  initCreds(): Creds;
  connect(opts: {
    creds: Creds;
    keys: SocketKeys;
    logger: Logger;
    getMessage: (key: WaKey) => Promise<{ conversation: string } | undefined>;
  }): Promise<WaSocket>;
  normalize(message: unknown): unknown;
}

export interface SessionHooks {
  onState(u: StateUpdate): void;
  onInbound(m: Inbound): void;
  onReceipts(r: Receipt[]): void;
  /** the fence failed: another gateway owns this store now */
  onLeaseLost(): void;
  /** text of a message we sent, for WhatsApp's resend-on-decrypt-failure */
  messageText(waId: string): Promise<string | null>;
  /** wipe this store's login (logout, logged out by the phone, fresh pairing) */
  wipe(): Promise<void>;
}

export class NotOnWhatsApp extends Error {
  constructor() {
    super('number is not on whatsapp');
  }
}

export class SessionClosed extends Error {
  constructor(state: string) {
    super(`whatsapp session not open (${state})`);
  }
}

const SEND_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 10_000;
const LOGOUT_TIMEOUT_MS = 10_000;
/** WhatsApp closes an unconfirmed pairing socket after ~3½ min (measured 2026-10-02): promise
 *  the merchant a little less than that */
export const PAIR_WINDOW_MS = 200_000;
/** consecutive failed connections before the state says error (it keeps retrying) */
const ERROR_AFTER_FAILURES = 6;
const JID_CACHE_MAX = 2_000;

async function bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** a `me` only counts once WhatsApp confirmed the pairing — persisting the provisional one a
 *  pairing-code request sets makes the next start try to log in and die on a 401 */
export function pairingConfirmed(creds: Creds): boolean {
  return !!creds.registered || !!creds.account;
}

function statusOf(u: ConnectionUpdate): number | undefined {
  const err = u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
  return err?.output?.statusCode;
}

export class StoreSession {
  private sock: WaSocket | null = null;
  private creds: Creds | null = null;
  private stateNow: SessionState = 'off';
  private stopped = true;
  /** bumped by every stop(): work that awaited across one must not resurrect the session */
  private gen = 0;
  private failures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pairing: { phone: string; issued: boolean } | null = null;
  private credsTail: Promise<void> = Promise.resolve();
  private jids = new Map<string, string | null>();

  constructor(
    readonly tenantId: string,
    private runtime: WaRuntime,
    private store: AuthStore,
    private hooks: SessionHooks,
    private log: Logger,
    private reconnectDelay: (failures: number) => number = reconnectDelayMs,
  ) {}

  get state(): SessionState {
    return this.stateNow;
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** Bring a paired store online (no-op if already running). False when there is no login. */
  async start(): Promise<boolean> {
    if (!this.stopped) return true;
    const g = this.gen;
    const creds = (await this.store.read('creds', 'main')) as Creds | null;
    // stopped (lease dropped) while reading: nothing to bring up, and nothing to report
    if (g !== this.gen) return true;
    if (!creds || !pairingConfirmed(creds)) return false;
    this.stopped = false;
    this.failures = 0;
    await this.open(creds, g);
    return true;
  }

  /** Start a fresh registration and ask WhatsApp for a code for `phone` (national digits). */
  async pair(phone: string): Promise<void> {
    await this.stop();
    const g = this.gen;
    await this.hooks.wipe();
    if (g !== this.gen) return;
    this.jids.clear();
    this.pairing = { phone, issued: false };
    this.stopped = false;
    this.failures = 0;
    await this.open(this.runtime.initCreds(), g);
  }

  /** Close the socket, keep the login (lease moved, shutdown, idle). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.gen++;
    this.pairing = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const s = this.sock;
    this.sock = null;
    try {
      s?.end();
    } catch {
      /* already closed */
    }
    await this.credsTail.catch(() => undefined);
  }

  /** Unlink the device on WhatsApp's side when we can, then forget the login. */
  async logout(): Promise<void> {
    const s = this.sock;
    const wasOpen = this.stateNow === 'open';
    this.stopped = true;
    if (s && wasOpen) {
      await bounded(s.logout(), LOGOUT_TIMEOUT_MS, 'whatsapp logout').catch((e) =>
        this.log.warn({ err: e }, 'logout call failed — wiping anyway'),
      );
    }
    await this.stop();
    await this.hooks.wipe();
    this.set({ state: 'off', detail: null, phone: null, name: null, pairCode: null });
  }

  private set(u: StateUpdate) {
    this.stateNow = u.state;
    this.hooks.onState(u);
  }

  private async open(creds: Creds, g: number): Promise<void> {
    this.creds = creds;
    // a store already counted as down stays "error" while it retries: no flapping, one alert
    if (!this.pairing && this.stateNow !== 'error') this.set({ state: 'connecting' });
    let sock: WaSocket;
    try {
      sock = await this.runtime.connect({
        creds,
        keys: {
          get: (type, ids) => this.store.readMany(type, ids),
          set: (data) =>
            this.store
              .writeMany(
                Object.entries(data).flatMap(([category, items]) =>
                  Object.entries(items).map(([name, value]) => ({ category, name, value })),
                ),
              )
              .catch((e) => {
                // baileys retries a failed commit; a lost lease ends the socket as well
                this.fail(e);
                throw e;
              }),
        },
        logger: this.log,
        getMessage: async (key) => {
          const text = key.id ? await this.hooks.messageText(key.id) : null;
          return text ? { conversation: text } : undefined;
        },
      });
    } catch (e) {
      this.log.error({ err: e }, 'socket start failed');
      this.scheduleReconnect();
      return;
    }
    // stopped (or stopped and restarted) while connecting — this socket was never published
    if (this.stopped || g !== this.gen) {
      try {
        sock.end();
      } catch {
        /* closing */
      }
      return;
    }
    this.sock = sock;
    sock.ev.on('creds.update', () => {
      if (this.sock !== sock) return;
      const snapshot = { ...creds };
      if (!pairingConfirmed(snapshot)) delete snapshot.me;
      this.credsTail = this.credsTail
        .then(() => this.store.writeMany([{ category: 'creds', name: 'main', value: snapshot }]))
        .catch((e) => this.fail(e));
    });
    sock.ev.on('connection.update', (u) => {
      if (this.sock !== sock) return;
      void this.onConnection(sock, creds, u).catch((e) =>
        this.log.error({ err: e }, 'connection update failed'),
      );
    });
    sock.ev.on('messages.upsert', ({ type, messages }) => {
      if (this.sock !== sock || (type !== 'notify' && type !== 'append')) return;
      void this.onMessages(sock, messages).catch((e) =>
        this.log.warn({ err: e }, 'inbound processing failed'),
      );
    });
    sock.ev.on('messages.update', (updates) => {
      if (this.sock !== sock) return;
      const out: Receipt[] = [];
      for (const u of updates) {
        // proto WebMessageInfo.Status: 3 delivered, 4 read, 5 played
        const st = u.update?.status ?? 0;
        if (!u.key?.fromMe || !u.key.id || st < 3) continue;
        out.push({ waId: u.key.id, status: st >= 4 ? 'read' : 'delivered' });
      }
      if (out.length) this.hooks.onReceipts(out);
    });
  }

  private fail(e: unknown) {
    if (e instanceof LeaseLost) {
      this.log.warn('lease lost — closing socket');
      void this.stop();
      this.hooks.onLeaseLost();
      return;
    }
    this.log.error({ err: e }, 'auth write failed');
  }

  private async onConnection(sock: WaSocket, creds: Creds, u: ConnectionUpdate) {
    if (u.qr && this.pairing && !this.pairing.issued) {
      // the code only registers while this socket's registration stream is live (first qr)
      this.pairing.issued = true;
      const phone = jidForPhone(this.pairing.phone)?.split('@')[0];
      if (!phone) {
        this.set({ state: 'off', detail: 'bad_phone' });
        await this.stop();
        return;
      }
      try {
        const code = await bounded(sock.requestPairingCode(phone), SEND_TIMEOUT_MS, 'pair code');
        this.log.info('pairing code issued');
        this.set({
          state: 'pairing',
          detail: null,
          pairCode: code.replace(/[^A-Z0-9]/gi, '').toUpperCase(),
          pairCodeExpiresAt: new Date(Date.now() + PAIR_WINDOW_MS),
        });
      } catch (e) {
        this.log.warn({ err: e }, 'pairing code request failed');
        // never connected: not an outage, the merchant just asks for another code
        this.set({ state: 'off', detail: 'pair_failed', pairCode: null });
        await this.stop();
      }
      return;
    }
    if (u.isNewLogin) {
      // WhatsApp restarts the stream (515) right after a confirmed pairing
      this.log.info('pairing confirmed');
      this.pairing = null;
      this.set({ state: 'connecting', pairCode: null, pairCodeExpiresAt: null, detail: null });
      return;
    }
    if (u.connection === 'open') {
      this.failures = 0;
      this.pairing = null;
      const raw = sock.user?.phoneNumber ?? sock.user?.id;
      const digits = raw?.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') || null;
      this.log.info('socket open');
      this.set({
        state: 'open',
        detail: null,
        phone: digits,
        name: sock.user?.name ?? null,
        pairCode: null,
        pairCodeExpiresAt: null,
      });
      return;
    }
    if (u.connection !== 'close') return;
    this.sock = null;
    const code = statusOf(u);
    if (this.stopped) return;
    if (!pairingConfirmed(creds)) {
      // an unregistered socket closing is the pairing window ending (or failing)
      this.log.info({ code }, 'pairing window closed');
      this.stopped = true;
      this.pairing = null;
      this.set({ state: 'off', detail: 'pair_expired', pairCode: null, pairCodeExpiresAt: null });
      return;
    }
    if (code === 401) {
      this.log.warn('logged out by whatsapp');
      this.stopped = true;
      await this.hooks.wipe();
      this.set({ state: 'logged_out', detail: 'logged_out', pairCode: null });
      return;
    }
    if (code === 403) {
      this.log.warn('whatsapp refused the account (403)');
      this.stopped = true;
      this.set({ state: 'banned', detail: 'forbidden' });
      return;
    }
    if (code === 515) {
      // expected restart (after pairing, after a protocol change) — come straight back
      this.log.info('restart required — reconnecting');
      await this.reopen(creds);
      return;
    }
    this.failures++;
    const detail = code === 440 ? 'replaced' : code === 500 ? 'bad_session' : 'connection_lost';
    this.log.info({ code, failures: this.failures }, 'socket closed — reconnecting');
    if (this.failures >= ERROR_AFTER_FAILURES) this.set({ state: 'error', detail });
    else this.set({ state: 'connecting', detail });
    this.scheduleReconnect();
  }

  private async reopen(creds: Creds, g = this.gen) {
    if (this.stopped || g !== this.gen) return;
    await this.open(creds, g);
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const ms = this.reconnectDelay(Math.max(1, this.failures));
    const g = this.gen;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || !this.creds) return;
      void this.reopen(this.creds, g).catch((e) => this.log.error({ err: e }, 'reconnect failed'));
    }, ms);
    this.reconnectTimer.unref?.();
  }

  private async onMessages(sock: WaSocket, messages: { key?: WaKey; message?: unknown }[]) {
    for (const m of messages) {
      const key = m.key;
      if (!key?.id || key.fromMe) continue;
      const jid = key.remoteJid ?? '';
      // direct chats only — groups and broadcasts are ignored at the socket too
      if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue;
      const text = extractText(this.runtime.normalize(m.message) ?? m.message);
      if (!text) continue;
      let phone = phoneForJid(jid) ?? phoneForJid(key.remoteJidAlt);
      if (!phone && jid.endsWith('@lid')) {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null);
        phone = phoneForJid(pn);
      }
      this.hooks.onInbound({ phone, text, id: key.id });
    }
  }

  /** The jid WhatsApp knows this number by (9th-digit variants), cached; null = not on WhatsApp. */
  async resolveJid(phone: string): Promise<string | null> {
    if (this.jids.has(phone)) return this.jids.get(phone)!;
    const sock = this.sock;
    if (!sock || this.stateNow !== 'open') throw new SessionClosed(this.stateNow);
    const candidates = phoneVariants(phone)
      .map((p) => jidForPhone(p))
      .filter((j): j is string => !!j);
    const res = await bounded(sock.onWhatsApp(...candidates), PROBE_TIMEOUT_MS, 'onWhatsApp');
    if (res === undefined) throw new Error('onWhatsApp returned nothing');
    const hit = res.find((r) => r.exists)?.jid ?? null;
    if (this.jids.size >= JID_CACHE_MAX) this.jids.clear();
    this.jids.set(phone, hit);
    return hit;
  }

  /** Send one text with a caller-chosen id (resends dedupe on WhatsApp's side). */
  async send(phone: string, text: string, waId: string): Promise<string> {
    const jid = await this.resolveJid(phone);
    if (!jid) throw new NotOnWhatsApp();
    const sock = this.sock;
    if (!sock || this.stateNow !== 'open') throw new SessionClosed(this.stateNow);
    const res = await bounded(
      sock.sendMessage(jid, { text }, { messageId: waId }),
      SEND_TIMEOUT_MS,
      'whatsapp send',
    );
    return res?.key?.id ?? waId;
  }
}

/** Plain text of an inbound message; media and the rest are not ours to read. */
export function extractText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  if (typeof m.conversation === 'string') return m.conversation;
  const ext = m.extendedTextMessage as { text?: string } | undefined;
  return typeof ext?.text === 'string' ? ext.text : null;
}

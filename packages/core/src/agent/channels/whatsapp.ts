import type { Sql } from '../../platform/db.ts';
import { getIntegration, type IntegrationRow } from '../../modules/integrations.ts';
import { controlTx } from '../../modules/control.ts';

/**
 * agent/channels/whatsapp — Baileys v7, in-process. Auth state persists in
 * the `wa_auth_state` table (DB-backed replacement for the removed
 * useMultiFileAuthState), so session survives restarts/redeploys without a
 * filesystem. `log` driver is the zero-credential dev path.
 */

interface BaileysSocket {
  sendMessage(jid: string, content: { text: string }): Promise<{ key?: { id?: string } }>;
  end(err?: Error): void;
  ev: {
    on(
      event: 'connection.update',
      cb: (u: {
        connection?: string;
        qr?: string;
        lastDisconnect?: { error?: { output?: { statusCode?: number } } };
      }) => void,
    ): void;
    on(event: 'creds.update', cb: () => void): void;
    on(
      event: 'messages.upsert',
      cb: (m: {
        type: string;
        messages: {
          key?: { remoteJid?: string; id?: string; fromMe?: boolean };
          message?: unknown;
        }[];
      }) => void,
    ): void;
  };
}

let socket: BaileysSocket | null = null;
let starting: Promise<BaileysSocket> | null = null;
/** identity of the integration that opened `socket` — config changes must
 *  close it, not keep sending through the old account. */
let socketFingerprint: string | null = null;

function fingerprintOf(integration: IntegrationRow): string {
  return `${integration.id}:${(integration.config.accountId as string) ?? 'default'}:${integration.updated_at}`;
}

type MessageHandler = (jid: string, text: string, providerId: string | null) => Promise<void>;

const handlers: MessageHandler[] = [];
export function onInboundMessage(fn: MessageHandler) {
  handlers.push(fn);
}

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
      const serialized = JSON.parse(JSON.stringify(data, bufferJSON.replacer));
      await controlTx(
        sql,
        (tx) =>
          tx`insert into wa_auth_state (account_id, category, name, data)
             values (${accountId}, ${category}, ${name}, ${tx.json(serialized as never)})
             on conflict (account_id, category, name) do update set data = excluded.data`,
      );
    },
    delete: async (category: string, name: string) => {
      await controlTx(
        sql,
        (tx) =>
          tx`delete from wa_auth_state where account_id = ${accountId} and category = ${category} and name = ${name}`,
      );
    },
  };
}

async function startSocket(sql: Sql, integration: IntegrationRow): Promise<BaileysSocket> {
  const baileys = (await import('baileys')) as unknown as {
    default: (opts: Record<string, unknown>) => BaileysSocket;
    initAuthCreds(): unknown;
    BufferJSON: {
      replacer(k: string, v: unknown): unknown;
      reviver(k: string, v: unknown): unknown;
    };
  };
  const accountId = (integration.config.accountId as string) ?? 'default';
  const auth = dbAuthState(sql, accountId, baileys.BufferJSON);

  const creds = (await auth.read('creds', 'main')) ?? baileys.initAuthCreds();
  const sock = baileys.default({
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
    browser: ['Venduá', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', () => void auth.write('creds', 'main', creds));
  sock.ev.on('connection.update', (u) => {
    if (u.qr) void persistQr(sql, accountId, u.qr);
    if (u.connection === 'open') void persistQr(sql, accountId, null);
    if (u.connection === 'close') {
      socket = null;
      starting = null;
      socketFingerprint = null;
      // Baileys 401 = logged out — nothing to reconnect to until re-paired.
      // Otherwise the stream dropped: restart inbound delivery instead of
      // staying offline until an outbound send happens to reopen it.
      const loggedOut = u.lastDisconnect?.error?.output?.statusCode === 401;
      if (!loggedOut) {
        setTimeout(() => {
          // Re-read the integration instead of reconnecting with the config
          // captured at startSocket time — a disabled or re-pointed driver
          // must not come back on the old settings.
          void getIntegration(sql, 'whatsapp')
            .then((fresh) => ensureSocket(sql, fresh))
            .catch((e) => console.error('[whatsapp] reconnect failed', e));
        }, 5_000);
      }
    }
  });
  sock.ev.on('messages.upsert', ({ type, messages }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      const key = m.key;
      const jid = key?.remoteJid;
      // Only direct chats — group (@g.us) and broadcast JIDs would mint leads
      // for every participant and reply into the group.
      if (!key || key.fromMe || !jid || !jid.endsWith('@s.whatsapp.net')) continue;
      // No provider id = nothing to dedupe a retry on — skip rather than
      // insert a message we may see again.
      if (!key.id) continue;
      const text = extractText(m.message);
      if (!text) continue;
      for (const fn of handlers) {
        void fn(jid, text, key.id);
      }
    }
  });
  return sock;
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

async function persistQr(sql: Sql, accountId: string, qr: string | null) {
  await controlTx(
    sql,
    (tx) =>
      tx`insert into control_settings (key, value) values (${'wa_qr'}, ${tx.json({ accountId, qr } as never)})
         on conflict (key) do update set value = excluded.value`,
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
    try {
      socket.end();
    } catch {
      /* closing a dead socket */
    }
    socket = null;
    socketFingerprint = null;
  }
  if (!wanted) return null;
  if (socket) return socket;
  if (!starting) {
    starting = startSocket(sql, integration!).then(
      (s) => {
        socket = s;
        socketFingerprint = wanted;
        starting = null;
        return s;
      },
      (err) => {
        // a failed start must not poison the flag — clear it so the next
        // send/pair attempt can retry.
        starting = null;
        throw err;
      },
    );
  }
  return starting;
}

export async function sendWhatsApp(
  sql: Sql,
  integration: IntegrationRow,
  to: string,
  text: string,
): Promise<string | null> {
  const driver = integration.driver;
  if (driver === 'log') {
    console.log(`[whatsapp:log] → ${to}\n${text}`);
    return `log:${crypto.randomUUID()}`;
  }
  if (driver === 'baileys') {
    const sock = await ensureSocket(sql, integration);
    if (!sock) throw new Error('baileys socket not started');
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
    const res = await sock.sendMessage(jid, { text });
    return res?.key?.id ?? null;
  }
  throw new Error(`unknown whatsapp driver: ${driver}`);
}

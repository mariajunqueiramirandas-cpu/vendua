import type { Sql } from '../../platform/db.ts';
import type { IntegrationRow } from '../../modules/integrations.ts';
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
    on(event: 'connection.update', cb: (u: { connection?: string; qr?: string }) => void): void;
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

type MessageHandler = (jid: string, text: string, providerId: string | null) => Promise<void>;

const handlers: MessageHandler[] = [];
export function onInboundMessage(fn: MessageHandler) {
  handlers.push(fn);
}

/** DB-backed auth state. Baileys v7's initAuthCreds() +
 * SignalKeyStore-style read/write map onto our wa_auth_state rows. */
function dbAuthState(sql: Sql, accountId: string) {
  return {
    read: async (category: string, name: string) => {
      const rows = await controlTx(
        sql,
        (tx) =>
          tx<
            { data: unknown }[]
          >`select data from wa_auth_state where account_id = ${accountId} and category = ${category} and name = ${name}`,
      );
      return rows[0]?.data ?? null;
    },
    write: async (category: string, name: string, data: unknown) => {
      await controlTx(
        sql,
        (tx) =>
          tx`insert into wa_auth_state (account_id, category, name, data)
             values (${accountId}, ${category}, ${name}, ${tx.json(data as never)})
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
  const auth = dbAuthState(sql, accountId);

  const creds = (await auth.read('creds', 'main')) ?? baileys.initAuthCreds();
  const sock = baileys.default({
    auth: {
      creds,
      keys: {
        get: (type: string, ids: string[]) => Promise.all(ids.map((id) => auth.read(type, id))),
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
    }
  });
  sock.ev.on('messages.upsert', ({ type, messages }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key?.fromMe || !m.key?.remoteJid) continue;
      const text = extractText(m.message);
      if (!text) continue;
      for (const fn of handlers) {
        void fn(m.key.remoteJid, text, m.key.id ?? null);
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
  if (!integration || integration.driver !== 'baileys' || !integration.enabled) return null;
  if (socket) return socket;
  if (!starting) {
    starting = startSocket(sql, integration).then((s) => {
      socket = s;
      starting = null;
      return s;
    });
  }
  return starting;
}

export async function sendWhatsApp(
  sql: Sql,
  integration: IntegrationRow | null,
  to: string,
  text: string,
): Promise<string | null> {
  const driver = integration?.driver ?? 'log';
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

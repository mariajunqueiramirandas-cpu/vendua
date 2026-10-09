import type { Context } from 'hono';
import { mediaUpload } from '../modules/media-upload.ts';
import type { Sql } from '../platform/db.ts';
import { withTenant } from '../platform/db.ts';
import { HttpError, bodyJson, sessionCartId } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import type { MediaProviders } from './media.ts';
import { introduction, loadAgent } from './settings.ts';

// The storefront chat (sales-agent.md §8 V4, I3): the Vendedor on the store's own site,
// working the page's own cart. The thread is bound to the shopper's cart session, so cart_edit
// changes the cart the page shows; the shopper closes the order on the page's checkout, which
// already proves nothing about a phone. Off unless the merchant turns it on (law 11).

const MAX_PER_10_MIN = 30;
/** voice messages and photos: each is a transcription or a model call on the ingest */
const MEDIA_PER_10_MIN = 6;
const MEDIA_MAX = 2 * 1024 * 1024;
const MEDIA_JSON_MAX = 3 * 1024 * 1024;

export interface WebChatView {
  available: boolean;
  name: string | null;
  intro: string | null;
  messages: {
    id: string;
    author: 'shopper' | 'agent' | 'core' | 'merchant';
    body: string;
    at: string;
    card: string | null;
    /** a voice message's body is its transcript ('' until heard); a photo's, its caption */
    kind: 'text' | 'voice' | 'image';
  }[];
  /** a reply is on its way */
  pending: boolean;
  /** what the chat takes besides text */
  media: { voice: boolean; image: boolean };
}

async function chatAvailable(tx: Sql, tenantId: string) {
  const agent = await loadAgent(tx, tenantId);
  const [t] = await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`;
  return {
    on: agent.enabled && agent.settings.webChat,
    name: agent.settings.name,
    intro: introduction(agent.settings, t?.name ?? ''),
  };
}

/** For the store profile: whether the page shows the chat, how the Vendedor introduces itself,
 *  and what it takes besides text (the page knows before the shopper has a cart session). */
export async function webChatProfile(
  tx: Sql,
  tenantId: string,
  media: Pick<MediaProviders, 'canTranscribe'> | null = null,
): Promise<{ name: string; intro: string; media: { voice: boolean; image: boolean } } | null> {
  const a = await chatAvailable(tx, tenantId);
  if (!a.on) return null;
  const voice = !!media && ((await media.canTranscribe?.()) ?? true);
  return { name: a.name, intro: a.intro, media: { voice, image: true } };
}

async function threadFor(tx: Sql, tenantId: string, cartId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into shopper_threads (tenant_id, channel, address, cart_id, class)
    values (${tenantId}, 'web', ${`web:${cartId}`}, ${cartId}, 'shopper')
    on conflict (tenant_id, channel, address) do update set updated_at = shopper_threads.updated_at
    returning id`;
  return row!.id;
}

async function view(
  tx: Sql,
  tenantId: string,
  cartId: string,
  canHear: boolean,
): Promise<WebChatView> {
  const a = await chatAvailable(tx, tenantId);
  const [t] = await tx<{ id: string; pending_since: Date | null }[]>`
    select id, pending_since from shopper_threads where tenant_id = ${tenantId} and channel = 'web' and address = ${`web:${cartId}`}`;
  const rows = t
    ? await tx<
        {
          id: string;
          author: WebChatView['messages'][number]['author'];
          kind: string;
          body: string | null;
          transcript: string | null;
          created_at: Date;
          meta: { card?: string };
        }[]
      >`
        select id, author, kind, body, transcript, created_at, meta from shopper_messages
        where tenant_id = ${tenantId} and thread_id = ${t.id} and status not in ('draft', 'skipped', 'blocked')
        order by created_at desc limit 60`
    : [];
  return {
    available: a.on,
    name: a.on ? a.name : null,
    intro: a.on ? a.intro : null,
    messages: rows.reverse().map((m) => ({
      id: m.id,
      author: m.author,
      body: (m.kind === 'audio' ? m.transcript : m.body) ?? '',
      at: m.created_at.toISOString(),
      card: m.meta?.card ?? null,
      kind: m.kind === 'audio' ? 'voice' : m.kind === 'image' ? 'image' : 'text',
    })),
    // a reply that hasn't come in two minutes isn't coming soon: the store took over, or muted
    pending: !!t?.pending_since && Date.now() - t.pending_since.getTime() < 120_000,
    // a photo is described on the ingest (or reaches Duá as a photo he can't see, as on WhatsApp)
    media: { voice: a.on && canHear, image: a.on },
  };
}

export function mountWebChat(d: {
  checkout: {
    get: (p: string, h: (c: Context) => Promise<Response>) => unknown;
    post: (p: string, h: (c: Context) => Promise<Response>) => unknown;
  };
  sql: Sql;
  sessionSecret: string;
  /** null: voice messages are off (no transcription route) */
  media: Pick<MediaProviders, 'canTranscribe'> | null;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
}) {
  const canHear = async () => !!d.media && ((await d.media.canTranscribe?.()) ?? true);

  d.checkout.get('/chat', async (c) => {
    const tenant = c.get('tenant') as Tenant;
    const cartId = await sessionCartId(c, d.sessionSecret);
    const hear = await canHear();
    const out = await withTenant(d.sql, tenant.id, (tx) => view(tx, tenant.id, cartId, hear));
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  d.checkout.post(
    '/chat',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      const body = await bodyJson(c, MEDIA_JSON_MAX);
      // a voice message or a photo: stored as WhatsApp's are, heard or read on the ingest
      const up =
        body.kind !== undefined
          ? mediaUpload(body, { maxBytes: MEDIA_MAX, maxCaption: 1000 })
          : null;
      const text = !up && typeof body.text === 'string' ? body.text.trim() : '';
      if (!up && (text.length < 1 || text.length > 1000))
        throw new HttpError(422, 'BAD_REQUEST', 'text must have 1–1000 characters', {
          field: 'text',
        });
      const hear = await canHear();
      const a = await chatAvailable(tx, tenant.id);
      if (!a.on) throw new HttpError(404, 'CHAT_UNAVAILABLE', 'this store has no chat');
      if (up?.kind === 'voice' && !hear)
        throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'this chat takes no voice messages');
      const [cart] = await tx<{ status: string }[]>`
        select status from carts where tenant_id = ${tenant.id} and id = ${cartId}`;
      if (cart?.status !== 'open')
        throw new HttpError(409, 'CART_NOT_OPEN', 'start a new cart to chat');
      const threadId = await threadFor(tx, tenant.id, cartId);
      const [recent] = await tx<{ n: number; media: number }[]>`
        select count(*)::int as n,
               (count(*) filter (where kind in ('audio', 'image')))::int as media
        from shopper_messages where thread_id = ${threadId} and author = 'shopper'
          and created_at > now() - interval '10 minutes'`;
      if ((recent?.n ?? 0) >= MAX_PER_10_MIN || (up && (recent?.media ?? 0) >= MEDIA_PER_10_MIN))
        throw new HttpError(429, 'RATE_LIMITED', 'too many messages; wait a little');
      if (up) {
        const kind = up.kind === 'voice' ? 'audio' : 'image';
        const meta =
          up.kind === 'voice'
            ? { mime: up.mime, seconds: up.seconds }
            : { mime: up.mime, caption: up.caption };
        const [msg] = await tx<{ id: string }[]>`
          insert into shopper_messages (tenant_id, thread_id, author, kind, body, meta, status, ingest)
          values (${tenant.id}, ${threadId}, 'shopper', ${kind}, ${up.caption},
                  ${tx.json(meta)}, 'received', 'pending')
          returning id`;
        await tx`
          insert into shopper_media (tenant_id, message_id, mime, bytes, seconds)
          values (${tenant.id}, ${msg!.id}, ${up.mime}, ${Buffer.from(up.bytes)}, ${up.seconds})`;
      } else
        await tx`insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, ingest)
          values (${tenant.id}, ${threadId}, 'shopper', 'text', ${text}, 'received', 'pending')`;
      await tx`update shopper_threads set last_in_at = now(), pending_since = coalesce(pending_since, now()),
        updated_at = now() where id = ${threadId}`;
      return { status: 201, body: await view(tx, tenant.id, cartId, hear) };
    }),
  );
}

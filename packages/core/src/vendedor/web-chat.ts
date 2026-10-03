import type { Context } from 'hono';
import type { Sql } from '../platform/db.ts';
import { withTenant } from '../platform/db.ts';
import { HttpError, bodyJson, sessionCartId } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { introduction, loadAgent } from './settings.ts';

// The storefront chat (sales-agent.md §8 V4, I3): the Vendedor on the store's own site,
// working the page's own cart. The thread is bound to the shopper's cart session, so cart_edit
// changes the cart the page shows; the shopper closes the order on the page's checkout, which
// already proves nothing about a phone. Off unless the merchant turns it on (law 11).

const MAX_PER_10_MIN = 30;

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
  }[];
  /** a reply is on its way */
  pending: boolean;
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

/** For the store profile: whether the page shows the chat, and how the Vendedor introduces itself. */
export async function webChatProfile(
  tx: Sql,
  tenantId: string,
): Promise<{ name: string; intro: string } | null> {
  const a = await chatAvailable(tx, tenantId);
  return a.on ? { name: a.name, intro: a.intro } : null;
}

async function threadFor(tx: Sql, tenantId: string, cartId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into shopper_threads (tenant_id, channel, address, cart_id, class)
    values (${tenantId}, 'web', ${`web:${cartId}`}, ${cartId}, 'shopper')
    on conflict (tenant_id, channel, address) do update set updated_at = shopper_threads.updated_at
    returning id`;
  return row!.id;
}

async function view(tx: Sql, tenantId: string, cartId: string): Promise<WebChatView> {
  const a = await chatAvailable(tx, tenantId);
  const [t] = await tx<{ id: string; pending_since: Date | null }[]>`
    select id, pending_since from shopper_threads where tenant_id = ${tenantId} and channel = 'web' and address = ${`web:${cartId}`}`;
  const rows = t
    ? await tx<
        {
          id: string;
          author: WebChatView['messages'][number]['author'];
          body: string | null;
          created_at: Date;
          meta: { card?: string };
        }[]
      >`
        select id, author, body, created_at, meta from shopper_messages
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
      body: m.body ?? '',
      at: m.created_at.toISOString(),
      card: m.meta?.card ?? null,
    })),
    pending: !!t?.pending_since,
  };
}

export function mountWebChat(d: {
  checkout: {
    get: (p: string, h: (c: Context) => Promise<Response>) => unknown;
    post: (p: string, h: (c: Context) => Promise<Response>) => unknown;
  };
  sql: Sql;
  sessionSecret: string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
}) {
  d.checkout.get('/chat', async (c) => {
    const tenant = c.get('tenant') as Tenant;
    const cartId = await sessionCartId(c, d.sessionSecret);
    const out = await withTenant(d.sql, tenant.id, (tx) => view(tx, tenant.id, cartId));
    c.header('cache-control', 'no-store');
    return c.json(out);
  });

  d.checkout.post(
    '/chat',
    d.idempotency(d.sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, d.sessionSecret);
      const body = await bodyJson(c);
      const text =
        typeof (body as { text?: unknown }).text === 'string'
          ? (body as { text: string }).text.trim()
          : '';
      if (text.length < 1 || text.length > 1000)
        throw new HttpError(422, 'BAD_REQUEST', 'text must have 1–1000 characters', {
          field: 'text',
        });
      const a = await chatAvailable(tx, tenant.id);
      if (!a.on) throw new HttpError(404, 'CHAT_UNAVAILABLE', 'this store has no chat');
      const [cart] = await tx<{ status: string }[]>`
        select status from carts where tenant_id = ${tenant.id} and id = ${cartId}`;
      if (cart?.status !== 'open')
        throw new HttpError(409, 'CART_NOT_OPEN', 'start a new cart to chat');
      const threadId = await threadFor(tx, tenant.id, cartId);
      const [recent] = await tx<{ n: number }[]>`
        select count(*)::int as n from shopper_messages where thread_id = ${threadId} and author = 'shopper'
          and created_at > now() - interval '10 minutes'`;
      if ((recent?.n ?? 0) >= MAX_PER_10_MIN)
        throw new HttpError(429, 'RATE_LIMITED', 'too many messages; wait a little');
      await tx`insert into shopper_messages (tenant_id, thread_id, author, kind, body, status, ingest)
        values (${tenant.id}, ${threadId}, 'shopper', 'text', ${text}, 'received', 'pending')`;
      await tx`update shopper_threads set last_in_at = now(), pending_since = coalesce(pending_since, now()),
        updated_at = now() where id = ${threadId}`;
      return { status: 201, body: await view(tx, tenant.id, cartId) };
    }),
  );
}

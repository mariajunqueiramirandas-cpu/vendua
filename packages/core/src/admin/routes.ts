import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { withTenant, type Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, bodyJson, clientIp, windowCounter } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { notifyStaff } from '../modules/staff.ts';
import { audit } from './audit.ts';
import {
  ADMIN_COOKIE,
  adminGate,
  clearAdminCookie,
  createSession,
  forgetGate,
  membershipsFor,
  pickerToken,
  readPickerToken,
  revokeSession,
  setAdminCookie,
  startOtp,
  validAdminPhone,
  verifyOtp,
  type OtpSender,
} from './auth.ts';
import {
  type AdminApp,
  type AdminCtx,
  type AdminDeps,
  type Merchant,
  type Role,
  isObj,
  need,
  optText,
  text,
} from './context.ts';
import { emitAdminTx, type AdminHub } from './live.ts';
import { activeCarts, type PresenceTracker } from '../modules/presence.ts';
import { mountAppearance } from './routes-appearance.ts';
import { mountCatalog } from './routes-catalog.ts';
import { mountCustomers } from './routes-customers.ts';
import { mountHome } from './routes-home.ts';
import { mountMarketing } from './routes-marketing.ts';
import { mountOrders } from './routes-orders.ts';
import { mountReports } from './routes-reports.ts';
import { mountStore } from './routes-store.ts';
import { mountTeam } from './routes-team.ts';
import { vapidPublicKey } from './webpush.ts';
import { storeOrigin } from '../platform/store-origin.ts';

const adminLog = log.child({ mod: 'admin' });

export interface MountAdminOpts {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  admin: AdminApp;
  sql: Sql;
  sessionSecret: string;
  hub: AdminHub;
  presence: PresenceTracker;
  trustProxy: boolean;
  /** trusted proxies beyond the client's own X-Forwarded-For entry (VENDUA_PROXY_HOPS) */
  proxyHops: number;
  otpSender: OtpSender;
  idempotency: AdminDeps['idempotency'];
  storeDomain: string;
}

const STREAM_HEARTBEAT_MS = 20_000;
const STREAM_MAX_MS = 30 * 60_000;
/** carts have no change signal — one cheap count per open admin stream */
const PRESENCE_POLL_MS = 20_000;
const MEDIA_MAX = 2 * 1024 * 1024;

/** The merchant admin API (docs/merchant-admin.md). Mounted at /admin/v1. */
export function mountAdmin(o: MountAdminOpts) {
  const { admin, sql, sessionSecret, hub, presence } = o;
  const secure = (c: Context) =>
    c.req.url.startsWith('https://') ||
    (o.trustProxy && c.req.header('x-forwarded-proto') === 'https');

  // ── sign-in (pre-tenant) ─────────────────────────────────────────────────
  // one bucket per client IP for the whole auth surface — codes are the scarce thing
  const authLimit = rateLimitByIp(20, { trustForwardedFor: o.trustProxy, proxyHops: o.proxyHops });

  admin.post('/auth/otp/start', authLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = validAdminPhone(body.phone);
    if (!phone)
      throw new HttpError(422, 'INVALID_PHONE', 'type the phone with DDD', { field: 'phone' });
    return c.json(await startOtp(sql, phone, o.otpSender));
  });

  admin.post('/auth/otp/verify', authLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = validAdminPhone(body.phone);
    const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : '';
    if (!phone || !(await verifyOtp(sql, phone, code)))
      throw new HttpError(422, 'INVALID_CODE', 'wrong or expired code', { field: 'code' });
    const stores = await membershipsFor(sql, phone);
    if (stores.length === 0)
      throw new HttpError(422, 'INVALID_CODE', 'wrong or expired code', { field: 'code' });
    if (stores.length === 1) {
      setAdminCookie(
        c,
        await createSession(sql, stores[0]!, c.req.header('user-agent')),
        secure(c),
      );
      return c.json({ signedIn: true, store: publicStore(stores[0]!) });
    }
    return c.json({
      signedIn: false,
      pickerToken: pickerToken(sessionSecret, phone),
      stores: stores.map(publicStore),
    });
  });

  admin.post('/auth/select', authLimit, async (c) => {
    const body = await bodyJson(c);
    const phone = readPickerToken(sessionSecret, body.pickerToken);
    if (!phone) throw new HttpError(401, 'UNAUTHENTICATED', 'sign in again');
    const m = (await membershipsFor(sql, phone)).find((s) => s.tenant_id === body.storeId);
    if (!m) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
    setAdminCookie(c, await createSession(sql, m, c.req.header('user-agent')), secure(c));
    return c.json({ signedIn: true, store: publicStore(m) });
  });

  admin.post('/auth/logout', async (c) => {
    const raw = getCookie(c, ADMIN_COOKIE);
    const [tenantId, sessionId] = (raw ?? '').split('.');
    if (tenantId && sessionId && UUID_RE.test(tenantId) && UUID_RE.test(sessionId))
      await revokeSession(sql, tenantId, sessionId).catch(() => undefined);
    clearAdminCookie(c);
    return c.json({ ok: true });
  });

  // ── everything below needs a session ─────────────────────────────────────
  admin.use('*', adminGate(sql, { trustProxy: o.trustProxy }));

  const deps: AdminDeps = {
    admin,
    sql,
    sessionSecret,
    hub,
    idempotency: o.idempotency,
    storeDomain: o.storeDomain,
  };

  admin.get('/session', async (c) => {
    const tenant = c.get('tenant');
    const m = c.get('merchant');
    const { stores, settings, url } = await withTenant(sql, tenant.id, async (tx) => ({
      stores: await membershipsFor(sql, m.phone),
      url: await storeOrigin(tx, tenant, o.storeDomain),
      settings: (
        await tx<
          { logo_url: string | null; prefs: Record<string, unknown>; email: string | null }[]
        >`
          select s.logo_url, u.prefs, u.email from merchant_users u
            left join store_settings s on s.tenant_id = u.tenant_id
          where u.id = ${m.userId}
        `
      )[0],
    }));
    return c.json({
      user: {
        id: m.userId,
        name: m.name,
        phone: m.phone,
        role: m.role,
        prefs: settings?.prefs ?? {},
      },
      store: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        logoUrl: settings?.logo_url ?? null,
        url,
      },
      stores: stores.map(publicStore),
      push: { publicKey: vapidPublicKey() },
      // "falar com a Venduá" (Ajuda); unset = the page offers the in-app message only
      support: { whatsapp: process.env.VENDUA_SUPPORT_WHATSAPP?.replace(/\D/g, '') || null },
    });
  });

  // switch store without re-entering a code: the verified phone is in the session
  admin.post('/session/switch', async (c) => {
    const m = c.get('merchant');
    const body = await bodyJson(c);
    const target = (await membershipsFor(sql, m.phone)).find((s) => s.tenant_id === body.storeId);
    if (!target) throw new HttpError(404, 'STORE_NOT_FOUND', 'store not found');
    setAdminCookie(c, await createSession(sql, target, c.req.header('user-agent')), secure(c));
    return c.json({ signedIn: true, store: publicStore(target) });
  });

  admin.patch('/me', async (c) => {
    const m = c.get('merchant');
    const tenant = c.get('tenant');
    return o.idempotency(sql, async (c, tx) => {
      const body = await bodyJson(c);
      const name = body.name === undefined ? undefined : text(body.name, 'name', 80, 1);
      const email = optText(body.email, 'email', 200);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        throw new HttpError(422, 'BAD_REQUEST', 'email looks wrong', { field: 'email' });
      let prefs: Record<string, unknown> | undefined;
      if (body.prefs !== undefined) {
        if (!isObj(body.prefs) || JSON.stringify(body.prefs).length > 2000)
          throw new HttpError(422, 'BAD_REQUEST', 'prefs must be a small object');
        prefs = pickPrefs(body.prefs);
      }
      const row = (
        await tx<{ id: string; name: string; email: string | null; prefs: unknown }[]>`
          update merchant_users set
            name = ${name ?? tx`name`},
            email = ${email === undefined ? tx`email` : email},
            prefs = ${prefs ? tx`prefs || ${tx.json(prefs as never)}` : tx`prefs`}
          where tenant_id = ${tenant.id} and id = ${m.userId}
          returning id, name, email, prefs
        `
      )[0];
      await emitAdminTx(tx, tenant.id, 'team');
      return { status: 200, body: { user: row } };
    })(c);
  });

  admin.get('/me/sessions', async (c) => {
    const m = c.get('merchant');
    const tenant = c.get('tenant');
    const rows = await withTenant(
      sql,
      tenant.id,
      (tx) => tx<{ id: string; user_agent: string; created_at: string; last_seen_at: string }[]>`
        select id, user_agent, created_at, last_seen_at from merchant_sessions
        where tenant_id = ${tenant.id} and user_id = ${m.userId} and revoked_at is null and expires_at > now()
        order by last_seen_at desc limit 20
      `,
    );
    return c.json({
      sessions: rows.map((r) => ({
        id: r.id,
        device: r.user_agent,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        current: r.id === m.sessionId,
      })),
    });
  });

  admin.delete('/me/sessions/:id', async (c) => {
    const m = c.get('merchant');
    const tenant = c.get('tenant');
    const id = c.req.param('id');
    if (!UUID_RE.test(id)) throw new HttpError(400, 'BAD_REQUEST', 'id must be a uuid');
    return o.idempotency(sql, async (_c, tx) => {
      await tx`
        update merchant_sessions set revoked_at = now()
        where tenant_id = ${tenant.id} and user_id = ${m.userId} and id = ${id}
      `;
      forgetGate();
      return { status: 200, body: { ok: true } };
    })(c);
  });

  // ── web push ─────────────────────────────────────────────────────────────
  admin.post('/push/subscribe', async (c) => {
    const m = c.get('merchant');
    const tenant = c.get('tenant');
    return o.idempotency(sql, async (c, tx) => {
      const body = await bodyJson(c);
      const endpoint = text(body.endpoint, 'endpoint', 1000, 10);
      if (!endpoint.startsWith('https://'))
        throw new HttpError(422, 'BAD_REQUEST', 'endpoint must be https');
      const keys = isObj(body.keys) ? body.keys : {};
      const p256dh = text(keys.p256dh, 'keys.p256dh', 200, 20);
      const auth = text(keys.auth, 'keys.auth', 100, 8);
      await tx`
        insert into push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
        values (${tenant.id}, ${m.userId}, ${endpoint}, ${p256dh}, ${auth})
        on conflict (tenant_id, endpoint) do update set user_id = excluded.user_id,
          p256dh = excluded.p256dh, auth = excluded.auth, last_error = null
      `;
      return { status: 201, body: { subscribed: true } };
    })(c);
  });

  admin.post('/push/unsubscribe', async (c) => {
    const tenant = c.get('tenant');
    return o.idempotency(sql, async (c, tx) => {
      const body = await bodyJson(c);
      const endpoint = text(body.endpoint, 'endpoint', 1000);
      await tx`delete from push_subscriptions where tenant_id = ${tenant.id} and endpoint = ${endpoint}`;
      return { status: 200, body: { subscribed: false } };
    })(c);
  });

  // ── search: orders, products, customers together ─────────────────────────
  admin.get('/search', async (c) => {
    const tenant = c.get('tenant');
    const m = c.get('merchant');
    const q = (c.req.query('q') ?? '').trim().slice(0, 80);
    if (q.length < 1) return c.json({ orders: [], products: [], customers: [] });
    const digits = q.replace(/\D/g, '');
    const like = `%${fold(q)}%`;
    const out = await withTenant(sql, tenant.id, async (tx) => {
      const orders = await tx`
        select id, number, state, customer ->> 'name' as name, total_cents as "totalCents", placed_at as "placedAt"
        from orders where tenant_id = ${tenant.id} and (
          ${/^\d{1,8}$/.test(q) ? tx`number = ${Number(q)} or` : tx``}
          translate(lower(customer ->> 'name'), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${like}
          ${digits.length >= 4 ? tx`or customer_phone like ${'%' + digits + '%'}` : tx``}
        )
        order by placed_at desc limit 8
      `;
      if (m.role === 'attendant') return { orders, products: [], customers: [] };
      const products = await tx`
        select p.id, p.name, p.status, p.base_price_cents as "priceCents",
          (select url from product_media where product_id = p.id order by sort limit 1) as "imageUrl"
        from products p where p.tenant_id = ${tenant.id}
          and translate(lower(p.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${like}
        order by p.status = 'archived', p.name limit 8
      `;
      const customers = await tx`
        select customer_phone as phone, (array_agg(customer ->> 'name' order by placed_at desc))[1] as name,
               count(*)::int as orders
        from orders where tenant_id = ${tenant.id} and customer_phone is not null and (
          translate(lower(customer ->> 'name'), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like ${like}
          ${digits.length >= 4 ? tx`or customer_phone like ${'%' + digits + '%'}` : tx``}
        )
        group by customer_phone order by max(placed_at) desc limit 8
      `;
      return { orders, products, customers };
    });
    return c.json(out);
  });

  // ── live stream: one per signed-in device ────────────────────────────────
  admin.get('/events', async (c) => {
    const tenant = c.get('tenant');
    const res = streamSSE(c, async (stream) => {
      let finish!: () => void;
      const done = new Promise<void>((r) => (finish = r));
      stream.onAbort(() => finish());
      let seq = 0;
      const unsubscribe = await hub.subscribe(tenant.id, (e) => {
        void stream.writeSSE({ event: 'change', id: String(++seq), data: JSON.stringify(e) });
      });
      // who's in the store: viewers move with streams, carts with the database — send on change
      let lastPresence = '';
      let sending = false;
      const sendPresence = async () => {
        if (sending) return;
        sending = true;
        try {
          const p = {
            viewers: presence.viewers(tenant.id),
            carts: await activeCarts(sql, tenant.id),
          };
          const data = JSON.stringify(p);
          if (data !== lastPresence) {
            lastPresence = data;
            await stream.writeSSE({ event: 'presence', data });
          }
        } catch {
          /* the next tick tries again */
        } finally {
          sending = false;
        }
      };
      const unwatch = await presence.subscribe(tenant.id, () => void sendPresence());
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ at: new Date() }) });
      void sendPresence();
      const carts = setInterval(() => void sendPresence(), PRESENCE_POLL_MS);
      // a named event, not a comment: the admin's watchdog sees it and reconnects a silent stream
      const beat = setInterval(
        () => void stream.writeSSE({ event: 'ping', data: '' }).catch(() => finish()),
        STREAM_HEARTBEAT_MS,
      );
      const lifetime = setTimeout(finish, STREAM_MAX_MS);
      await done;
      unsubscribe();
      unwatch();
      clearInterval(carts);
      clearInterval(beat);
      clearTimeout(lifetime);
    });
    c.header('cache-control', 'no-cache, no-transform');
    c.header('x-accel-buffering', 'no');
    return c.newResponse(res.body);
  });

  // ── media: client-resized photos, served from /v1/media ───────────────────
  admin.post('/media', async (c) => {
    const tenant = c.get('tenant');
    const m = need(c, 'manager');
    const mime = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mime))
      throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'send a webp, jpeg or png image');
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > MEDIA_MAX)
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'image is larger than 2 MB');
    const width = Number(c.req.query('w'));
    const height = Number(c.req.query('h'));
    const dominant = c.req.query('dominant');
    return o.idempotency(sql, async (c, tx) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MEDIA_MAX)
        throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'image is empty or larger than 2 MB');
      if (sniff(bytes) !== mime)
        throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'the file is not the image type it claims');
      const w = Number.isInteger(width) && width > 0 && width <= 4096 ? width : null;
      const h = Number.isInteger(height) && height > 0 && height <= 4096 ? height : null;
      const dom = dominant && /^#[0-9a-f]{6}$/.test(dominant) ? dominant : null;
      const row = (
        await tx<{ id: string }[]>`
          insert into media_objects (tenant_id, mime, bytes, width, height, dominant, created_by)
          values (${tenant.id}, ${mime}, ${bytes}, ${w}, ${h}, ${dom}, ${m.userId})
          returning id
        `
      )[0]!;
      const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
      return {
        status: 201,
        body: {
          id: row.id,
          url: `/v1/media/${tenant.id}/${row.id}.${ext}`,
          width: w,
          height: h,
          dominant: dom,
        },
      };
    })(c);
  });

  // ── help: "falar com a Venduá" lands with the team ───────────────────────
  admin.post('/help', async (c) => {
    const tenant = c.get('tenant');
    const m = c.get('merchant');
    return o.idempotency(sql, async (c, tx) => {
      const body = await bodyJson(c);
      const message = text(body.message, 'message', 2000, 3);
      const topic = optText(body.topic, 'topic', 60) ?? 'geral';
      await audit(tx, tenant.id, m, {
        action: 'help.request',
        entity: 'help',
        summary: `pediu ajuda (${topic})`,
        after: { topic, message },
      });
      // delivery happens after the claim commits; the staff channel never blocks the reply
      queueMicrotask(() => {
        void notifyStaff(sql, null, {
          subject: `Ajuda: ${tenant.name} (${topic})`,
          body: `${m.name} · ${formatPhone(m.phone)} · ${m.role}\n\n${message}`,
          idemKey: `admin-help:${tenant.id}:${Date.now()}`,
        }).catch((err) => adminLog.warn({ err }, 'help notify failed'));
      });
      return { status: 201, body: { sent: true } };
    })(c);
  });

  mountHome(deps);
  mountOrders(deps);
  mountCatalog(deps);
  mountStore(deps);
  mountCustomers(deps);
  mountMarketing(deps);
  mountReports(deps);
  mountTeam(deps);
  mountAppearance(deps);

  // public media read — storefront hosts proxy /v1 to Core, so the same URL works everywhere
  o.app.get('/v1/media/:tenantId/:file', async (c) => {
    const tenantId = c.req.param('tenantId');
    const m = /^([0-9a-f-]{36})\.(webp|jpg|png)$/.exec(c.req.param('file'));
    if (!UUID_RE.test(tenantId) || !m || !UUID_RE.test(m[1]!))
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    const row = await withTenant(
      sql,
      tenantId,
      async (tx) =>
        (
          await tx<{ mime: string; bytes: Uint8Array }[]>`
            select mime, bytes from media_objects where tenant_id = ${tenantId} and id = ${m[1]!}
          `
        )[0],
    );
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'not found');
    c.header('content-type', row.mime);
    c.header('cache-control', 'public, max-age=31536000, immutable');
    c.header('x-content-type-options', 'nosniff');
    return c.body(row.bytes as unknown as ArrayBuffer);
  });

  admin.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
}

function publicStore(s: { tenant_id: string; slug: string; name: string; role: Role }) {
  return { id: s.tenant_id, slug: s.slug, name: s.name, role: s.role };
}

export function formatPhone(p: string) {
  return p.length === 11
    ? `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
    : `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
}

/** accent-folded lowercase, matching the SQL translate() used for search */
export function fold(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[%_\\]/g, '');
}

const PREF_KEYS: Record<string, 'boolean' | 'number' | 'string' | 'list'> = {
  sound: 'boolean',
  volume: 'number',
  push: 'boolean',
  theme: 'string',
  dismissedHints: 'list',
};

function pickPrefs(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    const want = PREF_KEYS[k];
    if (!want) continue;
    if (want === 'list') {
      if (
        Array.isArray(v) &&
        v.length <= 50 &&
        v.every((x) => typeof x === 'string' && x.length < 40)
      )
        out[k] = v;
      continue;
    }
    if (typeof v === want) out[k] = v;
  }
  if (typeof out.volume === 'number') out.volume = Math.max(0, Math.min(1, out.volume as number));
  if (out.theme !== undefined && !['creme', 'noite', 'system'].includes(out.theme as string))
    delete out.theme;
  return out;
}

function sniff(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  return null;
}

function rateLimitByIp(max: number, flags: { trustForwardedFor: boolean; proxyHops: number }) {
  const allow = windowCounter({ windowMs: 60_000, max });
  return async (c: Context, next: () => Promise<void>) => {
    if (!allow(clientIp(c, flags)))
      throw new HttpError(429, 'RATE_LIMITED', 'too many attempts — wait a minute');
    await next();
  };
}

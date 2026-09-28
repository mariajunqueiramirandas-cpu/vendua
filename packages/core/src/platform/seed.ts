// dev tenant — idempotent reset to a blank store (orders preserved); quero-pudim :5174
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTemplatesDir } from '@vendua/templates/node';
import { createSql } from './db.ts';
import { log } from './log.ts';
import { isPublicHost } from './store-origin.ts';

const slog = log.child({ mod: 'seed' });

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);
const REPO = join(import.meta.dir, '../../../..');

// One dev store, deliberately blank: the merchant admin's onboarding (/admin/bem-vindo)
// is what fills it in. Re-seeding resets it to that blank state (orders are preserved).
const TENANT = {
  slug: 'quero-pudim',
  name: 'Quero Pudim Gourmet',
  hosts: ['quero-pudim.localhost', 'localhost:5174', '127.0.0.1:5174'],
  /** repo storefront whose templates/ seed the store's composition (v1 in Core) */
  storefront: 'storefronts/quero-pudim',
  /** the merchant admin owner — phone as national digits (DDD + number) */
  owner: { name: 'Vinícius', phone: '22981795040', email: 'viunuvi@gmail.com' },
};

// earlier seeds also made the fleet canaries and demo storefronts; a dev DB has one store now (FKs cascade)
await sql`delete from tenants where slug in ('brasa', 'forn', 'example-quero-pudim', 'loja-modelo')`;

await sql.begin(async (tx) => {
  const t = TENANT;
  const tid = (
    await tx<{ id: string }[]>`
      insert into tenants (slug, name) values (${t.slug}, ${t.name})
      on conflict (slug) do update set name = excluded.name
      returning id
    `
  )[0]!.id;

  await tx`delete from domains where tenant_id = ${tid}`;
  // SEED_DOMAINS="slug:host1|host2,..." — registers real public domains (resolver routes on Host)
  const extra = (process.env.SEED_DOMAINS ?? '')
    .split(',')
    .map((e) => e.trim().split(':'))
    .filter(([slug]) => slug === t.slug)
    .flatMap(([, hosts]) => (hosts ?? '').split('|').filter(Boolean));
  // the first public SEED_DOMAINS host is the address every admin link uses
  const primary = extra.find(isPublicHost);
  for (const host of [...t.hosts, ...extra]) {
    await tx`insert into domains (host, tenant_id, is_primary) values (${host}, ${tid}, ${host === primary})`;
  }

  // nothing configured: no profile, no hours, neither pickup nor delivery, no Pix
  await tx`delete from store_settings where tenant_id = ${tid}`;
  await tx`
    insert into store_settings (tenant_id, hours, pickup_enabled, delivery_enabled)
    values (${tid}, ${tx.json({ timezone: 'America/Sao_Paulo', windows: [] })}, false, false)
  `;

  // the store's owner in the merchant admin (dev codes print in the log, or come back
  // in the response with VENDUA_ADMIN_DEV_OTP=1)
  await tx`delete from merchant_users where tenant_id = ${tid} and phone = '22999990000'`;
  await tx`
    insert into merchant_users (tenant_id, name, phone, email, role)
    values (${tid}, ${t.owner.name}, ${t.owner.phone}, ${t.owner.email}, 'owner')
    on conflict (tenant_id, phone) do update
      set name = excluded.name, email = excluded.email, role = 'owner', status = 'active'
  `;

  await tx`delete from coupons where tenant_id = ${tid}`;
  await tx`delete from delivery_zones where tenant_id = ${tid}`;
  // drop cart_items first — preserved carts FK-reference products this delete cascades away
  await tx`delete from cart_items where tenant_id = ${tid}`;
  await tx`delete from categories where tenant_id = ${tid}`;

  await tx`select set_config('vendua.tenant_id', ${tid}, true)`;
  await tx`
    insert into storefront_ops (tenant_id, ring) values (${tid}, 'stable')
    on conflict (tenant_id) do update set ring = excluded.ring
  `;
  // composition: the storefront's repo templates become v1 — never over an existing history
  const dir = join(REPO, t.storefront, 'templates');
  if (existsSync(dir)) {
    const have = await tx`select 1 from storefront_templates where tenant_id = ${tid} limit 1`;
    if (!have[0])
      for (const [page, template] of Object.entries(readTemplatesDir(dir)))
        await tx`
          insert into storefront_templates (tenant_id, page, version, template, source)
          values (${tid}, ${page}, 1, ${tx.json(template as never)}, 'seed')
        `;
  }
});
slog.info({ slug: TENANT.slug }, 'seeded tenant (blank)');

// CRM: no demo pipeline — one real customer record for the store this repo ships.
// Re-seeds replace it (source='seed'); leads you create by hand are never touched.
{
  await sql`delete from leads where source = 'seed'`;
  const lead = (
    await sql<{ id: string }[]>`
      insert into leads (name, business_name, phone, whatsapp, instagram, city, segment, state,
        agent_mode, tags, source)
      values ('Quero Pudim Gourmet', 'Quero Pudim Gourmet', '+5522999999999', '+5522999999999',
        '@queropudim_gourmet', 'Saquarema', 'doceria', 'live', 'off',
        ${['cliente'] as unknown as never[]}, 'seed')
      returning id
    `
  )[0]!;
  await sql`
    insert into lead_activities (lead_id, kind, body, created_by)
    values (${lead.id}, 'note', 'Cliente: loja no ar em storefronts/quero-pudim (tenant quero-pudim).', 'staff')
  `;
  // one history row per stage — everReached counts to_state rows
  for (const s of ['lead', 'contacted', 'invited', 'live'] as const) {
    await sql`
      insert into lead_state_history (lead_id, from_state, to_state, actor, value_cents)
      values (${lead.id}, null, ${s}, 'staff', null)
    `;
  }
  slog.info('seeded CRM customer: Quero Pudim Gourmet');
}

await sql.end();
slog.info('done');

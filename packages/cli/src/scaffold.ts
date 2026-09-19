import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { die, isStorefrontDir, nextPort } from './paths.ts';

/**
 * `vendua scaffold <slug>` — copy the always-green _template into
 * storefronts/<slug>, give it a free dev port, and register a dev tenant so
 * `vendua dev <slug>` works immediately.
 *
 * Order matters: the DB registration runs BEFORE any file is written, so an
 * unreachable Postgres can never leave behind a package with no tenant.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DEFAULT_DB_URL = 'postgres://vendua:vendua@localhost:5433/vendua';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

interface SeedModifier {
  name: string;
  deltaCents?: number;
}
interface SeedGroup {
  name: string;
  required?: boolean;
  min?: number;
  max?: number;
  modifiers: SeedModifier[];
}
interface SeedProduct {
  slug: string;
  name: string;
  description?: string;
  priceCents: number;
  figure?: 'default' | 'alt';
  groups?: SeedGroup[];
}

/** The seeded sample catalog — one category, a few items, one required
 * modifier group so the product page's required-selection path is exercised. */
const SAMPLE_PRODUCTS: SeedProduct[] = [
  {
    slug: 'item-exemplo-1',
    name: 'Item de exemplo 1',
    description: 'Produto de exemplo criado pelo vendua scaffold.',
    priceCents: 1990,
    groups: [
      {
        name: 'Opção',
        required: true,
        min: 1,
        max: 1,
        modifiers: [{ name: 'Padrão' }, { name: 'Alternativa', deltaCents: 300 }],
      },
    ],
  },
  {
    slug: 'item-exemplo-2',
    name: 'Item de exemplo 2',
    description: 'Produto de exemplo criado pelo vendua scaffold.',
    priceCents: 2490,
  },
  {
    slug: 'item-exemplo-3',
    name: 'Item de exemplo 3',
    priceCents: 1290,
    figure: 'alt',
  },
];

export async function cmdScaffold(slug: string | undefined, root: string): Promise<void> {
  if (!slug) die('usage: vendua scaffold <slug>');
  if (!SLUG_RE.test(slug)) {
    die(`invalid slug '${slug}' — use lowercase letters, digits, and '-' (e.g. minha-loja)`);
  }
  const target = join(root, 'storefronts', slug);
  if (existsSync(target)) die(`storefronts/${slug} already exists — refusing to overwrite`);

  const template = join(root, 'storefronts', '_template');
  if (!isStorefrontDir(template)) die('storefronts/_template is missing or broken');

  const port = nextPort(root);
  await registerTenant(slug, port);

  // Build in a temp sibling and rename atomically — a copy/rewrite failure
  // must leave no `storefronts/<slug>` behind, or the existsSync guard above
  // would permanently reject the retry (the tenant rows already committed).
  const tmp = join(root, 'storefronts', `.scaffold-${slug}-${randomBytes(4).toString('hex')}`);
  try {
    // Build/install artifacts must not leak into a scaffold — a stale dist/ or
    // a template-local node_modules/ shipped into a fresh package is garbage.
    cpSync(template, tmp, {
      recursive: true,
      filter: (src) => !/([\\/])(node_modules|dist|qa-report)([\\/]|$)/.test(src),
    });

    const pkgPath = join(tmp, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string };
    pkg.name = `@vendua/storefront-${slug}`;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const vitePath = join(tmp, 'vite.config.ts');
    writeFileSync(
      vitePath,
      readFileSync(vitePath, 'utf8').replace(/port\s*:\s*\d+/, `port: ${port}`),
    );

    renameSync(tmp, target);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }

  console.log(`created storefronts/${slug} (@vendua/storefront-${slug}) on dev port ${port}`);
  console.log(`registered dev tenant '${slug}' for localhost:${port} and 127.0.0.1:${port}`);
  console.log('');
  console.log('next steps:');
  console.log('  bun install                  # register the workspace + lockfile');
  console.log(`  bunx vendua dev ${slug}      # → http://localhost:${port}`);
}

/**
 * Idempotent dev-tenant registration against DATABASE_URL — mirrors the row
 * shapes in packages/core/src/platform/seed.ts: tenant + domains +
 * store_settings + one zone + a small catalog. On conflict it leaves existing
 * rows alone (scaffold only fills what is missing).
 */
async function registerTenant(slug: string, port: number): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  let sql: postgres.Sql;
  try {
    sql = postgres(url, { max: 1, connect_timeout: 5 });
    // Force a connection up-front so an unreachable DB fails here, before any
    // storefront files exist.
    await sql`select 1`;
  } catch {
    dbUnreachable(url, slug);
  }
  try {
    await sql.begin(async (tx) => {
      const tenant = (
        await tx<{ id: string }[]>`
          insert into tenants (slug, name) values (${slug}, ${slug})
          on conflict (slug) do update set name = excluded.name
          returning id
        `
      )[0];
      if (!tenant) throw new Error('tenant upsert returned no row');
      const tid = tenant.id;

      for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
        // Never silently rebind a host: a scaffold racing another tenant's
        // port must fail loudly, not steal the domain row mid-transaction.
        const inserted = await tx`
          insert into domains (host, tenant_id) values (${host}, ${tid})
          on conflict (host) do nothing
          returning host
        `;
        if (!inserted[0]) {
          const bound = (
            await tx<{ slug: string }[]>`
              select t.slug from domains d join tenants t on t.id = d.tenant_id
              where d.host = ${host}
            `
          )[0];
          if (bound?.slug !== slug) {
            throw new Error(
              `${host} is already bound to tenant '${bound?.slug ?? '?'}' — pick another port (check storefronts/*/vite.config.ts)`,
            );
          }
        }
      }

      await tx`
        insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents,
          pickup_enabled, delivery_enabled, currency, vocabulary)
        values (${tid},
          ${tx.json({ timezone: 'America/Sao_Paulo', windows: [{ days: ALL_DAYS, open: '09:00', close: '18:00' }] })},
          30, 0, true, true, 'BRL', ${tx.json({})})
        on conflict (tenant_id) do nothing
      `;

      const zones = await tx`select 1 from delivery_zones where tenant_id = ${tid} limit 1`;
      if (zones.length === 0) {
        await tx`
          insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes)
          values (${tid}, 'Entrega', ${tx.json(['Centro'])}, 500, 0, 30, 50)
        `;
      }

      const cats = await tx`select 1 from categories where tenant_id = ${tid} limit 1`;
      if (cats.length === 0) {
        const cat = (
          await tx<{ id: string }[]>`
            insert into categories (tenant_id, slug, name, sort)
            values (${tid}, 'cardapio', 'Cardápio', 1)
            returning id
          `
        )[0];
        if (!cat) throw new Error('category insert returned no row');
        for (const p of SAMPLE_PRODUCTS) {
          const prod = (
            await tx<{ id: string }[]>`
              insert into products (tenant_id, category_id, slug, name, description, base_price_cents, status, figure_variant)
              values (${tid}, ${cat.id}, ${p.slug}, ${p.name}, ${p.description ?? null}, ${p.priceCents}, 'active', ${p.figure ?? 'default'})
              on conflict (tenant_id, slug) do nothing
              returning id
            `
          )[0];
          if (!prod) continue; // product slug already present
          for (const [gi, g] of (p.groups ?? []).entries()) {
            const grp = (
              await tx<{ id: string }[]>`
                insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
                values (${tid}, ${prod.id}, ${g.name}, ${g.required ?? false}, ${g.min ?? 0}, ${g.max ?? 1}, ${gi})
                returning id
              `
            )[0];
            if (!grp) throw new Error('modifier group insert returned no row');
            for (const [mi, m] of g.modifiers.entries()) {
              await tx`
                insert into modifiers (tenant_id, group_id, name, price_delta_cents, sort)
                values (${tid}, ${grp.id}, ${m.name}, ${m.deltaCents ?? 0}, ${mi})
              `;
            }
          }
        }
      }
    });
  } catch (err) {
    await sql.end().catch(() => {});
    // Connected but the schema isn't there or the write failed — still no
    // storefront files on disk, so this is a clean failure.
    console.error(
      `vendua: tenant registration failed — ${err instanceof Error ? err.message : err}`,
    );
    console.error('');
    console.error('If the database is up but unmigrated, run:');
    console.error('  cd packages/core && bun run migrate');
    console.error(`then re-run: vendua scaffold ${slug}`);
    process.exit(1);
  }
  await sql.end();
}

function dbUnreachable(url: string, slug: string): never {
  console.error(`vendua: could not reach Postgres at ${url} — no storefront was created.`);
  console.error('');
  console.error('Start the dev database and re-run the scaffold:');
  console.error('  cd packages/core && docker compose up -d && bun run migrate');
  console.error(`  bunx vendua scaffold ${slug}`);
  console.error('');
  console.error('Or point DATABASE_URL at a reachable Postgres:');
  console.error(`  DATABASE_URL=postgres://user:pass@host:5432/db bunx vendua scaffold ${slug}`);
  process.exit(1);
}

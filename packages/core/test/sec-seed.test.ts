import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';

// The seed runs on every boot with SEED_DEMO=1: in production it must only ever add.
const url = process.env.TEST_DATABASE_URL;

function seed(env: Record<string, string>) {
  const r = Bun.spawnSync(['bun', join(import.meta.dir, '../src/platform/seed.ts')], {
    env: { ...process.env, MIGRATION_DATABASE_URL: url!, LOG_LEVEL: 'warn', ...env },
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}

describe.skipIf(!url)('platform seed (db)', () => {
  const sql = postgres(url!, { onnotice: () => {} });
  let tid: string;

  beforeAll(async () => {
    await sql`delete from tenants where slug in ('quero-pudim', 'brasa')`;
    await sql`delete from leads where source = 'seed'`;
  });
  afterAll(async () => {
    await sql`delete from tenants where slug in ('quero-pudim', 'brasa')`;
    await sql`delete from leads where source = 'seed'`;
    await sql.end();
  });

  test('production creates a missing store once, owner from SEED_OWNER_*', async () => {
    seed({
      NODE_ENV: 'production',
      SEED_OWNER_NAME: 'Dona Teste',
      SEED_OWNER_PHONE: '21988887777',
      SEED_OWNER_EMAIL: 'dona@example.test',
      SEED_DOMAINS: 'quero-pudim:pudim.example.test',
    });
    tid = (await sql<{ id: string }[]>`select id from tenants where slug = 'quero-pudim'`)[0]!.id;
    const owners =
      await sql`select name, phone, email from merchant_users where tenant_id = ${tid}`;
    expect(owners.map((o) => ({ ...o }))).toEqual([
      { name: 'Dona Teste', phone: '21988887777', email: 'dona@example.test' },
    ]);
    const primary = await sql`select host from domains where tenant_id = ${tid} and is_primary`;
    expect(primary.map((d) => d.host)).toEqual(['pudim.example.test']);
    expect(await sql`select 1 from leads where source = 'seed'`).toHaveLength(1);
  });

  test("production never resets an existing store, nor deletes other stores' slugs", async () => {
    const brasa = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values ('brasa', 'Brasa Real') returning id`
    )[0]!.id;
    await sql`update tenants set name = 'Pudim do Dono' where id = ${tid}`;
    await sql`update domains set is_primary = false where tenant_id = ${tid}`;
    await sql`insert into domains (host, tenant_id, is_primary) values ('pudim.com.br', ${tid}, true)`;
    await sql`update store_settings set tagline = 'Minha loja' where tenant_id = ${tid}`;
    await sql`update merchant_users set status = 'revoked' where tenant_id = ${tid}`;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tid}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    await sql`insert into categories (tenant_id, slug, name) values (${tid}, 'doces', 'Doces')`;
    await sql`update leads set name = 'Editado' where source = 'seed'`;

    seed({
      NODE_ENV: 'production',
      SEED_DOMAINS: 'quero-pudim:pudim.example.test|novo.example.test',
    });

    expect(await sql`select 1 from tenants where id = ${brasa}`).toHaveLength(1);
    expect((await sql`select name from tenants where id = ${tid}`)[0]!.name).toBe('Pudim do Dono');
    const domains = await sql`select host, is_primary from domains where tenant_id = ${tid}`;
    expect(domains.find((d) => d.is_primary)?.host).toBe('pudim.com.br');
    // a new SEED_DOMAINS host is still added, never as a second primary
    expect(domains.map((d) => d.host)).toContain('novo.example.test');
    expect(
      (await sql`select tagline from store_settings where tenant_id = ${tid}`)[0]!.tagline,
    ).toBe('Minha loja');
    expect(
      (await sql`select status from merchant_users where tenant_id = ${tid}`).map((u) => u.status),
    ).toEqual(['revoked']);
    expect(await sql`select 1 from delivery_zones where tenant_id = ${tid}`).toHaveLength(1);
    expect(await sql`select 1 from categories where tenant_id = ${tid}`).toHaveLength(1);
    expect((await sql`select name from leads where source = 'seed'`).map((l) => l.name)).toEqual([
      'Editado',
    ]);
  });

  test('dev re-seeding still resets the store to blank', async () => {
    seed({ NODE_ENV: 'development' });
    expect(await sql`select 1 from categories where tenant_id = ${tid}`).toHaveLength(0);
    expect(await sql`select 1 from domains where host = 'pudim.com.br'`).toHaveLength(0);
    expect(
      (await sql`select tagline from store_settings where tenant_id = ${tid}`)[0]!.tagline,
    ).toBeNull();
    const owner = await sql`
      select status from merchant_users where tenant_id = ${tid} and phone = '22999990001'
    `;
    expect(owner.map((u) => u.status)).toEqual(['active']);
  });
});

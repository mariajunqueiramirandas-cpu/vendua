import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { getProductById, getProductsById } from '../src/modules/catalog.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// Checkout loads its lines with getProductsById; it must see exactly what the one-by-one
// loader sees — modifiers, gallery, kit slots, waitlist — for every kind of product.
describe.skipIf(!process.env.TEST_DATABASE_URL)('getProductsById', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const slug = `batch-${crypto.randomUUID().slice(0, 8)}`;
  let tenantId = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`
      insert into store_settings (tenant_id, hours)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })})
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id
      `
    )[0]!.id;
    const prod = async (s: string, extra: Record<string, unknown> = {}) =>
      (ids[s] = (
        await sql<{ id: string }[]>`
          insert into products ${sql({ tenant_id: tenantId, category_id: cat, slug: s, name: s, base_price_cents: 1000, ...extra } as never)}
          returning id
        `
      )[0]!.id);
    await prod('simples');
    await prod('esgotado', { stock_quantity: 0 });
    await prod('opcoes');
    await prod('fotos');
    await prod('kit', { kind: 'combo' });
    await prod('arquivado', { status: 'archived' });

    await sql`
      insert into notify_requests (tenant_id, subject, product_id, channel, contact)
      values (${tenantId}, 'product', ${ids.esgotado!}, 'whatsapp', '22999990001'),
             (${tenantId}, 'product', ${ids.esgotado!}, 'whatsapp', '22999990002')
    `;
    const [g1, g2] = await sql<{ id: string }[]>`
      insert into modifier_groups (tenant_id, product_id, name, required, min_select, max_select, sort)
      values (${tenantId}, ${ids.opcoes!}, 'Tamanho', true, 1, 1, 0),
             (${tenantId}, ${ids.opcoes!}, 'Extras', false, 0, 3, 1)
      returning id
    `;
    await sql`
      insert into modifiers (tenant_id, group_id, name, price_delta_cents, status, sort)
      values (${tenantId}, ${g1!.id}, 'Grande', 500, 'active', 1),
             (${tenantId}, ${g1!.id}, 'Pequeno', 0, 'active', 0),
             (${tenantId}, ${g2!.id}, 'Calda', 200, 'sold_out', 0)
    `;
    await sql`
      insert into product_media (tenant_id, product_id, url, alt, width, height, sort)
      values (${tenantId}, ${ids.fotos!}, 'https://cdn.x/2.webp', null, null, null, 1),
             (${tenantId}, ${ids.fotos!}, 'https://cdn.x/1.webp', 'Frente', 800, 600, 0)
    `;
    const slot = (
      await sql<{ id: string }[]>`
        insert into combo_slots (tenant_id, product_id, name, min_select, max_select)
        values (${tenantId}, ${ids.kit!}, 'Sabores', 2, 2) returning id
      `
    )[0]!.id;
    await sql`
      insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
      values (${tenantId}, ${slot}, ${ids.simples!}, 0, 0), (${tenantId}, ${slot}, ${ids.fotos!}, 150, 1)
    `;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('matches getProductById for every product; archived and repeated ids are handled', async () => {
    const all = Object.values(ids);
    await withTenant(sql, tenantId, async (tx) => {
      const batch = await getProductsById(tx, tenantId, [...all, ids.opcoes!], { forUpdate: true });
      expect(batch.size).toBe(all.length - 1);
      expect(batch.has(ids.arquivado!)).toBe(false);
      for (const id of all)
        expect(batch.get(id) ?? null).toEqual(await getProductById(tx, tenantId, id));

      const opcoes = batch.get(ids.opcoes!)!;
      expect(opcoes.modifierGroups.map((g) => g.name)).toEqual(['Tamanho', 'Extras']);
      expect(opcoes.modifierGroups[0]!.modifiers.map((m) => m.name)).toEqual(['Pequeno', 'Grande']);
      expect(batch.get(ids.fotos!)!.gallery.map((m) => m.alt)).toEqual(['Frente', null]);
      expect(batch.get(ids.esgotado!)!.waitlistCount).toBe(2);
      expect(batch.get(ids.kit!)!.comboSlots[0]!.items.map((i) => i.slug)).toEqual([
        'simples',
        'fotos',
      ]);
      expect((await getProductsById(tx, tenantId, [])).size).toBe(0);
    });
  });
});

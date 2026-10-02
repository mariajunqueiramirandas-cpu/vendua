// Real phone screenshots of the customer storefront of the fictional store Bolos da Nena, for
// Frame 4 (cardápio, preço, Pix). Dev database only: it turns the seed store into Bolos da Nena the
// way site/scripts/assets.ts does (menu, hours, delivery zones), sets a Pix key so the order page
// shows the QR, opens the store for the shoot and puts the hours back after.
//
// Needs Core on :8787 started with VENDUA_ADMIN_DEV_OTP=1, and `bun run dev` in storefronts/_template
// (:5175). Run: node videos/vendua-audio-47s/scripts/storefront-shots.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const OUT = join(HERE, '../capture/assets');
const CORE = process.env.CORE ?? 'http://localhost:8787';
const STORE = process.env.STORE ?? 'http://bolosdanena.localhost:5175';
const DB = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const PHONE = process.env.PHONE ?? '22999990001';
const SLUG = 'bolosdanena';
const { chromium } = await import(
  join(REPO, 'node_modules/.bun/playwright-core@1.63.0/node_modules/playwright-core/index.mjs')
);

if (!/localhost|127\.0\.0\.1/.test(DB)) throw new Error('dev database only');
const sql = (q) => execFileSync('psql', [DB, '-At', '-c', q], { encoding: 'utf8' }).trim();

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${CORE}/admin/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-vendua-admin': '1',
      'idempotency-key': crypto.randomUUID(),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400)
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// the same store the site's admin screens show (site/scripts/assets.ts MENU, NENA_HOURS)
const MENU = [
  [
    'Bolos inteiros',
    'Bolo de cenoura com brigadeiro - 45,00\nBolo de chocolate molhadinho - 48,00\nBolo de fubá com goiabada - 38,00\nBolo de milho cremoso - 40,00\nBolo de laranja com calda - 38,00\nBolo de banana com canela - 40,00',
  ],
  [
    'Fatias do dia',
    'Fatia de cenoura com brigadeiro - 9,00\nFatia de chocolate - 9,50\nFatia de fubá com goiabada - 8,00',
  ],
  [
    'Encomendas',
    'Bolo de aniversário 2 kg - 160,00\nBolo de aniversário 3 kg - 230,00\nKit festa: bolo + 50 docinhos - 210,00',
  ],
  ['Para acompanhar', 'Café coado 300 ml - 6,00\nSuco de laranja 400 ml - 9,00'],
];
const NENA_HOURS = [
  { days: [2, 3, 4, 5, 6], open: '08:00', close: '18:00' },
  { days: [0], open: '08:00', close: '12:00' },
];
const OPEN_ALL_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }];

async function seed() {
  const id = sql(
    `select id from tenants where slug in ('${SLUG}', 'quero-pudim') order by (slug = '${SLUG}') desc limit 1`,
  );
  if (!id) throw new Error('no seed store: run `bun run seed` in packages/core first');
  sql(`update tenants set slug = '${SLUG}', name = 'Bolos da Nena' where id = '${id}'`);
  sql(
    `insert into domains (host, tenant_id, is_primary) values ('${SLUG}.localhost', '${id}', false) on conflict do nothing`,
  );
  sql(`update merchant_users set name = 'Nena' where tenant_id = '${id}' and phone = '${PHONE}'`);
  const start = await api('POST', '/auth/otp/start', { phone: PHONE });
  const code = start.devCode ?? JSON.stringify(start).match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error('no dev sign-in code: start Core with VENDUA_ADMIN_DEV_OTP=1');
  await api('POST', '/auth/otp/verify', { phone: PHONE, code });
  if (Number(sql(`select count(*) from products where tenant_id = '${id}'`)) === 0) {
    await api('PATCH', '/store', {
      profile: {
        name: 'Bolos da Nena',
        tagline: 'Bolo de vó, feito hoje.',
        description:
          'Bolos caseiros assados todo dia de manhã, na cozinha da Nena. Fatias no balcão e bolos inteiros por encomenda.',
        instagram: '@bolosdanena',
        city: 'Campos dos Goytacazes',
        address: 'Rua dos Goitacazes, 214, Centro',
      },
      hours: NENA_HOURS,
      operations: { pickupEnabled: true, deliveryEnabled: true, prepTimeMinutes: 30 },
    });
    for (const [name, hoods, feeCents] of [
      ['Centro', ['Centro', 'Parque Tamandaré', 'Pelinca'], 500],
      ['Bairros próximos', ['Parque Califórnia', 'Jardim Carioca', 'Turf Club'], 800],
    ])
      await api('POST', '/zones', { name, kind: 'neighborhood', neighborhoods: hoods, feeCents });
    for (const [name, text] of MENU) {
      const c = await api('POST', '/categories', { name });
      await api('POST', '/products/import', { text, categoryId: c.category.id });
    }
    console.log('seeded the Bolos da Nena menu');
  }
  // a fictional key: the order page builds its static Pix QR from it
  await api('PATCH', '/payments', {
    pix: {
      key: 'pedidos@bolosdanena.com.br',
      keyType: 'email',
      beneficiary: 'Bolos da Nena',
      city: 'Campos',
    },
  });
}

async function webp(page, name) {
  const png = join(OUT, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    png,
    '-c:v',
    'libwebp',
    '-quality',
    '86',
    join(OUT, `${name}-750.webp`),
  ]);
  execFileSync('rm', [png]);
  console.log('shot', name);
}

await seed();
mkdirSync(OUT, { recursive: true });
let browser;
try {
  await api('PATCH', '/store', { hours: OPEN_ALL_DAY });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--disable-gpu', '--host-resolver-rules=MAP *.localhost 127.0.0.1'],
  });
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  await page.goto(`${STORE}/cardapio`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await webp(page, 'vitrine-cardapio');

  // Luiz's cake: open it, add it, check out
  await page.getByText('Bolo de chocolate molhadinho').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await webp(page, 'vitrine-produto');
  await page.locator('[data-vendua="add-to-cart"]').first().click();
  await page.waitForTimeout(600);
  const trigger = page.locator('[data-vendua="cart-trigger"]').first();
  if (await trigger.count()) await trigger.click();
  else await page.goto(`${STORE}/sacola`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('[data-vendua="checkout-button"]').first().click();
  await page.waitForLoadState('networkidle');
  await page
    .locator('input[name="name"], input[autocomplete="name"]')
    .first()
    .fill('Luiz Fernando');
  await page.locator('input[name="phone"], input[type="tel"]').first().fill('22994447777');
  await page
    .getByRole('button', { name: /continuar/i })
    .first()
    .click();
  await page.waitForTimeout(600);
  await page
    .getByRole('radio', { name: /retirada|retirar/i })
    .first()
    .click({ force: true });
  await page.waitForTimeout(300);
  await page
    .getByRole('button', { name: /continuar/i })
    .first()
    .click();
  await page.waitForTimeout(800);
  const pix = page.getByRole('radio', { name: /pix/i }).first();
  if (await pix.count()) await pix.click({ force: true });
  await page.waitForTimeout(400);
  await webp(page, 'vitrine-pagamento');
  await page
    .getByRole('button', { name: /confirmar|finalizar|fazer pedido|enviar pedido/i })
    .first()
    .click();
  await page.waitForURL(/\/pedido\//, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await webp(page, 'vitrine-pix');
} finally {
  await browser?.close();
  await api('PATCH', '/store', { hours: NENA_HOURS }).catch((e) =>
    console.error('hours not restored:', e.message),
  );
}

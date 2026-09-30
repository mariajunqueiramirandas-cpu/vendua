// Produces the site's images from the real product. Nothing here runs at build time: the outputs are
// committed, and this is how to regenerate them.
//
//   bun scripts/assets.ts dua        Duá poses from /brand/mascote → static/dua/*.webp (480 px)
//   bun scripts/assets.ts screens    real admin screens of the fictional store "Bolos da Nena", in Creme
//                                    and Noite → static/screens/*.webp, plus src/lib/screens.facts.json
//   bun scripts/assets.ts og         the social card → static/og.png (needs the screens)
//
// `screens` needs the local stack (the `local-stack` skill): Postgres on :5433, Core on :8787 started
// with VENDUA_ADMIN_DEV_OTP=1, and the admin dev server on :5196. It turns the seed store into Bolos da
// Nena (menu, hours, delivery areas, a month of orders), moves the orders' dates to today so "Vendas de
// hoje" isn't empty, forces the store open (morning shots) and then closed ("Seu dia"), and pins the
// browser clock so the greeting reads "Bom dia" / "Boa noite". Dev database only.
import { chromium, type Browser, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { KINDS, SCREENS, THEMES, type ScreenKey } from '../src/lib/screens';

const ROOT = join(import.meta.dir, '..');
const REPO = join(ROOT, '..');
const CORE = process.env.CORE ?? 'http://localhost:8787';
const ADMIN = process.env.ADMIN ?? 'http://localhost:5196/admin/';
const DB = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const PHONE = process.env.PHONE ?? '22999990001';
const AUTH = process.env.AUTH_STATE ?? '/tmp/vendua-admin-auth.json';
const CHROMIUM =
  process.env.CHROMIUM ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const TZ = 'America/Sao_Paulo';
const SLUG = 'bolosdanena';

const launch = () => chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

/** PNG/WebP bytes → WebP at the given widths, via the browser's own encoder (no native deps). */
async function encode(page: Page, bytes: Buffer, mime: string, widths: number[], quality = 0.86) {
  const uri = `data:${mime};base64,${bytes.toString('base64')}`;
  const out: string[] = await page.evaluate(
    async ({ uri, widths, quality }) => {
      const img = new Image();
      img.src = uri;
      await img.decode();
      return widths.map((w) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = Math.round((img.height * w) / img.width);
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/webp', quality);
      });
    },
    { uri, widths, quality },
  );
  return out.map((d) => Buffer.from(d.split(',')[1]!, 'base64'));
}

// ── dua ──────────────────────────────────────────────────────────────────
async function dua(browser: Browser) {
  const src = join(REPO, 'brand/mascote');
  const out = join(ROOT, 'static/dua');
  mkdirSync(out, { recursive: true });
  const page = await browser.newPage();
  for (const f of readdirSync(src).filter((f) => f.endsWith('.webp'))) {
    const [webp] = await encode(page, readFileSync(join(src, f)), 'image/webp', [480], 0.84);
    writeFileSync(join(out, f), webp!);
  }
  writeFileSync(
    join(ROOT, 'static/assets/brand/app-icon.png'),
    readFileSync(join(REPO, 'apps/admin/public/icons/icon-192.png')),
  );
  console.log(`dua: ${readdirSync(out).length} poses → static/dua/`);
}

// ── screens ──────────────────────────────────────────────────────────────
const MENU: [string, string][] = [
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

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
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
  if (set) cookie = set.split(';')[0]!;
  const json = (await res.json().catch(() => ({}))) as any;
  if (res.status >= 400)
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function signIn() {
  if (existsSync(AUTH)) {
    const st = JSON.parse(readFileSync(AUTH, 'utf8'));
    cookie = st.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
    const ok = await fetch(`${CORE}/admin/v1/session`, {
      headers: { cookie, 'x-vendua-admin': '1' },
    });
    if (ok.status === 200) return;
    cookie = '';
  }
  const start = await api('POST', '/auth/otp/start', { phone: PHONE });
  const code = start.devCode ?? JSON.stringify(start).match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error('no dev sign-in code: start Core with VENDUA_ADMIN_DEV_OTP=1');
  await api('POST', '/auth/otp/verify', { phone: PHONE, code });
  const [name, value] = cookie.split('=') as [string, string];
  writeFileSync(
    AUTH,
    JSON.stringify({
      cookies: [
        {
          name,
          value,
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}

/** Today's date in São Paulo, and that date at a local hour as a UTC instant (for the browser clock). */
function localToday() {
  const d = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const weekday = new Date(`${d}T12:00:00-03:00`).getUTCDay();
  return { date: d, weekday, at: (hh: string) => new Date(`${d}T${hh}:00-03:00`) };
}

async function seed(sql: postgres.Sql) {
  const t = (
    await sql<{ id: string }[]>`
      select id from tenants where slug in (${SLUG}, 'quero-pudim') order by (slug = ${SLUG}) desc limit 1`
  )[0];
  if (!t) throw new Error('no seed store: run `bun run seed` in packages/core first');
  await sql`update tenants set slug = ${SLUG}, name = 'Bolos da Nena' where id = ${t.id}`;
  await sql`insert into domains (host, tenant_id, is_primary) values (${`${SLUG}.localhost`}, ${t.id}, false) on conflict do nothing`;
  await sql`update merchant_users set name = 'Nena' where tenant_id = ${t.id} and phone = ${PHONE}`;
  await signIn();

  const products = (
    await sql<{ n: number }[]>`select count(*)::int as n from products where tenant_id = ${t.id}`
  )[0]!.n;
  if (products === 0) {
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
    ] as const)
      await api('POST', '/zones', { name, kind: 'neighborhood', neighborhoods: hoods, feeCents });
    for (const [name, text] of MENU) {
      const c = await api('POST', '/categories', { name });
      await api('POST', '/products/import', { text, categoryId: c.category.id });
    }
    console.log('seeded the Bolos da Nena menu');
  }

  const orders = (
    await sql<{ n: number }[]>`select count(*)::int as n from orders where tenant_id = ${t.id}`
  )[0]!.n;
  if (orders < 20) {
    const run = Bun.spawnSync(['bun', 'scripts/demo-orders.ts', '32'], {
      cwd: join(REPO, 'apps/admin'),
      env: { ...process.env, HOST: `${SLUG}.localhost`, CORE, DATABASE_URL: DB },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    if (run.exitCode !== 0) throw new Error('demo-orders failed');
  }

  // keep "today" today: shift every order so the newest one lands on today's date
  const today = localToday();
  const last = (
    await sql<{ d: string }[]>`
      select to_char(max(placed_at) at time zone ${TZ}, 'YYYY-MM-DD') as d from orders where tenant_id = ${t.id}`
  )[0]!.d;
  const days = Math.round((Date.parse(today.date) - Date.parse(last)) / 86_400_000);
  if (days > 0) {
    await sql`update orders set placed_at = placed_at + make_interval(days => ${days}), updated_at = updated_at + make_interval(days => ${days}) where tenant_id = ${t.id}`;
    await sql`update order_events set at = at + make_interval(days => ${days}) where tenant_id = ${t.id}`;
    console.log(`moved the orders ${days} day(s) forward to today`);
  }
  return t.id;
}

async function facts() {
  const home = await api('GET', '/home');
  const { orders } = await api('GET', '/orders?state=placed');
  const brl = (c: number) =>
    (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
  const o = (x: any) => ({
    id: x.id as string,
    number: x.number as number,
    customer: String(x.name).split(' ')[0],
    total: brl(x.totalCents),
    mode: x.mode === 'delivery' ? 'entrega' : 'retirada',
  });
  if (orders.length < 2)
    throw new Error('need two new orders on the board: rerun with a fresh database');
  return {
    owner: home.greetingName as string,
    salesToday: brl(home.today.salesCents),
    ordersToday: home.today.orders as number,
    newOrder: o(orders[0]),
    earlierOrder: o(orders[1]),
  };
}

/** the "Resumo do dia" the seuDia screen shows, formatted the way the admin's Home prints it */
async function dusk() {
  const home = await api('GET', '/home');
  const t = home.today;
  const short = (c: number) =>
    Math.round(c / 100)
      .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
      .replace(/\s/g, ' ');
  // the site's copy quotes every one of these; a quiet day would leave "Seu dia" with nothing to say
  if (!home.best?.[0] || !home.busiest || !t.lastWeekSalesCents || !t.orders)
    throw new Error(
      'the day has no recap to quote (best seller, busiest hour, last week): rerun demo orders',
    );
  return {
    bestSeller: { name: home.best[0].name as string, qty: home.best[0].qty as number },
    busiestHour: `${home.busiest.hour}h`,
    vsLastWeek: Math.round(((t.salesCents - t.lastWeekSalesCents) / t.lastWeekSalesCents) * 100),
    avgTicket: short(t.avgTicketCents),
  };
}

async function shoot(
  browser: Browser,
  key: ScreenKey,
  theme: (typeof THEMES)[number],
  clock: Date,
  route: string,
  act?: (p: Page) => Promise<void>,
) {
  const kind = SCREENS[key].kind;
  const vp = kind === 'phone' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  const mobile = kind === 'phone';
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: theme === 'noite' ? 'dark' : 'light',
    reducedMotion: 'reduce',
    storageState: AUTH,
    locale: 'pt-BR',
    timezoneId: TZ,
  });
  // one-time teaching hints stay dismissed: they'd cover the screen in every shot
  await ctx.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k: string) {
      return k.startsWith('vendua-hint:') ? '1' : get.call(this, k);
    };
  });
  const page = await ctx.newPage();
  await page.clock.setFixedTime(clock);
  await page.goto(new URL(route.replace(/^\//, ''), ADMIN).href);
  await page.waitForSelector('main, #root > *', { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
  if (act) {
    await act(page);
    await page.waitForTimeout(900);
  }
  const png = await page.screenshot();
  await ctx.close();
  return png;
}

async function screens(browser: Browser) {
  const sql = postgres(DB, { onnotice: () => {} });
  const out = join(ROOT, 'static/screens');
  mkdirSync(out, { recursive: true });
  try {
    await seed(sql);
    const today = localToday();

    // open, morning: every screen but "Seu dia"
    // plausible bakery hours that still cover "now", so the store reads Aberta and the hours screen
    // doesn't show 0h–23h59: 7h until a couple of hours from now, closed Mondays unless today is one
    const hourNow = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(
        new Date(),
      ),
    );
    const close =
      hourNow >= 21 ? '23:59' : `${String(Math.max(19, hourNow + 2)).padStart(2, '0')}:00`;
    const open = hourNow < 7 ? '00:00' : '07:00';
    const openDays = [0, 2, 3, 4, 5, 6].concat(today.weekday === 1 ? [1] : []);
    await api('PATCH', '/store', { hours: [{ days: openDays, open, close }] });
    const f = await facts();
    const morning = today.at('08:40');
    const plan: [ScreenKey, string, Date, ((p: Page) => Promise<void>)?][] = [
      ['inicio', '/', morning],
      ['pedidos', '/pedidos', morning],
      ['pedido', `/pedidos/${f.newOrder.id}`, morning],
      [
        'pausar',
        '/',
        morning,
        (p) =>
          p
            .getByRole('button', { name: /aberta/i })
            .first()
            .click(),
      ],
      ['cardapio', '/cardapio', morning],
      ['loja', '/loja', morning],
      ['boasVindas', '/bem-vindo', morning],
      ['quadro', '/pedidos', morning],
      ['inicioDesktop', '/', morning],
      ['relatorios', '/relatorios', morning],
      ['boasVindasDesktop', '/bem-vindo', morning],
    ];
    const encoder = await browser.newPage();
    const save = async (key: ScreenKey, theme: (typeof THEMES)[number], png: Buffer) => {
      const widths = KINDS[SCREENS[key].kind].widths;
      const files = await encode(encoder, png, 'image/png', widths);
      files.forEach((b, i) => writeFileSync(join(out, `${key}-${theme}-${widths[i]}.webp`), b));
    };
    for (const [key, route, clock, act] of plan)
      for (const theme of THEMES) {
        await save(key, theme, await shoot(browser, key, theme, clock, route, act));
        console.log(`screens: ${key} ${theme}`);
      }

    // closed for the rest of today (Nena's usual hours on every other day), evening: "Seu dia"
    await api('PATCH', '/store', {
      hours: [
        {
          days: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today.weekday),
          open: '08:00',
          close: '18:00',
        },
      ],
    });
    for (const theme of THEMES) {
      await save('seuDia', theme, await shoot(browser, 'seuDia', theme, today.at('19:07'), '/'));
      console.log(`screens: seuDia ${theme}`);
    }
    const seuDia = await dusk();
    await api('PATCH', '/store', { hours: NENA_HOURS });

    const { id: _a, ...newOrder } = f.newOrder;
    const { id: _b, ...earlierOrder } = f.earlierOrder;
    const factsFile = join(ROOT, 'src/lib/screens.facts.json');
    mkdirSync(dirname(factsFile), { recursive: true });
    writeFileSync(
      factsFile,
      JSON.stringify({ ...f, newOrder, earlierOrder, seuDia }, null, 2) + '\n',
    );
    console.log('facts:', JSON.stringify({ ...f, newOrder, earlierOrder, seuDia }));
  } finally {
    await sql.end();
  }
}

// ── og ───────────────────────────────────────────────────────────────────
async function og(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const b64 = (p: string) => readFileSync(join(ROOT, 'static', p)).toString('base64');
  // a setContent page can't load file:// fonts, so the woff2 files go in as data URIs
  const font = (p: string) => readFileSync(join(ROOT, 'node_modules', p)).toString('base64');
  const html = readFileSync(join(ROOT, 'scripts/og.html'), 'utf8')
    .replace('{{SCREEN}}', `data:image/webp;base64,${b64('screens/inicio-creme-750.webp')}`)
    .replace('{{DUA}}', `data:image/webp;base64,${b64('dua/avatar-ola.webp')}`)
    .replace(
      '@@FIGTREE@@',
      font('@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2'),
    )
    .replace(
      '@@GROTESK@@',
      font('@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2'),
    )
    .replace(
      '@@SERIF@@',
      font('@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2'),
    );
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ROOT, 'static/og.png') });
  console.log('og: static/og.png');
}

const cmd = process.argv[2] ?? 'all';
const browser = await launch();
try {
  if (cmd === 'dua' || cmd === 'all') await dua(browser);
  if (cmd === 'screens' || cmd === 'all') await screens(browser);
  if (cmd === 'og' || cmd === 'all') await og(browser);
} finally {
  await browser.close();
}

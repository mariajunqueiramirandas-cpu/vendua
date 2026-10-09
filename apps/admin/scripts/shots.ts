// Screenshots + layout/a11y gate for the merchant admin (docs/merchant-admin.md — quality gates).
//   bun scripts/shots.ts [route ...]      (defaults to every area)
// Env: CHROMIUM, BASE (http://localhost:5196/admin/), PHONE (22999990001, the seed's owner), STORE (quero-pudim),
//      OUT (./shots), THEMES (creme,noite), SIZES (phone,tablet,desktop), AXE=1 (fail on serious/critical
//      axe violations), LOCAL='{"vendua-copilot-dock":"1"}' (localStorage every page starts with),
//      PAGES (1: routes shot at once per theme × size)
// Core must run with VENDUA_ADMIN_DEV_OTP=1 so the sign-in code comes back in the response.
import AxeBuilder from '@axe-core/playwright';
import { chromium, type BrowserContext } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5196/admin/';
const PHONE = process.env.PHONE ?? '22999990001';
const STORE = process.env.STORE ?? 'quero-pudim';
const OUT = process.env.OUT ?? 'shots';
const THEMES = (process.env.THEMES ?? 'creme,noite').split(',') as ('creme' | 'noite')[];
const AXE = process.env.AXE === '1';
const SIZES = (process.env.SIZES ?? 'phone,tablet,desktop').split(',');
const LOCAL = process.env.LOCAL ? (JSON.parse(process.env.LOCAL) as Record<string, string>) : null;
const AUTH = process.env.AUTH_STATE ?? '/tmp/vendua-admin-auth.json';
const PAGES = Math.max(1, Number(process.env.PAGES) || 1);
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/',
      '/pedidos',
      '/cozinha',
      '/cozinha/painel',
      '/pedidos/historico',
      '/pedidos/agendados',
      '/cardapio',
      '/cardapio/importar',
      '/cardapio/estoque',
      '/loja',
      '/pagamentos',
      '/whatsapp',
      '/impressoras',
      '/clientes',
      '/marketing',
      '/aparencia',
      '/relatorios',
      '/equipe',
      '/conta',
      '/perfil',
      '/ajuda',
      '/vendedor',
      '/vendedor/comecar',
      '/vendedor/conversas',
      '/vendedor/ensinar',
      '/vendedor/ensaio',
      '/vendedor/cliente-oculto',
      '/vendedor/resultados',
      '/vendedor/configurar',
      '/vendedor/testar',
      '/copiloto',
      '/comecar',
      '/bem-vindo',
      '/_ui',
    ];
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
await ensureAuth();
let failures = 0;
for (const theme of THEMES) {
  for (const vp of VIEWPORTS.filter((v) => SIZES.includes(v.name))) {
    const ctx: BrowserContext = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
      colorScheme: theme === 'noite' ? 'dark' : 'light',
      reducedMotion: 'reduce',
      storageState: AUTH,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    if (LOCAL)
      await ctx.addInitScript((entries) => {
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
      }, LOCAL);
    const errors: string[] = [];
    // PAGES routes at once, each page with its own listeners (CI: 4; the default is one at a time)
    const queue = [...routes];
    const worker = async () => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
          errors.push(m.text());
      });
      page.on('response', (r) => {
        // map tiles and the live stream are outside this gate
        if (r.status() >= 400 && !r.url().includes('openstreetmap'))
          errors.push(`${r.status()} ${r.url()}`);
      });
      for (let r = queue.shift(); r !== undefined; r = queue.shift()) {
        await page.goto(new URL(r.replace(/^\//, ''), BASE).href);
        await page.waitForSelector('main, #root > *', { timeout: 15_000 });
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(500);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        const file = `${OUT}/${theme}-${vp.name}${r.replace(/[/?=&#]+/g, '_') || '_home'}.png`;
        await page.screenshot({ path: file, fullPage: vp.name === 'phone' });
        let flag = overflow > 0 ? `  ✗ horizontal overflow ${overflow}px` : '';
        if (overflow > 0) {
          failures++;
          // name what sticks out, so a failure on CI's data can be fixed without reproducing it
          const culprits = await page.evaluate(() => {
            const w = document.documentElement.clientWidth;
            const past = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
              (el) => {
                const b = el.getBoundingClientRect();
                return b.width > 0 && b.right > w + 0.5;
              },
            );
            // the innermost ones: an element whose children all fit is the one to look at
            return past
              .filter((el) => !past.some((o) => o !== el && el.contains(o)))
              .slice(0, 5)
              .map((el) => {
                const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
                const right = el.getBoundingClientRect().right.toFixed(1);
                return `${el.tagName.toLowerCase()}.${cls} right=${right} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
              });
          });
          for (const c of culprits) console.log(`    ↳ ${c}`);
        }
        if (AXE && vp.name !== 'tablet') {
          const res = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
            .analyze();
          const bad = res.violations.filter(
            (v) => v.impact === 'serious' || v.impact === 'critical',
          );
          for (const v of bad)
            console.log(
              `  ✗ axe ${v.id} (${v.impact}) on ${r}: ${v.nodes
                .slice(0, 3)
                .map((n) => n.target.join(' '))
                .join(' | ')}`,
            );
          failures += bad.length;
          if (bad.length) flag += `  ✗ ${bad.length} axe`;
        }
        console.log(`${theme.padEnd(6)} ${vp.name.padEnd(8)} ${r.padEnd(22)} → ${file}${flag}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGES, routes.length) }, worker));
    for (const e of errors) console.log(`  ✗ ${theme} ${vp.name} console: ${e}`);
    failures += errors.length;
    await ctx.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);

async function ensureAuth() {
  if (existsSync(AUTH)) {
    const ctx = await browser.newContext({ storageState: AUTH });
    const ok = (await ctx.request.get(new URL('v1/session', BASE).href)).ok();
    await ctx.close();
    if (ok) return;
  }
  const ctx = await browser.newContext();
  const h = { 'x-vendua-admin': '1', 'idempotency-key': crypto.randomUUID() };
  const start = await ctx.request.post(new URL('v1/auth/otp/start', BASE).href, {
    data: { phone: PHONE },
    headers: h,
  });
  const { devCode } = (await start.json()) as { devCode?: string };
  if (!devCode)
    throw new Error('no devCode — run Core with VENDUA_ADMIN_DEV_OTP=1 and seed a merchant user');
  const v = await ctx.request.post(new URL('v1/auth/otp/verify', BASE).href, {
    data: { phone: PHONE, code: devCode },
    headers: h,
  });
  const body = (await v.json()) as {
    signedIn: boolean;
    pickerToken?: string;
    stores?: { id: string; slug: string }[];
  };
  if (!body.signedIn) {
    const s = body.stores!.find((x) => x.slug === STORE) ?? body.stores![0]!;
    const pick = await ctx.request.post(new URL('v1/auth/select', BASE).href, {
      data: { pickerToken: body.pickerToken, storeId: s.id },
      headers: h,
    });
    if (!pick.ok()) throw new Error(`select failed: ${pick.status()}`);
  }
  await ctx.storageState({ path: AUTH });
  await ctx.close();
}

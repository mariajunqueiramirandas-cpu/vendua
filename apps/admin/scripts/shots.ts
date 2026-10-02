// Screenshots + layout/a11y gate for the merchant admin (docs/merchant-admin.md — quality gates).
//   bun scripts/shots.ts [route ...]      (defaults to every area)
// Env: CHROMIUM, BASE (http://localhost:5196/admin/), PHONE (22999990001, the seed's owner), STORE (quero-pudim),
//      OUT (./shots), THEMES (creme,noite), AXE=1 (fail on serious/critical axe violations)
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
const AUTH = process.env.AUTH_STATE ?? '/tmp/vendua-admin-auth.json';
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      '/',
      '/pedidos',
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
  for (const vp of VIEWPORTS) {
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
    const page = await ctx.newPage();
    const errors: string[] = [];
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
    for (const r of routes) {
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
      if (overflow > 0) failures++;
      if (AXE && vp.name !== 'tablet') {
        const res = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
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

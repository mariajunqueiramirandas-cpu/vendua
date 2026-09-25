// Screenshot + layout smoke for the control app.
//   bun scripts/shots.ts [route ...]      (defaults to every hub)
// Env: CHROMIUM, BASE (http://localhost:5196/control/), CONTROL_KEY (dev), OUT (./shots), THEME (light|dark)
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5196/control/';
const KEY = process.env.CONTROL_KEY ?? 'dev';
const OUT = process.env.OUT ?? 'shots';
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light';
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/pipeline', '/pipeline?v=board', '/inbox', '/agenda', '/agente/atividade', '/config'];
const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

mkdirSync(OUT, { recursive: true });
// CHROMIUM overrides the bundled browser (e.g. /opt/pw-browsers/chromium in cloud sessions)
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
let failures = 0;
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    colorScheme: THEME,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // failed fetches are reported with their URL by the response hook below
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      errors.push(m.text());
  });
  await login(page);
  page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
  for (const r of routes) {
    await page.goto(`${BASE}#${r}`);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const file = `${OUT}/${vp.name}${r.replace(/[/?=&]+/g, '_') || '_home'}.png`;
    await page.screenshot({ path: file });
    const flag = overflow > 0 ? `  ✗ horizontal overflow ${overflow}px` : '';
    if (overflow > 0) failures++;
    console.log(`${vp.name.padEnd(8)} ${r.padEnd(28)} → ${file}${flag}`);
  }
  for (const e of errors) console.log(`  ✗ ${vp.name} console: ${e}`);
  failures += errors.length;
  await ctx.close();
}
await browser.close();
process.exit(failures ? 1 : 0);

async function login(page: Page) {
  await page.goto(BASE);
  await page.waitForSelector('input[placeholder="chave de acesso"], main', { timeout: 15_000 });
  const input = page.getByPlaceholder('chave de acesso');
  if (await input.isVisible()) {
    await input.fill(KEY);
    await page.getByRole('button', { name: 'entrar' }).click();
    await page.waitForSelector('main', { timeout: 15_000 });
  }
}

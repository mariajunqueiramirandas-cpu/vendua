// Screenshots + layout gate for the site, like apps/admin/scripts/shots.ts.
//   bun scripts/shots.ts [route …]         (default: every page)
// Env: BASE (http://127.0.0.1:5173), OUT (./shots), WIDTHS (375,768,1280,1440), THEMES (light,dark),
//      SELECTOR (screenshot one element instead of the full page), CHROMIUM
// Fails on horizontal overflow, console errors and failed requests.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? 'shots';
const WIDTHS = (process.env.WIDTHS ?? '375,768,1280,1440').split(',').map(Number);
const THEMES = (process.env.THEMES ?? 'light,dark').split(',') as ('light' | 'dark')[];
const SELECTOR = process.env.SELECTOR;
const CHROMIUM =
  process.env.CHROMIUM ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const routes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/privacidade/', '/nao-existe/'];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
let failures = 0;
for (const theme of THEMES)
  for (const width of WIDTHS) {
    const page = await browser.newPage({
      viewport: { width, height: 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on(
      'console',
      (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()),
    );
    page.on('requestfailed', (r) => errors.push(`failed ${r.url()}`));
    for (const route of routes) {
      await page.goto(new URL(route, BASE).href, { waitUntil: 'networkidle' });
      // lazy images below the fold: scroll through once so the full-page shot has them
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const name = `${theme}-${width}${route.replace(/\/+/g, '_').replace(/_$/, '') || '_home'}`;
      const file = `${OUT}/${name}.png`;
      if (SELECTOR) await page.locator(SELECTOR).first().screenshot({ path: file });
      else await page.screenshot({ path: file, fullPage: true });
      const problems = [
        ...(overflow > 0 ? [`${overflow}px horizontal overflow`] : []),
        ...errors.splice(0),
      ];
      if (problems.length) failures++;
      console.log(
        `${problems.length ? '✗' : '✓'} ${name}${problems.length ? '  ' + problems.join('; ') : ''}`,
      );
    }
    await page.close();
  }
await browser.close();
process.exit(failures ? 1 : 0);

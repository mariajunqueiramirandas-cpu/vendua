// bun brand/social/render.ts [name]: screenshots brand/social/<name>.html (default story-lancamento)
// at its 1080×1920 size into <name>.png. Playwright and the fonts come from site/node_modules.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = dirname(new URL(import.meta.url).pathname);
const { chromium } = createRequire(join(here, '../../site/package.json'))(
  '@playwright/test',
) as typeof import('../../site/node_modules/@playwright/test');
const name = process.argv[2] ?? 'story-lancamento';
const CHROMIUM =
  process.env.CHROMIUM ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(pathToFileURL(join(here, `${name}.html`)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(here, `${name}.png`) });
await browser.close();
console.log(`brand/social/${name}.png`);

// Draws the store app's icon and splash sources into assets/ from the PWA's icon (ADR 0044 §7),
// then @capacitor/assets turns them into every iOS and Android size. Committed; rerun after the
// brand changes:
//   CHROMIUM=/opt/pw-browsers/chromium bun scripts/app-assets.ts
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}assets/`;
mkdirSync(out, { recursive: true });
const svg = readFileSync(`${root}public/icons/icon.svg`, 'utf8');
// the icon without its tile: the stores round the corners themselves
const bag = svg.replace(/<rect[^>]*\/>/, '');
const GREEN = '#123c32';
const CREAM = '#f7f4ea';
const NIGHT = '#0a100d';

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
async function draw(name: string, size: number, bg: string | null, art: string, scale: number) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;background:${bg ?? 'transparent'};display:grid;place-items:center}svg{width:${size * scale}px;height:${size * scale}px}</style>${art}`,
  );
  await page.screenshot({ path: `${out}${name}`, omitBackground: !bg, type: 'png' });
}
// iOS and the Play listing: the full square, no transparency
await draw('icon-only.png', 1024, GREEN, bag, 1);
// Android's adaptive icon: @capacitor/assets insets the foreground to the 66% safe zone, so the
// bag is drawn larger here to come out the size it is on iOS
await draw('icon-foreground.png', 1024, null, bag, 1.5);
await draw('icon-background.png', 1024, GREEN, '', 1);
// the splash: the tile on the page's own background, Creme and Noite
await draw('splash.png', 2732, CREAM, svg, 0.12);
await draw('splash-dark.png', 2732, NIGHT, svg, 0.12);
await browser.close();

execFileSync(
  'bunx',
  [
    '@capacitor/assets@3.0.5',
    'generate',
    '--ios',
    '--android',
    '--iconBackgroundColor',
    GREEN,
    '--iconBackgroundColorDark',
    GREEN,
    '--splashBackgroundColor',
    CREAM,
    '--splashBackgroundColorDark',
    NIGHT,
  ],
  { cwd: root, stdio: 'inherit' },
);

// the Capacitor template's splash art, which @capacitor/assets leaves beside its own
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  rmSync(`${root}ios/App/App/Assets.xcassets/Splash.imageset/${f}`, { force: true });

// Android 13's themed icon: the status-bar bag (res/drawable/ic_launcher_monochrome.xml)
for (const f of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const p = `${root}android/app/src/main/res/mipmap-anydpi-v26/${f}`;
  const xml = readFileSync(p, 'utf8');
  if (!xml.includes('<monochrome'))
    writeFileSync(
      p,
      xml.replace(
        '</adaptive-icon>',
        '    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />\n</adaptive-icon>',
      ),
    );
}

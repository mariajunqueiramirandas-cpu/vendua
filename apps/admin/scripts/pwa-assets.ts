// Draws the install-time art into public/: the notification badge, the app shortcut
// icons and the iOS splash screens. Committed; rerun after the brand changes.
//   CHROMIUM=/opt/pw-browsers/chromium bun scripts/pwa-assets.ts
// Store screenshots for the install dialog come from a running app:
//   CHROMIUM=… bun scripts/pwa-assets.ts --screenshots   (Core + dev server, as for shots.ts)
import { chromium, type Page } from '@playwright/test';
import { ForkKnife, Plus, Receipt } from '@phosphor-icons/react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SPLASH_DEVICES, splashName } from './splash-devices.ts';

const pub = new URL('../public/', import.meta.url).pathname;
const logo = readFileSync(`${pub}icons/icon.svg`, 'utf8');
const font = (f: string) =>
  readFileSync(
    new URL(`../node_modules/@fontsource-variable/space-grotesk/files/${f}`, import.meta.url),
  ).toString('base64');

const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);

async function draw(page: Page, html: string, w: number, h: number, out: string) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<!doctype html><style>
      @font-face{font-family:SG;src:url(data:font/woff2;base64,${font('space-grotesk-latin-wght-normal.woff2')}) format('woff2');font-weight:300 700}
      html,body{margin:0;width:${w}px;height:${h}px;background:transparent}
    </style>${html}`,
  );
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(`${pub}${out.split('/').slice(0, -1).join('/')}`, { recursive: true });
  await page.screenshot({ path: `${pub}${out}`, omitBackground: true, type: 'png' });
}

if (process.argv.includes('--screenshots')) {
  await screenshots();
} else {
  // badge: Android paints only the alpha, white in the status bar — the bag, cut-out knot
  const b = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  await draw(
    b,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 88 320 320" width="96" height="96">
      <mask id="m"><rect x="0" y="0" width="512" height="512" fill="#fff"/><circle cx="256" cy="298" r="26" fill="#000"/></mask>
      <g fill="#fff" mask="url(#m)">
        <path d="M142 182c0-17 13-30 30-30h168c17 0 30 13 30 30v22H142z"/>
        <path d="M152 222h208l-14 132c-2 15-15 26-30 26H196c-15 0-28-11-30-26z"/>
      </g>
      <path d="M206 152c0-28 22-50 50-50s50 22 50 50" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round"/>
    </svg>`,
    96,
    96,
    'icons/badge-96.png',
  );

  // shortcuts: the brand tile with the destination's icon
  const shortcuts = [
    ['orders', Receipt],
    ['menu', ForkKnife],
    ['new', Plus],
  ] as const;
  for (const [name, Icon] of shortcuts) {
    const svg = renderToStaticMarkup(
      createElement(Icon, { size: 60, weight: 'bold', color: '#d9f875' }),
    );
    await draw(
      b,
      `<div style="width:96px;height:96px;border-radius:22px;background:#123c32;display:grid;place-items:center">${svg}</div>`,
      96,
      96,
      `icons/shortcut-${name}.png`,
    );
  }

  // iOS splash: paper (or night) with the icon and the wordmark, like the app's first paint
  for (const dark of [false, true]) {
    for (const [w, h, dpr] of SPLASH_DEVICES) {
      const p = await (await browser.newContext({ deviceScaleFactor: dpr })).newPage();
      const size = Math.round(Math.min(w, h) * 0.26);
      await p.setViewportSize({ width: w, height: h });
      await p.setContent(
        `<!doctype html><style>
          @font-face{font-family:SG;src:url(data:font/woff2;base64,${font('space-grotesk-latin-wght-normal.woff2')}) format('woff2');font-weight:300 700}
          html,body{margin:0;height:100%}
          body{background:${dark ? '#0a100d' : '#f7f4ea'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(size * 0.2)}px}
          svg{width:${size}px;height:${size}px}
          p{margin:0;font:600 ${Math.round(size * 0.2)}px/1 SG;letter-spacing:-.02em;color:${dark ? '#f7f4ea' : '#123c32'}}
        </style>${logo}<p>Minha loja</p>`,
      );
      await p.evaluate(() => document.fonts.ready);
      const out = `${pub}${splashName(w, h, dpr, dark)}`;
      mkdirSync(`${pub}splash`, { recursive: true });
      await p.screenshot({ path: out, type: 'png' });
      await p.context().close();
    }
  }
  console.log(
    `badge, ${shortcuts.length} shortcut icons, ${SPLASH_DEVICES.length * 2} splash screens`,
  );
}
await browser.close();

// narrow (phones) + wide (desktop) shots for the richer install dialog, Creme theme
async function screenshots() {
  const BASE = process.env.BASE ?? 'http://localhost:5196/admin/';
  const AUTH = process.env.AUTH_STATE ?? '/tmp/vendua-admin-auth.json';
  const shots = [
    { file: 'inicio', route: '/', w: 390, h: 844, dpr: 2, label: 'O dia da loja num olhar' },
    {
      file: 'pedidos',
      route: '/pedidos',
      w: 390,
      h: 844,
      dpr: 2,
      label: 'Pedidos chegando ao vivo',
    },
    {
      file: 'cardapio',
      route: '/cardapio',
      w: 390,
      h: 844,
      dpr: 2,
      label: 'O cardápio na palma da mão',
    },
    {
      file: 'painel',
      route: '/pedidos',
      w: 1440,
      h: 900,
      dpr: 1,
      label: 'O quadro de pedidos no computador',
    },
  ];
  mkdirSync(`${pub}screenshots`, { recursive: true });
  const manifest = [];
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.w, height: s.h },
      deviceScaleFactor: s.dpr,
      isMobile: s.w < 800,
      hasTouch: s.w < 800,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      storageState: AUTH,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
    });
    // first-visit tips aren't what the store listing should show
    await ctx.addInitScript(() => {
      for (const h of ['orders-swipe', 'menu-longpress'])
        localStorage.setItem(`vendua-hint:${h}`, '1');
    });
    const page = await ctx.newPage();
    await page.goto(new URL(s.route.replace(/^\//, ''), BASE).href);
    await page.waitForSelector('main');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.addStyleTag({ content: '[class*="animate-"]{animation:none!important}' });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${pub}screenshots/${s.file}.jpg`, type: 'jpeg', quality: 82 });
    manifest.push({
      src: `/admin/screenshots/${s.file}.jpg`,
      sizes: `${s.w * s.dpr}x${s.h * s.dpr}`,
      type: 'image/jpeg',
      form_factor: s.w < 800 ? 'narrow' : 'wide',
      label: s.label,
    });
    await ctx.close();
  }
  writeFileSync('/dev/stdout', JSON.stringify(manifest, null, 2) + '\n');
}

// Records the real apps frame by frame in virtual time, for videos that show the product working.
//   node scripts/capture-ui.mjs <video> [clip...]
// Runs src/videos/<video>/capture.mjs, whose default export drives the pages (see `Rec` below), and
// encodes each clip to public/<video>/ui/<clip>.mp4 plus <clip>.json (frame marks and taps).
//
// Needs the local stack (the `local-stack` skill) on the dev database, started with a clean
// environment and fake payments, so nothing reaches a real provider:
//   env -i PATH="$PATH" HOME="$HOME" VENDUA_PAYMENTS_DRIVER=fake bun run dev:stack
//
// Why virtual time: a live screen recording drops frames under software rendering. Here each page's
// clock (timers, requestAnimationFrame, Date) only moves 1/30 s per captured frame, and every CSS
// or Web Animation is pinned to that clock, so the app's own motion lands frame-exact in the video.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { browserPath } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [id, ...only] = process.argv.slice(2);
const flowFile = id && join(root, 'src/videos', id, 'capture.mjs');
if (!flowFile || !existsSync(flowFile)) {
  console.error('usage: node scripts/capture-ui.mjs <video> [clip...]  (needs src/videos/<video>/capture.mjs)');
  process.exit(1);
}
const FPS = 30;
const STEP = 1000 / FPS;

// Pins every animation on the page to the virtual clock: one first seen at `vt` starts there.
// Finished ones are finished for real, so the app's onfinish handlers still run.
const syncAnimations = (vt) => {
  const seen = (window.__vSeen ??= new WeakMap());
  for (const a of document.getAnimations()) {
    // scroll-driven ones follow the scroll position, not time
    if (a.timeline && !(a.timeline instanceof DocumentTimeline)) continue;
    if (!seen.has(a)) seen.set(a, vt);
    const local = vt - seen.get(a);
    const end = a.effect?.getComputedTiming().endTime ?? Infinity;
    if (Number.isFinite(end) && local >= end) {
      if (a.playState !== 'finished') a.finish();
      continue;
    }
    if (a.playState !== 'paused') a.pause();
    a.currentTime = local;
  }
};

export class Rec {
  constructor(page, name, { quality = 92 } = {}) {
    this.page = page;
    this.name = name;
    this.quality = quality;
    this.dir = join(root, 'out', id, 'frames', name);
    this.n = 0;
    this.marks = {};
    this.taps = [];
    this.on = false;
  }

  /** advance virtual time without recording (loading, between takes) */
  async idle(ms) {
    for (let t = 0; t < ms; t += STEP) await this.tick();
  }

  /** real time passes for the network while the page's clock stands still */
  async settle(ms = 600) {
    await this.page.waitForTimeout(ms);
  }

  // virtual time lives on the page, so several clips can be cut from one page
  async tick() {
    await this.page.clock.runFor(STEP);
    this.page.__vt = (this.page.__vt ?? 0) + STEP;
    await this.page.evaluate(syncAnimations, this.page.__vt);
  }

  /** lets a page load: real time for the network, virtual time for its timers */
  async warm(rounds = 8) {
    for (let i = 0; i < rounds; i++) {
      await this.settle(250);
      await this.idle(120);
    }
  }

  start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.on = true;
  }

  /** record `count` frames, calling `each(i)` before each one (scrolls, typing) */
  async frames(count, each) {
    for (let i = 0; i < count; i++) {
      if (each) await each(i);
      await this.tick();
      if (!this.on) continue;
      await this.page.screenshot({
        path: join(this.dir, `${String(this.n).padStart(4, '0')}.jpg`),
        type: 'jpeg',
        quality: this.quality,
      });
      this.n++;
    }
  }

  seconds(s, each) {
    return this.frames(Math.round(s * FPS), each);
  }

  mark(label) {
    this.marks[label] = this.n;
  }

  /** a finger tap on the element's centre, logged for the video's tap marks (CSS px) */
  async tap(locator, label) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`tap: ${label ?? locator} is not on screen`);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    this.taps.push({ f: this.n, x, y, label });
    if (label) this.mark(label);
    await this.page.touchscreen.tap(x, y);
  }

  /** types like a thumb: one character every `every` frames */
  async type(locator, text, every = 2) {
    await locator.focus();
    for (const ch of text) {
      await this.page.keyboard.insertText(ch);
      await this.frames(every);
    }
  }

  /** scrolls the page by `dy` CSS px over `s` seconds on an ease-in-out curve */
  async scroll(dy, s) {
    const y0 = await this.page.evaluate(() => scrollY);
    const n = Math.round(s * FPS);
    await this.frames(n, (i) => {
      const x = (i + 1) / n;
      const e = x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
      return this.page.evaluate((y) => scrollTo(0, y), y0 + dy * e);
    });
  }

  finish() {
    this.on = false;
    const viewport = this.page.viewportSize();
    const outDir = join(root, 'public', id, 'ui');
    mkdirSync(outDir, { recursive: true });
    const mp4 = join(outDir, `${this.name}.mp4`);
    // a short GOP so Remotion can seek anywhere in a clip quickly; 4:2:0 needs even sides (375 × 3 is odd)
    const r = spawnSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(this.dir, '%04d.jpg'),
        '-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    writeFileSync(
      join(outDir, `${this.name}.json`),
      JSON.stringify({ frames: this.n, fps: FPS, viewport, marks: this.marks, taps: this.taps }, null, 2) + '\n',
    );
    console.log(`${this.name}: ${this.n} frames (${(this.n / FPS).toFixed(2)} s) → public/${id}/ui/${this.name}.mp4`);
  }
}

/** A phone-sized context whose page runs on a virtual clock that starts at `time`. */
async function phone(browser, { time, colorScheme = 'light', storageState, scale = 3 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: scale,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    ...(storageState ? { storageState } : {}),
  });
  // one-time teaching hints stay dismissed, as in the site's screenshots
  await ctx.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      return k.startsWith('vendua-hint:') ? '1' : get.call(this, k);
    };
  });
  await ctx.clock.install({ time: time ?? new Date() });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  return page;
}

const executablePath = browserPath() ?? undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const flow = (await import(pathToFileURL(flowFile).href)).default;
  await flow({ browser, phone, Rec, only: only.length ? new Set(only) : null, root });
} finally {
  await browser.close();
}

#!/usr/bin/env bun
// Maintenance kill-switch drill (roadmap 1b-ii): on a Venduá-owned store, flip
// the v.js kill switch in Core and prove the overlay renders (a) over the live
// Kernel and (b) on a broken build (every storefront bundle aborted), then turn
// it off and prove the store is back. Prints a markdown report.
//   bun src/drill-maintenance.ts <storefrontDir> <tenant> [report.md]
// Needs Core (VENDUA_CORE_ORIGIN) + CONTROL_SECRET; <tenant>.localhost must resolve.
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startPreview } from './preview.ts';

const [dirArg, tenant, reportFile] = process.argv.slice(2);
if (!dirArg || !tenant) {
  console.error('usage: drill-maintenance <storefrontDir> <tenant> [report.md]');
  process.exit(2);
}
const core = process.env.VENDUA_CORE_ORIGIN || 'http://localhost:8787';
const secret = process.env.CONTROL_SECRET;
if (!secret) throw new Error('CONTROL_SECRET required');
const port = Number(process.env.VENDUA_PREVIEW_PORT ?? 5188);
const MESSAGE = 'Drill: instabilidade — peça pelo WhatsApp';

const ops = async (loader: Record<string, unknown>) => {
  const r = await fetch(`${core}/control/v1/storefronts/${tenant}/ops`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      'x-vendua-control': secret,
      'idempotency-key': `drill:${Date.now()}:${Math.random()}`,
    },
    body: JSON.stringify({ loader }),
  });
  if (!r.ok) throw new Error(`ops PATCH ${r.status}: ${await r.text()}`);
};

const server = await startPreview({
  distDir: join(resolve(dirArg), 'dist'),
  port,
  coreOrigin: core,
});
const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'],
});
const url = `http://${tenant}.localhost:${port}/`;
const steps: [string, boolean, string][] = [];
const overlayText = async (page: import('@playwright/test').Page) => {
  await page
    .waitForSelector('#vendua-loader-overlay', { state: 'attached', timeout: 20_000 })
    .catch(() => {});
  return page.evaluate(() => {
    const s = document.getElementById('vendua-loader-overlay')?.shadowRoot;
    return s
      ? `${s.getElementById('vt')?.textContent ?? ''} — ${s.getElementById('vb')?.textContent ?? ''}`
      : '';
  });
};
try {
  await ops({ state: 'maintenance', message: MESSAGE });
  steps.push(['kill switch on (PATCH /control/v1/storefronts/:tenant/ops)', true, 'maintenance']);

  const live = await browser.newPage();
  await live.goto(url);
  await live.waitForTimeout(2000); // Kernel mounted + v.js handoff
  const t1 = await overlayText(live);
  steps.push(['overlay over a live Kernel', t1.includes('Drill'), t1.slice(0, 80)]);

  const broken = await browser.newContext();
  await broken.route('**/*', (r) => {
    const u = new URL(r.request().url());
    return u.pathname.endsWith('.js') && !u.pathname.startsWith('/v1/') ? r.abort() : r.continue();
  });
  const bp = await broken.newPage();
  await bp.goto(url);
  const t2 = await overlayText(bp);
  steps.push([
    'overlay on a broken build (bundle aborted, only v.js)',
    t2.includes('Drill'),
    t2.slice(0, 80),
  ]);

  await ops({ state: 'normal' });
  const back = await browser.newPage();
  await back.goto(url);
  await back.waitForTimeout(2500);
  const gone = await back.evaluate(() => !document.getElementById('vendua-loader-overlay'));
  steps.push(['kill switch off → store back', gone, gone ? 'no overlay' : 'overlay still present']);
} finally {
  await ops({ state: 'normal' }).catch(() => {});
  await browser.close();
  server.close();
}
const ok = steps.every((s) => s[1]);
const md = [
  `# Maintenance kill-switch drill — \`${tenant}\``,
  '',
  `${new Date().toISOString()} · artifact \`${dirArg}\` · Core ${core}`,
  '',
  '| Step | Result | Observed |',
  '| --- | --- | --- |',
  ...steps.map(
    ([s, pass, obs]) => `| ${s} | ${pass ? 'pass' : 'FAIL'} | ${obs.replace(/\|/g, '/')} |`,
  ),
  '',
  `**${ok ? 'Drill passed' : 'Drill FAILED'}.**`,
  '',
].join('\n');
console.log(md);
if (reportFile) writeFileSync(reportFile, md);
process.exit(ok ? 0 : 1);

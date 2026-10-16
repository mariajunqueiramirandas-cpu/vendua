// The app's bundle against Core from another origin, as on a phone (ADR 0044 §8): dist-native/
// served here on its own port, Core on :8787 with that origin allowed (VENDUA_ADMIN_APP_ORIGINS).
// Signs in through the screen, then checks that the session is a bearer token (no cookie), that
// every call is cross-origin and passes CORS, and that the live stream delivers a new order.
//   cd apps/admin && VITE_API_ORIGIN=http://localhost:8787 bun run build:native
//   (Core with VENDUA_ADMIN_APP_ORIGINS=http://localhost:5197 VENDUA_ADMIN_DEV_OTP=1)
//   CHROMIUM=/opt/pw-browsers/chromium bun scripts/native-smoke.ts
import { chromium, type Request } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = process.env.CORE ?? 'http://localhost:8787';
const PORT = Number(process.env.PORT ?? 5197);
const APP = `http://localhost:${PORT}`;
const PHONE = process.env.PHONE ?? '22999990001';
const STORE = new RegExp(process.env.STORE_NAME ?? 'pudim', 'i');
const dist = fileURLToPath(new URL('../dist-native/', import.meta.url));

if (!existsSync(join(dist, 'index.html'))) throw new Error('build dist-native first');
const index = readFileSync(join(dist, 'index.html'));
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', APP).pathname)).replace(
    /^\/+/,
    '',
  );
  const file = join(dist, path);
  if (path && file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    return void res.end(readFileSync(file));
  }
  // the WebView's router: any route is the app
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(index);
}).listen(PORT);

const problems: string[] = [];
const browser = await chromium.launch(
  process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {},
);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const calls: Request[] = [];
page.on('request', (r) => {
  if (r.url().startsWith(`${CORE}/admin/v1/`)) calls.push(r);
});
page.on('requestfailed', (r) => {
  // a stream torn down by navigation is not a failure
  if (r.url().startsWith(CORE) && !r.url().includes('/events'))
    problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`);
});
page.on('console', (m) => {
  if (m.type() === 'error' && /CORS|Access-Control/i.test(m.text())) problems.push(m.text());
});

const step = (s: string) => console.log(`· ${s}`);
try {
  step('sign in through the screen');
  await page.goto(`${APP}/entrar`);
  await page.getByLabel('Seu celular').fill(PHONE);
  await page.getByRole('button', { name: 'receber código' }).click();
  const hint = page.getByText(/o código é \d{6}/);
  await hint.waitFor({ timeout: 15_000 });
  const code = (await hint.textContent())!.match(/\d{6}/)![0];
  await page.getByLabel('número 1').click();
  await page.keyboard.type(code);
  // one store, or the picker
  const picker = page.getByText('Qual loja agora?');
  const home = page.locator('nav').first();
  await Promise.race([picker.waitFor({ timeout: 15_000 }), home.waitFor({ timeout: 15_000 })]);
  // the store demo-orders.ts orders from (HOST, quero-pudim by default)
  if (await picker.isVisible())
    await page.locator('ul button').filter({ hasText: STORE }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'), { timeout: 15_000 });

  step('the session is a bearer token, never a cookie');
  const cookies = await ctx.cookies(CORE);
  if (cookies.length) problems.push(`Core set cookies on the app: ${cookies.map((c) => c.name)}`);
  const session = calls.filter((r) => r.url().endsWith('/admin/v1/session')).at(-1);
  if (!session) problems.push('no GET /admin/v1/session');
  else {
    const h = await session.allHeaders();
    if (!/^Bearer \S+$/.test(h.authorization ?? ''))
      problems.push('GET /session went without Authorization: Bearer');
    if (!/^(ios|android)\/[^/]+\/\d+\/[^/]+$/.test(h['x-vendua-client'] ?? ''))
      problems.push(`x-vendua-client is ${h['x-vendua-client'] ?? 'missing'}`);
    const res = await session.response();
    if (res?.status() !== 200) problems.push(`GET /session answered ${res?.status()}`);
  }

  step('a new order arrives on the live stream');
  await page.goto(`${APP}/pedidos`);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const stream = calls.some((r) => r.url().includes('/admin/v1/events'));
  if (!stream) problems.push('the stream (/admin/v1/events) never opened');
  await page.waitForTimeout(1500);
  const before = calls.length;
  // a random demo cart can be refused (a minimum, a method the store lacks): five, all kept live
  const placed = spawnSync('bun', ['scripts/demo-orders.ts', '5'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env, CORE },
  });
  if (placed.status !== 0 || /placed 0 orders/.test(placed.stdout))
    problems.push(`demo-orders placed nothing: ${(placed.stdout + placed.stderr).slice(-400)}`);
  const deadline = Date.now() + 15_000;
  while (
    Date.now() < deadline &&
    !calls.slice(before).some((r) => /\/admin\/v1\/(orders|home)\b/.test(r.url()))
  )
    await page.waitForTimeout(250);
  if (!calls.slice(before).some((r) => /\/admin\/v1\/(orders|home)\b/.test(r.url())))
    problems.push('no refetch after a new order: the stream did not deliver it');
} catch (err) {
  problems.push(`smoke stopped: ${(err as Error).message}`);
  await page.screenshot({ path: 'shots/native-smoke.png' }).catch(() => undefined);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(
    `✗ the app against Core cross-origin:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
  );
  process.exit(1);
}
console.log(`✓ the app against Core cross-origin (${calls.length} calls, bearer, stream)`);

/**
 * Conformance Suite v1 — docs/architecture/10-qa-pipeline.md C/S/Q IDs.
 * Every test title starts with its stable ID; the custom reporter maps them
 * into qa-report/report.json. Determinism: seeded qa-* tenants, fixed data,
 * no network beyond the preview server and Core on this machine.
 *
 * Where the normative check needs something no storefront hook exposes yet
 * (checkout fields, a crashing slot override, (vendua)/* system routes), the
 * test either drives a documented pt-BR convention fallback or is marked
 * skipped-with-reason — never faked green.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  apiGet,
  apiPost,
  base,
  brl,
  discoverProductLinks,
  expectStoreContent,
  fillCustomerStep,
  fillDeliveryStep,
  getCatalog,
  getProduct,
  gotoCart,
  gotoProductPage,
  newSession,
  openCheckout,
  sessionToken,
  submitPaymentStep,
  trackPageErrors,
  type CartDto,
  type QaHost,
} from './helpers.ts';
import postgres from 'postgres';

const REPORT_DIR = process.env.VENDUA_QA_REPORT_DIR ?? 'qa-report';
const SHOTS = join(REPORT_DIR, 'screenshots');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const OPEN: QaHost = 'qa-open';
const PAUSED: QaHost = 'qa-paused';
const CLOSED: QaHost = 'qa-closed';
const EDGE: QaHost = 'qa-edge';
const O = base(OPEN);

const MOD_PRODUCT = 'qa-modular';
const SIMPLE_PRODUCT = 'qa-simples';
const OUT_ZONE = 'Nowhere-land';

async function getCart(request: APIRequestContext, host: QaHost, token: string) {
  const r = await apiGet(request, host, '/checkout/v1/cart', token);
  return { status: r.status, cart: r.body?.cart as CartDto | undefined };
}

/** Add an item through the real UI: listing → product page → required groups → add-to-cart. */
async function uiAddToCart(
  page: Page,
  request: APIRequestContext,
  host: QaHost,
  slug: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const origin = base(host);
  const products = await getCatalog(request, host);
  const { path } = await discoverProductLinks(page, products, origin);
  if (!(await gotoProductPage(page, path, slug, origin)))
    return { ok: false, detail: `no storefront link resolves to product ${slug}` };

  const detail = await getProduct(request, host, slug);
  for (const g of detail?.modifierGroups ?? []) {
    if (!g.required) continue;
    const group = page
      .locator(
        `[role="radiogroup"]:has-text("${g.name}"), [role="group"]:has-text("${g.name}"), fieldset:has-text("${g.name}")`,
      )
      .first();
    const choice = group
      .locator('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]')
      .first();
    if ((await choice.count()) === 0)
      return { ok: false, detail: `required group "${g.name}" has no selectable option` };
    await choice.click();
    await page.waitForTimeout(250);
  }
  const add = page.locator('[data-vendua="add-to-cart"]').first();
  if ((await add.count()) === 0)
    return { ok: false, detail: 'no [data-vendua="add-to-cart"] on product page' };
  if (!(await add.isEnabled().catch(() => false)))
    return { ok: false, detail: 'add-to-cart stayed disabled after required selection' };
  await add.dispatchEvent('click');
  // Verify the add actually landed server-side — a UI that "clicks" without
  // mutating the server cart must surface here, not downstream on an empty
  // cart page. Poll: the session token + cart write take a round-trip, and
  // a single fixed wait misreads a slow-but-healthy add as a UI failure.
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const tok = await sessionToken(page);
    if (tok && ((await getCart(request, host, tok)).cart?.items.length ?? 0) > 0)
      return { ok: true };
    await page.waitForTimeout(500);
  }
  return { ok: false, detail: 'add-to-cart click did not land a server cart item' };
}

/** Add a product straight through the public API (a second client beside the UI). */
async function apiAddItem(request: APIRequestContext, host: QaHost, productSlug: string) {
  const { sessionToken: tok, cart } = await newSession(request, host);
  const product = (await getCatalog(request, host)).find((p) => p.slug === productSlug);
  if (!product) throw new Error(`product ${productSlug} not in catalog`);
  const detail = await getProduct(request, host, productSlug);
  const modifierIds = (detail?.modifierGroups ?? [])
    .filter((g) => g.required)
    .map((g) => g.modifiers[0]!.id);
  const r = await apiPost(
    request,
    host,
    '/checkout/v1/cart/items',
    {
      productId: product.id,
      qty: 1,
      modifierIds,
    },
    tok,
  );
  if (r.status >= 400) throw new Error(`addItem ${r.status}: ${JSON.stringify(r.body)}`);
  return { sessionToken: tok, cart: r.body!.cart as CartDto };
}

async function orderCountByCart(cartId: string): Promise<number> {
  const sql = postgres(DATABASE_URL);
  try {
    const rows = await sql<{ n: number }[]>`
      select count(*)::int as n from orders where cart_id = ${cartId}
    `;
    return rows[0]!.n;
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------- C-series

test('[C01] catalog browsable; product cards expose data-vendua="product-link" and resolve', async ({
  page,
  request,
}) => {
  const products = await getCatalog(request, OPEN);
  expect(products.length, 'fixture catalog must not be empty').toBeGreaterThan(0);

  const { path, hookCount, slugHits } = await discoverProductLinks(page, products, O);
  expect(
    hookCount,
    `no element stamps data-vendua="product-link" (listing at ${path ?? 'none'} exposes ${slugHits} product anchors without the hook)`,
  ).toBeGreaterThan(0);

  const hrefs = await page
    .locator('a[data-vendua="product-link"][href]')
    .evaluateAll((els) => [
      ...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!)),
    ]);
  const bad: string[] = [];
  for (const href of hrefs.slice(0, 6)) {
    const res = await page.goto(new URL(href, O).href);
    if (!res?.ok()) {
      bad.push(`${href} → ${res?.status()}`);
      continue;
    }
    // Wait for real content — goto resolves at load, before React mounts.
    const rendered = await page
      .waitForSelector('[data-vendua="add-to-cart"], h1', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!rendered) bad.push(`${href} → no product content rendered`);
  }
  expect(bad, `unresolvable product links: ${bad.join(', ')}`).toHaveLength(0);
});

test('[C02] modifiers: required-group validation blocks; valid selection adds; totals match Core', async ({
  page,
  request,
}) => {
  const products = await getCatalog(request, OPEN);
  const { path } = await discoverProductLinks(page, products, O);
  expect(
    await gotoProductPage(page, path, MOD_PRODUCT, O),
    'could not reach qa-modular product page',
  ).toBeTruthy();

  // 1. validation blocks: untouched required group → no cart item lands
  const add = page.locator('[data-vendua="add-to-cart"]').first();
  expect(await add.count(), 'no add-to-cart primitive on product page').toBeGreaterThan(0);
  if (!(await add.isDisabled().catch(() => false))) {
    await add.click();
    await page.waitForTimeout(700);
  }
  const token0 = await sessionToken(page);
  const cart0 = token0 ? (await getCart(request, OPEN, token0)).cart : undefined;
  expect(
    cart0?.items?.length ?? 0,
    'required-group validation did not block: item was added without modifiers',
  ).toBe(0);

  // 2. valid selection adds through the UI
  const detail = await getProduct(request, OPEN, MOD_PRODUCT);
  for (const g of detail?.modifierGroups ?? []) {
    if (!g.required) continue;
    const group = page
      .locator(
        `[role="radiogroup"]:has-text("${g.name}"), [role="group"]:has-text("${g.name}"), fieldset:has-text("${g.name}")`,
      )
      .first();
    await group
      .locator('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]')
      .first()
      .click();
    await page.waitForTimeout(250);
  }
  await expect(add, 'add-to-cart stayed disabled after required selection').toBeEnabled();
  await add.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);

  const token = await sessionToken(page);
  expect(token, 'no checkout session minted after add').toBeTruthy();
  const { cart } = await getCart(request, OPEN, token!);
  expect(cart?.items.length, 'server cart empty after UI add').toBeGreaterThan(0);

  // 3. totals shown in the storefront equal Core's cart totals
  await gotoCart(page, O);
  const shown = brl(cart!.totals.totalCents);
  const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/ /g, ' ');
  expect(bodyText, `cart page does not show Core total ${shown}`).toContain(
    shown.replace(/ /g, ' '),
  );
});

test('[C03] cart: qty stepper mutates server cart; remove works; totals match Core', async ({
  page,
  request,
}) => {
  const added = await uiAddToCart(page, request, OPEN, SIMPLE_PRODUCT);
  expect(added.ok, added.ok === false ? added.detail : 'uiAddToCart failed').toBeTruthy();

  await gotoCart(page, O);
  const token = (await sessionToken(page))!;

  const stepper = page.locator('[data-vendua="qty-stepper"]').first();
  expect(await stepper.count(), 'no [data-vendua="qty-stepper"] on cart page').toBeGreaterThan(0);
  const { cart: c1 } = await getCart(request, OPEN, token);
  // convention: − qty + ; the last button increments
  await stepper.locator('button').last().click();
  await page.waitForTimeout(800);
  const { cart: c2 } = await getCart(request, OPEN, token);
  expect(c2?.items[0]?.qty, 'server cart qty did not increase via stepper').toBe(
    (c1?.items[0]?.qty ?? 0) + 1,
  );
  const shown = brl(c2!.totals.totalCents);
  const bodyText = (await page.evaluate(() => document.body.innerText)).replace(/ /g, ' ');
  expect(bodyText, `cart page does not show updated total ${shown}`).toContain(
    shown.replace(/ /g, ' '),
  );

  const rm = page.getByRole('button', { name: /remover|remove|excluir|apagar/i }).first();
  if ((await rm.count()) > 0) {
    await rm.click();
    await page.waitForTimeout(800);
  } else {
    const dec = stepper.locator('button').first();
    for (let i = 0; i < (c2?.items[0]?.qty ?? 1); i++) {
      await dec.click();
      await page.waitForTimeout(500);
    }
  }
  const { cart: c3 } = await getCart(request, OPEN, token);
  expect(c3?.items.length ?? 0, 'remove did not empty the server cart').toBe(0);
});

test('[C04] checkout entry starts a session; customer → delivery → payment steps reachable', async ({
  page,
  request,
}) => {
  const added = await uiAddToCart(page, request, OPEN, SIMPLE_PRODUCT);
  expect(added.ok, added.ok === false ? added.detail : 'uiAddToCart failed').toBeTruthy();
  expect(await sessionToken(page), 'no checkout session minted').toBeTruthy();

  await gotoCart(page, O);
  const url = await openCheckout(page);
  expect(url, 'no checkout entry reachable from cart page').toBeTruthy();

  const cust = await fillCustomerStep(page);
  expect(cust.ok, cust.detail).toBeTruthy();
  const del = await fillDeliveryStep(page, 'pickup');
  expect(del.ok, del.detail).toBeTruthy();
  expect(
    (await page.locator('text=/pix|pagamento|payment|revisão|revisao/i').count()) > 0,
    'payment step not reached',
  ).toBeTruthy();
});

test('[C05] order placement reaches sandbox payment; success surface renders order state', async ({
  page,
  request,
}) => {
  const added = await uiAddToCart(page, request, OPEN, SIMPLE_PRODUCT);
  expect(added.ok, added.ok === false ? added.detail : 'uiAddToCart failed').toBeTruthy();
  await gotoCart(page, O);
  expect(await openCheckout(page), 'checkout entry not reachable').toBeTruthy();
  await fillCustomerStep(page);
  await fillDeliveryStep(page, 'pickup');
  const submitted = await submitPaymentStep(page);
  expect(submitted.clicked, submitted.detail).toBeTruthy();

  await page.waitForURL(/pedido|order|status|sucesso/i, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});

  const orderIds: string[] = await page.evaluate(() => {
    try {
      return Object.keys(JSON.parse(sessionStorage.getItem('vendua.orderTokens') ?? '{}'));
    } catch {
      return [];
    }
  });
  const urlMatch = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    page.url(),
  );
  const orderId = urlMatch?.[1] ?? orderIds[0];
  expect(orderId, 'no order id surfaced (URL or vendua.orderTokens) after submit').toBeTruthy();

  const orderTokens: Record<string, string> = await page.evaluate(() => {
    try {
      return JSON.parse(sessionStorage.getItem('vendua.orderTokens') ?? '{}');
    } catch {
      return {};
    }
  });
  const tok = orderTokens[orderId!] ?? (await sessionToken(page));
  const r = await apiGet(request, OPEN, `/checkout/v1/orders/${orderId}`, tok ?? undefined);
  expect(r.status, `order ${orderId} not readable via API (${r.status})`).toBe(200);
  expect(r.body?.order?.payment?.provider, 'payment provider should be sandbox').toBe('sandbox');

  const text = await page.evaluate(() => document.body.innerText);
  expect(
    /pedido|confirmad|recebid|order|prepar|aguard|status/i.test(text),
    'success page shows no order-state content',
  ).toBeTruthy();
});

test('[C06] out-of-zone address: typed OUT_OF_ZONE surfaces; order cannot be placed', async ({
  page,
  request,
}) => {
  const quote = await apiPost(request, OPEN, '/checkout/v1/quote', { neighborhood: OUT_ZONE });
  expect(quote.status).toBe(200);
  expect(quote.body?.eligible).toBe(false);
  expect(quote.body?.reason).toBe('OUT_OF_ZONE');

  const added = await uiAddToCart(page, request, OPEN, SIMPLE_PRODUCT);
  expect(added.ok, added.ok === false ? added.detail : 'uiAddToCart failed').toBeTruthy();
  await gotoCart(page, O);
  await openCheckout(page);
  await fillCustomerStep(page);
  const del = await fillDeliveryStep(page, 'delivery', OUT_ZONE);
  expect(del.ok, del.detail).toBeTruthy();
  const submitted = await submitPaymentStep(page);
  expect(submitted.clicked, submitted.detail).toBeTruthy();
  await page.waitForTimeout(2000);

  expect(page.url(), 'an order was placed despite the out-of-zone address').not.toMatch(
    /pedido\/[0-9a-f-]{30,}|order\/[0-9a-f-]{30,}/i,
  );
  const text = await page.evaluate(() => document.body.innerText);
  const alerted =
    (await page.locator('[role="alert"], [data-vendua="notice"], .alert, .inline-alert').count()) >
    0;
  expect(
    alerted || /fora|área|area|zona|zone|atend|entrega/i.test(text),
    'no OUT_OF_ZONE feedback surfaced to the customer',
  ).toBeTruthy();
});

test('[C07] idempotent retry: double-submit of checkout produces exactly one order', async ({
  page,
  request,
}) => {
  // deterministic half: ONE idempotency key retried twice — the second call
  // must replay the stored response, not re-execute the mutation.
  const { sessionToken: tok, cart } = await apiAddItem(request, OPEN, SIMPLE_PRODUCT);
  const input = {
    customer: { name: 'QA Retry', phone: '22999990000' },
    delivery: { mode: 'pickup' },
    payment: { method: 'pix' },
  };
  const idem = crypto.randomUUID();
  const first = await apiPost(request, OPEN, '/checkout/v1/checkout', input, tok, idem);
  expect(
    [200, 201].includes(first.status),
    `first checkout failed: ${first.status} ${JSON.stringify(first.body)}`,
  ).toBeTruthy();
  const second = await apiPost(request, OPEN, '/checkout/v1/checkout', input, tok, idem);
  expect(
    second.status,
    `same-key retry expected the stored response, got ${second.status}: ${JSON.stringify(second.body)}`,
  ).toBe(first.status);
  expect(second.replayed, 'same-key retry missing x-idempotent-replay').toBe(true);
  expect(second.body?.order?.id, 'replay returned a different order').toBe(first.body?.order?.id);
  expect(await orderCountByCart(cart.id), 'double-submit produced ≠1 order').toBe(1);

  // UI half: rapid double-submit on the storefront must also collapse
  const added = await uiAddToCart(page, request, OPEN, SIMPLE_PRODUCT);
  expect(added.ok, added.ok === false ? added.detail : 'uiAddToCart failed').toBeTruthy();
  await gotoCart(page, O);
  await openCheckout(page);
  await fillCustomerStep(page);
  await fillDeliveryStep(page, 'pickup');
  const submit = page
    .getByRole('button', { name: /confirmar|finalizar|fazer pedido|enviar|pagar/i })
    .first();
  expect(await submit.count(), 'no submit button to double').toBeGreaterThan(0);
  await submit.click({ clickCount: 2 }).catch(() => {});
  await page.waitForTimeout(2500);
  const ids: string[] = await page.evaluate(() => {
    try {
      return Object.keys(JSON.parse(sessionStorage.getItem('vendua.orderTokens') ?? '{}'));
    } catch {
      return [];
    }
  });
  expect(ids.length, 'UI double-submit produced multiple orders').toBe(1);
});

// ---------------------------------------------------------------- S-series

test('[S01] paused fixture → blocking overlay, primitives disabled, checkout rejects STORE_PAUSED', async ({
  page,
  request,
}) => {
  const errs = trackPageErrors(page);
  await page.goto(base(PAUSED));
  // The kernel fetches surfaces post-mount in this harness (production injects
  // state at the edge): assert the overlay renders shortly after load.
  const overlay = page.locator('[data-vendua="blocking-overlay"]');
  await expect(overlay, 'no blocking overlay on paused store').toBeVisible({ timeout: 15_000 });

  // A working blocking overlay means interactive page content must be
  // unreachable — playwright's trial click is the idiomatic way to prove the
  // overlay intercepts pointer input over a real storefront link.
  const navLink = page.locator('main a[href], nav a[href]').first();
  if ((await navLink.count()) > 0) {
    const verdict = await navLink
      .click({ trial: true, timeout: 5_000 })
      .then(() => 'clickable')
      .catch((e) => String(e));
    expect(
      verdict,
      'blocking overlay does not intercept page interaction (nav link clickable)',
    ).toContain('intercepts pointer events');
  }

  const { sessionToken: tok } = await apiAddItem(request, PAUSED, SIMPLE_PRODUCT);
  const checkout = await apiPost(
    request,
    PAUSED,
    '/checkout/v1/checkout',
    {
      customer: { name: 'QA', phone: '22999990000' },
      delivery: { mode: 'pickup' },
      payment: { method: 'pix' },
    },
    tok,
  );
  expect(checkout.status).toBe(423);
  expect(checkout.body?.error?.code).toBe('STORE_PAUSED');
  expect(errs, `uncaught page errors: ${errs.join('; ')}`).toHaveLength(0);
});

test('[S02] closed fixture → closed notice shows next opening; browsing still works', async ({
  page,
  request,
}) => {
  const errs = trackPageErrors(page);
  await page.goto(base(CLOSED));
  const stack = page.locator('[data-vendua="banner-stack"]');
  await expect(stack, 'no banner content on closed store').not.toBeEmpty({ timeout: 15_000 });
  const text = await stack.innerText();
  expect(
    /fechad|closed|abre|abrimos|reabre|volta|reabrimos/i.test(text),
    `closed notice missing re-open info: "${text.slice(0, 120)}"`,
  ).toBeTruthy();

  const products = await getCatalog(request, CLOSED);
  expect(products.length).toBeGreaterThan(0);
  const { path } = await discoverProductLinks(page, products, base(CLOSED));
  expect(
    await gotoProductPage(page, path, SIMPLE_PRODUCT, base(CLOSED)),
    'catalog browsing broken on closed store',
  ).toBeTruthy();
  await expectStoreContent(page);

  // Closed still sells — preorders for the next window (contract asymmetry).
  const { sessionToken: tok } = await apiAddItem(request, CLOSED, SIMPLE_PRODUCT);
  const checkout = await apiPost(
    request,
    CLOSED,
    '/checkout/v1/checkout',
    {
      customer: { name: 'QA', phone: '22999990000' },
      delivery: { mode: 'pickup' },
      payment: { method: 'pix' },
    },
    tok,
  );
  expect(
    [200, 201].includes(checkout.status),
    `closed store must accept preorders, got ${checkout.status}: ${JSON.stringify(checkout.body)}`,
  ).toBeTruthy();
  expect(errs, `uncaught page errors: ${errs.join('; ')}`).toHaveLength(0);
});

test('[S03] unknown notice kind → generic system.Notice renders, no crash', async ({ page }) => {
  const errs = trackPageErrors(page);
  await page.goto(base(EDGE));
  await expectStoreContent(page);
  const stack = page.locator('[data-vendua="banner-stack"]');
  await expect(stack, 'banner stack empty under hostile envelope').not.toBeEmpty({
    timeout: 15_000,
  });
  const text = await stack.innerText();
  expect(
    text.includes('QA: unknown notice kind'),
    `unknown-kind notice not rendered: "${text.slice(0, 160)}"`,
  ).toBeTruthy();
  expect(errs, `uncaught page errors: ${errs.join('; ')}`).toHaveLength(0);
});

test('[S04] unknown severity/action types → degrade per spec, never crash', async ({ page }) => {
  const errs = trackPageErrors(page);
  await page.goto(base(EDGE));
  await expectStoreContent(page);
  const stack = page.locator('[data-vendua="banner-stack"]');
  await expect(stack).not.toBeEmpty({ timeout: 15_000 });
  const text = await stack.innerText();
  expect(
    text.includes('QA: unknown severity'),
    `unknown-severity notice not rendered: "${text.slice(0, 160)}"`,
  ).toBeTruthy();
  // unknown action type carrying href degrades to a plain link; one without
  // a target is dropped silently
  const link = stack.locator('a[href]', { hasText: 'Teleport' }).first();
  await expect(link, 'unknown action with href should degrade to a link').toBeVisible();
  expect(errs, `uncaught page errors: ${errs.join('; ')}`).toHaveLength(0);
});

test('[S05] override crash → error boundary renders Kernel default, failure reported', async () => {
  test.info().annotations.push({
    type: 'reason',
    description:
      'needs a fixture storefront whose slot override throws at render — none exists under storefronts/ and this slice may only touch packages/conformance',
  });
  test.skip();
});

test('[S06] v.js present, health ping responds, blocking overlay renders with Kernel JS disabled', async ({
  page,
  request,
  context,
}) => {
  // Kernel JS disabled = the storefront bundle never runs; v.js must still
  // render the paused overlay straight from /storefront/v1/state.
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith('.js') && !u.pathname.startsWith('/v1/')) return route.abort();
    return route.continue();
  });

  const ping = await apiGet(request, PAUSED, '/v1/v.js');
  expect(ping.status, 'v.js not served through the proxy').toBe(200);

  const stateReq = page.waitForRequest('**/storefront/v1/state', { timeout: 20_000 });
  await page.goto(base(PAUSED));
  await stateReq;
  const pinged = await page.evaluate(() => Boolean((window as any).__VENDUA_LOADER__));
  expect(pinged, '__VENDUA_LOADER__ ping missing — v.js did not run').toBeTruthy();
  await page.waitForSelector('#vendua-loader-overlay', { timeout: 20_000 });
  const hasContent = await page.evaluate(() => {
    const el = document.getElementById('vendua-loader-overlay');
    return Boolean(el?.shadowRoot && el.shadowRoot.innerHTML.length > 50);
  });
  expect(hasContent, 'loader overlay mounted but empty').toBeTruthy();
});

test('[S07] (vendua)/* system routes all resolve and render Kernel defaults', async () => {
  test.info().annotations.push({
    type: 'reason',
    description:
      'the Phase-0 kernel mounts no (vendua)/* system route group — nothing exists to exercise yet',
  });
  test.skip();
});

// ---------------------------------------------------------------- Q-series

const VIEWPORTS = [320, 360, 390, 768, 1280, 1440];

test('[Q01] no layout overflow at 320–1440px', async ({ page, request }) => {
  const products = await getCatalog(request, OPEN);
  const { path: catalogPath } = await discoverProductLinks(page, products, O);
  const routes = new Set<string>(['/']);
  if (catalogPath) routes.add(catalogPath);
  if (await gotoProductPage(page, catalogPath, SIMPLE_PRODUCT, O))
    routes.add(new URL(page.url()).pathname);

  const overflow: string[] = [];
  for (const w of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const r of routes) {
      await page.goto(`${O}${r}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) overflow.push(`${w}px @ ${r}: +${o}px horizontal overflow`);
    }
  }
  expect(overflow.join('\n')).toHaveLength(0);
});

test('[Q02] axe audit: zero serious+ violations on home/catalog/product/cart', async ({
  page,
  request,
}) => {
  const products = await getCatalog(request, OPEN);
  const { path: catalogPath } = await discoverProductLinks(page, products, O);
  const routes = new Set<string>(['/']);
  if (catalogPath) routes.add(catalogPath);
  if (await gotoProductPage(page, catalogPath, SIMPLE_PRODUCT, O))
    routes.add(new URL(page.url()).pathname);
  routes.add('/cart');

  const violations: string[] = [];
  for (const r of routes) {
    await page.goto(`${O}${r}`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    for (const v of scan.violations.filter(
      (x) => x.impact === 'serious' || x.impact === 'critical',
    )) {
      violations.push(`${r}: ${v.id} (${v.impact}) — ${v.nodes.length} node(s)`);
    }
  }
  expect(violations.join('\n')).toHaveLength(0);
});

test('[Q03] prefers-reduced-motion: content complete, no crash', async ({ browser, request }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errs = trackPageErrors(page);
  const products = await getCatalog(request, OPEN);
  const { path: catalogPath } = await discoverProductLinks(page, products, O);
  for (const r of ['/', catalogPath].filter((x): x is string => Boolean(x))) {
    await page.goto(`${O}${r}`);
    await expectStoreContent(page);
  }
  expect(errs, `uncaught page errors: ${errs.join('; ')}`).toHaveLength(0);
  await ctx.close();
});

test('[Q04] JS disabled: core shell legible; surfaces show a static fallback', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(O);
  const text = (await page.evaluate(() => document.body.innerText ?? '')).trim();
  const heading = await page.locator('h1, h2').count();
  expect(
    text.length > 40 && heading > 0,
    `no-JS render produced ${text.length} chars of body text and ${heading} heading(s) — the storefront ships no legible shell`,
  ).toBeTruthy();
  await ctx.close();
});

test('[Q05] byte budgets: initial JS gzip ≤250KB, total initial transfer ≤1.5MB', async ({
  page,
}) => {
  const sizes: { url: string; type: string; bytes: number }[] = [];
  page.on('response', async (res) => {
    try {
      const buf = await res.body();
      const ct = res.headers()['content-type'] ?? '';
      const compressible = /javascript|css|json|svg|html|text/.test(ct);
      sizes.push({
        url: res.url(),
        type: ct.split(';')[0]!,
        bytes: compressible ? gzipSync(buf).length : buf.length,
      });
    } catch {
      /* stream gone */
    }
  });
  await page.goto(O);
  await page.waitForLoadState('networkidle').catch(() => {});

  const js = sizes
    .filter((s) => /javascript|module/.test(s.type) || s.url.endsWith('.js'))
    .reduce((a, s) => a + s.bytes, 0);
  const total = sizes.reduce((a, s) => a + s.bytes, 0);
  expect(
    js,
    `initial JS gzip ${(js / 1024).toFixed(0)}KB exceeds the 250KB contract budget`,
  ).toBeLessThanOrEqual(250 * 1024);
  expect(
    total,
    `initial transfer ${(total / 1024).toFixed(0)}KB exceeds the 1.5MB contract budget`,
  ).toBeLessThanOrEqual(1536 * 1024);
});

test('[Q06] internal links resolve; unknown route renders a not-found surface', async ({
  page,
  request,
}) => {
  const products = await getCatalog(request, OPEN);
  await page.goto(O);
  const { path: catalogPath } = await discoverProductLinks(page, products, O);

  const links = new Set<string>();
  for (const r of ['/', catalogPath].filter((x): x is string => Boolean(x))) {
    await page.goto(`${O}${r}`).catch(() => {});
    for (const h of await page
      .locator('a[href^="/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')!))) {
      if (h.startsWith('/') && !h.startsWith('//') && !/\.(svg|png|jpg|css|js)$/.test(h))
        links.add(h.split('#')[0]!.split('?')[0]!);
    }
  }
  const dead: string[] = [];
  for (const l of [...links].slice(0, 20)) {
    const r = await request.get(`${O}${l}`);
    if (r.status() >= 400) dead.push(`${l} → ${r.status()}`);
  }
  expect(dead, `dead links: ${dead.join(', ')}`).toHaveLength(0);

  const homeH1 = await page.goto(`${O}/`).then(() =>
    page
      .locator('h1')
      .first()
      .innerText()
      .catch(() => ''),
  );
  await page.goto(`${O}/vendua-qa-404-probe`);
  const h1 = await page
    .locator('h1')
    .first()
    .innerText()
    .catch(() => '');
  const recovery = await page.locator('a[href^="/"]').count();
  expect(
    Boolean(h1) && h1 !== homeH1 && recovery > 0,
    `unknown route did not render a distinguishable not-found surface (h1: "${h1.slice(0, 80)}")`,
  ).toBeTruthy();
});

test('[Q07] contrast AA on token pairs used by default surfaces', async ({ page }) => {
  await page.goto(O);
  await page.waitForLoadState('networkidle').catch(() => {});
  const vars = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const n of [
      '--v-color-bg',
      '--v-color-surface',
      '--v-color-text',
      '--v-color-muted',
      '--v-color-accent',
      '--v-color-on-accent',
      '--v-color-danger',
    ]) {
      const v = cs.getPropertyValue(n).trim();
      if (v) out[n] = v;
    }
    return out;
  });

  // Resolve each token through the browser: a probe element's computed color
  // normalizes hex/rgb()/hsl()/named into `rgb(r, g, b)` — anything the page
  // can render, this can parse; anything it can't parse is a failure, not a
  // skip.
  const resolved: Record<string, string | null> = await page.evaluate((vars) => {
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const out: Record<string, string | null> = {};
    for (const [name, v] of Object.entries(vars)) {
      probe.style.color = v as string;
      out[name] = getComputedStyle(probe).color || null;
    }
    probe.remove();
    return out;
  }, vars);
  const rgb = (v: string | null) => {
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v ?? '');
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const lum = (v: string | null) => {
    const c = rgb(v);
    if (!c) return null;
    const ch = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  };
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  const pairs: [string, string][] = [
    ['--v-color-text', '--v-color-bg'],
    ['--v-color-muted', '--v-color-bg'],
    ['--v-color-text', '--v-color-surface'],
    ['--v-color-muted', '--v-color-surface'],
    ['--v-color-on-accent', '--v-color-accent'],
    ['--v-color-danger', '--v-color-bg'],
  ];
  const bad: string[] = [];
  for (const [fg, bg] of pairs) {
    if (!vars[fg] || !vars[bg]) {
      bad.push(`${fg}/${bg}: token unset — a required surface color has no value`);
      continue;
    }
    const lf = lum(resolved[fg] ?? null);
    const lb = lum(resolved[bg] ?? null);
    if (lf == null || lb == null) {
      bad.push(`${fg} (${vars[fg]}) / ${bg} (${vars[bg]}): browser could not resolve the color`);
      continue;
    }
    const r = ratio(lf, lb);
    if (r < 4.5) bad.push(`${fg} (${vars[fg]}) on ${bg} (${vars[bg]}): ${r.toFixed(2)}:1`);
  }
  expect(bad, `below 4.5:1 AA —\n${bad.join('\n')}`).toHaveLength(0);
});

test('[Q08] hostile-CSS global reset does not break Kernel defaults', async ({ page }) => {
  const RESET =
    '* { margin: 0 !important; padding: 0 !important; border: 0 !important; font: inherit !important; font-size: 100% !important; vertical-align: baseline !important; line-height: 1 !important; }';
  await page.goto(O);
  const stack = page.locator('[data-vendua="banner-stack"]');
  await expect(stack).not.toBeEmpty({ timeout: 15_000 });

  await page.addStyleTag({ content: RESET });
  const box = await stack.boundingBox();
  expect(box?.height ?? 0, 'banner stack collapsed under hostile reset').toBeGreaterThan(4);
  expect(
    (await stack.innerText()).trim().length,
    'banner content unreadable under reset',
  ).toBeGreaterThan(0);

  const p2 = await page.context().newPage();
  await p2.goto(base(PAUSED));
  const overlay = p2.locator('[data-vendua="blocking-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 15_000 });
  await p2.addStyleTag({ content: RESET });
  const layer = await overlay.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { position: cs.position, inset: cs.inset, width: el.getBoundingClientRect().width };
  });
  const vpWidth = p2.viewportSize()?.width ?? 0;
  expect(
    layer.position === 'fixed' && layer.inset === '0px' && layer.width >= vpWidth * 0.9,
    `blocking overlay lost its fixed full-viewport layer (${JSON.stringify(layer)} vs viewport ${vpWidth})`,
  ).toBeTruthy();
  await p2.close();
});

test('[Q09] focus order + visible focus; skip link works', async ({ page }) => {
  await page.goto(O);
  await page.waitForLoadState('networkidle').catch(() => {});

  const stops: { tag: string; text: string; visible: boolean }[] = [];
  let skipHref: string | null = null;
  const SKIP_RE = /pular|skip|salt|ir para o conte|conte[uú]do|content|main|principal/i;
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const visibleFocus =
        cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
          ? true
          : cs.boxShadow !== 'none';
      return {
        tag: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`,
        text: (el.innerText || el.getAttribute('aria-label') || '').slice(0, 60),
        href: el.getAttribute('href'),
        visible: visibleFocus,
      };
    });
    if (!info) break;
    stops.push(info);
    // A skip link jumps to page content — an in-page anchor whose text or
    // target reads as "skip to content"/"pular para…", not any '#' href.
    if (
      !skipHref &&
      info.href?.includes('#') &&
      (SKIP_RE.test(info.text) || SKIP_RE.test(info.href))
    )
      skipHref = info.href.split('#')[1] ? `#${info.href.split('#')[1]}` : info.href;
  }
  expect(stops.length, 'Tab produced no focusable elements').toBeGreaterThan(0);
  const invisible = stops.filter((s) => !s.visible);
  expect(
    invisible,
    `focused elements without a visible indicator:\n${invisible.map((s) => `${s.tag} "${s.text}"`).join('\n')}`,
  ).toHaveLength(0);
  expect(
    skipHref,
    'no skip link (anchor to main content) found in the first tab stops',
  ).toBeTruthy();
  const target = await page.evaluate((h) => Boolean(h && document.querySelector(h)), skipHref!);
  expect(target, `skip link target ${skipHref} does not exist`).toBeTruthy();
});

test('[Q10] zoom 200% CSS: no loss of function', async ({ page, request }) => {
  await page.goto(O);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => {
    (document.documentElement.style as CSSStyleDeclaration).zoom = '2';
  });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `200% zoom caused +${overflow}px horizontal overflow`).toBeLessThanOrEqual(2);
  await expectStoreContent(page);
  const products = await getCatalog(request, OPEN);
  const { path: catalogPath } = await discoverProductLinks(page, products, O);
  expect(
    await gotoProductPage(page, catalogPath, SIMPLE_PRODUCT, O),
    'product navigation broken at 200% zoom',
  ).toBeTruthy();
  const add = page.locator('[data-vendua="add-to-cart"]').first();
  if ((await add.count()) > 0)
    await expect(add, 'add-to-cart not interactable at 200% zoom').toBeEnabled();
});

// ------------------------------------------------------------- artifacts

test('[artifacts] screenshots at 390/1440 for the QA report', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });
  const shots: [QaHost, string][] = [
    [OPEN, 'home'],
    [PAUSED, 'paused'],
    [CLOSED, 'closed'],
    [EDGE, 'edge'],
  ];
  for (const [host, name] of shots) {
    for (const w of [390, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(base(host));
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(800); // let the surfaces fetch land
      await page.screenshot({ path: join(SHOTS, `${name}-${w}.png`), fullPage: false });
    }
  }
});

// checks key off the public API + `data-vendua` hooks only (ADR 0007);
// pt-BR conventions are the documented fallback where no hook exists
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PORT = Number(process.env.VENDUA_PREVIEW_PORT ?? 5199);
export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';

export type QaHost = 'qa-open' | 'qa-paused' | 'qa-closed' | 'qa-edge';
export const base = (host: QaHost) => `http://${host}.localhost:${PORT}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// core's 240/min/tenant checkout limiter trips under suite bursts — honor 429s
async function withRetry429<T extends { status(): number }>(fn: () => Promise<T>): Promise<T> {
  const waits = [12_000, 28_000, 50_000]; // last wait crosses the 60s window
  for (let attempt = 0; ; attempt++) {
    const r = await fn();
    if (r.status() !== 429 || attempt >= waits.length) return r;
    await sleep(waits[attempt]!);
  }
}

export async function apiGet(
  request: APIRequestContext,
  host: QaHost,
  path: string,
  token?: string,
) {
  const res = await withRetry429(() =>
    request.get(`${base(host)}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  );
  return { status: res.status(), body: await res.json().catch(() => null) };
}

export async function apiPost(
  request: APIRequestContext,
  host: QaHost,
  path: string,
  body?: unknown,
  token?: string,
  idemKey?: string,
) {
  const res = await withRetry429(() =>
    request.post(`${base(host)}${path}`, {
      data: body,
      headers: {
        'idempotency-key': idemKey ?? crypto.randomUUID(),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  );
  return {
    status: res.status(),
    body: await res.json().catch(() => null),
    replayed: res.headers()['x-idempotent-replay'] === 'true',
  };
}

export async function newSession(request: APIRequestContext, host: QaHost) {
  const r = await apiPost(request, host, '/checkout/v1/session', {});
  if (r.status !== 200 && r.status !== 201)
    throw new Error(`session create failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { sessionToken: string; cart: CartDto };
}

export interface CartDto {
  id: string;
  status: string;
  items: {
    id: string;
    productId: string;
    slug: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }[];
  totals: {
    subtotalCents: number;
    deliveryFeeCents: number;
    totalCents: number;
    itemCount: number;
  };
}

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  basePriceCents: number;
  status: string;
}

export async function getCatalog(request: APIRequestContext, host: QaHost) {
  const r = await apiGet(request, host, '/storefront/v1/catalog');
  const cats = (r.body?.categories ?? []) as { name: string; products: CatalogProduct[] }[];
  return cats.flatMap((c) => c.products);
}

export async function getProduct(request: APIRequestContext, host: QaHost, slug: string) {
  const r = await apiGet(request, host, `/storefront/v1/products/${slug}`);
  return r.body?.product as {
    slug: string;
    modifierGroups: {
      name: string;
      required: boolean;
      minSelect: number;
      maxSelect: number;
      modifiers: { id: string; name: string; priceDeltaCents: number; status: string }[];
    }[];
  } | null;
}

export const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export async function sessionToken(page: Page): Promise<string | null> {
  return page.evaluate(() => globalThis.sessionStorage?.getItem('vendua.session') ?? null);
}

// first candidate route exposing product-link hooks or slug anchors
// (a missing hook is itself what C01 measures)
export async function discoverProductLinks(page: Page, products: CatalogProduct[], origin: string) {
  const candidates = ['/catalog', '/catalogo', '/cardapio', '/menu', '/produtos', '/'];
  const slugs = new Set(products.map((p) => p.slug));
  for (const path of candidates) {
    await page.goto(`${origin}${path}`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const hookCount = await page.locator('a[data-vendua="product-link"][href]').count();
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
    const slugHits = hrefs.filter((h) => {
      const clean = h.split('?')[0]!.replace(/\/$/, '');
      return slugs.has(clean.split('/').pop()!);
    }).length;
    if (hookCount > 0 || slugHits > 0) return { path, hookCount, slugHits, byHook: hookCount > 0 };
  }
  return { path: null as string | null, hookCount: 0, slugHits: 0, byHook: false };
}

export async function gotoProductPage(
  page: Page,
  listingPath: string | null,
  slug: string,
  origin: string,
): Promise<boolean> {
  const targets = listingPath ? [listingPath, '/'] : ['/'];
  for (const p of targets) {
    await page.goto(`${origin}${p}`).catch(() => {});
    const link = page
      .locator(
        `a[data-vendua="product-link"][href*="${slug}"], a[href$="/${slug}"], a[href*="/${slug}?"]`,
      )
      .first();
    if ((await link.count()) > 0) {
      await link.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      if (page.url().includes(slug)) return true;
    }
  }
  return false;
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.fill(value);
      return true;
    }
  }
  return false;
}

async function clickByText(page: Page, re: RegExp): Promise<boolean> {
  const el = page
    .getByRole('button', { name: re })
    .or(page.getByRole('link', { name: re }))
    .first();
  if ((await el.count()) > 0 && (await el.isEnabled().catch(() => false))) {
    // dispatchEvent: wizards replace the button node on submit — .click() detach-retries
    await el.dispatchEvent('click');
    return true;
  }
  return false;
}

export async function gotoCart(page: Page, origin: string): Promise<void> {
  const trigger = page.locator('[data-vendua="cart-trigger"]').first();
  if ((await trigger.count()) > 0) {
    await trigger.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return;
  }
  for (const p of ['/cart', '/sacola', '/carrinho', '/bag']) {
    const r = await page.goto(`${origin}${p}`).catch(() => null);
    if (r && r.ok()) return;
  }
}

export async function openCheckout(page: Page): Promise<string | null> {
  const hook = page.locator('[data-vendua="checkout-button"]').first();
  if ((await hook.count()) > 0) {
    await Promise.all([page.waitForURL(/./, { timeout: 10_000 }).catch(() => {}), hook.click()]);
    return page.url();
  }
  const cta = page
    .getByRole('link', { name: /pagamento|checkout|finalizar|fechar pedido|ir para/i })
    .or(page.getByRole('button', { name: /pagamento|checkout|finalizar|fechar pedido/i }))
    .first();
  if ((await cta.count()) === 0) return null;
  const before = page.url();
  await cta.click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  return page.url() === before ? null : page.url();
}

export async function fillCustomerStep(page: Page): Promise<{ ok: boolean; detail?: string }> {
  const nameOk = await fillFirst(
    page,
    [
      'input[name="name"]',
      'input#checkout-name',
      'input[autocomplete="name"]',
      'input[placeholder*="nome" i]',
      'input[aria-label*="nome" i]',
    ],
    'QA Conformance',
  );
  const phoneOk = await fillFirst(
    page,
    [
      'input[name="phone"]',
      'input#checkout-phone',
      'input[autocomplete="tel"]',
      'input[type="tel"]',
      'input[placeholder*="telefone" i]',
      'input[placeholder*="whats" i]',
    ],
    '22999990000',
  );
  if (!nameOk || !phoneOk)
    return {
      ok: false,
      detail: `customer fields not found (name:${nameOk} phone:${phoneOk})`,
    };
  const advanced = await clickByText(page, /continuar|próximo|proximo|avançar|avancar|next/i);
  await page.waitForTimeout(300);
  return { ok: true, ...(advanced ? {} : { detail: 'no "continuar" button found after dados' }) };
}

export async function fillDeliveryStep(
  page: Page,
  mode: 'pickup' | 'delivery',
  neighborhood?: string,
): Promise<{ ok: boolean; detail?: string }> {
  const modeRe = mode === 'delivery' ? /entrega|delivery/i : /retirada|pickup|retirar/i;
  const picked = await page
    .getByRole('radio', { name: modeRe })
    .or(page.getByRole('button', { name: modeRe }))
    .or(page.locator('label').filter({ hasText: modeRe }).locator('input[type="radio"]'))
    .first();
  if ((await picked.count()) > 0) {
    await picked.click({ force: true }).catch(async () => {
      await picked.evaluate((e) => (e as HTMLElement).click());
    });
    await page.waitForTimeout(300);
  }
  if (mode === 'delivery') {
    const hoodOk = await fillFirst(
      page,
      [
        'input[name="neighborhood"]',
        'input#checkout-neighborhood',
        'input[name="bairro"]',
        'input[list]',
        'input[placeholder*="bairro" i]',
      ],
      neighborhood ?? 'Centro',
    );
    await fillFirst(
      page,
      [
        'input[name="street"]',
        'input[name="address"]',
        'input#checkout-street',
        'input[placeholder*="rua" i]',
        'input[placeholder*="endereço" i]',
      ],
      'Rua QA',
    );
    await fillFirst(
      page,
      [
        'input[name="number"]',
        'input#checkout-number',
        'input[placeholder*="número" i]',
        'input[placeholder*="numero" i]',
      ],
      '100',
    );
    if (!hoodOk)
      return { ok: false, detail: 'delivery mode chosen but no neighborhood field found' };
  }
  await clickByText(page, /continuar|próximo|proximo|avançar|avancar|next/i);
  await page.waitForTimeout(300);
  return { ok: true };
}

export async function submitPaymentStep(
  page: Page,
): Promise<{ clicked: boolean; detail?: string }> {
  const pix = page
    .getByRole('radio', { name: /pix/i })
    .or(page.getByRole('button', { name: /pix/i }))
    .or(page.locator('label').filter({ hasText: /pix/i }).locator('input[type="radio"]'))
    .first();
  if ((await pix.count()) > 0) {
    await pix.click({ force: true }).catch(async () => {
      await pix.evaluate((e) => (e as HTMLElement).click());
    });
    await page.waitForTimeout(200);
  }
  const submit = page
    .getByRole('button', { name: /confirmar|finalizar|fazer pedido|enviar pedido|pagar/i })
    .first();
  if ((await submit.count()) === 0)
    return { clicked: false, detail: 'no submit button on payment step' };
  if (!(await submit.isEnabled().catch(() => false)))
    return { clicked: false, detail: 'submit button on payment step is disabled' };
  await submit.dispatchEvent('click');
  return { clicked: true };
}

export async function expectStoreContent(page: Page) {
  await expect(page.locator('body')).not.toBeEmpty();
  const errors = await page.evaluate(() => (document.body.innerText ?? '').trim().length);
  expect(errors).toBeGreaterThan(20);
}

export function trackPageErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

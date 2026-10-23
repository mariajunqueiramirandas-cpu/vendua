// What scripts/capture-ui.mjs records for Launch60: one real order, end to end, on the dev stack.
// The store is the site's "Bolos da Nena" (`bun site/scripts/assets.ts screens` seeds it). The
// shopper orders on the storefront (_template on :5175) and pays with Pix; the fake payment driver
// settles it the way Mercado Pago's webhook would; the order lands live in the merchant admin,
// which accepts it, and the shopper's page follows. Dev database only.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';

const CORE = 'http://localhost:8787';
const ADMIN = 'http://localhost:5196/admin/';
const STORE = 'http://bolosdanena.localhost:5175';
const PHONE = '22999990001';
const AUTH = '/tmp/vendua-admin-auth.json';
const SHOPPER = { name: 'Luiz Carvalho', phone: '22988417260' };
const PRODUCT = 'bolo-de-cenoura-com-brigadeiro';
const REPO = new URL('../../../../../', import.meta.url).pathname;

/** A Pix copy-and-paste code from Core's own encoder, for the store's key and the order's total. */
const brCode = (amountCents) => {
  const r = spawnSync(
    'bun',
    ['-e', `import { pixPayload } from './src/modules/pix.ts';
      console.log(pixPayload({ key: '7d3f2a9e-41c6-4b8e-9a05-c2e81f64b7d1', keyType: 'random', beneficiary: 'Bolos da Nena', city: 'Campos' }, { amountCents: ${amountCents} }));`],
    { cwd: `${REPO}packages/core`, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

const psql = (q) => {
  const r = spawnSync('psql', ['-h', 'localhost', '-p', '5433', '-U', 'vendua', '-d', 'vendua', '-qAtc', q], {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: 'vendua' },
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(`${CORE}/admin/v1${path}`, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      'x-vendua-admin': '1',
      'idempotency-key': crypto.randomUUID(),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// the same saved sign-in the site's screenshots use
async function signIn() {
  if (existsSync(AUTH)) {
    cookie = JSON.parse(readFileSync(AUTH, 'utf8')).cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const ok = await fetch(`${CORE}/admin/v1/session`, { headers: { cookie, 'x-vendua-admin': '1' } });
    if (ok.status === 200) return;
    cookie = '';
  }
  const start = await api('POST', '/auth/otp/start', { phone: PHONE });
  if (!start.devCode) throw new Error('no dev sign-in code: start Core with VENDUA_ADMIN_DEV_OTP=1');
  await api('POST', '/auth/otp/verify', { phone: PHONE, code: start.devCode });
  const [name, value] = cookie.split('=');
  writeFileSync(
    AUTH,
    JSON.stringify({
      cookies: [{ name, value, domain: 'localhost', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }],
      origins: [],
    }),
  );
}

async function prepare() {
  await signIn();
  const tenant = psql(`select id from tenants where slug = 'bolosdanena'`);
  if (!tenant) throw new Error('no Bolos da Nena: run `bun site/scripts/assets.ts screens` first');
  // online Pix through the fake Mercado Pago: connect the store the way the admin's button does
  const payments = await api('GET', '/payments');
  if (!JSON.stringify(payments).includes('"connected"')) {
    const { url } = await api('POST', '/payments/mercadopago/connect');
    const back = await fetch(url.replace(/^https?:\/\/[^/]+/, CORE), { redirect: 'manual', headers: { cookie, 'x-vendua-admin': '1' } });
    if (!/mp=connected/.test(back.headers.get('location') ?? '')) throw new Error(`connect: ${back.status} ${back.headers.get('location')}`);
  }
  // open now, no rush notices, the store's own hours
  psql(`update store_settings set pix_key = '7d3f2a9e-41c6-4b8e-9a05-c2e81f64b7d1', pix_key_type = 'random', pix_beneficiary = 'Bolos da Nena', pix_city = 'Campos'
        where tenant_id = '${tenant}'`);
  psql(`update store_settings set freio_mode = 'off', freio_level = 'normal', demand_level = 'normal', status_override = null,
          hours = '{"timezone":"America/Sao_Paulo","windows":[{"days":[1,2,3,4,5,6],"open":"08:00","close":"19:00"},{"days":[0],"open":"08:00","close":"12:00"}]}'
        where tenant_id = '${tenant}'`);
  // the board before the new order: nothing waiting, three in the kitchen
  psql(`update orders set state = 'preparing' where tenant_id = '${tenant}' and state = 'placed'`);
  // a week ago, the same weekday, so "Seu dia" has a comparison to make
  psql(`update orders set placed_at = now() - interval '7 days' - make_interval(hours => (number % 7)), updated_at = now() - interval '7 days'
        where tenant_id = '${tenant}' and state = 'delivered' and number in (select number from orders where tenant_id = '${tenant}' and state = 'delivered' order by number limit 9)`);
  return tenant;
}

/** An order placed through the storefront API with Pix, as a shopper's phone would. */
async function placeOrder({ name, phone, slug, qty }) {
  // node:http, because fetch won't send our Host and Core finds the store by it
  const call = (method, path, body, token) =>
    new Promise((ok, fail) => {
      const req = request(`${CORE}${path}`, {
        method,
        headers: {
          host: 'bolosdanena.localhost',
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      req.on('error', fail);
      req.on('response', (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          const json = JSON.parse(raw || '{}');
          if (res.statusCode >= 400) fail(new Error(`${method} ${path} → ${res.statusCode} ${raw}`));
          else ok(json);
        });
      });
      req.end(body ? JSON.stringify(body) : undefined);
    });
  const { sessionToken: token } = await call('POST', '/checkout/v1/session');
  const { product } = await call('GET', `/storefront/v1/products/${slug}`);
  await call('POST', '/checkout/v1/cart/items', { productId: product.id, qty, modifierIds: [] }, token);
  const { order } = await call(
    'POST',
    '/checkout/v1/checkout',
    { customer: { name, phone }, delivery: { mode: 'pickup' }, payment: { method: 'pix' } },
    token,
  );
  // an online Pix is created when the shopper's page asks to pay
  await call('POST', `/checkout/v1/orders/${order.id}/pay`, undefined, token);
  const payment = psql(`select provider_payment_id from payments where order_id = '${order.id}' and provider_payment_id is not null limit 1`);
  return { id: order.id, number: order.number, payment };
}

/** Films until `ready()` is true on the page: the app's own transition stays in the clip. */
async function rolling(rec, ready, what, max = 150) {
  for (let i = 0; i < max; i++) {
    if (await ready()) return;
    await rec.frames(1);
    if (i % 10 === 9) await rec.settle(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Holds a step until `ready()` is true on the page, letting real and virtual time run. */
async function until(rec, ready, what, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await ready()) return;
    await rec.settle(150);
    await rec.idle(60);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export default async function flow({ browser, phone, Rec, only }) {
  const want = (clip) => !only || only.has(clip);
  const tenant = await prepare();
  const today = new Date();

  // ── the storefront: home, then one order through to the Pix code ──
  const shop = await phone(browser, { time: today });
  const pix = brCode(9000);
  await shop.route(/\/(checkout|storefront)\/v1\//, async (route) => {
    if ((route.request().headers().accept ?? '').includes('event-stream')) return route.continue();
    // Playwright fetches from Node, which can't resolve *.localhost: same server, Host kept
    const req = route.request();
    const res = await route.fetch({
      url: req.url().replace('bolosdanena.localhost', 'localhost'),
      headers: { ...req.headers(), host: new URL(req.url()).host },
    });
    const body = await res.text();
    if (!body.includes('FAKEPIX')) return route.fulfill({ response: res, body });
    route.fulfill({ response: res, body: body.replace(/"[^"]*FAKEPIX[^"]*"/g, JSON.stringify(pix)) });
  });
  await shop.goto(`${STORE}/`);
  const loja = new Rec(shop, 'loja');
  await loja.warm();
  if (want('loja')) {
    loja.start();
    await loja.seconds(0.6);
    await loja.scroll(560, 1.4);
    await loja.seconds(0.5);
    loja.finish();
  } else await shop.evaluate(() => scrollTo(0, 560));

  // one order end to end: the purchase, the board and the shopper's page are cut from it
  if (want('compra')) {
    const buy = new Rec(shop, 'compra');
    buy.start();
    const card = shop.locator(`a[href="/produto/${PRODUCT}"]`).first();
    await card.scrollIntoViewIfNeeded();
    await buy.seconds(0.3);
    await buy.tap(card, 'produto');
    await until(buy, () => shop.getByRole('button', { name: /aumentar quantidade/i }).isVisible(), 'the product page');
    await buy.seconds(0.7);
    await buy.tap(shop.getByRole('button', { name: /aumentar quantidade/i }), 'mais');
    await buy.seconds(0.5);
    await buy.tap(shop.getByRole('button', { name: /adicionar à sacola/i }), 'adicionar');
    await until(buy, () => shop.getByRole('button', { name: /ir para o pagamento/i }).isVisible(), 'the bag');
    await buy.seconds(0.9);
    await buy.tap(shop.getByRole('button', { name: /ir para o pagamento/i }), 'pagar');
    await until(buy, () => shop.locator('input[name=name]').isVisible(), 'the checkout');
    await buy.seconds(0.4);
    buy.mark('dados');
    await buy.type(shop.locator('input[name=name]'), SHOPPER.name, 1);
    await buy.type(shop.locator('input[name=phone]'), SHOPPER.phone, 1);
    await buy.seconds(0.3);
    await buy.tap(shop.getByRole('button', { name: /^continuar/i }), 'continuar');
    await until(buy, () => shop.getByText('Retirada', { exact: false }).first().isVisible(), 'the delivery step');
    await buy.seconds(0.4);
    await buy.tap(shop.getByText('Retirada', { exact: false }).first(), 'retirada');
    await buy.seconds(0.4);
    await buy.tap(shop.getByRole('button', { name: /^continuar/i }), 'continuar2');
    await until(buy, () => shop.getByRole('button', { name: /confirmar pedido/i }).isVisible(), 'the payment step');
    await buy.seconds(0.6);

    // the merchant admin, Noite, is filming its board before the order exists: an animation that
    // starts on a page whose clock isn't stepping would play out unfilmed
    const admin = await phone(browser, { time: new Date(), colorScheme: 'dark', storageState: AUTH });
    await admin.goto(new URL('pedidos', ADMIN).href);
    const board = new Rec(admin, 'pedidos');
    await board.warm(10);
    board.start();
    await board.seconds(0.5);
    await buy.tap(shop.getByRole('button', { name: /confirmar pedido/i }), 'confirmar');
    const cardOf = admin.locator(`[aria-label*=", ${SHOPPER.name.split(' ')[0]},"]`).first();
    for (let i = 0; i < 120 && !(await cardOf.isVisible().catch(() => false)); i++) await board.frames(1);
    if (!(await cardOf.isVisible())) throw new Error('the order never reached the board');
    board.mark('chegou');
    await board.seconds(1.2);
    // the shopper's side meanwhile: the Pix code, before it's paid
    await until(buy, () => shop.getByText(/pague com pix/i).first().isVisible(), 'the Pix code');
    buy.mark('pix');
    await buy.seconds(1.6);
    buy.finish();
    const [orderId, number] = psql(`select id, number from orders where tenant_id = '${tenant}' order by number desc limit 1`).split('|');
    const payment = psql(`select provider_payment_id from payments where order_id = '${orderId}' and provider_payment_id is not null limit 1`);
    if (!payment) throw new Error(`order #${number} has no Mercado Pago payment to settle`);
    console.log(`order #${number} (${orderId}), payment ${payment}`);
    await api('POST', `/dev/mp/payments/${payment}/settle`, { status: 'approved' });
    board.mark('pago');
    for (let i = 0; i < 90 && !(await cardOf.getByText(/pago online/i).isVisible().catch(() => false)); i++) await board.frames(1);
    board.mark('pagoVisto');
    await board.seconds(0.9);
    const accept = cardOf.locator('button', { hasText: /^aceitar/ });
    await board.tap(accept, 'aceitar');
    await board.seconds(2.4);
    board.finish();
    // let the undo window pass so Core has the order as accepted
    await board.idle(6500);
    await board.settle(1200);
    await board.idle(500);

    // ── the shopper's page catches up: paid, and accepted ──
    const track = new Rec(shop, 'acompanha');
    track.start();
    await track.seconds(0.3);
    for (let i = 0; i < 240 && !(await shop.getByText(/pagamento confirmado/i).first().isVisible().catch(() => false)); i++) await track.frames(1);
    track.mark('confirmado');
    await track.seconds(1.8);
    track.finish();
  }

  // ── Início: another paid order lands while it's open, and today's sales roll up ──
  if (want('inicio')) {
    const home = await phone(browser, { time: new Date(), colorScheme: 'dark', storageState: AUTH });
    await home.goto(ADMIN);
    const rec = new Rec(home, 'inicio');
    await rec.warm(10);
    const sales = () => home.getByText(/^R\$\s?[\d.]+,\d\d$/).first().textContent().catch(() => '');
    const before = await sales();
    rec.start();
    await rec.seconds(0.8);
    const extra = await placeOrder({ name: 'Mariana Souza', phone: '22997773333', slug: 'bolo-de-chocolate-molhadinho', qty: 1 });
    await api('POST', `/dev/mp/payments/${extra.payment}/settle`, { status: 'approved' });
    rec.mark('pago');
    for (let i = 0; i < 120 && (await sales()) === before; i++) await rec.frames(1);
    rec.mark('rola');
    await rec.seconds(2.2);
    rec.finish();
    console.log(`inicio: ${before} → ${await sales()}`);
  }

  // ── "Seu dia": the store closed at 18h, the recap at 19:07 ──
  if (want('seudia')) {
    const weekday = new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
    const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
    const days = [0, 1, 2, 3, 4, 5, 6].filter((x) => x !== d);
    psql(`update store_settings set hours = '{"timezone":"America/Sao_Paulo","windows":[{"days":${JSON.stringify(days)},"open":"08:00","close":"18:00"}]}' where tenant_id = '${tenant}'`);
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const dusk = await phone(browser, { time: new Date(`${date}T19:07:00-03:00`), colorScheme: 'dark', storageState: AUTH });
    await dusk.goto(ADMIN);
    const rec = new Rec(dusk, 'seudia');
    await rec.warm(10);
    rec.start();
    await rec.seconds(3);
    rec.finish();
    psql(`update store_settings set hours = '{"timezone":"America/Sao_Paulo","windows":[{"days":[1,2,3,4,5,6],"open":"08:00","close":"19:00"},{"days":[0],"open":"08:00","close":"12:00"}]}' where tenant_id = '${tenant}'`);
  }

  // ── Bem-vindo: Duá's questions with the store card filling in beside them, then the finale ──
  if (want('monta') || want('noar')) {
    // a store that hasn't started, and an address that matches its name (the seed's is pudim)
    psql(`update store_settings set onboarding = '{}' where tenant_id = '${tenant}'`);
    psql(`insert into domains (tenant_id, host) values ('${tenant}', 'bolosdanena.vendua.com.br') on conflict do nothing`);
    psql(`update domains set is_primary = false where tenant_id = '${tenant}'`);
    psql(`update domains set is_primary = true where host = 'bolosdanena.vendua.com.br'`);
    const wiz = await phone(browser, { time: new Date(), colorScheme: 'dark', storageState: AUTH });
    const q = (text) => () => wiz.getByRole('heading', { name: text }).first().isVisible().catch(() => false);
    if (want('monta')) {
      await wiz.goto(new URL('bem-vindo', ADMIN).href);
      const rec = new Rec(wiz, 'monta');
      await rec.warm(10);
      rec.start();
      await rec.seconds(0.8);
      // the button sits under the four parts of the map: a thumb scrolls down to it
      const go = wiz.getByRole('button', { name: /bora começar/i });
      const { y } = await go.boundingBox();
      await rec.scroll(y - 640, 0.5);
      await go.scrollIntoViewIfNeeded();
      await rec.seconds(0.15);
      await rec.tap(go, 'comecar');
      // signup already asked what it sells: the wizard opens on the name
      await rolling(rec, q(/como se chama/i), 'the name question');
      await rec.seconds(0.3);
      const name = wiz.getByRole('textbox').first();
      await name.fill('');
      rec.mark('nome');
      await rec.type(name, 'Bolos da Nena', 1);
      await rec.seconds(0.3);
      await rec.tap(wiz.getByRole('button', { name: /^continuar/i }), 'continuar');
      await rolling(rec, q(/foto ou logo/i), 'the logo question');
      await rec.seconds(0.3);
      await rec.tap(wiz.getByText(/deixar para depois/i).first(), 'logo');
      await rolling(rec, q(/cor da loja/i), 'the colour question');
      await rec.seconds(0.4);
      // the draft only: the colour is saved on Continuar, which this clip never taps
      await rec.tap(wiz.getByText('caramelo', { exact: true }), 'cor');
      await rec.seconds(0.6);
      // and back to its own green, the one the finale shows
      await rec.tap(wiz.getByText('floresta', { exact: true }), 'cor2');
      await rec.seconds(0.8);
      rec.finish();
    }
    if (want('noar')) {
      await wiz.goto(new URL('bem-vindo?passo=pronto', ADMIN).href);
      const rec = new Rec(wiz, 'noar');
      // filmed from before the finale paints, so its entrance is in the clip
      rec.start();
      await rolling(rec, q(/está no ar/i), 'the finale');
      rec.mark('noar');
      await rec.seconds(2.6);
      rec.finish();
    }
    psql(`update store_settings set onboarding = '{}' where tenant_id = '${tenant}'`);
  }
}

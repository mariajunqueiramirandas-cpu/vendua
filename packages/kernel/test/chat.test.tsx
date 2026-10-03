import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';
import { useCart } from '../src/index.ts';
import { CHAT_POLL_MS } from '../src/chat.ts';

// Kernel 1.18 — the store's assistant (the Vendedor) on the site: a system surface over the
// cart session, polled while a reply is on its way, rereading the cart when its turn lands.

let m: Mounted | null = null;
const POLL = { ...CHAT_POLL_MS };
beforeEach(() => {
  CHAT_POLL_MS.pending = 15;
  CHAT_POLL_MS.open = 60_000;
});
afterEach(() => {
  m?.unmount();
  m = null;
  Object.assign(CHAT_POLL_MS, POLL);
});

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CHAT = { name: 'Bia', intro: 'Bia, assistente virtual da Loja Teste' };

type Msg = { id: string; author: string; body: string; at: string; card: string | null };
interface Fake {
  calls: { method: string; path: string; headers: Record<string, string>; body?: unknown }[];
  messages: Msg[];
  pending: boolean;
  /** the Vendedor's next turn: lands on the next read after a send */
  reply: Msg[] | null;
  items: number;
  chatOn: boolean;
  post?: () => Response | null;
}

function cart(items: number) {
  return {
    id: 'cart',
    status: 'open',
    items: [],
    totals: {
      subtotalCents: 1800 * items,
      deliveryFeeCents: 0,
      totalCents: 1800 * items,
      itemCount: items,
      minOrderCents: 0,
      remainingMinOrderCents: 0,
      belowMinOrder: false,
    },
    delivery: null,
  };
}

/** mockCore + a Core with the chat on, the Vendedor answering one read after each send */
function fakeCore(over: Partial<Fake> = {}): Fake {
  mockCore();
  const base = globalThis.fetch;
  const f: Fake = {
    calls: [],
    messages: [],
    pending: false,
    reply: [
      {
        id: 'a1',
        author: 'agent',
        body: 'Coloquei 1 Pudim.',
        at: '2026-10-03T12:00:05Z',
        card: null,
      },
    ],
    items: 0,
    chatOn: true,
    ...over,
  };
  const view = () => ({
    available: f.chatOn,
    ...(f.chatOn ? CHAT : { name: null, intro: null }),
    messages: f.messages,
    pending: f.pending,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    f.calls.push({ method, path: url.pathname, headers, body });
    const p = url.pathname;
    if (p === '/storefront/v1/store') return json(200, { ...STORE, chat: f.chatOn ? CHAT : null });
    if (p === '/checkout/v1/cart') return json(200, { cart: cart(f.items) });
    if (p === '/checkout/v1/chat' && method === 'GET') {
      if (!headers.authorization)
        return json(401, { error: { code: 'SESSION_REQUIRED', message: 'x' } });
      if (f.pending && f.reply) {
        f.messages = [...f.messages, ...f.reply];
        f.reply = null;
        f.pending = false;
        f.items += 1;
      }
      return json(200, view());
    }
    if (p === '/checkout/v1/chat' && method === 'POST') {
      const hit = f.post?.();
      if (hit) return hit;
      f.messages = [
        ...f.messages,
        {
          id: `s${f.messages.length}`,
          author: 'shopper',
          body: body.text,
          at: '2026-10-03T12:00:00Z',
          card: null,
        },
      ];
      f.pending = true;
      return json(201, view());
    }
    return base(input, init);
  }) as typeof fetch;
  return f;
}

async function type(el: HTMLTextAreaElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(el: Element | null) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}
async function submit() {
  await act(async () => {
    $<HTMLFormElement>('[data-part="composer"]')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}
/** waits (in act) until `ok()` holds, for at most a second */
async function until(ok: () => boolean) {
  for (let i = 0; i < 100 && !ok(); i++) await wait(10);
}
async function wait(ms: number) {
  await act(async () => new Promise((r) => setTimeout(r, ms)));
  await flush();
}
const chatReads = (f: Fake) =>
  f.calls.filter((c) => c.method === 'GET' && c.path === '/checkout/v1/chat').length;

function Count() {
  const { cart } = useCart();
  return <output id="count">{cart ? cart.totals.itemCount : 'none'}</output>;
}

describe('store chat (Kernel 1.18)', () => {
  test('renders nothing and reads nothing when the store has no chat', async () => {
    const f = fakeCore({ chatOn: false });
    m = await mount({ path: '/', session: 'tok' });
    expect($('[data-vendua="chat"]')).toBeNull();
    expect(chatReads(f)).toBe(0);
  });

  test('a launcher opens a modal dialog; Escape closes it and focus returns to the launcher', async () => {
    fakeCore();
    m = await mount({ path: '/' });
    const launcher = $<HTMLButtonElement>('[data-vendua="chat"] [data-part="launcher"]')!;
    expect(launcher.getAttribute('aria-label')).toContain('Bia');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    await click(launcher);
    const dialog = $<HTMLDialogElement>('[data-vendua="chat"] dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    expect($('[data-part="title"]')!.textContent).toBe('Bia');
    expect($('[data-part="intro"]')!.textContent).toContain(
      'Bia, assistente virtual da Loja Teste',
    );
    expect($('[data-part="note"]')!.textContent).toContain('sua sacola');
    await act(async () => {
      $('textarea[name="chat-message"]')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  test('sends with an Idempotency-Key and shows the reply after polling', async () => {
    // slow enough to see "digitando…" before the next read
    CHAT_POLL_MS.pending = 150;
    const f = fakeCore();
    m = await mount({ path: '/' });
    await click($('[data-part="launcher"]'));
    const box = $<HTMLTextAreaElement>('textarea[name="chat-message"]')!;
    await type(box, '  quero um pudim  ');
    await submit();
    await flush();
    // no session yet: sending starts one, then posts on it
    const post = f.calls.find((c) => c.method === 'POST' && c.path === '/checkout/v1/chat')!;
    expect(post.body).toEqual({ text: 'quero um pudim' });
    expect(post.headers['idempotency-key']).toBeTruthy();
    expect(post.headers.authorization).toBe('Bearer tok');
    expect(f.calls.findIndex((c) => c.path === '/checkout/v1/session')).toBeLessThan(
      f.calls.indexOf(post),
    );
    expect(box.value).toBe('');
    expect($('[data-part="message"][data-author="shopper"]')!.textContent).toContain(
      'quero um pudim',
    );
    expect($('[data-part="typing"]')!.textContent).toContain('digitando');
    await until(() => !$('[data-part="typing"]'));
    expect($('[data-part="typing"]')).toBeNull();
    const reply = $('[data-part="message"][data-author="agent"]')!;
    expect(reply.textContent).toContain('Coloquei 1 Pudim.');
    expect(reply.querySelector('[data-part="author"]')!.textContent).toContain('Bia');
    expect($('[data-part="announce"]')!.textContent).toBe('Bia: Coloquei 1 Pudim.');
  });

  test('rereads the cart when the Vendedor’s turn lands', async () => {
    const f = fakeCore({ items: 0 });
    m = await mount({ path: '/', session: 'tok', children: <Count /> });
    expect($('#count')!.textContent).toBe('0');
    await click($('[data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'põe um pudim');
    await submit();
    await until(() => $('#count')!.textContent === '1');
    expect($('[data-part="message"][data-author="agent"]')).not.toBeNull();
    expect($('#count')!.textContent).toBe('1');
    // and polls slowly once nothing is pending
    const reads = chatReads(f);
    await wait(40);
    expect(chatReads(f)).toBe(reads);
  });

  test('a reply that lands while closed shows as unread', async () => {
    CHAT_POLL_MS.pending = 150;
    fakeCore();
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await act(async () => {
      ($('[data-part="close"]') as HTMLElement).click();
    });
    expect($('[data-part="unread"]')).toBeNull();
    await until(() => !!$('[data-part="unread"]'));
    expect($('[data-part="unread"]')!.textContent).toBe('1');
    expect($('[data-part="launcher"]')!.getAttribute('aria-label')).toContain('1 nova mensagem');
    expect($('[data-part="announce"]')!.textContent).toBe('Nova mensagem de Bia.');
    await click($('[data-part="launcher"]'));
    expect($('[data-part="unread"]')).toBeNull();
  });

  test('only same-origin links are tappable', async () => {
    fakeCore({
      messages: [
        {
          id: 'c1',
          author: 'core',
          body: 'Sua sacola: http://shop.test/sacola.',
          at: '2026-10-03T12:00:00Z',
          card: 'link',
        },
        {
          id: 'c2',
          author: 'agent',
          body: 'Veja https://evil.example/sacola ou //evil.example/x',
          at: '2026-10-03T12:00:01Z',
          card: null,
        },
      ],
    });
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-part="launcher"]'));
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-part="link"]')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/sacola']);
    expect($('[data-card="link"]')!.textContent).toContain('shop.test/sacola.');
    expect($('[data-part="message"][data-author="agent"]')!.textContent).toContain(
      'https://evil.example/sacola',
    );
  });

  test('errors show in the panel; the message stays in the box', async () => {
    const f = fakeCore({
      post: () => json(429, { error: { code: 'RATE_LIMITED', message: 'too many' } }),
    });
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-part="launcher"]'));
    const box = $<HTMLTextAreaElement>('textarea[name="chat-message"]')!;
    await type(box, 'oi');
    await submit();
    await flush();
    expect($('[data-part="error"]')!.textContent).toBe(
      'Muitas tentativas seguidas. Espere alguns segundos.',
    );
    expect($('[data-part="error"]')!.getAttribute('role')).toBe('alert');
    expect(box.value).toBe('oi');
    // a refusal is final: the next try is a new request
    f.post = () => null;
    await submit();
    await flush();
    const keys = f.calls
      .filter((c) => c.method === 'POST' && c.path === '/checkout/v1/chat')
      .map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect($('[data-part="error"]')).toBeNull();
  });

  test('a send that may have landed retries with the same Idempotency-Key', async () => {
    let fail = true;
    const f = fakeCore({
      post: () => {
        if (!fail) return null;
        fail = false;
        throw new TypeError('offline');
      },
    });
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await flush();
    expect($('[data-part="error"]')!.textContent).toContain('Sem conexão com a loja');
    await submit();
    await flush();
    const keys = f.calls
      .filter((c) => c.method === 'POST' && c.path === '/checkout/v1/chat')
      .map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test('a store that turned the chat off hides it', async () => {
    const f = fakeCore();
    f.post = () => {
      f.chatOn = false;
      return json(404, { error: { code: 'CHAT_UNAVAILABLE', message: 'off' } });
    };
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await flush();
    expect($('[data-vendua="chat"]')).toBeNull();
  });
});

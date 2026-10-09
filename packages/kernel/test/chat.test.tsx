import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { act } from 'react';
import { STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';
import { useCart, useStoreChat } from '../src/index.ts';
import { CHAT_POLL_MS, chatLink } from '../src/chat.ts';

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

type Msg = {
  id: string;
  author: string;
  body: string;
  at: string;
  card: string | null;
  kind?: string;
};
interface Fake {
  calls: { method: string; path: string; headers: Record<string, string>; body?: unknown }[];
  messages: Msg[];
  pending: boolean;
  /** the Vendedor's next turn: lands on the next read after a send */
  reply: Msg[] | null;
  items: number;
  chatOn: boolean;
  post?: () => Response | null;
  /** Kernel 1.24 — what Core says the chat takes (absent = an older Core) */
  media?: { voice: boolean; image: boolean };
  /** …and what the store profile says, before any read */
  profileMedia?: { voice: boolean; image: boolean };
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
    ...(f.media ? { media: f.media } : {}),
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
    if (p === '/storefront/v1/store')
      return json(200, {
        ...STORE,
        chat: f.chatOn ? { ...CHAT, ...(f.profileMedia ? { media: f.profileMedia } : {}) } : null,
      });
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
          body: body.kind === 'voice' ? '' : (body.text ?? ''),
          at: '2026-10-03T12:00:00Z',
          card: null,
          ...(body.kind ? { kind: body.kind } : {}),
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
    $<HTMLFormElement>('[data-vendua="chat"] [data-part="composer"]')!.dispatchEvent(
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
    expect($('[data-vendua="chat"] [data-part="title"]')!.textContent).toBe('Bia');
    expect($('[data-vendua="chat"] [data-part="intro"]')!.textContent).toContain(
      'Bia, assistente virtual da Loja Teste',
    );
    expect($('[data-vendua="chat"] [data-part="note"]')!.textContent).toContain('sua sacola');
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
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
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
    expect(
      $('[data-vendua="chat"] [data-part="message"][data-author="shopper"]')!.textContent,
    ).toContain('quero um pudim');
    expect($('[data-vendua="chat"] [data-part="typing"]')!.textContent).toContain('digitando');
    await until(() => !$('[data-vendua="chat"] [data-part="typing"]'));
    expect($('[data-vendua="chat"] [data-part="typing"]')).toBeNull();
    const reply = $('[data-vendua="chat"] [data-part="message"][data-author="agent"]')!;
    expect(reply.textContent).toContain('Coloquei 1 Pudim.');
    expect(reply.querySelector('[data-part="author"]')!.textContent).toContain('Bia');
    expect($('[data-vendua="chat"] [data-part="announce"]')!.textContent).toBe(
      'Bia: Coloquei 1 Pudim.',
    );
  });

  test('rereads the cart when the Vendedor’s turn lands', async () => {
    const f = fakeCore({ items: 0 });
    m = await mount({ path: '/', session: 'tok', children: <Count /> });
    expect($('#count')!.textContent).toBe('0');
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'põe um pudim');
    await submit();
    await until(() => $('#count')!.textContent === '1');
    expect($('[data-vendua="chat"] [data-part="message"][data-author="agent"]')).not.toBeNull();
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
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await act(async () => {
      ($('[data-vendua="chat"] [data-part="close"]') as HTMLElement).click();
    });
    expect($('[data-vendua="chat"] [data-part="unread"]')).toBeNull();
    await until(() => !!$('[data-vendua="chat"] [data-part="unread"]'));
    expect($('[data-vendua="chat"] [data-part="unread"]')!.textContent).toBe('1');
    expect($('[data-vendua="chat"] [data-part="launcher"]')!.getAttribute('aria-label')).toContain(
      '1 nova mensagem',
    );
    expect($('[data-vendua="chat"] [data-part="announce"]')!.textContent).toBe(
      'Nova mensagem de Bia.',
    );
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    expect($('[data-vendua="chat"] [data-part="unread"]')).toBeNull();
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
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>('[data-vendua="chat"] [data-part="link"]'),
    ];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/sacola']);
    expect($('[data-card="link"]')!.textContent).toContain('shop.test/sacola.');
    expect(
      $('[data-vendua="chat"] [data-part="message"][data-author="agent"]')!.textContent,
    ).toContain('https://evil.example/sacola');
  });

  test('errors show in the panel; the message stays in the box', async () => {
    const f = fakeCore({
      post: () => json(429, { error: { code: 'RATE_LIMITED', message: 'too many' } }),
    });
    m = await mount({ path: '/', session: 'tok' });
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    const box = $<HTMLTextAreaElement>('textarea[name="chat-message"]')!;
    await type(box, 'oi');
    await submit();
    await flush();
    expect($('[data-vendua="chat"] [data-part="error"]')!.textContent).toBe(
      'Muitas tentativas seguidas. Espere alguns segundos.',
    );
    expect($('[data-vendua="chat"] [data-part="error"]')!.getAttribute('role')).toBe('alert');
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
    expect($('[data-vendua="chat"] [data-part="error"]')).toBeNull();
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
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await flush();
    expect($('[data-vendua="chat"] [data-part="error"]')!.textContent).toContain(
      'Sem conexão com a loja',
    );
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
    await click($('[data-vendua="chat"] [data-part="launcher"]'));
    await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
    await submit();
    await flush();
    expect($('[data-vendua="chat"]')).toBeNull();
  });

  test('a link never leaves the page origin, however its path is written', () => {
    const here = location.origin;
    for (const evil of [`${here}//evil.com/x`, `${here}/\\evil.com`, '/.//evil.com']) {
      const href = chatLink(evil);
      expect(href).not.toBeNull();
      expect(new URL(href!, location.href).origin).toBe(here);
    }
    expect(chatLink('https://evil.com/sacola')).toBeNull();
  });

  test('a reply that never comes stops the fast poll', async () => {
    CHAT_POLL_MS.pendingMax = 120;
    const f = fakeCore({ pending: true, reply: null });
    m = await mount({ path: '/', session: 'tok' });
    const reads = () =>
      f.calls.filter((c) => c.method === 'GET' && c.path.endsWith('/chat')).length;
    await act(() => new Promise((r) => setTimeout(r, 300)));
    const settled = reads();
    expect(settled).toBeGreaterThan(1);
    await act(() => new Promise((r) => setTimeout(r, 200)));
    expect(reads()).toBe(settled);
  });
});

// Kernel 1.24 — voice messages and photos: base64 in the Kernel, the same send semantics as text.
let probe: ReturnType<typeof useStoreChat> | null = null;
function Probe() {
  probe = useStoreChat();
  return null;
}
const posts = (f: Fake) =>
  f.calls.filter((c) => c.method === 'POST' && c.path === '/checkout/v1/chat');
const bytes = (...b: number[]) => new Uint8Array(b);

describe('store chat media (Kernel 1.24)', () => {
  afterEach(() => {
    probe = null;
    setSystemTime();
  });

  test('a voice message and a photo go as base64 with their kind, each with its own key', async () => {
    const f = fakeCore({ media: { voice: true, image: true }, reply: null });
    m = await mount({ path: '/', session: 'tok', children: <Probe /> });
    await until(() => probe!.media.voice);
    expect(probe!.media).toEqual({ voice: true, image: true });
    let ok = false;
    await act(async () => {
      ok = await probe!.sendVoice(
        new Blob([bytes(1, 2, 3, 250)], { type: 'audio/webm;codecs=opus' }),
        3.4,
      );
    });
    expect(ok).toBe(true);
    await act(async () => {
      ok = await probe!.sendPhoto(
        new Blob([bytes(255, 216, 255)], { type: 'image/jpeg' }),
        '  de chocolate ',
      );
    });
    expect(ok).toBe(true);
    const [voice, photo] = posts(f);
    expect(voice!.body).toEqual({
      kind: 'voice',
      mime: 'audio/webm;codecs=opus',
      data: btoa(String.fromCharCode(1, 2, 3, 250)),
      seconds: 3,
    });
    expect(photo!.body).toEqual({
      kind: 'image',
      mime: 'image/jpeg',
      data: btoa(String.fromCharCode(255, 216, 255)),
      text: 'de chocolate',
    });
    expect(voice!.headers['idempotency-key']).toBeTruthy();
    expect(voice!.headers['idempotency-key']).not.toBe(photo!.headers['idempotency-key']);
    expect(voice!.headers.authorization).toBe('Bearer tok');
    expect(probe!.messages.map((x) => x.kind)).toEqual(['voice', 'image']);
  });

  test('a photo send that may have landed retries with the same key; another photo takes a new one', async () => {
    let fail = true;
    const f = fakeCore({
      media: { voice: true, image: true },
      reply: null,
      post: () => {
        if (!fail) return null;
        fail = false;
        throw new TypeError('offline');
      },
    });
    m = await mount({ path: '/', session: 'tok', children: <Probe /> });
    await until(() => probe!.media.image);
    const shot = new Blob([bytes(1, 2)], { type: 'image/png' });
    let ok = true;
    await act(async () => {
      ok = await probe!.sendPhoto(shot);
    });
    expect(ok).toBe(false);
    expect(probe!.message).toContain('Sem conexão com a loja');
    await act(async () => {
      ok = await probe!.sendPhoto(shot);
    });
    expect(ok).toBe(true);
    await act(async () => {
      await probe!.sendPhoto(new Blob([bytes(3)], { type: 'image/png' }));
    });
    const keys = posts(f).map((c) => c.headers['idempotency-key']);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
    expect(posts(f)[0]!.body).toEqual({ kind: 'image', mime: 'image/png', data: btoa('\x01\x02') });
  });

  test('too large or not a photo is refused before sending, in words; Core’s 415 too', async () => {
    const f = fakeCore({
      media: { voice: true, image: true },
      reply: null,
      post: () => json(415, { error: { code: 'UNSUPPORTED_MEDIA', message: 'no' } }),
    });
    m = await mount({ path: '/', session: 'tok', children: <Probe /> });
    await until(() => probe!.media.image);
    await act(async () => {
      await probe!.sendPhoto(
        new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }),
      );
    });
    expect(probe!.error?.code).toBe('PAYLOAD_TOO_LARGE');
    expect(probe!.message).toBe('Foto grande demais. Escolha outra.');
    await act(async () => {
      await probe!.sendPhoto(new Blob([bytes(1)], { type: 'image/gif' }));
    });
    expect(probe!.error?.code).toBe('UNSUPPORTED_MEDIA');
    expect(posts(f)).toHaveLength(0);
    await act(async () => {
      await probe!.sendVoice(new Blob([bytes(1)], { type: 'audio/x-weird' }), 2);
    });
    expect(posts(f)).toHaveLength(1);
    expect(probe!.message).toBe('Não deu para enviar esse áudio. Escreva sua mensagem.');
  });

  test('text only until Core says otherwise; the store profile answers before a session', async () => {
    const f = fakeCore({ profileMedia: { voice: true, image: false } });
    m = await mount({ path: '/', children: <Probe /> });
    await until(() => probe!.available);
    expect(chatReads(f)).toBe(0);
    expect(probe!.media).toEqual({ voice: true, image: false });
    m.unmount();
    probe = null;
    fakeCore();
    m = await mount({ path: '/', session: 'tok', children: <Probe /> });
    await until(() => !probe!.loading);
    expect(probe!.media).toEqual({ voice: false, image: false });
  });

  test('the default chat records a voice message and sends it', async () => {
    const G = globalThis as Record<string, unknown>;
    const had = { MediaRecorder: G.MediaRecorder, mediaDevices: navigator.mediaDevices };
    const stopped: string[] = [];
    class FakeRecorder {
      static isTypeSupported = (t: string) => t === 'audio/ogg;codecs=opus';
      state = 'inactive';
      mimeType: string;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_s: unknown, o: { mimeType?: string; audioBitsPerSecond?: number }) {
        this.mimeType = o.mimeType ?? '';
        expect(o.audioBitsPerSecond).toBe(32000);
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([bytes(7, 7)], { type: this.mimeType }) });
        queueMicrotask(() => this.onstop?.());
      }
    }
    G.MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped.push('track') }] }),
      },
    });
    try {
      const f = fakeCore({ media: { voice: true, image: true }, reply: null });
      m = await mount({ path: '/', session: 'tok' });
      await click($('[data-vendua="chat"] [data-part="launcher"]'));
      await until(() => !!$('[data-vendua="chat"] [data-part="mic"]'));
      const mic = $('[data-vendua="chat"] [data-part="mic"]')!;
      expect(mic.getAttribute('aria-label')).toBe('Gravar mensagem de voz');
      expect($('[data-vendua="chat"] [data-part="photo"]')!.getAttribute('aria-label')).toBe(
        'Enviar foto',
      );
      await click(mic);
      await flush();
      expect($('[data-vendua="chat"] [data-part="recording"]')).not.toBeNull();
      expect($('[data-vendua="chat"] [data-part="recording-time"]')!.textContent).toContain('0:00');
      setSystemTime(new Date(Date.now() + 4200));
      await click($('[data-vendua="chat"] [data-part="recording-send"]'));
      await until(() => posts(f).length === 1);
      await flush();
      expect(posts(f)[0]!.body).toEqual({
        kind: 'voice',
        mime: 'audio/ogg;codecs=opus',
        data: btoa('\x07\x07'),
        seconds: 4,
      });
      expect(stopped).toEqual(['track']);
      expect($('[data-vendua="chat"] [data-part="recording"]')).toBeNull();
      expect(
        $('[data-vendua="chat"] [data-part="message"][data-kind="voice"]')!.textContent,
      ).toContain('Mensagem de voz');
      // typing turns the mic into send
      await type($<HTMLTextAreaElement>('textarea[name="chat-message"]')!, 'oi');
      expect($('[data-vendua="chat"] [data-part="mic"]')).toBeNull();
      expect($('[data-vendua="chat"] [data-part="send"]')).not.toBeNull();
    } finally {
      G.MediaRecorder = had.MediaRecorder;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: had.mediaDevices,
      });
    }
  });
});

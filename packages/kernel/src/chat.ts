import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  ApiError,
  idemKey,
  type StoreChat,
  type StoreChatMedia,
  type StoreChatMediaKinds,
  type StoreChatMessage,
  type VenduaApi,
} from './api.ts';
import { useKernel, invalidateQuery } from './provider.tsx';
import { useStore, type QueryError } from './hooks.ts';
import { errorCopy } from './rules/errors.ts';

// Kernel 1.18 — the storefront chat (sales-agent.md §8 V4): the Vendedor on the store's own
// site, working this tab's cart session. It answers asynchronously, so the Kernel polls while a
// reply is on its way (and, slower, while the chat is open), and rereads the cart whenever the
// Vendedor's turn lands: it may have edited the bag the page shows. One feed per API client,
// shared by every reader.

/** milliseconds between reads: a reply on its way / the chat open with nothing pending */
/** pendingMax: a reply that hasn't come by then won't come soon (the store took over, or muted) */
export const CHAT_POLL_MS = { pending: 2000, open: 12000, pendingMax: 120_000 };
/** Core's bound on a message */
export const CHAT_MAX_LENGTH = 1000;
/** Kernel 1.24 — Core's bound on a voice message's or photo's bytes (decoded) */
export const CHAT_MEDIA_MAX_BYTES = 2 * 1024 * 1024;
/** Kernel 1.24 — the longest voice message the default chat records */
export const CHAT_VOICE_MAX_SECONDS = 60;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type ImageMime = (typeof IMAGE_MIMES)[number];
const TEXT_ONLY: StoreChatMediaKinds = { voice: false, image: false };

type SendKind = 'text' | 'voice' | 'image';
/** what a send carries; a media send's bytes are encoded just before posting */
type Outgoing =
  | { kind: 'text'; text: string }
  | { kind: 'voice'; blob: Blob; seconds: number }
  | { kind: 'image'; blob: Blob; text: string };

interface ChatState {
  view: StoreChat | null;
  loaded: boolean;
  error: QueryError | undefined;
  sending: boolean;
  sendError: QueryError | undefined;
  /** what the last send carried: its failure reads in its words */
  sendKind: SendKind;
}

const toError = (err: unknown): QueryError =>
  err instanceof ApiError
    ? { status: err.status, code: err.code, message: err.message, details: err.details }
    : { code: 'INTERNAL', message: 'chat failed' };

/** a failure after which the message may have landed: a retry reuses its key */
const mayHaveLanded = (e: QueryError) =>
  e.code === 'NETWORK_ERROR' || e.code === 'IDEMPOTENCY_IN_PROGRESS' || (e.status ?? 0) >= 500;

class ChatFeed {
  private state: ChatState = {
    view: null,
    loaded: false,
    error: undefined,
    sending: false,
    sendError: undefined,
    sendKind: 'text',
  };
  private listeners = new Set<() => void>();
  private holders = 0;
  private live = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private known: Set<string> | null = null;
  private wasPending = false;
  /** the send that may have landed, by what it carried: the same send retries with its key */
  private retry: { kind: SendKind; text: string; blob: Blob | null; key: string } | null = null;
  private onVisible = () => {
    if (!hidden() && this.holders > 0 && (this.live > 0 || this.waiting())) void this.refresh();
  };

  constructor(private api: VenduaApi) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  get = () => this.state;

  private set(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private pendingFrom: number | null = null;

  private waiting() {
    if (!this.state.view?.pending) {
      this.pendingFrom = null;
      return false;
    }
    this.pendingFrom ??= Date.now();
    return Date.now() - this.pendingFrom < CHAT_POLL_MS.pendingMax;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const waiting = this.waiting();
    if (this.holders === 0 || !(this.live > 0 || waiting) || hidden()) return;
    const ms = waiting ? CHAT_POLL_MS.pending : CHAT_POLL_MS.open;
    this.timer = setTimeout(() => void this.refresh(), ms);
  }

  /** mount a reader; `live` = the chat is open in front of the shopper */
  hold(live: boolean): () => void {
    this.holders++;
    if (live) this.live++;
    if (this.holders === 1)
      globalThis.document?.addEventListener('visibilitychange', this.onVisible);
    // opening the chat reads it now; a closed reader reads once per page
    if (live || !this.state.loaded) void this.refresh();
    else this.schedule();
    return () => {
      this.holders--;
      if (live) this.live--;
      if (this.holders === 0)
        globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
      this.schedule();
    };
  }

  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    // no session = nothing said yet (reading would mint nothing: GET needs the Bearer)
    if (!this.api.sessionToken) {
      if (!this.state.loaded) this.set({ loaded: true });
      return Promise.resolve();
    }
    this.inflight = this.api
      .chat()
      .then(
        (view) => this.apply(view),
        (err) => {
          const e = toError(err);
          // a token Core no longer takes is a conversation not started on this cart
          if (e.status === 401) this.set({ loaded: true, view: null, error: undefined });
          else this.set({ loaded: true, error: e });
        },
      )
      .finally(() => {
        this.inflight = null;
        this.schedule();
      });
    return this.inflight;
  }

  private apply(view: StoreChat) {
    const known = this.known;
    const fresh = known ? view.messages.filter((m) => !known.has(m.id)) : [];
    const turnEnded = this.wasPending && !view.pending;
    this.known = new Set(view.messages.map((m) => m.id));
    this.wasPending = view.pending;
    this.set({ view, loaded: true, error: undefined });
    // the Vendedor's turn may have edited the bag: the page's sacola rereads it
    if (turnEnded || fresh.some((m) => m.author === 'agent' || m.author === 'core'))
      this.refreshCart();
    if (!view.available) this.refreshStore();
  }

  private refreshCart() {
    if (!this.api.sessionToken) return;
    // seed, don't evict: an evicted cart reads null until the refetch lands
    this.api.cart().then(
      (r) => invalidateQuery('cart', r.cart),
      () => invalidateQuery('cart'),
    );
  }

  private refreshStore() {
    this.api.store().then(
      (s) => invalidateQuery('store', s),
      () => {},
    );
  }

  send(raw: string): Promise<boolean> {
    const text = raw.trim();
    if (!text) return Promise.resolve(false);
    if (text.length > CHAT_MAX_LENGTH) {
      this.set({
        sendKind: 'text',
        sendError: { code: 'BAD_REQUEST', message: 'text must have 1–1000 characters' },
      });
      return Promise.resolve(false);
    }
    return this.post({ kind: 'text', text });
  }

  sendVoice(blob: Blob, seconds: number): Promise<boolean> {
    if (!blob || blob.size === 0) return Promise.resolve(false);
    return this.post({ kind: 'voice', blob, seconds });
  }

  sendPhoto(blob: Blob, caption?: string): Promise<boolean> {
    if (!blob || blob.size === 0) return Promise.resolve(false);
    const text = (caption ?? '').trim();
    if (text.length > CHAT_MAX_LENGTH) {
      this.set({
        sendKind: 'image',
        sendError: { code: 'BAD_REQUEST', message: 'text must have up to 1000 characters' },
      });
      return Promise.resolve(false);
    }
    return this.post({ kind: 'image', blob, text });
  }

  private async post(out: Outgoing): Promise<boolean> {
    if (this.state.sending) return false;
    const refuse = (code: string, message: string) => {
      this.set({ sendKind: out.kind, sendError: { code, message } });
      return false;
    };
    if (out.kind !== 'text') {
      if (out.blob.size > CHAT_MEDIA_MAX_BYTES)
        return refuse('PAYLOAD_TOO_LARGE', 'media must be at most 2 MB');
      if (out.kind === 'image' && !IMAGE_MIMES.includes(out.blob.type as ImageMime))
        return refuse('UNSUPPORTED_MEDIA', 'photos are JPEG, PNG or WebP');
    }
    const text = out.kind === 'voice' ? '' : out.text;
    const blob = out.kind === 'text' ? null : out.blob;
    const r = this.retry;
    const key = r && r.kind === out.kind && r.text === text && r.blob === blob ? r.key : idemKey();
    const before = this.api.sessionToken;
    this.set({ sending: true, sendError: undefined, sendKind: out.kind });
    try {
      const view =
        out.kind === 'text'
          ? await this.api.sendChat(out.text, { idempotencyKey: key })
          : await this.api.sendChatMedia(await mediaBody(out), { idempotencyKey: key });
      this.retry = null;
      // the send started (or rotated) the cart session: the page's cart is a new one
      if (this.api.sessionToken !== before) this.refreshCart();
      this.apply(view);
      this.set({ sending: false });
      this.schedule();
      return true;
    } catch (err) {
      const e = toError(err);
      this.retry = mayHaveLanded(e) ? { kind: out.kind, text, blob, key } : null;
      this.set({ sending: false, sendError: e });
      if (e.code === 'CHAT_UNAVAILABLE') this.refreshStore();
      return false;
    }
  }
}

/** a voice message's or photo's body for Core: the bytes as base64 */
async function mediaBody(out: Exclude<Outgoing, { kind: 'text' }>): Promise<StoreChatMedia> {
  const data = await base64(out.blob);
  if (out.kind === 'voice') {
    const seconds = Math.round(out.seconds);
    return {
      kind: 'voice',
      mime: out.blob.type || 'audio/webm',
      data,
      ...(Number.isFinite(seconds) && seconds > 0 ? { seconds } : {}),
    };
  }
  return {
    kind: 'image',
    mime: out.blob.type as ImageMime,
    data,
    ...(out.text ? { text: out.text } : {}),
  };
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  // in chunks: one String.fromCharCode over 2 MB of arguments overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const hidden = () => globalThis.document?.visibilityState === 'hidden';

const feeds = new WeakMap<VenduaApi, ChatFeed>();
function feedFor(api: VenduaApi): ChatFeed {
  let f = feeds.get(api);
  if (!f) feeds.set(api, (f = new ChatFeed(api)));
  return f;
}

/** A chat failure in words (`ERROR_COPY`, title and body); a voice message's or photo's own. */
export function chatErrorWords(code: string, kind: SendKind = 'text'): string {
  if (kind !== 'text') {
    const voice = kind === 'voice';
    if (code === 'PAYLOAD_TOO_LARGE')
      return voice
        ? 'Áudio grande demais. Grave um mais curto.'
        : 'Foto grande demais. Escolha outra.';
    if (code === 'UNSUPPORTED_MEDIA')
      return voice
        ? 'Não deu para enviar esse áudio. Escreva sua mensagem.'
        : 'Formato de foto não aceito. Envie JPG, PNG ou WebP.';
    if (code === 'BAD_REQUEST')
      return voice
        ? 'Não deu para enviar o áudio. Grave de novo.'
        : 'Não deu para enviar a foto. Tente outra.';
  }
  if (code === 'BAD_REQUEST') return `Escreva uma mensagem de até ${CHAT_MAX_LENGTH} caracteres.`;
  const c = errorCopy(code);
  return c.body ? `${c.title}. ${c.body}` : `${c.title}.`;
}

/**
 * Kernel 1.18 — the store's assistant (the Vendedor) on the site, bound to this tab's cart
 * session: what it said, whether a reply is on its way, and `send`. Pass `live` while the chat is
 * in front of the shopper: the Kernel then reads it every few seconds (every 2 s while a reply is
 * pending, which it also does with the chat closed). When the Vendedor's turn lands the Kernel
 * rereads the cart, so `useCart()` shows what it changed. Never throws: `send` resolves false
 * and `error`/`message` say why. Kernel 1.24: `sendVoice` / `sendPhoto` send a voice message or a
 * photo (base64-encoded here) when `media` says Core takes it, with the same semantics.
 */
export function useStoreChat(opts: { live?: boolean } = {}): {
  /** the store has the chat on (`StoreProfile.chat`) */
  available: boolean;
  name: string | null;
  intro: string | null;
  messages: StoreChatMessage[];
  /** a reply is on its way */
  pending: boolean;
  /** resolves true once Core took the message; starts the cart session when there is none */
  send: (text: string) => Promise<boolean>;
  /** Kernel 1.24 — what the chat takes besides text (Core's word; text only until it says) */
  media: StoreChatMediaKinds;
  /** Kernel 1.24 — a recorded voice message (`MediaRecorder`'s blob, its type the mime) and its
   *  length; same promise, key reuse and errors as `send` */
  sendVoice: (audio: Blob, seconds: number) => Promise<boolean>;
  /** Kernel 1.24 — a photo (JPEG, PNG or WebP, at most 2 MB) with an optional caption */
  sendPhoto: (image: Blob, caption?: string) => Promise<boolean>;
  sending: boolean;
  /** the last send failure (cleared by the next send) or read failure */
  error: QueryError | undefined;
  /** `error` in words */
  message: string | null;
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const { store } = useStore();
  const profile = store?.chat ?? null;
  const feed = feedFor(api);
  const s = useSyncExternalStore(feed.subscribe, feed.get, feed.get);
  const live = !!opts.live;
  const on = !!profile;
  useEffect(() => (on ? feed.hold(live) : undefined), [feed, on, live]);
  const send = useCallback(
    (text: string) => (on ? feed.send(text) : Promise.resolve(false)),
    [feed, on],
  );
  const sendVoice = useCallback(
    (audio: Blob, seconds: number) =>
      on ? feed.sendVoice(audio, seconds) : Promise.resolve(false),
    [feed, on],
  );
  const sendPhoto = useCallback(
    (image: Blob, caption?: string) =>
      on ? feed.sendPhoto(image, caption) : Promise.resolve(false),
    [feed, on],
  );
  const refetch = useCallback(() => void feed.refresh(), [feed]);
  const error = s.sendError ?? s.error;
  const available = on && s.view?.available !== false;
  return {
    available,
    name: available ? (s.view?.name ?? profile!.name) : null,
    intro: available ? (s.view?.intro ?? profile!.intro) : null,
    messages: s.view?.messages ?? [],
    pending: !!s.view?.pending,
    send,
    media: available ? (s.view?.media ?? profile!.media ?? TEXT_ONLY) : TEXT_ONLY,
    sendVoice,
    sendPhoto,
    sending: s.sending,
    error,
    message: error ? chatErrorWords(error.code, s.sendError ? s.sendKind : 'text') : null,
    loading: on && !s.loaded,
    refetch,
  };
}

/** A URL in a chat message → an href on this page's origin, or null (show it as text). The
 *  store's public origin maps onto this one: the cart session lives in this origin's tab. */
export function chatLink(raw: string, publicUrl?: string): string | null {
  const here = globalThis.location?.href;
  if (!here) return null;
  try {
    const u = new URL(raw, here);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const own = new Set([new URL(here).origin]);
    if (publicUrl) own.add(new URL(publicUrl).origin);
    // one leading slash: "//evil.com" would be protocol-relative, off this origin
    return own.has(u.origin) ? `/${u.pathname.replace(/^\/+/, '')}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}

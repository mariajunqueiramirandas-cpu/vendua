import { isPreview } from './preview.ts';
import type { ConsentPurpose } from './config.ts';

// Analytics beacon (15-analytics.md): batched, lossy by design, never blocks
// commerce. Platform events are session-scoped funnel math and always flow;
// `custom.*` events need the store's analytics consent.

export const PLATFORM_EVENTS = [
  'page_view',
  'product_view',
  'add_to_cart',
  'cart_open',
  'checkout_start',
  'checkout_step',
  'payment_submit',
  'order_failed',
  'notice_shown',
  'notice_action',
  'notify_me',
  'slot_error',
  'section_unknown',
] as const;
export type PlatformEvent = (typeof PLATFORM_EVENTS)[number];

interface QueuedEvent {
  name: string;
  at: number;
  props: Record<string, unknown>;
}

const SID_KEY = 'vendua.sid';
const CONSENT_KEY = 'vendua.consent';
const MAX_BATCH = 20;
const FLUSH_MS = 4000;

function randomId(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(
    /[^A-Za-z0-9_-]/g,
    '',
  );
}

/** Short-lived, rotating, first-party — tab-scoped via sessionStorage. */
function sessionId(): string {
  try {
    let sid = globalThis.sessionStorage?.getItem(SID_KEY);
    if (!sid) {
      sid = randomId().slice(0, 32);
      globalThis.sessionStorage?.setItem(SID_KEY, sid);
    }
    return sid;
  } catch {
    return (memorySid ??= randomId().slice(0, 32));
  }
}
let memorySid: string | undefined;

export interface ConsentState {
  version: 1;
  purposes: ConsentPurpose[];
  at: string;
}

export function readConsent(): ConsentState | null {
  try {
    const raw = globalThis.localStorage?.getItem(CONSENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as ConsentState) : null;
    return parsed?.version === 1 && Array.isArray(parsed.purposes) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeConsent(purposes: ConsentPurpose[]): ConsentState {
  const state: ConsentState = { version: 1, purposes, at: new Date().toISOString() };
  try {
    globalThis.localStorage?.setItem(CONSENT_KEY, JSON.stringify(state));
  } catch {
    /* private mode — decision lives for this page only */
  }
  memoryConsent = state;
  consentListeners.forEach((fn) => fn());
  return state;
}
let memoryConsent: ConsentState | null = null;
const consentListeners = new Set<() => void>();
export function onConsentChange(fn: () => void): () => void {
  consentListeners.add(fn);
  return () => consentListeners.delete(fn);
}
export function currentConsent(): ConsentState | null {
  return memoryConsent ?? readConsent();
}

class Beacon {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private baseUrl = '';
  private wired = false;

  configure(baseUrl: string) {
    this.baseUrl = baseUrl;
    if (this.wired || typeof window === 'undefined') return;
    this.wired = true;
    // pagehide fires on mobile tab close where unload doesn't
    window.addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
  }

  push(name: string, props: Record<string, unknown>) {
    this.queue.push({ name, at: Date.now(), props });
    const w = globalThis as { __VENDUA_EVENTS__?: QueuedEvent[] };
    // conformance reads the local tape; bounded so a long session can't grow it forever
    (w.__VENDUA_EVENTS__ ??= []).push({ name, at: Date.now(), props });
    if (w.__VENDUA_EVENTS__.length > 200) w.__VENDUA_EVENTS__.splice(0, 100);
    if (this.queue.length >= MAX_BATCH) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush(unloading = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, 50);
    const body = JSON.stringify({
      batchId: randomId().slice(0, 32),
      sessionId: sessionId(),
      events,
    });
    const url = `${this.baseUrl}/storefront/v1/events`;
    try {
      if (unloading && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }
      void fetch(url, {
        method: 'POST',
        body,
        keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => {});
    } catch {
      /* lossy by design */
    }
  }
}

export const beacon = new Beacon();

/** Kernel-internal: taxonomy events from primitives and surfaces. */
export function emit(name: PlatformEvent, props: Record<string, unknown> = {}) {
  // an editor preview isn't a shopper — keep it out of the store's funnel
  if (isPreview()) return;
  beacon.push(name, props);
}

/** Storefront-facing: only `custom.<name>`, only with analytics consent. */
export function trackCustom(name: string, props: Record<string, unknown> = {}): boolean {
  if (!/^custom\.[a-z0-9_.]{1,48}$/.test(name)) {
    console.warn(`[vendua] track('${name}') ignored — storefront events must be 'custom.<name>'`);
    return false;
  }
  if (!currentConsent()?.purposes.includes('analytics')) return false;
  if (JSON.stringify(props).length > 2048) return false;
  beacon.push(name, props);
  return true;
}

export interface KernelReport {
  kind: 'slot_error' | 'section_error' | 'section_unknown' | 'block_unknown';
  target: string;
  message: string;
  at: number;
}

/** Failures the Kernel degraded around (04: "the failure is reported"). */
export function reportFailure(r: Omit<KernelReport, 'at'>) {
  const entry = { ...r, at: Date.now() };
  const w = globalThis as { __VENDUA_REPORTS__?: KernelReport[] };
  (w.__VENDUA_REPORTS__ ??= []).push(entry);
  if (w.__VENDUA_REPORTS__.length > 100) w.__VENDUA_REPORTS__.splice(0, 50);
  emit(r.kind === 'slot_error' || r.kind === 'section_error' ? 'slot_error' : 'section_unknown', {
    kind: r.kind,
    target: r.target,
    message: r.message.slice(0, 200),
  });
  console.warn(`[vendua] ${r.kind}: ${r.target} — ${r.message}`);
}

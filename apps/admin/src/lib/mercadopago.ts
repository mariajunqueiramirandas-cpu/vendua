import { useEffect } from 'react';

// Mercado Pago's device fingerprint for the plan's Pix (anti-fraud, and the integration-quality
// "SDK do frontend"): MercadoPago.js, started with the platform's public key, sets
// MP_DEVICE_SESSION_ID; without a key, its security script does. Every request then carries the
// id (lib/api.ts, x-vendua-device), and Core sends it with the Pix it issues as X-meli-session-id.

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => unknown;
  }
}

const SDK = 'https://sdk.mercadopago.com/js/v2';
const SECURITY = 'https://www.mercadopago.com/v2/security.js';
// Core's DEVICE_ID_RE: anything else would be dropped there anyway
const DEVICE_RE = /^[A-Za-z0-9_:.-]{1,200}$/;

// which script is on the page: a keyless start (cached data from before the key existed, say)
// still gives way to MercadoPago.js when the key arrives
let loaded: 'sdk' | 'security' | null = null;

function start(publicKey: string | null) {
  if (typeof document === 'undefined') return;
  if (loaded === 'sdk' || (loaded === 'security' && !publicKey)) return;
  const before = loaded;
  loaded = publicKey ? 'sdk' : 'security';
  const s = document.createElement('script');
  s.async = true;
  if (publicKey) {
    s.src = SDK;
    s.onload = () => {
      try {
        if (window.MercadoPago) new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      } catch {
        // a blocked or broken SDK only costs the fingerprint, never the payment
      }
    };
  } else {
    s.src = SECURITY;
    s.setAttribute('view', 'checkout');
  }
  s.onerror = () => {
    loaded = before;
    s.remove();
  };
  document.head.appendChild(s);
}

/** Starts the SDK once billing is on, on the screens that issue a plan Pix. */
export function useMercadoPago(
  billing: { available: boolean; publicKey: string | null } | undefined,
) {
  const available = !!billing?.available;
  const key = billing?.publicKey ?? null;
  useEffect(() => {
    if (available) start(key);
  }, [available, key]);
}

/** The fingerprint, once Mercado Pago's script has set it. */
export function mpDeviceId(): string | null {
  const v = (globalThis as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID;
  return typeof v === 'string' && DEVICE_RE.test(v) ? v : null;
}

// the Kernel's MP_DEVICE_WAIT_MS: a phone loads the script in time, and a blocked one costs a beat
const WAIT_MS = 1500;
// a screen starts the SDK in an effect, which can run after the one that asks for its Pix
const START_GRACE_MS = 150;

/** For a request that issues a Pix: the fingerprint, waiting briefly while Mercado Pago's script
 *  loads (a Pix that goes out without it stays without it). Null when nothing is loading it. */
export async function mpDeviceReady(ms = WAIT_MS): Promise<string | null> {
  const t0 = Date.now();
  for (;;) {
    const id = mpDeviceId();
    if (id) return id;
    const waited = Date.now() - t0;
    if (waited >= ms || (loaded === null && waited >= START_GRACE_MS)) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

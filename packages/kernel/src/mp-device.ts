// Kernel 1.20 — Mercado Pago's device fingerprint for its anti-fraud. MercadoPago.js (the card
// form) and the keyless security.js both publish it as the global MP_DEVICE_SESSION_ID; the
// online Pix has no public key, so it gets security.js.

const SECURITY_SRC = 'https://www.mercadopago.com/v2/security.js';

/** what the order page waits for the fingerprint before it asks Core for the Pix */
export const MP_DEVICE_WAIT_MS = 1500;

/** The fingerprint, when whichever Mercado Pago script is on the page has one. */
export function readMpDeviceId(): string | null {
  const id = (globalThis as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID;
  return typeof id === 'string' && id ? id : null;
}

let security: { script: HTMLScriptElement; loaded: Promise<void> } | null = null;

/** security.js, once per page; a failure (or a script taken off the page) clears the cache so
 *  the next call injects it again. */
function loadSecurity(): Promise<void> {
  if (security?.script.isConnected) return security.loaded;
  const script = document.createElement('script');
  const loaded = new Promise<void>((resolve, reject) => {
    script.src = SECURITY_SRC;
    script.setAttribute('view', 'checkout');
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('security.js did not load'));
    };
    document.head.appendChild(script);
  }).catch((err: unknown) => {
    if (security?.script === script) security = null;
    throw err;
  });
  security = { script, loaded };
  return loaded;
}

/** Starts security.js early (the checkout, once online Pix is picked) so the fingerprint is
 *  usually there by the time the order page asks for the Pix. */
export function preloadMpDevice() {
  if (typeof document === 'undefined' || readMpDeviceId()) return;
  try {
    loadSecurity().catch(() => undefined);
  } catch {
    // a page that refuses scripts: the order page tries again and goes on without it
  }
}

/** The fingerprint as soon as there is one, or null when the script fails or `timeoutMs`
 *  passes — never throws, so a payment never waits on Mercado Pago longer than that. */
export function mpDeviceId({ timeoutMs = MP_DEVICE_WAIT_MS } = {}): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const now = readMpDeviceId();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const finish = () => {
      clearInterval(poll);
      clearTimeout(timer);
      resolve(readMpDeviceId());
    };
    const poll = setInterval(() => readMpDeviceId() && finish(), 100);
    const timer = setTimeout(finish, timeoutMs);
    try {
      loadSecurity().then(() => readMpDeviceId() && finish(), finish);
    } catch {
      finish();
    }
  });
}

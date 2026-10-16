import type { PushConfig, PushState } from '../types.ts';

// Web push for new orders (design spec §5.2, §6.3). The service worker shows the
// notification and handles "aceitar"; this file just (un)subscribes the device.

const api = async () => (await import('../../lib/api.ts')).api;

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const browserCan = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const pushConfigured = (cfg: PushConfig) => !!cfg.publicKey;
export const pushSupported = (cfg: PushConfig) => !!cfg.publicKey && browserCan();

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!browserCan()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/admin/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(cfg: PushConfig): Promise<'on' | 'denied' | 'unsupported'> {
  if (!pushSupported(cfg)) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg =
    (await navigator.serviceWorker.getRegistration('/admin/')) ??
    (await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }));
  await navigator.serviceWorker.ready;
  const key = keyBytes(cfg.publicKey!);
  let sub = await reg.pushManager.getSubscription();
  // made under an earlier VAPID key, it can never be delivered to: start a new one
  if (sub && !sameKey(sub, key)) {
    await (await api()).pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await (await api()).pushSubscribe(sub.toJSON());
  return 'on';
}

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const had = sub.options.applicationServerKey;
  // a browser that doesn't say: keep it, Core drops it if the push service refuses it
  if (!had) return true;
  const a = new Uint8Array(had);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/** On only with a subscription made under the current VAPID key: one from earlier keys can't be
 *  delivered to, so the admin offers to turn push on again, which re-subscribes. */
export async function pushState(cfg: PushConfig): Promise<PushState> {
  if (!pushSupported(cfg)) return 'unsupported';
  const sub = await currentSubscription().catch(() => null);
  if (sub && sameKey(sub, keyBytes(cfg.publicKey!))) return 'on';
  return Notification.permission === 'denied' ? 'denied' : 'off';
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await (await api()).pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** Ties a subscription saved before pushes followed the session to this sign-in, so ending
 *  this session elsewhere stops them. */
export async function rebindPush() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) await (await api()).pushRebind(sub.endpoint).catch(() => undefined);
}

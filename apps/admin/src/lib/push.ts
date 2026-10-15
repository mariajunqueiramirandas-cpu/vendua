import { api } from './api.ts';

// Web push for new orders (design spec §5.2, §6.3). The service worker shows the
// notification and handles "aceitar"; this file just (un)subscribes the device.

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/admin/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush(publicKey: string): Promise<'on' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg =
    (await navigator.serviceWorker.getRegistration('/admin/')) ??
    (await navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }));
  await navigator.serviceWorker.ready;
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // made under an earlier VAPID key, it can never be delivered to: start a new one
  if (sub && !sameKey(sub, key)) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.pushSubscribe(sub.toJSON());
  return 'on';
}

function sameKey(sub: PushSubscription, key: Uint8Array) {
  const had = sub.options.applicationServerKey;
  // a browser that doesn't say: keep it, Core drops it if the push service refuses it
  if (!had) return true;
  const a = new Uint8Array(had);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/** This device's subscription, unless it was made under another VAPID key (the keys changed):
 *  the admin then offers to turn push on again, which re-subscribes with the current one. */
export async function liveSubscription(publicKey: string): Promise<PushSubscription | null> {
  const sub = await currentSubscription();
  return sub && sameKey(sub, keyBytes(publicKey)) ? sub : null;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}

/** Ties a subscription saved before pushes followed the session to this sign-in, so ending
 *  this session elsewhere stops them. */
export async function rebindPush() {
  const sub = await currentSubscription().catch(() => null);
  if (sub) await api.pushRebind(sub.endpoint).catch(() => undefined);
}

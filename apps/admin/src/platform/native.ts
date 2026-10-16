import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { nativePush } from './native/push.ts';
import { Shell } from './native/shell.ts';
import {
  applyUpdate,
  bundleGood,
  checkForUpdate,
  onUpdate,
  startUpdates,
  updateOnLaunch,
  updateReady,
} from './native/updates.ts';
import { openStream } from './sse.ts';
import { PUBLIC_ORIGIN, type Platform } from './types.ts';

// The iOS/Android app (ADR 0044): this same React app, bundled inside a Capacitor shell. Its
// page lives at capacitor://localhost (iOS) or https://localhost (Android), so Core is another
// origin: every call is absolute, the session is a bearer token from the Keychain/Keystore, and
// the alerts, printing, sharing and voice are the phone's own.

const kind: 'ios' | 'android' = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
const API = String(import.meta.env.VITE_API_ORIGIN || PUBLIC_ORIGIN).replace(/\/$/, '');

let token: string | null = null;
let shell = { version: '0.0.0', native: 0 };
let bundle = 'builtin';

const url = (path: string) => (/^https?:\/\//.test(path) ? path : `${API}${path}`);
const headers = (): Record<string, string> => ({
  'x-vendua-client': `${kind}/${shell.version}/${shell.native}/${bundle}`,
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

const has = (plugin: string) => Capacitor.isPluginAvailable(plugin);
const quiet = <T>(p: Promise<T>) => void p.catch(() => undefined);

function base64(blob: Blob): Promise<string> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

/** Files go to the share sheet from the app's cache (WhatsApp, Arquivos, Drive…). */
async function shareFiles(files: File[], text?: string) {
  const paths: string[] = [];
  for (const f of files) {
    const name = f.name.replace(/[^\w.-]+/g, '-') || 'arquivo';
    const w = await Filesystem.writeFile({
      path: `share/${Date.now()}-${name}`,
      data: await base64(f),
      directory: Directory.Cache,
      recursive: true,
    });
    paths.push(w.uri);
  }
  await Share.share({ files: paths, ...(text ? { text } : {}) });
}

/** A link into the app (Universal Link / App Link / custom tab coming back): route it. */
function openInApp(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  quiet(Browser.close());
  if (!u.pathname.startsWith('/admin')) return;
  // the website's own flows (signup ends in the plan's payment): never inside the app
  if (/^\/admin\/comecar/.test(u.pathname) || u.searchParams.has('assinatura'))
    return quiet(Browser.open({ url: u.href }));
  window.dispatchEvent(new CustomEvent('vendua:open', { detail: u.pathname + u.search + u.hash }));
}

/** Android's back button: the open sheet, then the previous screen, then Início, then away. */
function back() {
  const st = history.state as { idx?: number; vSheet?: string } | null;
  if (st?.vSheet || (st?.idx ?? 0) > 0) return history.back();
  if (location.pathname !== '/')
    return window.dispatchEvent(new CustomEvent('vendua:open', { detail: '/' }));
  quiet(App.minimizeApp());
}

/** The status and navigation bars follow Creme/Noite (index.html sets data-theme). */
function followTheme() {
  const apply = () => {
    const dark = document.documentElement.dataset.theme === 'noite';
    quiet(StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }));
    if (kind === 'android')
      quiet(StatusBar.setBackgroundColor({ color: dark ? '#0a100d' : '#f7f4ea' }));
  };
  apply();
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

/** The native splash stays until the app has drawn something. */
function hideSplashOnPaint() {
  const root = document.getElementById('root');
  const hide = () =>
    requestAnimationFrame(() => quiet(SplashScreen.hide({ fadeOutDuration: 150 })));
  if (!root || root.childNodes.length) return hide();
  const mo = new MutationObserver(() => {
    if (!root.childNodes.length) return;
    mo.disconnect();
    hide();
  });
  mo.observe(root, { childList: true });
  // never a splash forever, whatever happened
  setTimeout(() => {
    mo.disconnect();
    hide();
  }, 8000);
}

const push = nativePush(kind, () => shell.version);

export const platform: Platform = {
  kind,
  get shell() {
    return shell;
  },
  async ready() {
    const [info, saved, meta] = await Promise.all([
      Shell.info().catch(() => shell),
      Shell.sessionGet().catch(() => ({ token: null })),
      fetch('/bundle.json')
        .then((r) => r.json() as Promise<{ version?: string }>)
        .catch(() => ({ version: undefined })),
    ]);
    shell = info;
    token = saved.token;
    bundle = meta.version ?? 'builtin';
    startUpdates({ url, headers, native: shell.native, bundle: () => bundle });
    hideSplashOnPaint();
    followTheme();
    void App.addListener('appUrlOpen', (e) => openInApp(e.url));
    void App.addListener('backButton', back);
    void App.addListener('resume', () => window.dispatchEvent(new CustomEvent('vendua:resume')));
    // back from Mercado Pago (or a help page) without a link: what it changed shows on return
    void Browser.addListener('browserFinished', () =>
      window.dispatchEvent(new CustomEvent('vendua:resume')),
    );
    void Shell.addListener('alertOpened', (d) =>
      window.dispatchEvent(new CustomEvent('vendua:open', { detail: d.url })),
    );
    await updateOnLaunch();
  },
  started: bundleGood,

  http: {
    url,
    headers,
    credentials: 'omit',
    mediaUrl: (u) => (u.startsWith('/') && !u.startsWith('//') ? `${API}${u}` : u),
    async privateMedia(path) {
      const res = await fetch(url(path), { headers: headers() });
      if (!res.ok) throw new Error(`media ${res.status}`);
      return URL.createObjectURL(await res.blob());
    },
  },
  session: {
    async set(t) {
      token = t ?? null;
      await Shell.sessionSet({ token, apiOrigin: API });
    },
    async clear() {
      token = null;
      await Shell.sessionSet({ token: null, apiOrigin: API });
    },
  },
  stream: (path, h) => openStream(url(path), { headers: headers(), credentials: 'omit' }, h),

  push,

  // iOS gets haptics for the first time (§5.3)
  haptic: {
    tick: () => quiet(Haptics.selectionChanged()),
    commit: () => quiet(Haptics.impact({ style: ImpactStyle.Medium })),
    newOrder: () => {
      quiet(Haptics.notification({ type: NotificationType.Warning }));
      setTimeout(() => quiet(Haptics.notification({ type: NotificationType.Warning })), 270);
    },
    error: () => quiet(Haptics.notification({ type: NotificationType.Error })),
  },
  keepAwake: {
    supported: () => has('KeepAwake'),
    async hold() {
      await KeepAwake.keepAwake();
      return () => quiet(KeepAwake.allowSleep());
    },
  },
  share: {
    async files(files, text) {
      if (!has('Share') || !has('Filesystem')) return 'unsupported';
      try {
        await shareFiles(files, text);
        return 'shared';
      } catch {
        return 'cancelled';
      }
    },
    async save(blob, name) {
      await shareFiles([new File([blob], name, { type: blob.type })]).catch(() => undefined);
    },
    // a CSV export: fetched with the token, then the share sheet ("Salvar em Arquivos")
    async download(path, name) {
      const res = await fetch(url(path), { headers: headers() });
      if (!res.ok) throw new Error(`download ${res.status}`);
      await shareFiles([new File([await res.blob()], name)]).catch(() => undefined);
    },
  },
  async print(doc) {
    const r = await Shell.print(
      doc ? { html: doc.html, title: doc.title } : { title: document.title },
    ).catch(() => ({ done: false }));
    return r.done;
  },
  speech: {
    // Android's WebView has no speechSynthesis: the phone's own TTS engine, in pt-BR
    supported: () => has('TextToSpeech'),
    speak: (text, rate) => quiet(TextToSpeech.speak({ text, lang: 'pt-BR', rate })),
    hush: () => quiet(TextToSpeech.stop()),
  },

  // the stores' billing rules (ADR 0044, decision 1): the plan is paid on the website only
  canPay: false,
  storeUrl:
    kind === 'android'
      ? `https://play.google.com/store/apps/details?id=br.com.vendua.painel`
      : import.meta.env.VITE_APP_STORE_URL || null,
  openExternal: (u) => quiet(Browser.open({ url: u })),
  publicUrl: (path) => `${PUBLIC_ORIGIN}${path}`,

  updates: {
    check: () => void checkForUpdate(),
    apply: applyUpdate,
    ready: updateReady,
    onReady: onUpdate,
  },
  install: {
    mode: () => null,
    onChange: () => () => undefined,
    prompt: async () => false,
    installed: () => true,
  },
  badge: (n) => quiet(Shell.setBadge({ count: Math.max(0, n) })),
  ordersSeen: () => quiet(Shell.clearAlerts({ prefix: 'order-' })),
  // the share target is the PWA's for now (ADR 0044, phase 5)
  takeSharedPhoto: async () => null,
};

import { openStream } from './sse.ts';
import type { Platform } from './types.ts';
import {
  checkForUpdate,
  applyUpdate,
  installMode,
  onInstallChange,
  onUpdate,
  ordersSeen,
  promptInstall,
  setBadge,
  standalone,
  startPwa,
  takeSharedPhoto,
  updateReady,
} from './web/pwa.ts';
import {
  disablePush,
  enablePush,
  pushConfigured,
  pushState,
  pushSupported,
  rebindPush,
} from './web/push.ts';

// The website (painel.vendua.com.br/admin/): same origin as Core, the session is the cookie, the
// service worker does updates and push, and the browser's own APIs do the rest.

const vibrate = (p: number | number[]) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
};

type Sentinel = {
  release: () => Promise<void>;
  addEventListener: (t: 'release', f: () => void) => void;
};
const wakeLock = () =>
  (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } })
    .wakeLock;

function download(href: string, name: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  a.click();
}

function ptVoice(): SpeechSynthesisVoice | null {
  const all = speechSynthesis.getVoices();
  return (
    all.find((v) => v.lang === 'pt-BR' && v.localService) ??
    all.find((v) => /^pt[-_]BR$/i.test(v.lang)) ??
    all.find((v) => /^pt/i.test(v.lang)) ??
    null
  );
}
const speechOk = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

const headers = { 'x-vendua-client': `web/${__ADMIN_BUILD__}` };

export const platform: Platform = {
  kind: 'web',
  shell: null,
  async ready() {
    startPwa();
  },
  started() {},

  http: {
    url: (path) => path,
    headers: () => headers,
    credentials: 'same-origin',
    mediaUrl: (u) => u,
    privateMedia: async (path) => path,
  },
  session: {
    async set() {},
    async clear() {},
  },
  stream: (path, h) => openStream(path, { headers, credentials: 'same-origin' }, h),

  push: {
    configured: pushConfigured,
    supported: pushSupported,
    state: pushState,
    enable: enablePush,
    disable: disablePush,
    rebind: rebindPush,
  },

  // Android vibration (§5.3); iOS Safari has none
  haptic: {
    tick: () => vibrate(8),
    commit: () => vibrate(22),
    newOrder: () => vibrate([180, 90, 180]),
    error: () => vibrate([30, 40, 30]),
  },
  keepAwake: {
    supported: () => typeof navigator !== 'undefined' && !!wakeLock(),
    async hold(lost) {
      const s = await wakeLock()?.request('screen');
      if (!s) return null;
      s.addEventListener('release', lost);
      return () => void s.release().catch(() => undefined);
    },
  },
  share: {
    async files(files, text) {
      if (!navigator.canShare?.({ files })) return 'unsupported';
      try {
        await navigator.share({ files, ...(text ? { text } : {}) });
        return 'shared';
      } catch {
        return 'cancelled';
      }
    },
    async save(blob, name) {
      const url = URL.createObjectURL(blob);
      download(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    // the cookie rides along: the browser saves what Core names
    async download(path, name) {
      download(path, name);
    },
  },
  async print(doc) {
    if (!doc) {
      window.print();
      return true;
    }
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) return false;
    w.document.write(
      doc.html.replace(
        '</body>',
        '<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body>',
      ),
    );
    w.document.close();
    return true;
  },
  speech: {
    supported: speechOk,
    speak(text, rate) {
      if (!speechOk()) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      const v = ptVoice();
      if (v) u.voice = v;
      u.rate = rate;
      speechSynthesis.speak(u);
    },
    hush() {
      if (speechOk()) speechSynthesis.cancel();
    },
  },

  canPay: true,
  storeUrl: null,
  openExternal: (url) => window.location.assign(url),
  publicUrl: (path) => `${window.location.origin}${path}`,

  updates: { check: checkForUpdate, apply: applyUpdate, ready: updateReady, onReady: onUpdate },
  install: {
    mode: installMode,
    onChange: onInstallChange,
    prompt: promptInstall,
    installed: standalone,
  },
  badge: setBadge,
  ordersSeen,
  takeSharedPhoto,
};

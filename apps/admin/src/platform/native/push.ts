import type { PushConfig, PushState } from '../types.ts';
import { Shell } from './shell.ts';

// The app's order alerts (ADR 0044 §5): the shell registers with APNs/FCM and draws them; Core
// keeps the device in push_devices, tied to this session. Its token is kept here only to say
// which device to drop or re-tie.

const KEY = 'vendua-app-push-token';
const api = async () => (await import('../../lib/api.ts')).api;

const saved = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const keep = (t: string | null) => {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* the row in Core is what counts */
  }
};

export function nativePush(kind: 'ios' | 'android', version: () => string) {
  const configured = (cfg: PushConfig) => !!cfg[kind];
  return {
    configured,
    supported: configured,
    async state(cfg: PushConfig): Promise<PushState> {
      if (!configured(cfg)) return 'unsupported';
      const p = await Shell.pushPermission().catch(() => ({ state: 'prompt' as const }));
      if (p.state === 'denied') return 'denied';
      return p.state === 'granted' && saved() ? 'on' : 'off';
    },
    async enable(cfg: PushConfig): Promise<'on' | 'denied' | 'unsupported'> {
      if (!configured(cfg)) return 'unsupported';
      let token: string;
      try {
        token = (await Shell.pushRegister()).token;
      } catch {
        return 'denied';
      }
      await (await api()).pushDevice({ platform: kind, token, appVersion: version() });
      keep(token);
      return 'on';
    },
    async disable() {
      const token = saved();
      keep(null);
      if (token) await (await api()).pushDeviceRemove(token).catch(() => undefined);
      await Shell.pushUnregister().catch(() => undefined);
    },
    /** each start and each sign-in: the device's alerts follow this session, and a token the
     *  OS rotated (FCM does) replaces the old one in Core */
    async rebind() {
      const old = saved();
      if (!old) return;
      const p = await Shell.pushPermission().catch(() => null);
      if (p?.state !== 'granted') return keep(null);
      // already granted: no prompt, just the current token
      const token = await Shell.pushRegister()
        .then((r) => r.token)
        .catch(() => old);
      const a = await api();
      await a.pushDevice({ platform: kind, token, appVersion: version() }).catch(() => undefined);
      if (token !== old) await a.pushDeviceRemove(old).catch(() => undefined);
      keep(token);
    },
  };
}

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { VenduaShellWeb } from './shell-web.ts';

// The app's own native code (ios/App/App/VenduaShell.swift, android/…/VenduaShellPlugin.kt): the
// session token in the Keychain/Keystore, the order alerts it draws and answers itself, and the
// system print dialog. Everything else uses stock Capacitor plugins.

export interface VenduaShell {
  /** the store build: its version and native level (app-version.json, baked in at build) */
  info(): Promise<{ version: string; native: number }>;
  /** the session token, readable after first unlock so "Aceitar" works with the phone locked */
  sessionGet(): Promise<{ token: string | null }>;
  /** `apiOrigin` is where the alert's own "Aceitar" POSTs */
  sessionSet(o: { token: string | null; apiOrigin: string }): Promise<void>;
  /** asks for permission (once), registers with APNs/FCM: the device token, or a 'denied' error */
  pushRegister(): Promise<{ token: string }>;
  pushPermission(): Promise<{ state: 'granted' | 'denied' | 'prompt' }>;
  pushUnregister(): Promise<void>;
  /** drops this app's delivered notifications whose tag starts with `prefix` */
  clearAlerts(o: { prefix: string }): Promise<void>;
  setBadge(o: { count: number }): Promise<void>;
  /** the system print dialog: an HTML document, or the page on screen when `html` is absent */
  print(o: { html?: string; title: string }): Promise<{ done: boolean }>;
  /** a tapped notification: the route it opens (kept until the app listens, for a cold start) */
  addListener(e: 'alertOpened', fn: (d: { url: string }) => void): Promise<PluginListenerHandle>;
}

// main.tsx awaits platform.ready() at the top level, so the stand-in can't be a lazy chunk: a
// chunk importing from the entry would wait on the entry, which waits on it
export const Shell = registerPlugin<VenduaShell>('VenduaShell', {
  web: () => new VenduaShellWeb(),
});

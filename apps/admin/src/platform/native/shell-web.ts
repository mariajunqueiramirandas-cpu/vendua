import { WebPlugin } from '@capacitor/core';
import app from '../../../app-version.json';
import type { VenduaShell } from './shell.ts';

// The app's bundle opened in a desktop browser (`vite --mode native`, CI's cross-origin smoke):
// no phone underneath, so the session lives in sessionStorage and the phone-only parts say no.

const KEY = 'vendua-app-session';

export class VenduaShellWeb extends WebPlugin implements Omit<VenduaShell, 'addListener'> {
  async info() {
    return { version: app.version, native: app.native };
  }
  async sessionGet() {
    return { token: sessionStorage.getItem(KEY) };
  }
  async sessionSet({ token }: { token: string | null; apiOrigin: string }) {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  }
  async pushRegister(): Promise<{ token: string }> {
    throw this.unavailable('no push in a browser');
  }
  async pushPermission() {
    return { state: 'denied' as const };
  }
  async pushUnregister() {}
  async clearAlerts() {}
  async setBadge() {}
  async print() {
    return { done: false };
  }
}

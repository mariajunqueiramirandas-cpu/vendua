// The one seam between the admin and where it runs (ADR 0044): the website at
// painel.vendua.com.br/admin/ (web.ts) or the iOS/Android app (native.ts). Vite's alias picks
// one per build mode, so the web bundle carries no Capacitor and the app no service worker.
// Everything that differs between them goes through here; tools/check-admin-platform.mjs keeps
// browser-only and Capacitor calls out of the rest of src/.

export { platform } from '@platform-impl';
export * from './types.ts';

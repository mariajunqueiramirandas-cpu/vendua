import type { CapacitorConfig } from '@capacitor/cli';

// The merchant admin as an iOS and Android app (ADR 0044): the same React app, built with
// `vite build --mode native` into dist-native/ and shipped inside the app; Core updates it over
// the air (src/platform/native/updates.ts). CAP_SERVER_URL is live reload for development
// only: a store build always runs its bundled copy (Apple rejects website wrappers).

const live = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'br.com.vendua.painel',
  appName: 'Venduá',
  webDir: 'dist-native',
  // the WebView's own origin (capacitor://localhost, https://localhost): Core's CORS allows these
  ios: {
    scheme: 'capacitor',
    contentInset: 'never',
    limitsNavigationsToAppBoundDomains: false,
    // the app's own delegate draws and answers its alerts (ios/App/App/OrderAlerts.swift)
    handleApplicationNotifications: false,
  },
  android: { allowMixedContent: false },
  ...(live ? { server: { url: live, cleartext: live.startsWith('http://') } } : {}),
  plugins: {
    // the platform layer calls the network itself (fetch with a bearer token, a streamed SSE)
    CapacitorHttp: { enabled: false },
    CapacitorUpdater: {
      // manual: the app asks Core, never a vendor's cloud (ADR 0044 §2)
      autoUpdate: false,
      resetWhenUpdate: true,
      appReadyTimeout: 15_000,
      responseTimeout: 30,
      directUpdate: false,
      statsUrl: '',
      channelUrl: '',
      updateUrl: '',
    },
    SplashScreen: { launchAutoHide: false, backgroundColor: '#f7f4ea', showSpinner: false },
  },
};

export default config;

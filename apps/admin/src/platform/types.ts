// The shape both targets implement (index.ts says what this seam is for).

export type ClientKind = 'web' | 'ios' | 'android';
export type PushState = 'on' | 'off' | 'denied' | 'unsupported';

/** What Core says about alerts for this session (GET /session `push`). */
export interface PushConfig {
  /** the VAPID key: web push is on in this Core */
  publicKey: string | null;
  /** APNs / FCM credentials are set: the app's native alerts are on */
  ios?: boolean;
  android?: boolean;
}

export interface StreamHandlers {
  /** a named server-sent event (`hello`, `change`, `presence`, `ping`, `signedout`) */
  event: (name: string, data: string) => void;
  /** the connection is gone; `status` is the HTTP answer when Core refused it, else 0 */
  closed: (status: number) => void;
}

export interface Platform {
  kind: ClientKind;
  /** the store build running this bundle; null on the web */
  shell: { version: string; native: number } | null;
  /** before the first request: the session token from the Keychain, the update check */
  ready(): Promise<void>;
  /** the router has mounted and /session answered: an updated bundle is good (no rollback) */
  started(): void;

  http: {
    /** an absolute or same-origin URL for a Core path (`/admin/v1/…`, `/analytics/…`) */
    url(path: string): string;
    /** sent on every Core call: who is calling, and the session when it isn't a cookie */
    headers(): Record<string, string>;
    credentials: RequestCredentials;
    /** what Core returns for a picture (`/v1/media/…`, already absolute, blob:) → an <img> src */
    mediaUrl(u: string): string;
    /** an /admin/v1 picture that needs the session (a copilot photo) → a src, or null meanwhile */
    privateMedia(path: string): Promise<string>;
  };

  session: {
    /** a sign-in's token (native) or nothing (web: the cookie is the session) */
    set(token: string | null | undefined): Promise<void>;
    clear(): Promise<void>;
  };

  /** One reader for both platforms: fetch + ReadableStream, so it can send headers. */
  stream(path: string, h: StreamHandlers): () => void;

  push: {
    /** Core can send this kind of alert (its keys are set) */
    configured(cfg: PushConfig): boolean;
    /** …and this device can receive it */
    supported(cfg: PushConfig): boolean;
    state(cfg: PushConfig): Promise<PushState>;
    enable(cfg: PushConfig): Promise<'on' | 'denied' | 'unsupported'>;
    disable(): Promise<void>;
    /** ties this device's alerts to the session that just signed in */
    rebind(): Promise<void>;
  };

  haptic: { tick(): void; commit(): void; newOrder(): void; error(): void };
  keepAwake: {
    supported(): boolean;
    /** the screen stays lit until the returned release; `lost` when the OS drops it (hidden) */
    hold(lost: () => void): Promise<(() => void) | null>;
  };
  share: {
    /** the share sheet with files; 'unsupported' leaves the fallback (a download) to the caller */
    files(files: File[], text?: string): Promise<'shared' | 'cancelled' | 'unsupported'>;
    /** a file this device keeps: a download on the web, the share sheet in the app */
    save(blob: Blob, name: string): Promise<void>;
    /** a Core file that needs the session (a CSV export) */
    download(path: string, name: string): Promise<void>;
  };
  /** an HTML document (a ticket), or the page on screen with its print CSS when omitted */
  print(doc?: { html: string; title: string }): Promise<boolean>;
  speech: {
    supported(): boolean;
    speak(text: string, rate: number): void;
    hush(): void;
  };

  /** whether the plan can be bought or paid here: never inside the app (ADR 0044, decision 1) */
  canPay: boolean;
  /** a trip out (Mercado Pago, help pages): this tab on the web, an in-app browser in the app */
  openExternal(url: string): void;
  /** a link for someone else (an invite, a referral): always the public admin address */
  publicUrl(path: string): string;

  updates: {
    check(): void;
    apply(): void;
    ready(): boolean;
    onReady(fn: () => void): () => void;
  };
  install: {
    mode(): 'prompt' | 'ios' | null;
    onChange(fn: () => void): () => void;
    prompt(): Promise<boolean>;
    /** running as an installed app (a home-screen PWA or the store app) */
    installed(): boolean;
  };
  /** the app icon's count of waiting orders */
  badge(n: number): void;
  /** the board is on screen: this device's order notifications did their job */
  ordersSeen(): void;
  /** a photo shared into the app from the gallery, once */
  takeSharedPhoto(): Promise<File | null>;
}

/** The public admin address, for links other people open (and the app's API origin). */
export const PUBLIC_ORIGIN = 'https://painel.vendua.com.br';

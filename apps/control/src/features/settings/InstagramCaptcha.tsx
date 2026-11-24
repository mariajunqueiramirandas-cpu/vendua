import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import type { IgCaptcha } from '@/lib/api.ts';

const META_ORIGIN = 'https://www.fbsbx.com';

function frameURL(raw: string) {
  try {
    const url = new URL(raw);
    if (
      url.origin === META_ORIGIN &&
      url.pathname === '/captcha/recaptcha/iframe/' &&
      !url.username &&
      !url.password &&
      !url.hash
    ) {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function InstagramCaptcha({
  captcha,
  instructions,
  busy,
  onSolved,
  onCancel,
}: {
  captcha: IgCaptcha;
  instructions: string;
  busy: boolean;
  onSolved: (token: string) => void;
  onCancel: () => void;
}) {
  const src = frameURL(captcha.iframeURL);
  const frame = useRef<HTMLIFrameElement>(null);
  const submitted = useRef(false);
  const [height, setHeight] = useState(180);
  const [reload, setReload] = useState(0);
  const [expired, setExpired] = useState(false);

  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      const widget = frame.current?.contentWindow;
      if (!widget || event.origin !== META_ORIGIN || event.source !== widget) return;
      const data = event.data as {
        type?: unknown;
        size?: { height?: unknown };
        token?: unknown;
      } | null;
      if (!data || typeof data !== 'object') return;
      switch (data.type) {
        case 'GET_ORIGIN':
          widget.postMessage({}, META_ORIGIN);
          break;
        case 'RESIZE_IFRAME': {
          const requested = data.size?.height;
          if (typeof requested === 'number' && Number.isFinite(requested)) {
            setHeight(Math.max(100, Math.min(900, requested)));
          }
          break;
        }
        case 'CAPTCHA_EXPIRED':
          setExpired(true);
          break;
        case 'CAPTCHA_SOLVED':
          if (
            !busy &&
            !submitted.current &&
            typeof data.token === 'string' &&
            data.token.trim() &&
            data.token.length <= 16_384
          ) {
            submitted.current = true;
            onSolved(data.token);
          }
          break;
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [busy, onSolved]);

  return (
    <>
      <p className="text-sm">{instructions}</p>
      {src ? (
        <iframe
          key={reload}
          ref={frame}
          title="verificação do Instagram"
          src={src}
          height={height}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms"
          className="w-full rounded-md border border-sidebar-border bg-card"
        />
      ) : (
        <p role="alert" className="text-sm text-destructive">
          a verificação não pôde ser carregada. cancele e tente novamente.
        </p>
      )}
      {busy && (
        <p role="status" className="text-sm">
          verificando…
        </p>
      )}
      {!busy && expired && (
        <p role="status" className="text-sm">
          a verificação expirou. recarregue para tentar de novo.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {src && (
          <Button
            variant="ghost"
            className="text-sidebar-muted hover:text-sidebar-foreground"
            disabled={busy}
            onClick={() => {
              submitted.current = false;
              setHeight(180);
              setExpired(false);
              setReload((value) => value + 1);
            }}
          >
            recarregar verificação
          </Button>
        )}
        <Button
          variant="ghost"
          className="text-sidebar-muted hover:text-sidebar-foreground"
          disabled={busy}
          onClick={onCancel}
        >
          cancelar
        </Button>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { platform } from '../platform/index.ts';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/feedback.tsx';
import { Mascote } from '../ui/Mascote.tsx';
import { toast } from '../ui/Toast.tsx';

// The app's shell is older than Core needs (ADR 0044 §2). Hard: Core answered 426, nothing works
// until the store update, so it's the whole screen. Soft: this Core's bundle needs a newer shell,
// the app keeps running on the bundle it has and says so once.

const openStore = () => {
  if (platform.storeUrl) platform.openExternal(platform.storeUrl);
};

export function useStoreUpdate(): boolean {
  const [hard, setHard] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ hard?: boolean }>).detail?.hard) return setHard(true);
      toast('Tem uma versão nova do app na loja, com melhorias para você.', {
        tone: 'info',
        ms: 10_000,
        ...(platform.storeUrl ? { action: { label: 'atualizar', run: openStore } } : {}),
      });
    };
    window.addEventListener('vendua:store-update', on);
    return () => window.removeEventListener('vendua:store-update', on);
  }, []);
  return hard;
}

export function StoreUpdate() {
  const store = platform.kind === 'ios' ? 'App Store' : 'Play Store';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg pt-safe pb-safe">
      <EmptyState
        art={<Mascote pose="publicar" />}
        title="Atualize o app para continuar"
        body={`Esta versão do Venduá ficou para trás. Atualize na ${store} e volte: sua loja e seus pedidos estão do jeito que você deixou.`}
        action={
          platform.storeUrl ? <Button onClick={openStore}>abrir a {store}</Button> : undefined
        }
      />
    </main>
  );
}

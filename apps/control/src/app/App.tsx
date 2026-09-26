import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCw, WifiOff } from 'lucide-react';
import { Toaster } from 'sonner';
import { ApiError, api } from '@/lib/api.ts';
import { useLiveInvalidation } from '@/lib/live.ts';
import { onUnauthorized, qk } from '@/lib/query.ts';
import { useApplyTheme, useTheme } from '@/lib/theme.ts';
import { Button } from '@/components/ui/button.tsx';
import { TooltipProvider } from '@/components/ui/controls.tsx';
import Login from '@/features/auth/Login.tsx';
import { AppShell, BrandMark } from './AppShell.tsx';
import { AppRoutes } from './routes.tsx';

// the gate answers 404 (401 in principle) for a missing/stale cookie — only that means
// "sign in"; offline or a 502 mid-deploy must not bounce an installed PWA to the login form
const signedOut = (err: unknown) => err instanceof ApiError && [401, 404].includes(err.status);

export default function App() {
  useApplyTheme();
  const { dark } = useTheme();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: qk.session(),
    queryFn: api.session,
    retry: (n, err) => !signedOut(err) && n < 2,
    refetchInterval: false,
    staleTime: Infinity,
  });
  const authed = session.isSuccess;
  const unreachable =
    (session.isError && !signedOut(session.error)) ||
    (session.isPending && session.fetchStatus === 'paused');
  const { refetch } = session;

  useEffect(() => {
    if (!unreachable) return;
    const retry = () => document.visibilityState === 'visible' && void refetch();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [unreachable, refetch]);

  const signOut = useCallback(() => {
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    void client.resetQueries({ queryKey: qk.session() });
  }, [client]);
  useEffect(() => onUnauthorized(signOut), [signOut]);
  useLiveInvalidation(client, authed);

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    signOut();
  }, [signOut]);

  let body;
  if (unreachable)
    body = <Unreachable retrying={session.isFetching} onRetry={() => void refetch()} />;
  else if (session.isPending) body = <Splash />;
  else if (!authed)
    body = <Login onLogin={() => void client.invalidateQueries({ queryKey: qk.session() })} />;
  else
    body = (
      <AppShell onLogout={() => void logout()}>
        <AppRoutes />
      </AppShell>
    );

  return (
    <TooltipProvider delayDuration={300}>
      {body}
      <Toaster
        theme={dark ? 'dark' : 'light'}
        position="top-center"
        toastOptions={{ className: 'font-sans' }}
      />
    </TooltipProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center bg-app">
      <BrandMark className="size-9 animate-pulse rounded-[10px] text-[24px]" />
    </div>
  );
}

function Unreachable({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-app px-6 text-center max-md:h-vv max-md:pt-safe">
      <WifiOff className="size-7 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Sem conexão com o servidor</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Sua sessão continua salva — tentamos de novo quando a rede voltar.
        </p>
      </div>
      <Button variant="outline" onClick={onRetry} disabled={retrying}>
        <RotateCw className={retrying ? 'animate-spin' : undefined} /> tentar de novo
      </Button>
    </div>
  );
}

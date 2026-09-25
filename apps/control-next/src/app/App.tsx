import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { api } from '@/lib/api.ts';
import { useLiveInvalidation } from '@/lib/live.ts';
import { onUnauthorized, qk } from '@/lib/query.ts';
import { useApplyTheme, useTheme } from '@/lib/theme.ts';
import { TooltipProvider } from '@/components/ui/controls.tsx';
import Login from '@/features/auth/Login.tsx';
import { AppShell } from './AppShell.tsx';
import { AppRoutes } from './routes.tsx';

export default function App() {
  useApplyTheme();
  const { dark } = useTheme();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: qk.session(),
    queryFn: api.session,
    retry: false,
    refetchInterval: false,
    staleTime: Infinity,
  });
  const authed = session.isSuccess;

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
  if (session.isPending) body = <Splash />;
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
    <div className="flex h-full items-center justify-center bg-sidebar">
      <span className="animate-pulse font-serif text-3xl text-sidebar-foreground italic">
        venduá
      </span>
    </div>
  );
}

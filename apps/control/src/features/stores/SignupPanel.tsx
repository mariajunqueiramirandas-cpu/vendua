import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, type SignupReadiness } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { ErrorState } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';

// "Cadastro de lojas pela internet": the team's switch, and what else Core waits on before a
// visitor can get a WhatsApp code and create a store (ADR 0032). Core decides; this only says why.

const NEEDS: { key: 'whatsapp' | 'email' | 'billing'; label: string; fix: string; to: string }[] = [
  {
    key: 'whatsapp',
    label: 'WhatsApp da Venduá conectado',
    fix: 'manda o código de confirmação',
    to: '/config?a=conexoes',
  },
  {
    key: 'email',
    label: 'E-mail configurado',
    fix: 'manda as boas-vindas e as faturas',
    to: '/config?a=conexoes',
  },
  {
    key: 'billing',
    label: 'Mercado Pago ou código de acesso',
    fix: 'MP_PLATFORM_ACCESS_TOKEN ou VENDUA_SIGNUP_ACCESS_CODE no servidor',
    to: '',
  },
];

export function SignupPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.signupReadiness(), queryFn: api.signupReadiness });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.putSetting('signup', { enabled }),
    onSuccess: (_r, enabled) => toast.success(enabled ? 'cadastro ligado' : 'cadastro desligado'),
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.signupReadiness() }),
  });
  const r: SignupReadiness | undefined = q.data;
  const missing = r ? NEEDS.filter((n) => !r[n.key]) : [];
  const mobile = useIsMobile();
  const status = r
    ? r.open
      ? 'aberto: qualquer pessoa pode criar uma loja'
      : r.on
        ? 'ligado, mas esperando o que falta abaixo'
        : 'desligado: ninguém cria loja pelo site'
    : undefined;

  return (
    <Panel
      title="cadastro pela internet"
      aside={mobile ? undefined : status}
      actions={
        <Switch
          checked={toggle.isPending ? toggle.variables : !!r?.on}
          disabled={!r || toggle.isPending}
          aria-label="cadastro de lojas pela internet"
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      }
    >
      {mobile && status ? <p className="mb-3 text-sm text-muted-foreground">{status}</p> : null}
      {q.isError && !r ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-3">
          {NEEDS.map((n) => {
            const ok = !!r?.[n.key];
            return (
              <li key={n.key} className="flex min-w-0 items-start gap-2 text-sm">
                {ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <CircleAlert
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      r ? 'text-warning' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  />
                )}
                <span className="min-w-0">
                  <span className="block font-medium">
                    {n.label}
                    <span className="sr-only">{ok ? ': pronto' : ': falta'}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {!ok && n.to ? (
                      <Link to={n.to} className="underline underline-offset-2">
                        configurar
                      </Link>
                    ) : null}
                    {!ok && n.to ? ' · ' : null}
                    {n.fix}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {r?.on && missing.length ? (
        <p className="mt-3 text-xs text-muted-foreground">
          O site e o painel mostram “o cadastro pela internet ainda não abriu” até tudo ficar
          pronto.
        </p>
      ) : null}
    </Panel>
  );
}

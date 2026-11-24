import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FlaskConical,
  Link2,
  Loader2,
  Plug,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type TelegramOverview } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import { SaveBar } from '../bits.tsx';
import {
  useTelegramCommands,
  useTelegramConnect,
  useTelegramDisconnect,
  useTelegramLink,
  useTelegramTest,
} from './queries.ts';

function Step({
  done,
  children,
  action,
}: {
  done: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px]',
          done ? 'border-transparent bg-agent text-agent-foreground' : 'bg-card',
        )}
        aria-hidden
      >
        {done && <Check className="size-3" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className={cn(done && 'text-muted-foreground')}>{children}</span>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </li>
  );
}

/**
 * Setup in 3 tiny steps: drop the @BotFather token in env, click conectar, then tap the one-click
 * Telegram link to start your DM. No server, no roles, no copying user IDs.
 */
export function ConnectionPanel({ d }: { d: TelegramOverview }) {
  const qc = useQueryClient();
  const baseEnv = d.app.tokenEnv === 'TELEGRAM_BOT_TOKEN' ? '' : d.app.tokenEnv;
  const [secretRef, setSecretRef] = useState(baseEnv);
  useEffect(() => setSecretRef(baseEnv), [baseEnv]);

  const connect = useTelegramConnect();
  const disconnect = useTelegramDisconnect();
  const link = useTelegramLink();
  const sendTest = useTelegramTest();
  const commands = useTelegramCommands();

  const [waitingLink, setWaitingLink] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  // back from Telegram after tapping Start: refresh overview & staff roster automatically
  useEffect(() => {
    if (!waitingLink) return;
    const onFocus = () => {
      setWaitingLink(false);
      void Promise.all([
        qc.invalidateQueries({ queryKey: qk.telegram() }),
        qc.invalidateQueries({ queryKey: qk.settings() }),
      ]);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [waitingLink, qc]);

  const probe = useMutation({
    mutationFn: () => api.testIntegration('telegram'),
    onSuccess: (r) =>
      r.ok ? toast.success(`telegram: ${r.detail}`) : toast.error(`telegram: ${r.detail}`),
    onError: (e) => toast.error(`telegram: ${errorMessage(e)}`),
  });

  const webhookError = connect.data && !connect.data.webhook.ok ? connect.data.webhook.error : null;

  const copyText = (text: string, label: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success(label),
      () => toast.error('não deu para copiar — selecione e copie'),
    );

  const openOneTapLink = async () => {
    const r = await link.mutateAsync(undefined);
    setGeneratedUrl(r.url);
    setWaitingLink(true);
    window.open(r.url, '_blank', 'noopener,noreferrer');
  };

  const copyOneTapLink = async () => {
    const r = await link.mutateAsync(undefined);
    setGeneratedUrl(r.url);
    setWaitingLink(true);
    await copyText(r.url, 'link copiado — abra no Telegram e toque em Começar');
  };

  const linkedCount = d.team.linked;
  const ready = d.app.ok && linkedCount > 0;
  const dirtyEnv = secretRef !== baseEnv;

  const status = ready ? (
    <Badge variant="agent">@{d.app.username}</Badge>
  ) : d.app.ok ? (
    <Badge variant="warn">falta abrir a DM</Badge>
  ) : d.app.enabled ? (
    <Badge variant="warn" title={d.app.reason ?? ''}>
      {d.app.reason}
    </Badge>
  ) : (
    <Badge>desligado</Badge>
  );

  return (
    <Panel title="conexão" aside="bot na sua DM do Telegram" actions={status}>
      {!ready && (
        <ol className="flex flex-col gap-2.5 rounded-md border bg-muted/40 p-2.5 text-sm">
          <Step done={d.app.tokenPresent}>
            abra o{' '}
            <a
              className="underline underline-offset-2"
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
            >
              @BotFather
            </a>{' '}
            no Telegram, mande <code className="rounded bg-secondary px-1 text-xs">/newbot</code> e
            coloque o token no ambiente do Core como{' '}
            <code className="rounded bg-secondary px-1 text-xs">{d.app.tokenEnv}</code> (Dokploy →
            Environment), depois reinicie
          </Step>
          <Step
            done={d.app.ok}
            action={
              !d.app.ok && (
                <Button
                  size="sm"
                  disabled={!d.app.tokenPresent || connect.isPending}
                  onClick={() => connect.mutate(secretRef || undefined)}
                >
                  {connect.isPending ? <Loader2 className="animate-spin" /> : <Plug />} conectar
                </Button>
              )
            }
          >
            conecte — o CRM lê o bot pelo token, cadastra o webhook e registra os comandos
          </Step>
          <Step
            done={linkedCount > 0}
            action={
              d.app.ok &&
              linkedCount === 0 && (
                <>
                  <Button size="sm" disabled={link.isPending} onClick={() => void openOneTapLink()}>
                    {link.isPending ? <Loader2 className="animate-spin" /> : <ArrowUpRight />} abrir
                    no Telegram
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={link.isPending}
                    onClick={() => void copyOneTapLink()}
                  >
                    <Copy /> copiar link
                  </Button>
                </>
              )
            }
          >
            toque em abrir no Telegram e aperte <strong>Começar</strong> na DM — pronto, os avisos
            passam a chegar lá
          </Step>
        </ol>
      )}

      {generatedUrl && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2.5 text-xs">
          <span className="text-muted-foreground">
            link único (vale 24h) — abra no celular ou mande para alguém da equipe tocar em Começar:
          </span>
          <div className="flex gap-2">
            <Input readOnly value={generatedUrl} className="font-mono text-xs" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyText(generatedUrl, 'link copiado')}
              aria-label="copiar link de conexão"
            >
              <Copy />
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={generatedUrl} target="_blank" rel="noreferrer">
                abrir <ArrowUpRight />
              </a>
            </Button>
          </div>
        </div>
      )}

      {webhookError && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-sm">
          <p>
            o Telegram recusou o webhook ({webhookError}). Confira se{' '}
            <code className="rounded bg-secondary px-1 text-xs">{d.app.webhookUrl}</code> responde
            em HTTPS e clique em conectar de novo.
          </p>
        </div>
      )}

      {d.app.ok && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {linkedCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={sendTest.isPending}
              onClick={() => sendTest.mutate()}
            >
              {sendTest.isPending ? <Loader2 className="animate-spin" /> : <Send />} enviar teste
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={link.isPending}
            onClick={() => void copyOneTapLink()}
          >
            {link.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} gerar link de DM
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={probe.isPending}
            onClick={() => probe.mutate()}
          >
            {probe.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />} testar
            conexão
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={commands.isPending}
            onClick={() => commands.mutate()}
          >
            registrar comandos
          </Button>
          {d.app.enabled && (
            <ConfirmButton
              variant="ghost"
              confirm="desligar o bot?"
              onConfirm={() => disconnect.mutate()}
            >
              desligar
            </ConfirmButton>
          )}
        </div>
      )}

      {d.app.ok && (
        <p className="mt-3 text-xs text-muted-foreground">
          comandos:{' '}
          {d.state.commandsError ? (
            <span className="text-warning-foreground">{d.state.commandsError.message}</span>
          ) : d.state.commandsCurrent ? (
            'registrados na DM'
          ) : (
            'registrando na próxima rodada…'
          )}
        </p>
      )}

      <details className="group mt-3" open={dirtyEnv || undefined}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          configurar à mão
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <Field
            label="variável do token"
            htmlFor="tg-env"
            hint={
              d.app.tokenPresent ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="size-3 text-agent-ink" /> presente no ambiente
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warning-foreground">
                  <X className="size-3" /> ausente no ambiente do Core
                </span>
              )
            }
          >
            <Input
              id="tg-env"
              placeholder="TELEGRAM_BOT_TOKEN"
              value={secretRef}
              maxLength={120}
              spellCheck={false}
              className="font-mono md:text-xs"
              onChange={(e) => setSecretRef(e.target.value.trim().toUpperCase())}
            />
          </Field>

          <Field
            label="URL do webhook"
            htmlFor="tg-webhook"
            hint="o Telegram manda comandos e cliques de botão para cá, autenticados por segredo"
          >
            <div className="flex gap-2">
              <Input
                id="tg-webhook"
                readOnly
                value={d.app.webhookUrl}
                className="font-mono md:text-xs"
              />
              <Button
                variant="outline"
                onClick={() => void copyText(d.app.webhookUrl, 'URL copiada')}
                aria-label="copiar URL do webhook"
              >
                <Copy /> <span className="hidden sm:inline">copiar</span>
              </Button>
            </div>
          </Field>

          <SaveBar inCard>
            <Button
              disabled={connect.isPending}
              onClick={() => connect.mutate(secretRef || undefined)}
            >
              {connect.isPending && <Loader2 className="animate-spin" />}
              reconectar webhook
            </Button>
          </SaveBar>
        </div>
      </details>
    </Panel>
  );
}

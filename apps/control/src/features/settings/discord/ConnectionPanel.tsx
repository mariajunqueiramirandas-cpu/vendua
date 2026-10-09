import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FlaskConical,
  Loader2,
  Plug,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, type DiscordOverview } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import { ErrorHint, SaveBar } from '../bits.tsx';
import { useDiscordCommands, useDiscordConnect, useSaveDiscordConnection } from './queries.ts';

const SNOWFLAKE = /^\d{17,20}$/;
const PUBLIC_KEY = /^[0-9a-f]{64}$/i;

type Form = { applicationId: string; publicKey: string; guildId: string; secretRef: string };

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
 * The token is the one thing Discord can't hand over: from it, "conectar" reads the app's ids,
 * sets the interactions URL and finds the server. The fields stay for the manual path.
 */
export function ConnectionPanel({ d }: { d: DiscordOverview }) {
  const base: Form = {
    applicationId: d.app.applicationId ?? '',
    publicKey: d.app.publicKey ?? '',
    guildId: d.app.guildId ?? '',
    secretRef: d.app.tokenEnv === 'DISCORD_BOT_TOKEN' ? '' : d.app.tokenEnv,
  };
  const baseKey = JSON.stringify(base);
  const [form, setForm] = useState(base);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(base), [baseKey]);
  const save = useSaveDiscordConnection();
  const commands = useDiscordCommands();
  const connect = useDiscordConnect();
  const [invited, setInvited] = useState(false);
  // back from Discord's invite tab: look for the server the bot just joined
  useEffect(() => {
    if (!invited) return;
    const onFocus = () => {
      setInvited(false);
      connect.mutate(undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invited]);
  const test = useMutation({
    mutationFn: () => api.testIntegration('discord'),
    onSuccess: (r) =>
      r.ok ? toast.success(`discord: ${r.detail}`) : toast.error(`discord: ${r.detail}`),
    onError: (e) => toast.error(`discord: ${errorMessage(e)}`),
  });

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value.trim() });
  const issues = {
    applicationId: form.applicationId && !SNOWFLAKE.test(form.applicationId) ? 'id inválido' : '',
    guildId: form.guildId && !SNOWFLAKE.test(form.guildId) ? 'id inválido' : '',
    publicKey: form.publicKey && !PUBLIC_KEY.test(form.publicKey) ? '64 caracteres hex' : '',
  };
  const invalid = Object.values(issues).some(Boolean);
  const dirty = JSON.stringify(form) !== baseKey;
  const endpoint = d.app.endpointUrl;
  const linked = d.app.enabled && !!d.app.applicationId && !!d.app.publicKey;
  const picked = connect.data?.guildId ?? d.app.guildId;
  const choices = !picked && connect.data ? connect.data.guilds : [];
  const endpointError =
    connect.data && !connect.data.endpoint.ok ? connect.data.endpoint.error : null;

  const submit = (enabled: boolean) =>
    save.mutate({
      enabled,
      secretRef: form.secretRef,
      config: {
        applicationId: form.applicationId,
        guildId: form.guildId,
        publicKey: form.publicKey.toLowerCase(),
      },
    });

  const copy = () =>
    navigator.clipboard.writeText(endpoint).then(
      () => toast.success('URL copiada'),
      () => toast.error('não deu para copiar — selecione e copie'),
    );

  const status = d.app.ok ? (
    <Badge variant="agent">ativo</Badge>
  ) : d.app.enabled ? (
    <Badge variant="warn" title={d.app.reason ?? ''}>
      {d.app.reason}
    </Badge>
  ) : (
    <Badge>desligado</Badge>
  );

  return (
    <Panel title="conexão" aside="o bot e o servidor da equipe" actions={status}>
      {!d.app.ok && (
        <ol className="flex flex-col gap-2.5 rounded-md border bg-muted/40 p-2.5 text-sm">
          <Step done={d.app.tokenPresent}>
            crie um aplicativo em{' '}
            <a
              className="underline underline-offset-2"
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noreferrer"
            >
              discord.com/developers
            </a>
            ; na aba Bot, gere o token e coloque no ambiente do Core como{' '}
            <code className="rounded bg-secondary px-1 text-xs">{d.app.tokenEnv}</code> (Dokploy →
            Environment), depois reinicie
          </Step>
          <Step
            done={linked}
            action={
              !linked && (
                <Button
                  size="sm"
                  disabled={!d.app.tokenPresent || connect.isPending}
                  onClick={() => connect.mutate(undefined)}
                >
                  {connect.isPending ? <Loader2 className="animate-spin" /> : <Plug />} conectar
                </Button>
              )
            }
          >
            conecte — o CRM lê o aplicativo pelo token e cadastra a URL de interações no Discord
          </Step>
          <Step
            done={!!picked}
            action={
              linked &&
              !picked && (
                <>
                  {d.app.invite && (
                    <Button asChild size="sm">
                      <a
                        href={d.app.invite}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setInvited(true)}
                      >
                        adicionar ao servidor <ArrowUpRight />
                      </a>
                    </Button>
                  )}
                  {choices.length > 1 ? (
                    <Select
                      aria-label="servidor da equipe"
                      className="h-7 w-auto text-xs"
                      value=""
                      disabled={connect.isPending}
                      onChange={(e) => e.target.value && connect.mutate(e.target.value)}
                    >
                      <option value="">já está em {choices.length} servidores — qual?</option>
                      {choices.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={connect.isPending}
                      onClick={() => connect.mutate(undefined)}
                    >
                      {connect.isPending && <Loader2 className="animate-spin" />} já adicionei
                    </Button>
                  )}
                </>
              )
            }
          >
            adicione o bot ao servidor da equipe — ele é encontrado sozinho quando você voltar
          </Step>
        </ol>
      )}

      {endpointError && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning-soft p-2.5 text-sm">
          <p>
            o Discord recusou a URL de interações ({endpointError}). Cole-a em General Information →
            Interactions Endpoint URL:
          </p>
          <div className="flex gap-2">
            <Input readOnly value={endpoint} className="font-mono md:text-xs" />
            <Button variant="outline" onClick={copy} aria-label="copiar URL de interações">
              <Copy /> <span className="hidden sm:inline">copiar</span>
            </Button>
          </div>
        </div>
      )}

      <details className="group mt-3" open={dirty || undefined}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          configurar à mão
        </summary>
        <div className="mt-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="application id" htmlFor="dc-app">
              <Input
                id="dc-app"
                inputMode="numeric"
                placeholder="1234567890123456789"
                value={form.applicationId}
                maxLength={20}
                aria-invalid={!!issues.applicationId}
                className="aria-invalid:border-destructive"
                onChange={set('applicationId')}
              />
              {issues.applicationId && <ErrorHint>{issues.applicationId}</ErrorHint>}
            </Field>
            <Field label="id do servidor" htmlFor="dc-guild">
              <Input
                id="dc-guild"
                inputMode="numeric"
                placeholder="1234567890123456789"
                value={form.guildId}
                maxLength={20}
                aria-invalid={!!issues.guildId}
                className="aria-invalid:border-destructive"
                onChange={set('guildId')}
              />
              {issues.guildId && <ErrorHint>{issues.guildId}</ErrorHint>}
            </Field>
            <Field label="public key" htmlFor="dc-key">
              <Input
                id="dc-key"
                placeholder="64 caracteres hex"
                value={form.publicKey}
                maxLength={64}
                spellCheck={false}
                aria-invalid={!!issues.publicKey}
                className="font-mono aria-invalid:border-destructive md:text-xs"
                onChange={set('publicKey')}
              />
              {issues.publicKey && <ErrorHint>{issues.publicKey}</ErrorHint>}
            </Field>
            <Field
              label="variável do token"
              htmlFor="dc-env"
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
                id="dc-env"
                placeholder="DISCORD_BOT_TOKEN"
                value={form.secretRef}
                maxLength={120}
                spellCheck={false}
                className="font-mono md:text-xs"
                onChange={(e) =>
                  setForm({ ...form, secretRef: e.target.value.trim().toUpperCase() })
                }
              />
            </Field>
          </div>

          <Field
            className="mt-3"
            label="URL de interações"
            htmlFor="dc-endpoint"
            hint="o Discord manda comandos e cliques de botão para cá — assinados, só ele consegue usar"
          >
            <div className="flex gap-2">
              <Input id="dc-endpoint" readOnly value={endpoint} className="font-mono md:text-xs" />
              <Button variant="outline" onClick={copy} aria-label="copiar URL de interações">
                <Copy /> <span className="hidden sm:inline">copiar</span>
              </Button>
            </div>
          </Field>

          <SaveBar inCard>
            <Button disabled={invalid || save.isPending} onClick={() => submit(true)}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {d.app.enabled ? 'salvar' : 'salvar e ativar'}
            </Button>
          </SaveBar>
        </div>
      </details>

      {d.app.ok && (
        <p className="mt-3 text-xs text-muted-foreground">
          comandos:{' '}
          {d.state.commandsError ? (
            <span className="text-warning-foreground">{d.state.commandsError.message}</span>
          ) : d.state.commandsCurrent ? (
            'registrados no servidor'
          ) : (
            'registrando na próxima rodada…'
          )}
        </p>
      )}

      {(d.app.ok || d.app.enabled) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {d.app.ok && d.app.invite && (
            <Button asChild variant="outline">
              <a href={d.app.invite} target="_blank" rel="noreferrer">
                adicionar ao servidor <ArrowUpRight />
              </a>
            </Button>
          )}
          {d.app.ok && (
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {test.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />} testar
            </Button>
          )}
          {d.app.ok && (
            <Button variant="ghost" disabled={commands.isPending} onClick={() => commands.mutate()}>
              registrar comandos
            </Button>
          )}
          {d.app.enabled && (
            <ConfirmButton
              variant="ghost"
              confirm="desligar o bot?"
              onConfirm={() => submit(false)}
            >
              desligar
            </ConfirmButton>
          )}
        </div>
      )}
    </Panel>
  );
}

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, FlaskConical, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type DiscordOverview } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ConfirmButton } from '@/components/common.tsx';
import { ErrorHint, SaveBar } from '../bits.tsx';
import { useDiscordCommands, useSaveDiscordConnection } from './queries.ts';

const SNOWFLAKE = /^\d{17,20}$/;
const PUBLIC_KEY = /^[0-9a-f]{64}$/i;

type Form = { applicationId: string; publicKey: string; guildId: string; secretRef: string };

function Step({ done, children }: { done: boolean; children: React.ReactNode }) {
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
      <span className={cn('min-w-0', done && 'text-muted-foreground')}>{children}</span>
    </li>
  );
}

/** The bot's credentials: ids in the integration row, the token by env name — never its value. */
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
  const endpoint = `${window.location.origin}${d.app.endpointPath}`;
  const configured = !!d.app.applicationId && !!d.app.guildId;

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
        <ol className="mb-3 flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2.5 text-sm">
          <Step done={configured}>
            crie um aplicativo em{' '}
            <a
              className="underline underline-offset-2"
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noreferrer"
            >
              discord.com/developers
            </a>{' '}
            e copie o <b>application id</b> e a <b>public key</b> (General Information)
          </Step>
          <Step done={d.app.tokenPresent}>
            na aba Bot, gere o token e coloque no ambiente do Core como{' '}
            <code className="rounded bg-secondary px-1 text-xs">{d.app.tokenEnv}</code> (Dokploy →
            Environment), depois reinicie
          </Step>
          <Step done={!!d.app.guildId}>
            com o modo desenvolvedor ligado, clique com o botão direito no servidor → copiar ID
          </Step>
          <Step done={d.app.enabled}>salve e ative aqui embaixo</Step>
          <Step done={false}>
            cole a URL de interações em General Information → Interactions Endpoint URL
          </Step>
          <Step done={false}>adicione o bot ao servidor pelo convite</Step>
        </ol>
      )}

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
            onChange={(e) => setForm({ ...form, secretRef: e.target.value.trim().toUpperCase() })}
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

      <SaveBar inCard pinned={dirty}>
        <Button disabled={invalid || save.isPending} onClick={() => submit(true)}>
          {save.isPending && <Loader2 className="animate-spin" />}
          {d.app.enabled ? 'salvar' : 'salvar e ativar'}
        </Button>
        {d.app.invite && (
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
          <ConfirmButton variant="ghost" confirm="desligar o bot?" onConfirm={() => submit(false)}>
            desligar
          </ConfirmButton>
        )}
      </SaveBar>
    </Panel>
  );
}

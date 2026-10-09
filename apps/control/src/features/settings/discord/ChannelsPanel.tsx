import { useEffect, useState } from 'react';
import { Check, Hash, Loader2, Send, Sparkles, X } from 'lucide-react';
import type { DiscordGuild, DiscordOverview } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Select } from '@/components/ui/input.tsx';
import { SaveBar } from '../bits.tsx';
import {
  useDiscordGuild,
  useDiscordMute,
  useDiscordSetup,
  useDiscordTest,
  useSaveDiscordSetting,
} from './queries.ts';

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function ChannelOptions({ guild, current }: { guild: DiscordGuild | undefined; current: string }) {
  const channels = guild?.channels ?? [];
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const ch of channels) {
    const g = ch.category ?? 'sem categoria';
    groups.set(g, [...(groups.get(g) ?? []), ch]);
  }
  const known = channels.some((c) => c.id === current);
  return (
    <>
      {current && !known && <option value={current}>#? canal fora da lista ({current})</option>}
      {[...groups].map(([g, list]) => (
        <optgroup key={g} label={g}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              # {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** Where each category lands, the staff role, and "criar canais". */
export function ChannelsPanel({ d }: { d: DiscordOverview }) {
  const guild = useDiscordGuild(d.app.ok);
  const save = useSaveDiscordSetting();
  const setup = useDiscordSetup();
  const test = useDiscordTest();
  const mute = useDiscordMute();
  const base = { channels: d.setting.channels, staffRoleId: d.setting.staffRoleId ?? '' };
  const baseKey = JSON.stringify(base);
  const [edit, setEdit] = useState(base);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdit(base), [baseKey]);
  const dirty = JSON.stringify(edit) !== baseKey;
  const mapped = Object.values(d.setting.channels).filter(Boolean).length;

  if (!d.app.ok)
    return (
      <Panel title="canais">
        <p className="text-sm text-muted-foreground">
          conecte o bot primeiro — os canais e cargos vêm do próprio servidor.
        </p>
      </Panel>
    );

  const rows = [
    {
      key: 'default',
      emoji: '📥',
      label: 'padrão',
      hint: 'recebe toda categoria sem canal próprio',
    },
    ...d.catalog.categories,
  ];
  const setChannel = (key: string, id: string) => {
    const channels = { ...edit.channels };
    if (id) channels[key] = id;
    else delete channels[key];
    setEdit({ ...edit, channels });
  };

  return (
    <Panel
      title="canais"
      aside={guild.data ? `servidor ${guild.data.guild.name}` : undefined}
      actions={
        guild.isFetching ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
        ) : null
      }
    >
      {guild.isError && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-2.5 py-2 text-sm text-warning-foreground">
          não consegui ler o servidor: {errorMessage(guild.error)}
        </p>
      )}

      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end">
        <Field
          className="sm:max-w-xs sm:flex-1"
          label="cargo da equipe"
          htmlFor="dc-role"
          hint={
            guild.data && !guild.data.roles.length
              ? 'o servidor ainda não tem cargos — crie um em Configurações do servidor → Cargos'
              : 'é mencionado nos avisos urgentes e é quem vê os canais criados pelo bot'
          }
        >
          <Select
            id="dc-role"
            value={edit.staffRoleId}
            onChange={(e) => setEdit({ ...edit, staffRoleId: e.target.value })}
          >
            <option value="">— sem cargo —</option>
            {(guild.data?.roles ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                @{r.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1">
          <Button
            variant={mapped ? 'outline' : 'default'}
            disabled={setup.isPending}
            onClick={() => setup.mutate(edit.staffRoleId)}
          >
            {setup.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            criar canais
          </Button>
        </div>
        <p className="text-xs text-muted-foreground sm:flex-1 sm:pb-1.5">
          {edit.staffRoleId
            ? 'cria a categoria “Venduá”, privada para o cargo, com um canal por assunto — e já liga tudo aqui. Rodar de novo só completa o que faltar.'
            : 'sem cargo, os canais ficam visíveis para todo o servidor e ninguém é mencionado. Escolha um cargo depois e rode de novo para fechá-los.'}
        </p>
      </div>

      <ul className="flex flex-col" aria-label="canal de cada categoria">
        {rows.map((r) => {
          const until = d.state.mutes[r.key];
          return (
            <li
              key={r.key}
              className="grid grid-cols-1 gap-1.5 border-b py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span aria-hidden>{r.emoji}</span>
                  <span className={cn(r.key === 'default' && 'font-medium')}>{r.label}</span>
                  {until && (
                    <>
                      <Badge variant="warn">silenciado até {hhmm(until)}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mute.isPending}
                        onClick={() => mute.mutate({ category: r.key, minutes: 0 })}
                      >
                        reativar
                      </Button>
                    </>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{r.hint}</p>
              </div>
              <Select
                aria-label={`canal de ${r.label}`}
                value={edit.channels[r.key] ?? ''}
                onChange={(e) => setChannel(r.key, e.target.value)}
              >
                <option value="">{r.key === 'default' ? '— nenhum —' : '— usar o padrão —'}</option>
                <ChannelOptions guild={guild.data} current={edit.channels[r.key] ?? ''} />
              </Select>
            </li>
          );
        })}
      </ul>

      {test.data && !dirty && test.data.results.length > 0 && (
        <ul
          className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs"
          aria-label="resultado do teste"
        >
          {test.data.results.map((t) => {
            const name = guild.data?.channels.find((c) => c.id === t.channelId)?.name;
            return (
              <li key={t.channelId} className="flex items-start gap-1.5">
                {t.ok ? (
                  <Check className="mt-px size-3.5 shrink-0 text-agent-ink" />
                ) : (
                  <X className="mt-px size-3.5 shrink-0 text-destructive-foreground" />
                )}
                <span className={cn(!t.ok && 'text-destructive-foreground')}>
                  <Hash className="inline size-3" />
                  {name ?? t.channelId} · {t.categories.join(', ')}
                  {t.error ? ` — ${t.error}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SaveBar inCard pinned={dirty}>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              ...d.setting,
              channels: edit.channels,
              staffRoleId: edit.staffRoleId || null,
            })
          }
        >
          salvar canais
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setEdit(base)}>
            desfazer
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={!mapped || test.isPending}
            title="manda uma mensagem de teste em cada canal escolhido"
            onClick={() => test.mutate()}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} enviar teste
          </Button>
        )}
      </SaveBar>
    </Panel>
  );
}

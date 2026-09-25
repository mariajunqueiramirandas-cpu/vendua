import { useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import type { Brief } from '@/lib/api.ts';
import { rel } from '@/lib/format.ts';
import { errorMessage } from '@/lib/query.ts';
import { ConfirmButton, EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch, Tooltip } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useBriefMutations, useBriefs } from './queries.ts';

const EMPTY = { name: '', query: '', segment: '', city: '', target: '' };

function BriefRow({ b }: { b: Brief }) {
  const { toggle, remove } = useBriefMutations();
  const proposal = b.created_by === 'strategist';
  const busy = toggle.isPending || remove.isPending;
  const meta = [
    [b.segment, b.city].filter(Boolean).join(' · ') || '—',
    b.target ? `≤${b.target}` : '',
    `última ${rel(b.last_run_at)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{b.name}</span>
          {proposal && (
            <Tooltip content="proposta do estrategista">
              <span className="inline-flex">
                <Badge variant="warn">proposta</Badge>
              </span>
            </Tooltip>
          )}
        </div>
        <span className="truncate text-xs text-foreground/80" title={b.query}>
          {b.query}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{meta}</span>
        {b.note && (
          <span className="line-clamp-2 text-[11px] text-warning-foreground" title={b.note}>
            {b.note}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {!b.enabled && proposal ? (
          <Tooltip content="aprovar proposta — começa a rodar">
            <Button
              size="sm"
              variant="agent"
              disabled={busy}
              onClick={() => toggle.mutate({ id: b.id, enabled: true })}
            >
              aprovar
            </Button>
          </Tooltip>
        ) : (
          <Tooltip content={b.enabled ? 'ativa — clica pra pausar' : 'pausada'}>
            <span className="inline-flex items-center px-1">
              <Switch
                checked={b.enabled}
                disabled={busy}
                aria-label={b.enabled ? 'pausar brief' : 'ativar brief'}
                onCheckedChange={(v) => toggle.mutate({ id: b.id, enabled: v })}
              />
            </span>
          </Tooltip>
        )}
        <ConfirmButton
          size="icon-sm"
          variant="ghost"
          aria-label="remover brief"
          confirm={<Trash2 />}
          disabled={busy}
          onConfirm={() => remove.mutate(b.id)}
        >
          <Trash2 />
        </ConfirmButton>
      </div>
    </li>
  );
}

/** Daily rotation: saved briefs the scheduler runs 1x/day. */
export function Briefs() {
  const q = useBriefs();
  const { create } = useBriefMutations();
  const [open, setOpen] = useState(false);
  const [bf, setBf] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const ok = !!bf.name.trim() && !!bf.query.trim();

  const submit = () => {
    if (!ok) return;
    setMsg('');
    create.mutate(
      {
        name: bf.name.trim(),
        query: bf.query.trim(),
        ...(bf.segment.trim() && { segment: bf.segment.trim() }),
        ...(bf.city.trim() && { city: bf.city.trim() }),
        ...(bf.target && { target: Number(bf.target) }),
      },
      {
        onSuccess: () => {
          setBf(EMPTY);
          setOpen(false);
        },
        onError: (e) => setMsg(errorMessage(e)),
      },
    );
  };

  const briefs = q.data ?? [];
  return (
    <Panel
      title="rotina diária"
      aside="1x/dia · autocontato conforme guardrails"
      actions={
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus /> brief
        </Button>
      }
      flush
    >
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <LoadingRows rows={3} className="p-3" />
      ) : briefs.length ? (
        <ul className="divide-y">
          {briefs.map((b) => (
            <BriefRow key={b.id} b={b} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={CalendarClock}
          title="nenhum brief ainda"
          hint="um brief roda sozinho todo dia e traz leads novos"
          action={
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <Plus /> novo brief
            </Button>
          }
        />
      )}

      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title="novo brief"
        description="entra na rotina diária — o agente roda essa busca uma vez por dia"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              cancelar
            </Button>
            <Button disabled={!ok || create.isPending} onClick={submit}>
              {create.isPending ? 'salvando…' : 'criar brief'}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="nome" htmlFor="bf-name">
            <Input
              id="bf-name"
              placeholder="ex: docerias fortaleza"
              value={bf.name}
              onChange={(e) => setBf({ ...bf, name: e.target.value })}
            />
          </Field>
          <Field label="busca" htmlFor="bf-query">
            <Input
              id="bf-query"
              placeholder="ex: padarias de bairro sem site"
              value={bf.query}
              onChange={(e) => setBf({ ...bf, query: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="segmento" htmlFor="bf-seg">
              <Input
                id="bf-seg"
                value={bf.segment}
                onChange={(e) => setBf({ ...bf, segment: e.target.value })}
              />
            </Field>
            <Field label="cidade" htmlFor="bf-city">
              <Input
                id="bf-city"
                value={bf.city}
                onChange={(e) => setBf({ ...bf, city: e.target.value })}
              />
            </Field>
          </div>
          <Field label="alvo" htmlFor="bf-target" hint="máximo de leads por rodada (opcional)">
            <Input
              id="bf-target"
              type="number"
              inputMode="numeric"
              min={1}
              max={1000}
              value={bf.target}
              onChange={(e) => setBf({ ...bf, target: e.target.value })}
              className="w-28"
            />
          </Field>
          {msg && <p className="text-xs text-destructive-foreground">{msg}</p>}
          <button type="submit" hidden />
        </form>
      </ResponsiveSheet>
    </Panel>
  );
}

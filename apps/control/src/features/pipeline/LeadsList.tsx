import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, type UseInfiniteQueryResult, type InfiniteData } from '@tanstack/react-query';
import { Plus, Send, Upload, X } from 'lucide-react';
import { api, type LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtMoney, isLate, rel, relDue } from '@/lib/format.ts';
import { errorMessage } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Avatar, EmptyState, ErrorState, ScoreBar, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { BulkBar, type Channel, type Goal } from './BulkBar.tsx';
import { AgentMode, Channels, Drafts, FitIntent, NextAction } from './cells.tsx';
import type { PipelineParams } from './params.ts';

type Page = { leads: LeadListItem[]; nextCursor: string | null };

const COLUMNS: Column<LeadListItem>[] = [
  {
    key: 'lead',
    header: 'lead',
    className: 'max-w-0 w-[34%] min-w-56',
    cell: (l) => (
      <div className="flex min-w-0 items-center gap-2">
        <Avatar name={l.name} size="sm" />
        <span className="min-w-0 truncate font-medium">{l.name}</span>
        {l.businessName && (
          <span className="min-w-0 shrink-[3] truncate text-xs text-muted-foreground">
            {l.businessName}
          </span>
        )}
        {l.unsubscribedAt && <Badge variant="bad">descadastrado</Badge>}
        {l.archivedAt && <Badge variant="outline">arquivado</Badge>}
        {l.tags.slice(0, 2).map((t) => (
          <Badge key={t} className="max-xl:hidden">
            {t}
          </Badge>
        ))}
      </div>
    ),
  },
  { key: 'stage', header: 'estágio', cell: (l) => <StateChip state={l.state} /> },
  {
    key: 'chan',
    header: <span title="canais de contato cadastrados">canais</span>,
    className: 'max-lg:hidden',
    cell: (l) => <Channels lead={l} />,
  },
  {
    key: 'agent',
    header: 'agente',
    cell: (l) => (
      <span className="inline-flex items-center gap-1">
        <AgentMode lead={l} />
        <Drafts n={l.pendingDrafts} />
      </span>
    ),
  },
  {
    key: 'score',
    header: 'score',
    className: 'max-lg:hidden',
    cell: (l) => <ScoreBar score={l.score} />,
  },
  { key: 'fit', header: 'fit', className: 'max-xl:hidden', cell: (l) => <FitIntent lead={l} /> },
  { key: 'value', header: 'valor', align: 'end', cell: (l) => fmtMoney(l.dealValueCents) },
  {
    key: 'next',
    header: 'próx. ação',
    className: 'text-xs',
    cell: (l) => <NextAction lead={l} />,
  },
  {
    key: 'act',
    header: 'últ. atividade',
    align: 'end',
    className: 'text-muted-foreground',
    cell: (l) => rel(l.lastActivityAt ?? l.updatedAt),
  },
];

function MobileRow({ lead: l }: { lead: LeadListItem }) {
  const late = isLate(l.nextActionAt);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{l.name}</span>
        {l.businessName && (
          <span className="min-w-0 shrink-[3] truncate text-xs text-muted-foreground">
            {l.businessName}
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs tnum">
          {l.dealValueCents != null ? fmtMoney(l.dealValueCents) : ''}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <StateChip state={l.state} />
        <AgentMode lead={l} />
        <Drafts n={l.pendingDrafts} />
        {l.unsubscribedAt && <Badge variant="bad">descadastrado</Badge>}
        {l.archivedAt && <Badge variant="outline">arquivado</Badge>}
        <span className={cn('ml-auto shrink-0 tnum', late && 'text-destructive-foreground')}>
          {l.nextActionAt ? relDue(l.nextActionAt) : rel(l.lastActivityAt ?? l.updatedAt)}
        </span>
      </div>
    </div>
  );
}

export function LeadsList({
  query,
  p,
  onImport,
  tags,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page>>;
  p: PipelineParams;
  onImport: () => void;
  /** known tags, offered by the selection's "tag" */
  tags: string[];
}) {
  const nav = useNavigate();
  const leads = useMemo(() => query.data?.pages.flatMap((pg) => pg.leads) ?? [], [query.data]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dispatchMsg, setDispatchMsg] = useState('');
  // Bumped on filter change — invalidates in-flight dispatch results.
  const filterGen = useRef(0);
  const dispatchM = useMutation({
    mutationFn: (v: { ids: string[]; goal: Goal; channel: Channel }) =>
      api.requestAgent({
        kind: 'outreach',
        leadIds: v.ids,
        goal: v.goal,
        channel: v.channel,
      }),
  });

  // Filter change: drop hidden selections (dispatch only acts on visible leads)
  // and invalidate in-flight dispatch results.
  const fkey = JSON.stringify(p.filters);
  useEffect(() => {
    filterGen.current++;
    setSel(new Set());
    setDispatchMsg('');
  }, [fkey]);

  // Prune selections to the reloaded visible set — dispatch must never act on hidden leads.
  useEffect(() => {
    if (!query.data || query.isPlaceholderData) return;
    const ids = new Set(leads.map((l) => l.id));
    setSel((s) => {
      const kept = [...s].filter((id) => ids.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [leads, query.data, query.isPlaceholderData]);

  const dispatch = async (goal: Goal, channel: Channel) => {
    const gen = filterGen.current;
    setDispatchMsg('');
    try {
      const r = await dispatchM.mutateAsync({ ids: [...sel], goal, channel });
      if (gen !== filterGen.current) return; // filters changed mid-flight — stale result
      const names = new Map(leads.map((l) => [l.id, l.name]));
      const skips = r.skipped
        .map((s) => `${names.get(s.leadId) ?? s.leadId.slice(0, 8)}: ${s.reason}`)
        .join(' · ');
      const n = r.runs.length;
      setDispatchMsg(
        `${n} disparado${n === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} ignorado${r.skipped.length === 1 ? '' : 's'}${skips ? ` (${skips})` : ''}` : ''}`,
      );
      setSel(new Set());
    } catch (e) {
      if (gen !== filterGen.current) return;
      setDispatchMsg(errorMessage(e));
    }
  };

  if (query.isError && !leads.length)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const empty = p.filtered ? (
    <EmptyState
      title="nada aqui"
      hint="nenhum lead corresponde aos filtros"
      action={
        <Button size="sm" variant="outline" onClick={p.clearFilters}>
          <X /> limpar filtros
        </Button>
      }
    />
  ) : (
    <EmptyState
      title="nenhum lead ainda"
      hint="importe uma planilha ou cadastre o primeiro"
      action={
        <>
          <Button size="sm" variant="outline" onClick={onImport}>
            <Upload /> importar csv
          </Button>
          <Button size="sm" onClick={p.openNew}>
            <Plus /> novo lead
          </Button>
        </>
      }
    />
  );

  return (
    <>
      {dispatchMsg && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border bg-agent-soft px-3 py-2 text-sm">
          <Send className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{dispatchMsg}</span>
          <button
            type="button"
            className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setDispatchMsg('')}
            aria-label="fechar"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
        <DataList
          rows={leads}
          rowKey={(l) => l.id}
          columns={COLUMNS}
          mobileRow={(l) => <MobileRow lead={l} />}
          onRowClick={(l) => nav(`/pipeline/${l.id}`)}
          selection={{ selected: sel, onChange: setSel }}
          loading={query.isPending}
          empty={empty}
          className={cn(query.isPlaceholderData && 'opacity-60 transition-opacity')}
        />
      </Card>

      {query.hasNextPage && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'carregando…' : 'carregar mais'}
          </Button>
        </div>
      )}

      {sel.size > 0 && (
        <BulkBar
          leads={leads}
          sel={sel}
          onClear={() => setSel(new Set())}
          stale={query.isPlaceholderData}
          archivedView={p.filters.archived === 'only'}
          tags={tags}
          dispatch={(goal, channel) => void dispatch(goal, channel)}
          dispatching={dispatchM.isPending}
        />
      )}
    </>
  );
}

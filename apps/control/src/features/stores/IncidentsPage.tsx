import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Siren } from 'lucide-react';
import type { Incident } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, rel } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { SEVERITY, Tag } from './bits.tsx';
import { IncidentSheet } from './IncidentSheet.tsx';
import { useIncidents } from './queries.ts';
import { useStoresTabs } from './tabs.ts';

const RANK = { outage: 0, degraded: 1, info: 2 } as const;

// a resolved outage is history, not an alarm: same label, no colour
const PAST = Object.fromEntries(
  Object.entries(SEVERITY).map(([k, t]) => [k, { ...t, variant: 'outline' }]),
) as typeof SEVERITY;

const Sev = ({ i }: { i: Incident }) => (
  <Tag map={i.resolvedAt ? PAST : SEVERITY} value={i.severity} />
);

const since = (iso: string) => {
  const r = rel(iso);
  return r === 'agora' ? 'aberto agora' : `aberto há ${r}`;
};

function Title({ i }: { i: Incident }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className={cn('truncate font-medium', i.resolvedAt && 'text-muted-foreground')}>
        {i.title}
      </span>
      {i.body && <span className="truncate text-xs text-muted-foreground">{i.body}</span>}
    </div>
  );
}

const COLUMNS: Column<Incident>[] = [
  {
    key: 'sev',
    header: 'gravidade',
    className: 'w-32 whitespace-nowrap',
    cell: (i) => (
      <span className="inline-block w-24">
        <Sev i={i} />
      </span>
    ),
  },
  { key: 'title', header: 'incidente', className: 'max-w-0 w-full', cell: (i) => <Title i={i} /> },
  {
    key: 'started',
    header: 'início',
    className: 'w-44 whitespace-nowrap text-muted-foreground tnum',
    cell: (i) => <span className="inline-block w-36">{fmtDateTime(i.startedAt)}</span>,
  },
  {
    key: 'state',
    header: 'status',
    align: 'end',
    className: 'w-40 whitespace-nowrap',
    cell: (i) =>
      i.resolvedAt ? (
        <span className="inline-flex w-32 items-center justify-end gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" /> resolvido · {rel(i.resolvedAt)}
        </span>
      ) : (
        <span className="inline-block w-32 text-xs font-medium">{since(i.startedAt)}</span>
      ),
  },
];

function MobileRow({ i }: { i: Incident }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <Sev i={i} />
        {i.resolvedAt ? (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tnum">
            <CheckCircle2 className="size-3.5" /> resolvido · {rel(i.resolvedAt)}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-xs font-medium tnum">{since(i.startedAt)}</span>
        )}
      </div>
      <span className={cn('truncate text-sm font-medium', i.resolvedAt && 'text-muted-foreground')}>
        {i.title}
      </span>
      {i.body && <span className="line-clamp-2 text-xs text-muted-foreground">{i.body}</span>}
    </div>
  );
}

export default function IncidentsPage() {
  const tabs = useStoresTabs();
  const query = useIncidents();
  const [sp, setSp] = useSearchParams();
  const setParam = (k: string, v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.delete('novo');
        n.delete('incidente');
        if (v) n.set(k, v);
        return n;
      },
      { replace: !v },
    );

  const { open, closed } = useMemo(() => {
    const all = query.data ?? [];
    const by = (a: Incident, b: Incident) => b.startedAt.localeCompare(a.startedAt);
    return {
      open: all
        .filter((i) => !i.resolvedAt)
        .sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3) || by(a, b)),
      closed: all
        .filter((i) => i.resolvedAt)
        .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')),
    };
  }, [query.data]);

  const editId = sp.get('incidente');
  const editing = query.data?.find((i) => i.id === editId) ?? null;
  const sheetOpen = sp.get('novo') === '1' || !!editing;
  const onRow = (i: Incident) => setParam('incidente', i.id);

  const list = (rows: Incident[], empty: ReactNode) => (
    <DataList
      rows={rows}
      rowKey={(i) => i.id}
      columns={COLUMNS}
      mobileRow={(i) => <MobileRow i={i} />}
      onRowClick={onRow}
      empty={empty}
    />
  );

  let body;
  if (query.isError && !query.data) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else if (query.isPending) {
    body = <LoadingRows rows={4} />;
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <Panel
          flush
          title="em aberto"
          aside={
            open.length
              ? 'visíveis agora na Ajuda dos lojistas e em status.vendua.com.br'
              : undefined
          }
          className={cn(
            'overflow-hidden',
            open.some((i) => i.severity === 'outage') && 'border-destructive/40',
          )}
        >
          {list(
            open,
            <EmptyState
              icon={CheckCircle2}
              title="nenhum incidente em aberto"
              hint="publique um quando algo da plataforma afetar as lojas"
              className="py-8"
            />,
          )}
        </Panel>
        <Panel
          flush
          title="resolvidos"
          aside={
            closed.length
              ? 'a Ajuda mostra os dos últimos 7 dias; a página de status, os de 30'
              : undefined
          }
          className="overflow-hidden"
        >
          {list(
            closed,
            <p className="px-3 py-4 text-sm text-muted-foreground">nenhum incidente resolvido</p>,
          )}
        </Panel>
      </div>
    );
  }

  return (
    <Page
      title="Lojas"
      tabs={tabs}
      actions={
        <Button size="sm" onClick={() => setParam('novo', '1')}>
          <Siren /> novo incidente
        </Button>
      }
    >
      {body}
      <IncidentSheet open={sheetOpen} incident={editing} onClose={() => setParam('novo', null)} />
    </Page>
  );
}

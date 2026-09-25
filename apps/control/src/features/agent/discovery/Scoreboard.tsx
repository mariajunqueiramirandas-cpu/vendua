import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import type { LeadListItem, SegmentStat } from '@/lib/api.ts';
import { fmtUsdCents, rel } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, ScoreBar, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { useDuplicates, useFoundLeads, useSegments } from './queries.ts';

const replyPct = (s: SegmentStat) =>
  s.contacted > 0 ? `${Math.round((s.replied / s.contacted) * 100)}%` : null;

/** "o que converte" — the agent reads this same board when it searches. */
export function SegmentBoard() {
  const q = useSegments();
  const segs = q.data ?? [];
  const columns: Column<SegmentStat>[] = [
    { key: 's', header: 'segmento', cell: (s) => <span className="font-medium">{s.segment}</span> },
    {
      key: 'l',
      header: 'leads',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => s.leads,
    },
    {
      key: 'c',
      header: 'contatados',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => s.contacted,
    },
    {
      key: 'r',
      header: 'responderam',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => (
        <>
          <b className="font-semibold">{s.replied}</b>
          {replyPct(s) && <span className="text-muted-foreground"> · {replyPct(s)}</span>}
        </>
      ),
    },
    {
      key: 'a',
      header: 'ativos',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => s.live,
    },
    {
      key: 'k',
      header: 'custo 30d',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => fmtUsdCents(s.costCents),
    },
    {
      key: 'p',
      header: <span title="custo 30d ÷ leads novos 30d">cpl</span>,
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => (s.cplCents == null ? '—' : fmtUsdCents(s.cplCents)),
    },
  ];
  if (q.error && !q.data)
    return (
      <Panel title="o que converte">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Panel>
    );
  return (
    <Panel
      title="o que converte"
      aside="o agente vê este quadro na busca e reforça o que está convertendo"
      flush
    >
      <DataList
        rows={segs}
        rowKey={(s) => s.segment}
        columns={columns}
        loading={q.isPending}
        empty={<EmptyState title="sem segmentos ainda" hint="aparecem conforme leads entram" />}
        mobileRow={(s) => (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.segment}</span>
              <span className="text-xs text-muted-foreground tnum">
                cpl {s.cplCents == null ? '—' : fmtUsdCents(s.cplCents)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground tnum">
              {s.leads} leads · {s.contacted} contat. ·{' '}
              <b className="font-semibold text-foreground">{s.replied}</b> resp.
              {replyPct(s) ? ` (${replyPct(s)})` : ''} · {s.live} ativos
            </div>
          </div>
        )}
      />
    </Panel>
  );
}

function Scores({ l }: { l: LeadListItem }) {
  return (
    <span className="flex items-center gap-1.5">
      {l.fitScore != null && (
        <span title={l.fitReason ?? undefined}>
          <ScoreBar score={l.fitScore} />
        </span>
      )}
      {l.intentScore != null && (
        <Badge variant="outline" className="tnum" title={l.intentReason ?? undefined}>
          i{l.intentScore}
        </Badge>
      )}
    </span>
  );
}

export function FoundLeads() {
  const nav = useNavigate();
  const q = useFoundLeads();
  const dupes = useDuplicates();
  const found = q.data ?? [];
  const columns: Column<LeadListItem>[] = [
    {
      key: 'n',
      header: 'lead',
      className: 'max-w-56',
      cell: (l) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium">{l.name}</span>
          {l.businessName && (
            <span className="truncate text-xs text-muted-foreground">{l.businessName}</span>
          )}
        </span>
      ),
    },
    {
      key: 'm',
      header: 'segmento · cidade',
      className: 'max-w-48 truncate text-muted-foreground',
      cell: (l) => [l.segment, l.city].filter(Boolean).join(' · ') || '—',
    },
    { key: 'f', header: 'fit · intenção', cell: (l) => <Scores l={l} /> },
    { key: 's', header: 'etapa', cell: (l) => <StateChip state={l.state} /> },
    {
      key: 'v',
      header: 'via',
      className: 'max-w-32 truncate text-xs text-muted-foreground',
      cell: (l) => l.discoveredVia ?? '—',
    },
    {
      key: 'w',
      header: 'quando',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (l) => rel(l.createdAt),
    },
  ];

  return (
    <Panel title="leads descobertos" aside={found.length ? `${found.length}` : undefined} flush>
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataList
          rows={found}
          rowKey={(l) => l.id}
          columns={columns}
          loading={q.isPending}
          onRowClick={(l) => nav(`/pipeline/${l.id}`)}
          empty={<EmptyState icon={Sparkles} title="nenhum ainda" hint="rode uma descoberta" />}
          mobileRow={(l) => (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                <StateChip state={l.state} />
              </div>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {[l.businessName, l.segment, l.city].filter(Boolean).join(' · ') || '—'}
                </span>
                <Scores l={l} />
                <span className="text-xs text-muted-foreground tnum">{rel(l.createdAt)}</span>
              </div>
            </div>
          )}
        />
      )}
      {!!dupes.data?.length && (
        <div className="border-t px-3 py-2.5">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">possíveis duplicados</h3>
          <ul className="flex flex-col gap-1.5">
            {dupes.data.slice(0, 10).map((g, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
                <Badge variant="warn">{g.field}</Badge>
                <span className="max-w-full truncate font-mono text-xs">{g.value}</span>
                <span className="flex flex-wrap gap-x-2">
                  {g.leads.map((l) => (
                    <Link
                      key={l.id}
                      to={`/pipeline/${l.id}`}
                      className="underline underline-offset-4 decoration-border-strong hover:decoration-foreground"
                    >
                      {l.name}
                    </Link>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

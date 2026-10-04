import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Search } from 'lucide-react';
import type { AiUsageView } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { fmtCompact, fmtInt, fmtUsdAi, providerLabel } from './format.ts';
import { useAiUsage, type AiDays } from './queries.ts';
import { AI_TABS } from './tabs.ts';

type StoreUsage = AiUsageView['byStore'][number];

const PERIODS = [
  ['30', '30 dias'],
  ['7', '7 dias'],
] as const;

/** The plan's conversations this cycle: used of limit, amber when they ran out. */
function Allowance({ s, className }: { s: StoreUsage; className?: string | undefined }) {
  if (s.limit <= 0) return <span className="text-muted-foreground">—</span>;
  const pct = Math.min(100, (s.used / s.limit) * 100);
  const out = s.remaining <= 0;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', out ? 'bg-warning' : 'bg-agent-ink')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tnum">
        {fmtInt(s.used)}/{fmtInt(s.limit)}
      </span>
      {out && <Badge variant="warn">esgotou</Badge>}
    </span>
  );
}

const dailyLimit = (s: StoreUsage) =>
  s.dailyLimitUsd == null ? (
    <span className="text-muted-foreground">sem teto</span>
  ) : (
    fmtUsdAi(s.dailyLimitUsd)
  );

function ByModel({ rows }: { rows: AiUsageView['byModel'] }) {
  const ranked = [...rows].sort((a, b) => b.usd - a.usd);
  const max = Math.max(...ranked.map((r) => r.usd), 0);
  return (
    <Panel title="gasto por modelo" flush>
      {ranked.length ? (
        <ul className="flex flex-col gap-2.5 p-3 md:gap-1.5">
          <li
            aria-hidden
            className="hidden text-[11px] text-muted-foreground md:grid md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_7rem_5.5rem] md:gap-x-3"
          >
            <span />
            <span />
            <span className="text-right">gasto</span>
            <span className="text-right">chamadas</span>
          </li>
          {ranked.map((r) => (
            <li
              key={`${r.provider}/${r.model}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_7rem_5.5rem]"
            >
              <span className="min-w-0 truncate text-[13px]" title={`${r.provider} ${r.model}`}>
                {r.model}
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {providerLabel(r.provider)}
                </span>
              </span>
              <span className="text-right text-[13px] tnum md:order-3">{fmtUsdAi(r.usd)}</span>
              <span
                className="col-span-2 h-2 overflow-hidden md:order-2 md:col-span-1 md:h-3"
                title={`${r.model}: ${fmtUsdAi(r.usd)}`}
              >
                <span
                  className="block h-full rounded-r-[4px] bg-agent-ink/80"
                  style={{ width: `${max > 0 ? Math.max(1.5, (r.usd / max) * 100) : 0}%` }}
                />
              </span>
              <span className="hidden text-right text-[13px] text-muted-foreground tnum md:order-4 md:block">
                {fmtInt(r.calls)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-3 text-sm text-muted-foreground">nenhuma chamada no período</p>
      )}
    </Panel>
  );
}

export default function UsagePage() {
  const [sp, setSp] = useSearchParams();
  const days: AiDays = sp.get('d') === '7' ? 7 : 30;
  const [q, setQ] = useState('');
  const query = useAiUsage(days);
  const navigate = useNavigate();
  const data = query.data;

  const stores = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...(data?.byStore ?? [])]
      .filter((s) => !term || s.name.toLowerCase().includes(term) || s.slug.includes(term))
      .sort((a, b) => b.usd - a.usd || b.conversations - a.conversations);
  }, [data, q]);

  const columns: Column<StoreUsage>[] = [
    {
      key: 'store',
      header: 'loja',
      className: 'max-w-40 lg:max-w-64',
      cell: (s) => (
        <Link
          to={`/lojas/${s.id}`}
          onClick={(e) => e.stopPropagation()}
          className="flex min-w-0 items-baseline gap-1.5 hover:underline"
        >
          <span className="truncate font-medium">{s.name}</span>
          <span className="truncate text-xs text-muted-foreground">{s.slug}</span>
        </Link>
      ),
    },
    {
      key: 'conv',
      header: `conversas ${days}d`,
      align: 'end',
      cell: (s) => fmtInt(s.conversations),
    },
    {
      key: 'allowance',
      header: 'usadas no ciclo',
      className: 'whitespace-nowrap',
      cell: (s) => <Allowance s={s} />,
    },
    {
      key: 'usd',
      header: 'gasto',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (s) => fmtUsdAi(s.usd),
    },
    {
      key: 'calls',
      header: 'chamadas',
      align: 'end',
      className: 'hidden lg:table-cell',
      cell: (s) => fmtInt(s.calls),
    },
    {
      key: 'limit',
      header: 'limite diário',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: dailyLimit,
    },
  ];

  const toolbar = (
    <div className="flex items-center gap-2">
      <Segmented
        value={String(days) as '7' | '30'}
        options={PERIODS}
        onChange={(v) =>
          setSp(
            (prev) => {
              const n = new URLSearchParams(prev);
              if (v === '30') n.delete('d');
              else n.set('d', v);
              return n;
            },
            { replace: true },
          )
        }
      />
      <div className="relative min-w-0 flex-1 md:max-w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="buscar loja"
          aria-label="buscar loja"
          className="pl-8"
        />
      </div>
    </div>
  );

  return (
    <Page title="IA" tabs={AI_TABS} toolbar={toolbar}>
      {query.isPending ? (
        <LoadingRows />
      ) : query.isError || !data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className={cn('flex flex-col gap-4', query.isPlaceholderData && 'opacity-60')}>
          <KpiStrip
            items={[
              { label: `gasto em ${days} dias`, value: fmtUsdAi(data.totals.usd) },
              { label: 'conversas', value: fmtInt(data.totals.conversations) },
              { label: 'chamadas ao modelo', value: fmtInt(data.totals.calls) },
              { label: 'tokens de entrada', value: fmtCompact(data.totals.inputTokens) },
              { label: 'tokens de saída', value: fmtCompact(data.totals.outputTokens) },
            ]}
          />
          <ByModel rows={data.byModel} />
          <Panel
            title="por loja"
            aside={`${fmtInt(stores.length)} ${stores.length === 1 ? 'loja' : 'lojas'}`}
            flush
          >
            <DataList
              rows={stores}
              rowKey={(s) => s.id}
              columns={columns}
              onRowClick={(s) => navigate(`/lojas/${s.id}`)}
              empty={
                <EmptyState
                  icon={Bot}
                  title={q.trim() ? 'nenhuma loja encontrada' : 'nenhuma loja usou o Duá'}
                  hint={q.trim() ? undefined : `nos últimos ${days} dias`}
                />
              }
              mobileRow={(s) => (
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{s.slug}</span>
                    <span className="ml-auto shrink-0 text-sm tnum">{fmtUsdAi(s.usd)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="tnum">
                      {fmtInt(s.conversations)} {s.conversations === 1 ? 'conversa' : 'conversas'}
                    </span>
                    <span className="tnum">
                      {fmtInt(s.calls)} {s.calls === 1 ? 'chamada' : 'chamadas'}
                    </span>
                    <Allowance s={s} />
                    <span>limite {dailyLimit(s)}</span>
                  </div>
                </div>
              )}
            />
          </Panel>
          <p className="text-xs text-muted-foreground">
            Gasto em US$, como cada chamada foi cobrada. Usadas no ciclo são as conversas do plano
            no mês (ou no teste) atual, não no período escolhido.
          </p>
        </div>
      )}
    </Page>
  );
}

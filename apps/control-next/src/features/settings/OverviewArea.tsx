import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { ChannelHealth } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { SectionHead } from './bits.tsx';
import type { ProvTone } from './providers.ts';
import { useChannelHealth } from './queries.ts';
import type { AreaKey, Check, Readiness } from './readiness.ts';

const DOT: Record<ProvTone, string> = {
  live: 'bg-agent ring-agent/30',
  warn: 'bg-warning ring-warning/30',
  off: 'bg-border-strong ring-transparent',
};

export function OverviewArea({
  r,
  loading,
  onGo,
}: {
  r: Readiness;
  loading: boolean;
  onGo: (a: AreaKey, p?: string) => void;
}) {
  const allUp = r.ready === r.essential.length && r.attn === 0;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start [&>*]:min-w-0">
      <section>
        <SectionHead
          title={
            loading
              ? 'lendo a máquina…'
              : allUp
                ? 'máquina inteira no ar'
                : `${r.ready} de ${r.essential.length} essenciais no ar`
          }
          sub={
            <>
              uma linha por peça — toque para abrir a área que resolve
              {!loading && r.attn > 0 && (
                <span className="font-medium text-warning-foreground">
                  {' '}
                  · {r.attn} pedindo atenção
                </span>
              )}
            </>
          }
        />
        <Panel flush>
          {loading ? (
            <LoadingRows rows={9} className="p-3" />
          ) : (
            <>
              <Group label="essencial — o agente não roda sem isso" />
              {r.essential.map((c) => (
                <CheckRow key={c.key} c={c} onGo={onGo} />
              ))}
              <Group label="rotina — ajusta o dia a dia" />
              {r.routine.map((c) => (
                <CheckRow key={c.key} c={c} onGo={onGo} />
              ))}
            </>
          )}
        </Panel>
      </section>
      <section>
        <SectionHead
          title="saúde dos canais"
          sub="envios, falhas e bloqueios de guarda · últimos 30 dias"
        />
        <ChannelHealthPanel />
      </section>
    </div>
  );
}

function Group({ label }: { label: string }) {
  return (
    <div className="border-b bg-muted/50 px-3 py-1 text-[11px] font-medium text-muted-foreground first:rounded-t-lg">
      {label}
    </div>
  );
}

function CheckRow({ c, onGo }: { c: Check; onGo: (a: AreaKey, p?: string) => void }) {
  const nav = useNavigate();
  return (
    <button
      type="button"
      className="flex min-h-10 w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-hover pointer-coarse:min-h-12"
      onClick={() => (c.route ? nav(c.route) : c.to && onGo(c.to, c.p))}
    >
      <i className={cn('size-2 shrink-0 rounded-full ring-3', DOT[c.tone])} aria-hidden />
      <span className="w-24 shrink-0 truncate text-sm font-medium sm:w-36">{c.label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 text-sm text-muted-foreground sm:truncate',
          c.tone === 'warn' && 'text-warning-foreground',
        )}
      >
        {c.state}
      </span>
      {c.route && (
        <span className="hidden text-[11px] text-muted-foreground sm:inline">estúdio</span>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

const blockedTitle = (r: ChannelHealth) =>
  Object.entries(r.blockedByReason)
    .map(([reason, n]) => `${reason}: ${n}`)
    .join('\n');

/** alert = failureRate ≥20% on ≥5 sends — advisory only, never pauses sends. */
const HealthChip = ({ r }: { r: ChannelHealth }) =>
  r.alert ? (
    <Badge variant="bad">falha {Math.round((r.failureRate ?? 0) * 100)}%</Badge>
  ) : (
    <Badge>ok</Badge>
  );

const COLUMNS: Column<ChannelHealth>[] = [
  {
    key: 'channel',
    header: 'canal',
    cell: (r) => <span className="font-medium">{r.channel}</span>,
  },
  { key: 'sent', header: 'enviadas', align: 'end', cell: (r) => r.sent },
  { key: 'failed', header: 'falhas', align: 'end', cell: (r) => r.failed },
  {
    key: 'blocked',
    header: 'bloqueios',
    align: 'end',
    cell: (r) => <span title={blockedTitle(r)}>{r.blocked}</span>,
  },
  { key: 'bounced', header: 'bounces', align: 'end', cell: (r) => r.bounced || '—' },
  { key: 'alert', header: '', align: 'end', className: 'w-24', cell: (r) => <HealthChip r={r} /> },
];

function ChannelHealthPanel() {
  const q = useChannelHealth();
  return (
    <Panel flush>
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <LoadingRows rows={2} className="p-3" />
      ) : (
        <DataList
          rows={q.data.channels}
          rowKey={(r) => r.channel}
          columns={COLUMNS}
          empty={<EmptyState title="sem canais" />}
          mobileRow={(r) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{r.channel}</span>
                <span className="ml-auto">
                  <HealthChip r={r} />
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tnum">
                <span>{r.sent} enviadas</span>
                <span>{r.failed} falhas</span>
                <span title={blockedTitle(r)}>{r.blocked} bloqueios</span>
                <span>{r.bounced || '—'} bounces</span>
              </div>
            </div>
          )}
        />
      )}
    </Panel>
  );
}

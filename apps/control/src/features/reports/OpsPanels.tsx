import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type AgentMetrics, type ChannelHealth, type SegmentStat } from '@/lib/api.ts';
import { fmtUsd, fmtUsdCents } from '@/lib/format.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { qk } from '@/lib/query.ts';
import { cn } from '@/lib/cn.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented, Tooltip } from '@/components/ui/controls.tsx';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'warn' | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <span
        className={cn(
          'text-lg leading-tight font-medium tnum',
          tone === 'warn' && 'text-warning-foreground',
        )}
      >
        {value}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

type Kind = AgentMetrics['byKind'][number];
const KIND_COLS: Column<Kind>[] = [
  { key: 'kind', header: 'tipo', cell: (k) => RUN_KIND_LABEL[k.kind] ?? k.kind },
  { key: 'runs', header: 'runs', align: 'end', cell: (k) => k.runs },
  { key: 'done', header: 'feitos', align: 'end', cell: (k) => k.done },
  { key: 'failed', header: 'falhas', align: 'end', cell: (k) => k.failed || '—' },
  { key: 'canceled', header: 'cancel.', align: 'end', cell: (k) => k.canceled || '—' },
  { key: 'acted', header: 'agiu', align: 'end', cell: (k) => (k.done ? pct(k.actedRate) : '—') },
  { key: 'steps', header: 'passos', align: 'end', cell: (k) => k.avgSteps || '—' },
  { key: 'cost', header: 'custo', align: 'end', cell: (k) => fmtUsd(k.costUsd) },
];

/** Agent ops readout (old Runs "leitura") — the 7|30d toggle is scoped to this panel. */
export function AgentMetricsPanel({ days, onDays }: { days: 7 | 30; onDays: (d: 7 | 30) => void }) {
  const q = useQuery({
    queryKey: qk.agentMetrics(days),
    queryFn: () => api.agentMetrics(days),
    placeholderData: (prev) => prev,
  });
  const m = q.data;
  const totalRuns = m?.byKind.reduce((a, k) => a + k.runs, 0) ?? 0;
  const totalDone = m?.byKind.reduce((a, k) => a + k.done, 0) ?? 0;
  const acted = m?.byKind.reduce((a, k) => a + Math.round(k.actedRate * k.done), 0) ?? 0;
  const cost = m?.byKind.reduce((a, k) => a + k.costUsd, 0) ?? 0;
  const empty =
    !!m &&
    totalRuns === 0 &&
    !m.outbound.sent &&
    !m.outbound.drafted &&
    !m.outbound.rejected &&
    !m.replies.leadsContacted &&
    !(m.wakeups?.pending || m.wakeups?.fired);
  const kinds = m?.byKind.filter((k) => k.runs > 0) ?? [];

  return (
    <Panel
      title="agente"
      aside="leitura operacional"
      flush
      actions={
        <Segmented
          size="sm"
          value={String(days) as '7' | '30'}
          onChange={(v) => onDays(v === '30' ? 30 : 7)}
          options={[
            ['7', '7d'],
            ['30', '30d'],
          ]}
        />
      }
    >
      {q.isError && !m ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !m ? (
        <LoadingRows rows={3} className="p-3" />
      ) : empty ? (
        <p className="p-3 text-sm text-muted-foreground">
          nenhum run no período — o agente ainda não trabalhou
        </p>
      ) : (
        <div className={cn('transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label={`runs feitos · ${totalRuns} total`} value={totalDone} />
            <Stat label="agiram" value={totalDone ? pct(acted / totalDone) : '—'} />
            <Stat
              label="rascunhos p/ aprovar"
              value={m.outbound.drafted}
              tone={m.outbound.drafted ? 'warn' : undefined}
            />
            <Stat
              label={`responderam · ${m.replies.leadsReplied}/${m.replies.leadsContacted}`}
              value={m.replies.leadsContacted ? pct(m.replies.replyRate) : '—'}
            />
            <Stat label="custo" value={fmtUsd(cost)} />
            {m.wakeups && (
              <Stat
                label={`wakeups pendentes · ${m.wakeups.fired} disparados`}
                value={m.wakeups.pending}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              enviadas <b className="font-medium text-foreground tnum">{m.outbound.sent}</b>
            </span>
            <span>
              aprovadas <b className="font-medium text-foreground tnum">{m.outbound.approved}</b>
            </span>
            <span>
              rejeitadas <b className="font-medium text-foreground tnum">{m.outbound.rejected}</b>
            </span>
          </div>
          {kinds.length > 0 && (
            <DataList
              className="border-t"
              rows={kinds}
              rowKey={(k) => k.kind}
              columns={KIND_COLS}
              mobileRow={(k) => (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{RUN_KIND_LABEL[k.kind] ?? k.kind}</span>
                    <span className="tnum">{fmtUsd(k.costUsd)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground tnum">
                    {k.done}/{k.runs} feitos
                    {k.failed ? ` · ${k.failed} falhas` : ''}
                    {k.canceled ? ` · ${k.canceled} cancel.` : ''} · agiu{' '}
                    {k.done ? pct(k.actedRate) : '—'} · {k.avgSteps || '—'} passos
                  </div>
                </div>
              )}
            />
          )}
        </div>
      )}
    </Panel>
  );
}

const SEG_COLS: Column<SegmentStat>[] = [
  { key: 'segment', header: 'segmento', cell: (s) => s.segment },
  { key: 'leads', header: 'leads', align: 'end', cell: (s) => s.leads },
  { key: 'contacted', header: 'contatados', align: 'end', cell: (s) => s.contacted },
  {
    key: 'replied',
    header: 'responderam',
    align: 'end',
    cell: (s) => (
      <>
        {s.replied}
        {s.contacted > 0 && (
          <span className="text-muted-foreground">
            {' '}
            · {Math.round((s.replied / s.contacted) * 100)}%
          </span>
        )}
      </>
    ),
  },
  { key: 'live', header: 'ativos', align: 'end', cell: (s) => s.live },
  { key: 'cost', header: 'custo 30d', align: 'end', cell: (s) => fmtUsdCents(s.costCents) },
  {
    key: 'cpl',
    header: (
      <Tooltip content="custo 30d ÷ leads novos 30d">
        <span className="underline decoration-dotted underline-offset-2">cpl</span>
      </Tooltip>
    ),
    align: 'end',
    cell: (s) => (s.cplCents == null ? '—' : fmtUsdCents(s.cplCents)),
  },
];

export function SegmentsPanel() {
  const q = useQuery({ queryKey: qk.segments(), queryFn: api.segments });
  const rows = q.data?.segments ?? [];
  return (
    <Panel
      title="segmentos"
      aside="conversão e custo por lead"
      flush
      actions={
        <Link
          to="/agente/descoberta"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          descoberta →
        </Link>
      }
    >
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataList
          rows={rows}
          rowKey={(s) => s.segment}
          loading={q.isPending}
          columns={SEG_COLS}
          empty={<p className="p-3 text-sm text-muted-foreground">sem segmentos ainda</p>}
          mobileRow={(s) => (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{s.segment}</span>
                <span className="text-xs text-muted-foreground tnum">
                  cpl {s.cplCents == null ? '—' : fmtUsdCents(s.cplCents)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground tnum">
                {s.leads} leads · {s.contacted} contatados · {s.replied} responderam
                {s.contacted > 0 && ` (${Math.round((s.replied / s.contacted) * 100)}%)`} · {s.live}{' '}
                ativos · {fmtUsdCents(s.costCents)}
              </div>
            </div>
          )}
        />
      )}
    </Panel>
  );
}

const blockedTitle = (r: ChannelHealth) =>
  Object.entries(r.blockedByReason)
    .map(([reason, n]) => `${reason}: ${n}`)
    .join('\n');

const HealthChip = ({ r }: { r: ChannelHealth }) =>
  r.alert ? (
    <Badge variant="bad">falha {Math.round((r.failureRate ?? 0) * 100)}%</Badge>
  ) : (
    <Badge>ok</Badge>
  );

const HEALTH_COLS: Column<ChannelHealth>[] = [
  { key: 'channel', header: 'canal', cell: (r) => r.channel },
  { key: 'sent', header: 'enviadas', align: 'end', cell: (r) => r.sent },
  { key: 'failed', header: 'falhas', align: 'end', cell: (r) => r.failed },
  {
    key: 'blocked',
    header: 'bloqueios',
    align: 'end',
    cell: (r) => <span title={blockedTitle(r)}>{r.blocked}</span>,
  },
  { key: 'bounced', header: 'bounces', align: 'end', cell: (r) => r.bounced || '—' },
  { key: 'alert', header: '', align: 'end', cell: (r) => <HealthChip r={r} /> },
];

/** 30d channel rollup; alert = failureRate ≥20% on ≥5 sends — advisory only, never pauses sends. */
export function ChannelHealthPanel() {
  const q = useQuery({ queryKey: qk.channelHealth(), queryFn: api.channelHealth });
  const rows = q.data?.channels ?? [];
  return (
    <Panel title="saúde dos canais" aside="30 dias" flush>
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataList
          rows={rows}
          rowKey={(r) => r.channel}
          loading={q.isPending}
          columns={HEALTH_COLS}
          empty={<p className="p-3 text-sm text-muted-foreground">sem canais</p>}
          mobileRow={(r) => (
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{r.channel}</span>
                <span className="text-xs text-muted-foreground tnum">
                  {r.sent} enviadas · {r.failed} falhas · {r.blocked} bloqueios
                  {r.bounced ? ` · ${r.bounced} bounces` : ''}
                </span>
                {r.blocked > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {blockedTitle(r).replace(/\n/g, ' · ')}
                  </span>
                )}
              </div>
              <HealthChip r={r} />
            </div>
          )}
        />
      )}
    </Panel>
  );
}

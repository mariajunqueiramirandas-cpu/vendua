import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Wakeup } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, isLate, relDue } from '@/lib/format.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { ConfirmButton, EmptyState } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { AreaIntro, EndpointState } from './bits.tsx';
import { RoutinesPanel } from './RoutinesPanel.tsx';

const FILTERS = [
  { key: 'pending', label: 'pendentes', empty: 'nada agendado' },
  { key: 'fired', label: 'disparados', empty: 'nada disparado' },
  { key: 'canceled', label: 'cancelados', empty: 'nada cancelado' },
  { key: 'all', label: 'todos', empty: 'nada por aqui' },
] as const;
type Filter = (typeof FILTERS)[number]['key'];

const PAGE = 500; // server cap — beyond this we say so, no silent tail

export function AgendaArea({ active }: { active: boolean }) {
  const [sp, setSp] = useSearchParams();
  const status: Filter = FILTERS.find((f) => f.key === sp.get('f'))?.key ?? 'pending';
  const setStatus = (f: Filter) => {
    const next = new URLSearchParams(sp);
    if (f === 'pending') next.delete('f');
    else next.set('f', f);
    setSp(next, { replace: true });
  };

  const qc = useQueryClient();
  // per-status keys: switching filters never flashes the other set's rows
  const q = useQuery({
    queryKey: qk.wakeups({ status, limit: String(PAGE) }),
    queryFn: () => api.wakeups({ status, limit: String(PAGE) }),
    select: (r) => r.wakeups,
    enabled: active,
  });
  const cancel = useMutation({
    mutationFn: api.cancelWakeup,
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.wakeups() }),
    onError: (e) => toast.error(`agenda: ${errorMessage(e)}`),
  });

  const lead = (w: Wakeup) =>
    w.leadId ? (
      <Link to={`/pipeline/${w.leadId}`} className="font-medium hover:underline">
        {w.leadName ?? w.leadId.slice(0, 8)}
      </Link>
    ) : (
      <span>{w.leadName ?? '—'}</span>
    );
  const due = (w: Wakeup) => (
    <span
      className={cn(
        'tnum',
        w.status === 'pending' && isLate(w.at) && 'font-medium text-destructive-foreground',
      )}
    >
      {relDue(w.at)}
    </span>
  );
  const origin = (w: Wakeup) => (
    <span className="inline-flex items-center gap-1.5">
      {w.createdBy === 'staff' ? 'equipe' : w.requested ? 'lead' : 'agente'}
      {(w.requested || w.createdBy === 'staff') && <Badge variant="agent">promessa</Badge>}
    </span>
  );
  const action = (w: Wakeup) =>
    w.status === 'pending' && (
      <ConfirmButton
        size="sm"
        confirm="desmarcar?"
        disabled={cancel.isPending && cancel.variables === w.id}
        onConfirm={() => cancel.mutate(w.id)}
      >
        cancelar
      </ConfirmButton>
    );

  const columns: Column<Wakeup>[] = [
    {
      key: 'at',
      header: 'quando',
      className: 'w-36 whitespace-nowrap',
      cell: (w) => (
        <div className="flex flex-col leading-tight">
          {due(w)}
          <span className="text-[11px] text-muted-foreground tnum">{fmtDateTime(w.at)}</span>
        </div>
      ),
    },
    { key: 'lead', header: 'lead', className: 'w-48', cell: lead },
    {
      key: 'kind',
      header: 'tipo',
      className: 'w-28',
      cell: (w) => <Badge>{RUN_KIND_LABEL[w.kind] ?? w.kind}</Badge>,
    },
    {
      key: 'focus',
      header: 'foco',
      cell: (w) => (
        <div className="min-w-48">
          <p className="line-clamp-2">{w.focus}</p>
          {w.status === 'canceled' && w.cancelReason && (
            <p className="text-xs text-muted-foreground">motivo: {w.cancelReason}</p>
          )}
        </div>
      ),
    },
    { key: 'origin', header: 'origem', className: 'w-32 whitespace-nowrap', cell: origin },
    { key: 'act', header: '', align: 'end', className: 'w-28', cell: (w) => action(w) },
  ];

  const empty = FILTERS.find((f) => f.key === status)?.empty ?? 'nada por aqui';
  const rows = q.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <RoutinesPanel active={active} />
      <div>
        <AreaIntro
          aside={
            <Segmented
              size="sm"
              value={status}
              onChange={setStatus}
              options={FILTERS.map((f) => [f.key, f.label] as const)}
            />
          }
        >
          tudo que o agente vai fazer depois — follow-ups dele, retornos que o lead pediu e datas da
          equipe; cancelar aqui desmarca
        </AreaIntro>
        {q.error ? (
          <EndpointState
            title="agenda do agente"
            error={q.error}
            missing="GET /agent/wakeups ainda não chegou neste servidor — os retornos que o agente marca com a tool `schedule` vão aparecer aqui, com cancelamento."
            onRetry={() => void q.refetch()}
          />
        ) : (
          <Card className="overflow-hidden">
            <DataList
              rows={rows}
              rowKey={(w) => w.id}
              loading={q.isPending}
              columns={columns}
              empty={
                <EmptyState
                  icon={CalendarClock}
                  title={empty}
                  hint="follow-ups, retornos pedidos e datas marcadas no lead aparecem aqui"
                />
              }
              mobileRow={(w) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    {due(w)}
                    <span className="min-w-0 truncate">{lead(w)}</span>
                    <Badge className="ml-auto">{RUN_KIND_LABEL[w.kind] ?? w.kind}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{w.focus}</p>
                  {w.status === 'canceled' && w.cancelReason && (
                    <p className="text-xs text-muted-foreground">motivo: {w.cancelReason}</p>
                  )}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tnum">{fmtDateTime(w.at)}</span>·{origin(w)}
                    <span className="ml-auto">{action(w)}</span>
                  </div>
                </div>
              )}
            />
            {rows.length === PAGE && (
              <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                mostrando os {PAGE} primeiros — a lista corta aqui; cancele pelo painel do lead pros
                que ficaram de fora
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

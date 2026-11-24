import { useQuery } from '@tanstack/react-query';
import { ApiError, api, type Routine } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, rel, relDue } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { SectionHead } from './bits.tsx';

type Health = 'ok' | 'failing' | 'off' | 'idle';

const health = (r: Routine): Health =>
  !r.enabled ? 'off' : r.lastOk === false ? 'failing' : r.lastOk === null ? 'idle' : 'ok';

const DOT: Record<Health, string> = {
  ok: 'bg-agent',
  failing: 'bg-destructive',
  off: 'bg-border-strong',
  idle: 'bg-border-strong',
};

/** The scheduler's routines — what runs by itself, when, and whether it's healthy. */
export function RoutinesPanel({ active }: { active: boolean }) {
  const q = useQuery({
    queryKey: qk.routines(),
    queryFn: api.routines,
    select: (r) => r.routines,
    enabled: active,
    refetchInterval: active ? 30_000 : false,
  });
  const failing = q.data?.filter((r) => health(r) === 'failing').length ?? 0;
  const notHere = q.error instanceof ApiError && q.error.status === 404;

  const statusBadge = q.data ? (
    failing ? (
      <Badge variant="bad">{failing} falhando</Badge>
    ) : (
      <Badge variant="agent">tudo em dia</Badge>
    )
  ) : q.error ? (
    <Badge variant={notHere ? 'outline' : 'warn'}>
      {notHere ? 'indisponível' : 'falha ao ler'}
    </Badge>
  ) : undefined;

  return (
    <section>
      <SectionHead
        title="rotinas automáticas"
        sub="jobs do agendador — Telegram, reuniões, foto do funil e descoberta"
        aside={statusBadge}
      />
      <Panel flush>
        {q.data ? (
          <ul className="divide-y">
            {q.data.map((r) => (
              <RoutineRow key={r.name} r={r} />
            ))}
          </ul>
        ) : !q.error ? (
          <LoadingRows rows={4} className="p-3" />
        ) : notHere ? (
          <p className="p-3 text-xs text-muted-foreground">
            GET /agent/routines ainda não chegou neste servidor.
          </p>
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} className="py-4" />
        )}
      </Panel>
    </section>
  );
}

function RoutineRow({ r }: { r: Routine }) {
  const h = health(r);
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 md:flex-row md:items-center md:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[h])} />
        <div className="flex min-w-0 flex-col">
          <span className={cn('text-sm', h === 'off' && 'text-muted-foreground')}>{r.label}</span>
          <span className="text-xs text-muted-foreground">
            {r.cadence}
            {h === 'off' && ' · desligada'}
          </span>
          {h === 'failing' && (
            <span className="text-xs break-words text-destructive-foreground">
              falhando{r.failingSince ? ` desde ${fmtDateTime(r.failingSince)}` : ''}
              {r.lastError ? ` — ${r.lastError}` : ''}
            </span>
          )}
        </div>
      </div>
      <dl className="flex shrink-0 gap-4 pl-4.5 text-xs text-muted-foreground md:pl-0">
        <div className="flex gap-1">
          <dt>última</dt>
          <dd
            className="tnum text-foreground"
            title={r.lastFinishedAt ? fmtDateTime(r.lastFinishedAt) : undefined}
          >
            {r.lastFinishedAt ? rel(r.lastFinishedAt) : 'nunca'}
          </dd>
        </div>
        {r.nextAt && h !== 'off' && (
          <div className="flex gap-1">
            <dt>próxima</dt>
            <dd className="tnum text-foreground" title={fmtDateTime(r.nextAt)}>
              {relDue(r.nextAt)}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

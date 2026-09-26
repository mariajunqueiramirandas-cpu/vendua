import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, fmtUsdCents, isLate, rel, relDue } from '@/lib/format.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { errorMessage } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useLeadWakeups, useRecentRuns, useScheduledRuns } from '../queries.ts';
import { Hint, Row, Section } from '../Section.tsx';
import { FetchErr, isMissing } from './shared.tsx';

const RUN_VARIANT: Record<string, 'warn' | 'bad' | 'default'> = {
  queued: 'warn',
  running: 'warn',
  failed: 'bad',
  canceled: 'bad',
};

function Due({ at, full }: { at: string; full?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 text-xs whitespace-nowrap text-muted-foreground tnum',
        isLate(at) && 'font-medium text-destructive-foreground',
      )}
      title={fmtDateTime(at)}
    >
      {relDue(at)}
      {full && ` · ${fmtDateTime(at)}`}
    </span>
  );
}

function CancelButton({
  onClick,
  busy,
  title,
}: {
  onClick: () => void;
  busy: boolean;
  title: string;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={onClick}
    >
      <X />
    </Button>
  );
}

/** What's queued next for this lead: next action, scheduled runs, pending wakeups. */
export function AgentAgenda({ lead }: { lead: LeadListItem }) {
  const client = useQueryClient();
  const sched = useScheduledRuns(lead.id);
  const wake = useLeadWakeups(lead.id);
  const cancelRun = useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['runs'] }),
  });
  const cancelWake = useMutation({
    mutationFn: (id: string) => api.cancelWakeup(id),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['wakeups'] }),
  });
  const runs = sched.data ?? [];
  const wakeups = wake.data ?? [];
  const empty = !lead.nextActionAt && !runs.length && wake.isSuccess && !wakeups.length;

  return (
    <Section title="agenda">
      {/* next_action_at mirrors the earliest agenda entry — shown only when the entries aren't */}
      {lead.nextActionAt && !wakeups.length && (
        <Row>
          <Badge>próxima ação</Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            próximo passo marcado para este lead
          </span>
          <Due at={lead.nextActionAt} full />
        </Row>
      )}
      {runs.map((r) => (
        <Row key={r.id}>
          <Badge>{RUN_KIND_LABEL[r.kind] ?? r.kind}</Badge>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            run na fila · agenda {fmtDateTime(r.run_at)}
          </span>
          <CancelButton
            title="cancelar run"
            busy={cancelRun.isPending && cancelRun.variables === r.id}
            onClick={() => cancelRun.mutate(r.id)}
          />
        </Row>
      ))}
      {wakeups.map((w) => (
        <Row key={w.id} className="items-start py-1">
          <Badge variant="agent-soft" className="mt-0.5">
            {RUN_KIND_LABEL[w.kind] ?? w.kind}
          </Badge>
          <div className="min-w-0 flex-1">
            <p className="text-sm [overflow-wrap:anywhere]">{w.focus || 'foco livre'}</p>
            <p className="text-xs text-muted-foreground">
              {w.requested
                ? 'pedido do lead'
                : w.createdBy === 'staff'
                  ? 'agendado pela equipe'
                  : 'agendado pelo agente'}{' '}
              · {fmtDateTime(w.at)}
            </p>
          </div>
          <Due at={w.at} />
          <CancelButton
            title="cancelar este despertar"
            busy={cancelWake.isPending && cancelWake.variables === w.id}
            onClick={() => cancelWake.mutate(w.id)}
          />
        </Row>
      ))}
      {wake.error && isMissing(wake.error) && <Hint>despertares ainda não expostos pela API</Hint>}
      {wake.error && !isMissing(wake.error) && (
        <FetchErr what="os despertares" retry={() => void wake.refetch()} />
      )}
      {empty && (
        <Hint>nada agendado — follow-ups, retornos pedidos e datas da equipe aparecem aqui</Hint>
      )}
    </Section>
  );
}

export function AgentRuns({ leadId }: { leadId: string }) {
  const { data: runs = [], isPending } = useRecentRuns(leadId);
  return (
    <Section
      title="runs"
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link to="/agente/atividade">
            todos <ArrowRight />
          </Link>
        </Button>
      }
    >
      {runs.map((r) => (
        <Row key={r.id}>
          <Link
            to={`/agente/atividade/${r.id}`}
            className="font-mono text-xs underline-offset-2 hover:underline"
          >
            {r.id.slice(0, 8)}
          </Link>
          <Badge>{RUN_KIND_LABEL[r.kind] ?? r.kind}</Badge>
          <Badge variant={RUN_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
          <span className="flex-1" />
          <span className="text-xs text-muted-foreground tnum">{fmtUsdCents(r.cost_cents)}</span>
          <span className="w-8 text-right text-xs text-muted-foreground tnum">
            {rel(r.created_at)}
          </span>
        </Row>
      ))}
      {!runs.length && !isPending && <Hint>nenhum run neste lead ainda</Hint>}
    </Section>
  );
}

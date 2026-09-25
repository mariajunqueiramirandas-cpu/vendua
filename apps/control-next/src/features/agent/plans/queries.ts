import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type AgentRun, type LeadListItem, type Wakeup } from '@/lib/api.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';

// `pages: 'all'` never reaches the API — it keys these cursor-walked arrays
// apart from single-page qk.leads/qk.runs entries of another shape.

/** Every lead — follows the keyset cursor; a partial page would silently hide plans. */
export const useAllLeads = () =>
  useQuery({
    queryKey: qk.leads({ limit: '200', pages: 'all' }),
    queryFn: async () => {
      const all: LeadListItem[] = [];
      let cursor: string | undefined;
      do {
        const r = await api.leads({ limit: '200', ...(cursor ? { cursor } : {}) });
        all.push(...r.leads);
        cursor = r.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
  });

/** Every delayed run (scheduled=1 → run_at asc + keyset cursor), lead-bound only. */
export const useScheduledRuns = () =>
  useQuery({
    queryKey: qk.runs({ status: 'queued', scheduled: '1', pages: 'all' }),
    queryFn: async () => {
      const all: AgentRun[] = [];
      let cursor: string | undefined;
      do {
        const r = await api.runs({
          status: 'queued',
          scheduled: '1',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        });
        all.push(...r.runs);
        cursor = r.nextCursor || undefined;
      } while (cursor);
      return all.filter((x) => x.lead_id);
    },
  });

export const usePendingWakeups = () =>
  useQuery({
    queryKey: qk.wakeups({ status: 'pending', limit: '200' }),
    queryFn: () => api.wakeups({ status: 'pending', limit: '200' }).then((r) => r.wakeups),
  });

export function useCancelWakeup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelWakeup(id),
    onSuccess: () => toast.success('wakeup cancelado'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void client.invalidateQueries({ queryKey: ['wakeups'] }),
  });
}

export interface QueueItem {
  key: string;
  at: string;
  what: string;
  detail: string | null;
  leadId: string | null;
  leadName: string | null;
  late: boolean;
  wakeupId: string | null;
}

/** Mirrors claimRun's suppression predicate — only work the worker can claim shows. */
export const isLive = (l: LeadListItem | undefined) =>
  !!l && l.agentMode !== 'off' && !l.archivedAt && !l.unsubscribedAt && !l.agentPausedAt;

export function buildQueue(
  leads: LeadListItem[],
  runs: AgentRun[],
  wakeups: Wakeup[],
  now: number,
): QueueItem[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const live = (id: string) => isLive(byId.get(id));
  const late = (at: string) => new Date(at).getTime() <= now;
  return [
    ...runs
      // thread-bound runs also hold on a staff pause — the part of claimRun's gate live() can't see
      .filter((r) => live(r.lead_id!) && r.thread_agent_enabled !== false && r.run_at)
      .map((r) => ({
        key: `run:${r.id}`,
        at: r.run_at!,
        what: `run ${RUN_KIND_LABEL[r.kind] ?? r.kind}`,
        detail: null,
        leadId: r.lead_id,
        leadName: byId.get(r.lead_id!)?.name ?? r.lead_name ?? 'lead',
        late: late(r.run_at!),
        wakeupId: null,
      })),
    ...leads
      .filter((l) => isLive(l) && l.nextActionAt)
      .map((l) => ({
        key: `lead:${l.id}`,
        at: l.nextActionAt!,
        what: 'follow-up do agente',
        detail: null,
        leadId: l.id,
        leadName: l.name,
        late: late(l.nextActionAt!),
        wakeupId: null,
      })),
    // a wakeup fires into a run, which the same gate then holds — hide it when the lead is off
    ...wakeups
      .filter((w) => !w.leadId || live(w.leadId))
      .map((w) => ({
        key: `wakeup:${w.id}`,
        at: w.at,
        what: `wakeup ${RUN_KIND_LABEL[w.kind] ?? w.kind}`,
        detail: w.focus || null,
        leadId: w.leadId,
        leadName: w.leadId ? (byId.get(w.leadId)?.name ?? w.leadName ?? 'lead') : null,
        late: late(w.at),
        wakeupId: w.id,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** A skipped step counts as resolved, not pending. */
export const planProgress = (l: LeadListItem) => {
  const total = l.agentPlan.length;
  const resolved = l.agentPlan.filter((s) => s.status !== 'todo').length;
  return { total, resolved, ratio: total ? resolved / total : 0 };
};

/** Countdown to fire: T− until, T+ once overdue. */
export function tMinus(at: string, now: number): string {
  const d = new Date(at).getTime() - now;
  const m = Math.abs(Math.round(d / 60000));
  const v =
    m >= 1440
      ? `${Math.floor(m / 1440)}d${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}h`
      : m >= 60
        ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
        : `${m}m`;
  return d <= 0 ? `T+${v}` : `T−${v}`;
}

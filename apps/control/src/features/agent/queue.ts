import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type AgentRun, type LeadListItem, type Wakeup } from '@/lib/api.ts';
import { RUN_KIND_LABEL, TRIGGER_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';

// `pages: 'all'` never reaches the API — it keys cursor-walked arrays
// apart from single-page qk.leads / qk.runs entries of another shape.

/** Every lead — follows the keyset cursor so deep lists never hide plans or queue entries. */
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

/** Every delayed queued run (scheduled=1 → run_at asc). */
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
      return all;
    },
  });

/** Currently running turns across the workspace (pinned above the upcoming queue). */
export const useRunningRuns = () =>
  useQuery({
    queryKey: qk.runs({ status: 'running', limit: '20' }),
    queryFn: () => api.runs({ status: 'running', limit: '20' }),
    select: (r) => r.runs,
  });

export const useWakeups = (status: 'pending' | 'fired', limit = 200, enabled = true) =>
  useQuery({
    queryKey: qk.wakeups({ status, limit: String(limit) }),
    queryFn: () => api.wakeups({ status, limit: String(limit) }),
    select: (r) => r.wakeups,
    enabled,
  });

export function useCancelWakeup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelWakeup(id),
    onSuccess: () => toast.success('retorno cancelado'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['wakeups'] });
      void client.invalidateQueries({ queryKey: ['runs'] });
      void client.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export interface QueueItem {
  key: string;
  at: string;
  kind: string;
  what: string;
  detail: string | null;
  leadId: string | null;
  leadName: string | null;
  origin: 'lead' | 'staff' | 'agent';
  promised: boolean;
  late: boolean;
  cancel: { kind: 'wakeup' | 'run'; id: string } | null;
}

export const isSuppressed = (l: LeadListItem | undefined) =>
  !!l && (!!l.archivedAt || !!l.unsubscribedAt);

/** Mirrors claimRun's suppression predicate — automated follow-ups only run on live leads. */
export const isLive = (l: LeadListItem | undefined) =>
  !!l && l.agentMode !== 'off' && !l.archivedAt && !l.unsubscribedAt && !l.agentPausedAt;

/**
 * Deduplicated upcoming work for the agent.
 *
 * In Runtime v3, a scheduled follow-up or callback is ONE `agent_mailbox` row that Core
 * surfaces via `/agent/wakeups`, via `/runs?status=queued&scheduled=1` (same UUID), and
 * mirrored onto `leads.nextActionAt`. We prefer the wakeup (which carries `focus`, `requested`
 * and `createdBy`), keep only distinct non-timer scheduled runs (e.g. delayed inbound replies
 * or first-contact delays), and use `nextActionAt` only as a legacy fallback.
 */
export function buildQueue(
  leads: readonly LeadListItem[],
  runs: readonly AgentRun[],
  wakeups: readonly Wakeup[],
  now: number,
): QueueItem[] {
  const byId = new Map(leads.map((l) => [l.id, l]));
  const wakeupIds = new Set<string>();
  const coveredLeads = new Set<string>();
  const late = (at: string) => new Date(at).getTime() <= now;
  const out: QueueItem[] = [];

  for (const w of wakeups) {
    wakeupIds.add(w.id);
    const promised = w.requested || w.createdBy === 'staff';
    const lead = w.leadId ? byId.get(w.leadId) : undefined;
    if (lead && isSuppressed(lead)) continue;
    // Promised callbacks (requested by lead or booked by staff) survive pause/preset;
    // automated follow-ups are parked when the lead is off or paused.
    if (lead && !promised && !isLive(lead)) continue;
    if (w.leadId) coveredLeads.add(w.leadId);
    out.push({
      key: `wakeup:${w.id}`,
      at: w.at,
      kind: w.kind,
      what: w.requested
        ? 'retorno pedido'
        : w.createdBy === 'staff'
          ? 'retorno marcado'
          : 'follow-up',
      detail: w.focus || null,
      leadId: w.leadId,
      leadName: w.leadId ? (lead?.name ?? w.leadName ?? 'lead') : null,
      origin: w.createdBy === 'staff' ? 'staff' : w.requested ? 'lead' : 'agent',
      promised,
      late: late(w.at),
      cancel: { kind: 'wakeup', id: w.id },
    });
  }

  for (const r of runs) {
    if (wakeupIds.has(r.id) || !r.run_at) continue;
    const promised = r.promised === true;
    const lead = r.lead_id ? byId.get(r.lead_id) : undefined;
    if (lead && isSuppressed(lead)) continue;
    if (lead && !promised && !isLive(lead)) continue;
    if (r.thread_agent_enabled === false) continue;
    if (r.lead_id) coveredLeads.add(r.lead_id);
    const what = (r.source && TRIGGER_LABEL[r.source]) || RUN_KIND_LABEL[r.kind] || r.kind;
    out.push({
      key: `run:${r.id}`,
      at: r.run_at,
      kind: r.kind,
      what,
      detail: null,
      leadId: r.lead_id,
      leadName: r.lead_id ? (lead?.name ?? r.lead_name ?? 'lead') : null,
      origin: r.source === 'staff' ? 'staff' : r.source === 'callback' ? 'lead' : 'agent',
      promised,
      late: late(r.run_at),
      cancel: { kind: 'run', id: r.id },
    });
  }

  for (const l of leads) {
    if (!l.nextActionAt || coveredLeads.has(l.id) || !isLive(l)) continue;
    out.push({
      key: `lead:${l.id}`,
      at: l.nextActionAt,
      kind: 'outreach',
      what: 'retorno agendado',
      detail: null,
      leadId: l.id,
      leadName: l.name,
      origin: 'agent',
      promised: false,
      late: late(l.nextActionAt),
      cancel: null,
    });
  }

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Deduplicates a single lead's pending timers vs delayed runs vs mirrored nextActionAt. */
export function dedupeLeadSchedule(
  lead: Pick<LeadListItem, 'nextActionAt'>,
  runs: readonly AgentRun[],
  wakeups: readonly Wakeup[],
) {
  const wakeupIds = new Set(wakeups.map((w) => w.id));
  const extraRuns = runs.filter((r) => !wakeupIds.has(r.id));
  const fallbackNextActionAt =
    lead.nextActionAt && wakeups.length === 0 && extraRuns.length === 0 ? lead.nextActionAt : null;
  return { wakeups, extraRuns, fallbackNextActionAt };
}

/** Progress counts completed, applicable milestones. */
export const planProgress = (l: Pick<LeadListItem, 'agentPlan'>) => {
  const total = l.agentPlan.filter((s) => s.status !== 'skip').length;
  const resolved = l.agentPlan.filter((s) => s.status === 'done').length;
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

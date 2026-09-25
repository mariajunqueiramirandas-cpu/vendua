import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type AgentRun, type LeadListItem, type Task } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export type LeadPatch = Record<string, unknown>;

export const meetingsKey = (leadId: string) => qk.meetings({ leadId, scope: 'all' });
export const tasksKey = (leadId: string) => qk.tasks({ leadId });
export const wakeupsKey = (leadId: string) => qk.wakeups({ lead_id: leadId, status: 'pending' });
const schedRunsKey = (leadId: string) =>
  qk.runs({ lead_id: leadId, status: 'queued', scheduled: '1' });
const recentRunsKey = (leadId: string) => qk.runs({ lead_id: leadId, limit: '6' });

export const useLead = (id: string) =>
  useQuery({ queryKey: qk.lead(id), queryFn: () => api.lead(id).then((r) => r.lead) });

export const useActivities = (id: string) =>
  useQuery({
    queryKey: qk.activities(id),
    queryFn: () => api.activities(id).then((r) => r.activities),
  });

export const useLeadThreads = (id: string) =>
  useQuery({
    queryKey: qk.leadThreads(id),
    queryFn: () => api.leadThreads(id).then((r) => r.threads),
  });

export const useLeadTasks = (id: string) =>
  useQuery({
    queryKey: tasksKey(id),
    queryFn: () => api.tasks({ leadId: id }).then((r) => r.tasks),
  });

export const useLeadMeetings = (id: string) =>
  useQuery({
    queryKey: meetingsKey(id),
    queryFn: () => api.meetings({ leadId: id, scope: 'all' }).then((r) => r.meetings),
  });

export const useLeadFacts = (id: string) =>
  useQuery({ queryKey: qk.leadFacts(id), queryFn: () => api.leadFacts(id).then((r) => r.facts) });

export const useLeadAutonomy = (id: string) =>
  useQuery({ queryKey: qk.leadAutonomy(id), queryFn: () => api.leadAutonomy(id) });

export const useLeadWakeups = (id: string) =>
  useQuery({
    queryKey: wakeupsKey(id),
    queryFn: () => api.wakeups({ lead_id: id, status: 'pending' }).then((r) => r.wakeups),
  });

// scheduled=1 → run_at asc + keyset cursor — walk every page so a deep queue can't hide follow-ups
async function allScheduledRuns(leadId: string, cursor?: string): Promise<AgentRun[]> {
  const r = await api.runs({
    lead_id: leadId,
    status: 'queued',
    scheduled: '1',
    limit: '200',
    ...(cursor ? { cursor } : {}),
  });
  return r.nextCursor ? [...r.runs, ...(await allScheduledRuns(leadId, r.nextCursor))] : r.runs;
}

export const useScheduledRuns = (id: string) =>
  useQuery({ queryKey: schedRunsKey(id), queryFn: () => allScheduledRuns(id) });

export const useRecentRuns = (id: string) =>
  useQuery({
    queryKey: recentRunsKey(id),
    queryFn: () => api.runs({ lead_id: id, limit: '6' }).then((r) => r.runs),
  });

/** Everything a lead write can ripple into (stage → activities, mode → autonomy, lists…). */
export function invalidateLead(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: qk.lead(id) });
  void client.invalidateQueries({ queryKey: qk.activities(id) });
  void client.invalidateQueries({ queryKey: qk.leadAutonomy(id) });
  void client.invalidateQueries({ queryKey: ['leads'] });
  void client.invalidateQueries({ queryKey: ['stats'] });
}

/** Map API patch fields onto the cached row so the UI moves before the server answers. */
function applyPatch(lead: LeadListItem, p: LeadPatch): LeadListItem {
  const next = { ...lead } as LeadListItem & Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'agentPaused') next.agentPausedAt = v ? new Date().toISOString() : null;
    else next[k] = v;
  }
  return next;
}

/** Optimistic PATCH /leads/:id — stage, inline fields, agent controls. */
export function usePatchLead(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (p: LeadPatch) => api.patchLead(id, p),
    onMutate: async (p) => {
      await client.cancelQueries({ queryKey: qk.lead(id) });
      const prev = client.getQueryData<LeadListItem>(qk.lead(id));
      if (prev) client.setQueryData(qk.lead(id), applyPatch(prev, p));
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.lead(id), ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => invalidateLead(client, id),
  });
}

export function useSetTaskDone(leadId: string) {
  const client = useQueryClient();
  const key = tasksKey(leadId);
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.setTaskDone(id, done),
    onMutate: async ({ id, done }) => {
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData<Task[]>(key);
      if (prev)
        client.setQueryData<Task[]>(
          key,
          prev.map((t) =>
            t.id === id ? { ...t, doneAt: done ? new Date().toISOString() : null } : t,
          ),
        );
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) client.setQueryData(key, ctx.prev);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
      void client.invalidateQueries({ queryKey: qk.lead(leadId) });
    },
  });
}

/** Opens the lead's thread on `channel`, creating it first when it doesn't exist. */
export function useOpenChannel(leadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (channel: 'whatsapp' | 'email' | 'manual') => {
      const threads =
        client.getQueryData<{ id: string; channel: string }[]>(qk.leadThreads(leadId)) ??
        (await api.leadThreads(leadId)).threads;
      const found = threads.find((t) => t.channel === channel);
      if (found) return found.id;
      const r = await api.newThread(leadId, channel);
      return r.thread.id;
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.leadThreads(leadId) });
      void client.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, type Task } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const OPEN_TASKS = { done: 'false' };

/** `all` includes done tasks (the old "incluir concluídas"). */
export function useTasks(all: boolean) {
  const params = all ? {} : OPEN_TASKS;
  return useQuery({
    queryKey: qk.tasks(params),
    queryFn: () => api.tasks(params),
    placeholderData: (prev) => prev,
  });
}

export function useSetTaskDone() {
  const qc = useQueryClient();
  const root = [qk.tasks()[0]];
  return useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api.setTaskDone(id, done),
    onMutate: async ({ id, done }) => {
      await qc.cancelQueries({ queryKey: root });
      const snap = qc.getQueriesData<{ tasks: Task[] }>({ queryKey: root });
      const doneAt = done ? new Date().toISOString() : null;
      qc.setQueriesData<{ tasks: Task[] }>({ queryKey: root }, (old) =>
        old ? { tasks: old.tasks.map((t) => (t.id === id ? { ...t, doneAt } : t)) } : old,
      );
      return { snap };
    },
    onError: (e, _v, ctx) => {
      for (const [key, data] of ctx?.snap ?? []) qc.setQueryData(key, data);
      toast.error(errorMessage(e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: root });
      void qc.invalidateQueries({ queryKey: qk.stats() });
    },
  });
}

export const useApprovals = () => useQuery({ queryKey: qk.approvals(), queryFn: api.approvals });

export const useThreads = () => useQuery({ queryKey: qk.threads(), queryFn: () => api.threads() });

export const usePendingWakeups = () =>
  useQuery({
    queryKey: qk.wakeups({ status: 'pending' }),
    queryFn: () => api.wakeups({ status: 'pending' }),
  });

/** Inline approve — same outcome messages as the old approvals screen. */
export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approve(id),
    onSuccess: (res) => {
      if (res.stale) toast.info('rascunho expirado — regenerando contra o estado atual');
      else if (res.sent?.ok) toast.success('enviado');
      else toast.error(`falhou: ${res.sent?.reason ?? 'desconhecido'}`);
    },
    // refusals keep the draft pending — surface why
    onError: (e) =>
      toast.error(
        e instanceof ApiError && e.code === 'LEAD_COST_CAP'
          ? 'falhou: rascunho expirado e lead acima do teto de custo — edite ou rejeite'
          : `falhou: ${errorMessage(e)}`,
      ),
    onSettled: () => {
      for (const k of [qk.approvals(), [qk.threads()[0]], qk.stats()])
        void qc.invalidateQueries({ queryKey: k });
    },
  });
}

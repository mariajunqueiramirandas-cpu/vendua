import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { STATUS_LABEL } from './bits.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTaskId = (id: string) => UUID.test(id);

/** A malformed id never reaches Core — the page says "não encontrada" for it directly. */
export const useSiteTask = (id: string) =>
  useQuery({
    queryKey: qk.siteTask(id),
    queryFn: () => api.siteTask(id),
    enabled: isTaskId(id),
  });

export type SiteAction = 'approve' | 'retry' | 'human' | 'cancel';

const DONE: Record<SiteAction, string> = {
  approve: 'aprovado — o merge e a publicação seguem sozinhos',
  retry: 'de volta na fila, numa branch nova',
  human: 'a tarefa é da equipe agora',
  cancel: 'tarefa cancelada',
};

const CONFLICT: Record<string, string> = {
  SITE_TASK_NOT_GREEN: 'só um PR aberto com CI verde pode ser aprovado',
  SITE_TASK_BUSY: 'a tarefa mudou de estado — confira e tente de novo',
  SITE_TASK_DONE: 'a tarefa já terminou e não pode mais ser cancelada',
  SITE_ALREADY_BUILDING: 'o pedido já tem outra tarefa em andamento',
  SITE_REQUEST_OPEN: 'a loja já tem outro pedido de site aberto',
};

/** Core's 409/422 in pt-BR, with the state it found when it says so. */
export function actionError(e: unknown): string {
  if (e instanceof ApiError && (e.status === 409 || e.status === 422)) {
    const base = CONFLICT[e.code] ?? errorMessage(e);
    const now = e.details?.status;
    const label = typeof now === 'string' ? STATUS_LABEL[now as keyof typeof STATUS_LABEL] : null;
    return label ? `${base} (agora: ${label})` : base;
  }
  return errorMessage(e);
}

/** One staff action on a task. Errors stay on the mutation for the panel to show inline. */
export function useSiteAction(id: string) {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.siteTask(id) });
    void qc.invalidateQueries({ queryKey: qk.siteTasks('open') });
    void qc.invalidateQueries({ queryKey: qk.siteTasks('all') });
    void qc.invalidateQueries({ queryKey: qk.billingStores() });
  };
  return useMutation({
    mutationFn: (v: { action: SiteAction; reason?: string | undefined }) => {
      switch (v.action) {
        case 'approve':
          return api.approveSiteTask(id);
        case 'retry':
          return api.retrySiteTask(id);
        case 'human':
          return api.takeSiteTask(id);
        case 'cancel':
          return api.cancelSiteTask(id, v.reason ?? '');
      }
    },
    onSuccess: (_r, v) => toast.success(DONE[v.action]),
    // a 409 means the screen was stale: show the fresh state next to the message
    onSettled: refresh,
  });
}

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, type ThreadView } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

const INBOX_ROOTS = new Set(['threads', 'thread', 'approvals', 'stats', 'lead-threads', 'lead']);
const invalidateInbox = (client: QueryClient) =>
  client.invalidateQueries({ predicate: (q) => INBOX_ROOTS.has(String(q.queryKey[0])) });

export function useThreads(channel: string, q: string) {
  const params: Record<string, string> = {};
  if (channel) params.channel = channel;
  if (q) params.q = q;
  return useQuery({
    queryKey: qk.threads(params),
    queryFn: () => api.threads(params),
    placeholderData: (prev) => prev,
  });
}

export const useThread = (id: string | undefined) =>
  useQuery({
    queryKey: qk.thread(id ?? ''),
    queryFn: () => api.thread(id!),
    enabled: !!id,
  });

export const useApprovals = () => useQuery({ queryKey: qk.approvals(), queryFn: api.approvals });

/** What a draft needs for approve/edit/reject — shared by the queue rows and thread bubbles. */
export interface DraftRef {
  id: string;
  threadId: string;
  /** compose-time subject snapshot — an edit keeps the reviewed subject */
  subject: string | null;
}

export function useApproveDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.approve(id),
    onSuccess: (res) => {
      if (res.stale) toast('rascunho expirado — regenerando contra o estado atual');
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
    onSettled: () => invalidateInbox(client),
  });
}

export function useRejectDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reject(id),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => invalidateInbox(client),
  });
}

/** "salvar + aprovar": the edited text ships as a new draft; the original is rejected. */
export function useEditDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ draft, body }: { draft: DraftRef; body: string }) => {
      // create the replacement before rejecting the original, so a failed compose loses nothing
      let replacement: string;
      try {
        const res = await api.sendThreadMessage(
          draft.threadId,
          body,
          false,
          draft.subject ?? undefined,
        );
        replacement = res.message.id;
      } catch {
        throw new Error('falhou ao criar rascunho editado — original mantido');
      }
      try {
        await api.reject(draft.id);
      } catch {
        // both drafts pending would let the message go out twice — withdraw the replacement
        const undone = await api.reject(replacement).then(
          () => true,
          () => false,
        );
        throw new Error(
          undone
            ? 'falhou ao descartar o original — edição desfeita, nada foi enviado'
            : 'falhou ao descartar o original e ao desfazer a edição — há dois rascunhos na fila, descarte um',
        );
      }
      // "salvar + aprovar" sends the edited version — approve the replacement
      try {
        const res = await api.approve(replacement);
        return res.sent?.ok
          ? { ok: true, msg: 'enviado (editado)' }
          : { ok: false, msg: `salvo, falhou ao enviar: ${res.sent?.reason ?? 'desconhecido'}` };
      } catch {
        return { ok: false, msg: 'salvo como rascunho — aprove na fila' };
      }
    },
    onSuccess: (r) => (r.ok ? toast.success(r.msg) : toast.error(r.msg)),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => invalidateInbox(client),
  });
}

export function useSendMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { threadId: string; body: string; send: boolean; subject?: string }) =>
      api.sendThreadMessage(v.threadId, v.body, v.send, v.subject),
    onSuccess: (res, v) => {
      if (!v.send) toast.success('rascunho salvo');
      else if (res.sent && !res.sent.ok)
        toast.error(`falhou ao enviar: ${res.sent.reason ?? 'desconhecido'}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
    // the row's last-message preview + draft chip go stale otherwise
    onSettled: () => invalidateInbox(client),
  });
}

export function useThreadAgent() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { threadId: string; enabled: boolean }) =>
      api.setThreadAgent(v.threadId, v.enabled),
    onMutate: async ({ threadId, enabled }) => {
      const key = qk.thread(threadId);
      await client.cancelQueries({ queryKey: key });
      const prev = client.getQueryData<ThreadView>(key);
      if (prev)
        client.setQueryData(key, { ...prev, thread: { ...prev.thread, agentEnabled: enabled } });
      return { prev };
    },
    onError: (e, { threadId }, ctx) => {
      if (ctx?.prev) client.setQueryData(qk.thread(threadId), ctx.prev);
      toast.error(errorMessage(e));
    },
    // re-enabling also clears the lead-wide handoff marker server-side
    onSettled: () => invalidateInbox(client),
  });
}

export function useNewThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (v: { leadId: string; channel: string }) => api.newThread(v.leadId, v.channel),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => invalidateInbox(client),
  });
}

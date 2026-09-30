import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type IncidentSeverity, type SiteRequestStatus } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useBillingStores = () =>
  useQuery({ queryKey: qk.billingStores(), queryFn: api.billingStores, select: (r) => r.stores });

export const useControlPlans = () =>
  useQuery({ queryKey: qk.controlPlans(), queryFn: api.controlPlans, select: (r) => r.plans });

export const useIncidents = () =>
  useQuery({ queryKey: qk.incidents(), queryFn: api.incidents, select: (r) => r.incidents });

export function useActivateDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.activateDomain(id),
    onSuccess: () => {
      toast.success('domínio ativado');
      void qc.invalidateQueries({ queryKey: qk.billingStores() });
    },
    onError: (e) => toast.error(`não ativou: ${errorMessage(e)}`),
  });
}

export function usePatchSiteRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: SiteRequestStatus; staffNote?: string }) =>
      api.patchSiteRequest(v.id, {
        status: v.status,
        ...(v.staffNote ? { staffNote: v.staffNote } : {}),
      }),
    onSuccess: () => {
      toast.success('pedido de site atualizado');
      void qc.invalidateQueries({ queryKey: qk.billingStores() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function usePatchPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; name?: string; priceCents?: number; public?: boolean }) => {
      const { id, ...patch } = v;
      return api.patchPlan(id, patch);
    },
    onSuccess: () => toast.success('plano salvo'),
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.controlPlans() });
      void qc.invalidateQueries({ queryKey: qk.billingStores() });
    },
  });
}

export interface IncidentDraft {
  title: string;
  body: string;
  severity: IncidentSeverity;
}

export function useSaveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string | null; draft: IncidentDraft }) => {
      const { title, body, severity } = v.draft;
      return v.id
        ? api.patchIncident(v.id, { title, body, severity })
        : api.createIncident({ title, severity, ...(body ? { body } : {}) });
    },
    onSuccess: (_r, v) => toast.success(v.id ? 'incidente atualizado' : 'incidente publicado'),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.incidents() }),
  });
}

export function useResolveIncident() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patchIncident(id, { resolved: true }),
    onSuccess: () => toast.success('incidente resolvido'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.incidents() }),
  });
}

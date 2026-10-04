import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  api,
  type AiPackPatch,
  type IncidentSeverity,
  type PlanPatch,
  type SiteRequestStatus,
} from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useBillingStores = () =>
  useQuery({ queryKey: qk.billingStores(), queryFn: api.billingStores, select: (r) => r.stores });

export const useCustomers = () =>
  useQuery({ queryKey: qk.customers(), queryFn: api.customers, select: (r) => r.stores });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isStoreId = (id: string) => UUID.test(id);

/** A malformed id never reaches Core — the page shows "não encontrada" for it directly. */
export const useCustomer = (id: string) =>
  useQuery({
    queryKey: qk.customer(id),
    queryFn: () => api.customer(id),
    enabled: isStoreId(id),
  });

/** One store's billing row (domain, site request, open invoice), read on its own. */
export const useBillingStore = (id: string) =>
  useQuery({
    queryKey: qk.billingStore(id),
    queryFn: () => api.billingStore(id),
    select: (r) => r.stores[0] ?? null,
    enabled: isStoreId(id),
  });

export const useControlPlans = () =>
  useQuery({ queryKey: qk.controlPlans(), queryFn: api.controlPlans, select: (r) => r.plans });

export const useAiPacks = () =>
  useQuery({ queryKey: qk.aiPacks(), queryFn: api.listAiPacks, select: (r) => r.packs });

export function usePatchAiPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: AiPackPatch & { id: string }) => api.patchAiPack(id, patch),
    onSuccess: () => toast.success('pacote salvo'),
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.aiPacks() }),
  });
}

export const useIncidents = () =>
  useQuery({ queryKey: qk.incidents(), queryFn: api.incidents, select: (r) => r.incidents });

export function useMarkInvoicePaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markInvoicePaid(id),
    onSuccess: () => toast.success('pagamento confirmado'),
    onError: (e) => toast.error(`não confirmou: ${errorMessage(e)}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.billingStores() });
      void qc.invalidateQueries({ queryKey: qk.customers() });
    },
  });
}

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
    mutationFn: (v: PlanPatch & { id: string }) => {
      const { id, ...patch } = v;
      return api.patchPlan(id, patch);
    },
    onSuccess: () => toast.success('plano salvo'),
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.controlPlans() });
      void qc.invalidateQueries({ queryKey: qk.billingStores() });
      void qc.invalidateQueries({ queryKey: qk.customers() });
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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type ProvisionInput, type ReleasePolicy } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useFleetStatus = () =>
  useQuery({ queryKey: qk.fleetStatus(), queryFn: api.fleetStatus });

export const useFleetStorefronts = () =>
  useQuery({
    queryKey: qk.fleetStorefronts(),
    queryFn: api.fleetStorefronts,
    select: (r) => r.storefronts,
  });

export const useFleetStorefront = (slug: string | null) =>
  useQuery({
    queryKey: qk.fleetStorefront(slug ?? ''),
    queryFn: () => api.fleetStorefront(slug!),
    select: (r) => r.storefront,
    enabled: !!slug,
  });

export const useFleetIncidents = () =>
  useQuery({
    queryKey: qk.fleetIncidents(),
    queryFn: api.fleetIncidents,
    select: (r) => r.incidents,
  });

export const useProvisionings = (leadId?: string) =>
  useQuery({
    queryKey: qk.fleetProvisionings(leadId),
    queryFn: () => api.provisionings(leadId),
    select: (r) => r.provisionings,
  });

export const useSlugStatus = (slug: string) =>
  useQuery({
    queryKey: qk.fleetSlug(slug),
    queryFn: () => api.slugStatus(slug),
    enabled: slug.length >= 3,
    staleTime: 5_000,
    refetchInterval: false,
  });

const FLEET_ROOTS = new Set([
  'fleet-status',
  'fleet-storefronts',
  'fleet-storefront',
  'fleet-provisionings',
  'fleet-incidents',
  'lead',
]);

/** SSE also lands (fleet.change) — this is the floor when the stream is down. */
function useFleetRefresh() {
  const qc = useQueryClient();
  return () =>
    void qc.invalidateQueries({ predicate: (q) => FLEET_ROOTS.has(String(q.queryKey[0])) });
}

const short = (id: string) => id.slice(0, 7);

export function usePatchStorefront(slug: string) {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (p: { policy?: ReleasePolicy; bundle?: string; reason?: string }) =>
      api.patchStorefront(slug, p),
    onSuccess: (r, p) => {
      const dep = r.deployment ? ` · versão ${short(r.deployment.release)} a caminho` : '';
      if (p.bundle) toast.success(`pacote trocado para ${p.bundle}${dep}`);
      else if (p.policy === 'pinned') toast.success('loja fixada na versão atual');
      else toast.success(`a loja volta a seguir o pacote${dep}`);
    },
    onError: (e) => toast.error(`não salvou: ${errorMessage(e)}`),
    onSettled: refresh,
  });
}

export function usePromote(slug: string) {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (b: { release: string; reason?: string }) => api.promote(slug, b),
    onSuccess: (r, b) =>
      toast.success(
        r.deployment
          ? `versão ${short(b.release)} promovida${r.policy === 'pinned' ? ' · loja fixada nela' : ''}`
          : 'essa versão já está no ar',
      ),
    onError: (e) => toast.error(`não promoveu: ${errorMessage(e)}`),
    onSettled: refresh,
  });
}

export function useRollback(slug: string) {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (b: { reason?: string }) => api.rollback(slug, b),
    onSuccess: (r) => toast.success(`voltou para a versão ${short(r.deployment.release)}`),
    onError: (e) => toast.error(`não voltou: ${errorMessage(e)}`),
    onSettled: refresh,
  });
}

export function useProbeNow(slug: string) {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: () => api.probe(slug),
    onError: (e) => toast.error(`a sonda não rodou: ${errorMessage(e)}`),
    onSettled: refresh,
  });
}

export function useRetryProvisioning() {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (id: string) => api.retryProvisioning(id),
    onSuccess: () => toast.success('tentando de novo'),
    onError: (e) => toast.error(`não reiniciou: ${errorMessage(e)}`),
    onSettled: refresh,
  });
}

export function useCreateProvisioning() {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (b: ProvisionInput) => api.createProvisioning(b),
    onSuccess: (r) => toast.success(`loja ${r.provisioning.tenant ?? ''} criada`),
    onSettled: refresh,
  });
}

export function usePatchFleetIncident() {
  const refresh = useFleetRefresh();
  return useMutation({
    mutationFn: (v: { id: string; op: 'ack' | 'resolve' }) =>
      api.patchFleetIncident(v.id, v.op === 'ack' ? { ack: true } : { resolved: true }),
    onSuccess: (_r, v) => toast.success(v.op === 'ack' ? 'alerta reconhecido' : 'alerta resolvido'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
}

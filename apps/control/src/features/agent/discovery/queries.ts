import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useDiscoveryRuns = () =>
  useQuery({
    queryKey: qk.runs({ kind: 'discovery' }),
    queryFn: () => api.runs({ kind: 'discovery' }),
    select: (r) => r.runs,
  });

/** Leads the hunts brought in — the `descoberto` tag, or `discoveredVia` on servers without the tag filter. */
export const useFoundLeads = () =>
  useQuery({
    queryKey: qk.leads({ tag: 'descoberto', limit: '50' }),
    queryFn: () =>
      api
        .leads({ tag: 'descoberto', limit: '50' })
        .then((r) => r.leads)
        .catch(() =>
          api.leads({ limit: '50' }).then((r) => r.leads.filter((l) => l.discoveredVia)),
        ),
  });

export const useDuplicates = () =>
  useQuery({ queryKey: qk.duplicates(), queryFn: () => api.duplicates(), select: (r) => r.groups });

export const useBriefs = () =>
  useQuery({ queryKey: qk.briefs(), queryFn: () => api.briefs(), select: (r) => r.briefs });

export const useSegments = () =>
  useQuery({ queryKey: qk.segments(), queryFn: () => api.segments(), select: (r) => r.segments });

export function useBriefMutations() {
  const client = useQueryClient();
  const settle = () => void client.invalidateQueries({ queryKey: qk.briefs() });
  const onError = (e: unknown) => toast.error(errorMessage(e));
  // create reports its error inline in the sheet
  const create = useMutation({ mutationFn: api.createBrief, onSettled: settle });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patchBrief(id, { enabled }),
    onError,
    onSettled: settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBrief(id),
    onError,
    onSettled: settle,
  });
  return { create, toggle, remove };
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type CampaignStatus, type StartCampaignPayload } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export type CampaignFilter = 'open' | 'all' | 'won' | 'ended';

export function useCampaigns(filter: CampaignFilter = 'all') {
  const apiStatus: CampaignStatus | 'open' | undefined =
    filter === 'open' ? 'open' : filter === 'won' ? 'won' : undefined;
  return useQuery({
    queryKey: qk.campaigns(apiStatus),
    queryFn: () => api.campaigns(apiStatus ? { status: apiStatus, limit: 50 } : { limit: 50 }),
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: qk.campaign(id ?? ''),
    queryFn: () => api.campaign(id!),
    enabled: Boolean(id),
  });
}

function useInvalidateCampaign(id?: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['campaigns'] });
    if (id) void client.invalidateQueries({ queryKey: qk.campaign(id) });
    else void client.invalidateQueries({ queryKey: ['campaign'] });
    void client.invalidateQueries({ queryKey: ['runs'] });
    void client.invalidateQueries({ queryKey: ['agent-config'] });
  };
}

export function useStartCampaign() {
  const invalidate = useInvalidateCampaign();
  return useMutation({
    mutationFn: (payload: StartCampaignPayload) => api.startCampaign(payload),
    onSuccess: ({ campaign }) => {
      invalidate();
      toast.success(`campanha "${campaign.title}" iniciada`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function usePauseCampaign(id: string) {
  const invalidate = useInvalidateCampaign(id);
  return useMutation({
    mutationFn: (reason?: string) => api.pauseCampaign(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success('campanha pausada');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useResumeCampaign(id: string) {
  const invalidate = useInvalidateCampaign(id);
  return useMutation({
    mutationFn: (body?: { extraBudgetUsd?: number | undefined; extendDays?: number | undefined }) =>
      api.resumeCampaign(id, body),
    onSuccess: () => {
      invalidate();
      toast.success('campanha retomada — diretor acordado');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useStopCampaign(id: string) {
  const invalidate = useInvalidateCampaign(id);
  return useMutation({
    mutationFn: (reason?: string) => api.stopCampaign(id, reason),
    onSuccess: () => {
      invalidate();
      toast.success('campanha encerrada');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useGuideCampaign(id: string) {
  const invalidate = useInvalidateCampaign(id);
  return useMutation({
    mutationFn: (guidance: string) => api.guideCampaign(id, guidance),
    onSuccess: () => {
      invalidate();
      toast.success('orientação aplicada — diretor acordado');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function useBumpCampaignBudget(id: string) {
  const invalidate = useInvalidateCampaign(id);
  return useMutation({
    mutationFn: (addUsd: number) => api.bumpCampaignBudget(id, addUsd),
    onSuccess: ({ resumed }, addUsd) => {
      invalidate();
      toast.success(
        resumed ? `+US$ ${addUsd} adicionados — campanha retomada` : `+US$ ${addUsd} adicionados`,
      );
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

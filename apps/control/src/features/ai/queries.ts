import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CustomerRow } from '@/lib/api.ts';
import { qk } from '@/lib/query.ts';

export type AiDays = 7 | 30;
export type AiSettingKey = 'agent_runtime.routes' | 'agent_runtime.budgets';

export const useAiUsage = (days: AiDays) =>
  useQuery({
    queryKey: qk.aiUsage(days),
    queryFn: () => api.aiUsage(days),
    placeholderData: keepPreviousData,
  });

export const useAiModels = () => useQuery({ queryKey: qk.aiModels(), queryFn: api.aiModels });

export type StoreRef = Pick<CustomerRow, 'id' | 'slug' | 'name'>;
const toRefs = (r: { stores: CustomerRow[] }): StoreRef[] =>
  r.stores.map(({ id, slug, name }) => ({ id, slug, name }));

/** Every store, for the override pickers (shares the Lojas list's cache entry). */
export const useStoreRefs = () =>
  useQuery({ queryKey: qk.customers(), queryFn: api.customers, select: toRefs });

export function useSaveAiSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: AiSettingKey; value: unknown }) =>
      api.putSetting(key, value),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.aiModels() }),
        qc.invalidateQueries({ queryKey: qk.settings() }),
      ]),
  });
}

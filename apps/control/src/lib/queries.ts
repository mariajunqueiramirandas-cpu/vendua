import { useQuery } from '@tanstack/react-query';
import { api } from './api.ts';
import { qk } from './query.ts';

/** Shared, app-wide queries. Feature-specific ones live in features/<area>/queries.ts. */
export const useStats = () => useQuery({ queryKey: qk.stats(), queryFn: api.stats });

export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations(), queryFn: api.integrations });

export function useBadges() {
  const { data } = useStats();
  return { drafts: data?.pendingDrafts ?? 0, overdue: data?.overdueTasks ?? 0 };
}

export function useLlmDriver() {
  const { data } = useIntegrations();
  if (!data) return '';
  return data.integrations.find((i) => i.kind === 'llm' && i.enabled)?.driver ?? 'off';
}

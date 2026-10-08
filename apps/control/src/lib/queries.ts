import { useQuery } from '@tanstack/react-query';
import { api, type SiteTask } from './api.ts';
import { qk } from './query.ts';

/** Shared, app-wide queries. Feature-specific ones live in features/<area>/queries.ts. */
export const useStats = () => useQuery({ queryKey: qk.stats(), queryFn: api.stats });

export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations(), queryFn: api.integrations });

/** Site sob medida tasks a person has to act on: stuck ones, and green PRs awaiting approval. */
export const needsHuman = (t: Pick<SiteTask, 'status' | 'ci'>) =>
  t.status === 'escalated' || (t.status === 'pr_open' && t.ci === 'success');

export const useSiteTasks = (status: 'open' | 'all') =>
  useQuery({
    queryKey: qk.siteTasks(status),
    queryFn: () => api.siteTasks(status),
    select: (r) => r.tasks,
  });

/** The open list's raw response, counted — shares its cache with /lojas/sites. */
export function useSiteTasksBadge() {
  const { data } = useQuery({
    queryKey: qk.siteTasks('open'),
    queryFn: () => api.siteTasks('open'),
    select: (r) => r.tasks.filter(needsHuman).length,
  });
  return data ?? 0;
}

export function useBadges() {
  const { data } = useStats();
  const sites = useSiteTasksBadge();
  return { drafts: data?.pendingDrafts ?? 0, overdue: data?.overdueTasks ?? 0, sites };
}

export function useLlmDriver() {
  const { data } = useIntegrations();
  if (!data) return '';
  return data.integrations.find((i) => i.kind === 'llm' && i.enabled)?.driver ?? 'off';
}

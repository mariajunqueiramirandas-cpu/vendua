import { useQuery } from '@tanstack/react-query';
import { api, type AutonomyLevel, type SiteTask } from './api.ts';
import { AUTONOMY_LABEL } from './labels.ts';
import { qk } from './query.ts';

/** Shared, app-wide queries. Feature-specific ones live in features/<area>/queries.ts. */
export const useStats = () => useQuery({ queryKey: qk.stats(), queryFn: api.stats });

export const useIntegrations = () =>
  useQuery({ queryKey: qk.integrations(), queryFn: api.integrations });

export const useAgentConfig = () =>
  useQuery({ queryKey: qk.agentConfig(), queryFn: api.agentConfig });

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

export interface AgentStatus {
  label: string;
  tone: 'live' | 'warn' | 'bad' | 'off';
  level: AutonomyLevel | null;
  modelsMissing: boolean;
}

/** Real runtime status of the CRM agent (autonomy level + AI model routes). */
export function useAgentStatus(): AgentStatus {
  const cfg = useAgentConfig();
  const models = useQuery({ queryKey: qk.aiModels(), queryFn: api.aiModels });
  const level = cfg.data?.level ?? null;
  const modelsMissing =
    models.isSuccess && !models.data.primaryRoute && models.data.routesSource === 'none';
  if (modelsMissing) return { label: 'sem modelo', tone: 'bad', level, modelsMissing: true };
  if (!level) return { label: '', tone: 'off', level: null, modelsMissing: false };
  const tone: AgentStatus['tone'] =
    level === 'off' ? 'off' : level === 'supervised' ? 'live' : 'warn';
  return { label: AUTONOMY_LABEL[level], tone, level, modelsMissing: false };
}

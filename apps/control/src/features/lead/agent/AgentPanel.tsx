import type { LeadListItem } from '@/lib/api.ts';
import type { LeadPatch } from '../queries.ts';
import { AgentControl } from './AgentControl.tsx';
import { AgentFacts } from './AgentFacts.tsx';
import { AgentPlan } from './AgentPlan.tsx';
import { AgentAgenda, AgentRuns } from './AgentSchedule.tsx';

/** Everything the agent knows and will do on this lead — right rail on wide screens, a tab elsewhere. */
export function AgentPanel({ lead, patch }: { lead: LeadListItem; patch: (p: LeadPatch) => void }) {
  return (
    <>
      <AgentControl lead={lead} patch={patch} />
      <AgentPlan lead={lead} />
      <AgentAgenda lead={lead} />
      <AgentFacts leadId={lead.id} />
      <AgentRuns leadId={lead.id} />
    </>
  );
}

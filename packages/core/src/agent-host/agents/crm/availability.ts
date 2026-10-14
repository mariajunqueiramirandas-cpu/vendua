import {
  block,
  pass,
  type ConversationState,
  type Json,
  type ToolGuard,
} from '@vendua/agent-runtime';
import type { Workspace } from './context.ts';

// What this install can run, for the three CRM agents. A leaf module: the agents import it at
// definition time, and crm/index.ts sits in an import cycle with the agent registry.

export const workspaceOf = (ctxTenant: Json) => ctxTenant as unknown as Workspace | null;

/** A tool whose provider isn't configured stays out of the model's list. */
export const offers = (tool: string, s: ConversationState) =>
  !workspaceOf(s.context.tenant)?.disabled[tool];

/** Refuses such a tool if the model calls it anyway. */
export const available: ToolGuard = {
  id: 'available',
  stage: 'tool',
  run(call, { state }) {
    const why = workspaceOf(state.context.tenant)?.disabled[call.name];
    return why ? block(`unavailable:${call.name}`, `${call.name} indisponível: ${why}`) : pass;
  },
};

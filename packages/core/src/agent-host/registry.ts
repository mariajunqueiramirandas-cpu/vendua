import type { Agent, Lane } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';
import { AGENTS } from './agents/index.ts';
import { hostOnlineQa } from './qa.ts';

// Which agents this Core runs, by id: dispatchTx needs an agent's lane to create its actor, and
// the runtime needs every version it may route to.
const current = new Map<string, Agent<Sql>>();
const versions = new Map<string, Agent<Sql>>();

export function registerAgent(agent: Agent<Sql>, opts: { current?: boolean } = {}): void {
  versions.set(agent.version, agent);
  if (opts.current !== false) current.set(agent.def.id, agent);
}

/** Scores a sample of every agent's conversations once there is an agent to score. */
export const ONLINE_QA = AGENTS.length ? hostOnlineQa() : null;

for (const a of AGENTS) registerAgent(a);
if (ONLINE_QA) registerAgent(ONLINE_QA.agent);

export function currentAgents(): Agent<Sql>[] {
  return [...current.values()];
}

export function loadedVersions(): Agent<Sql>[] {
  return [...versions.values()];
}

export function laneOf(agentId: string): Lane {
  const a = current.get(agentId);
  if (!a) throw new Error(`no agent ${agentId} registered`);
  return a.def.lane;
}

import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { AgentTool } from './llm.ts';
import { controlTx } from '../modules/control.ts';
import {
  createLead,
  getLeadDetail,
  leadInsert,
  leadPatch,
  listLeads,
  updateLead,
} from '../modules/leads.ts';
import { addActivity, createTask } from '../modules/activities.ts';
import { composeMessage, setThreadAgent, channel } from '../modules/threads.ts';
import { getSetting } from '../modules/integrations.ts';
import { checkSendAllowed } from './guardrails.ts';
import { dispatchMessage } from './send.ts';

/**
 * agent/tools — the central tool registry (Hermes-style: one registry, gated
 * per run kind like `enabled_toolsets`). Every tool validates its args and
 * executes against modules — the model never touches SQL.
 */

export interface ToolContext {
  sql: Sql;
  runId: string;
  runKind: 'triage' | 'reply' | 'outreach' | 'discovery';
  leadId: string | null;
  threadId: string | null;
  /** tool call index within the run — seeds deterministic idempotency keys */
  step: number;
}

const leadIdArg = { type: 'string', description: 'lead uuid' } as const;
const LEAD_FIELDS = {
  businessName: { type: 'string' },
  phone: { type: 'string' },
  whatsapp: { type: 'string' },
  email: { type: 'string' },
  instagram: { type: 'string' },
  website: { type: 'string' },
  city: { type: 'string' },
  segment: { type: 'string' },
  source: { type: 'string' },
  tags: { type: 'array', items: { type: 'string' } },
  dealValueCents: { type: 'integer' },
  nextActionAt: { type: 'string', description: 'ISO-8601' },
} as const;

const REGISTRY: { def: AgentTool; toolsets: string[] }[] = [
  {
    toolsets: ['triage', 'reply', 'outreach', 'discovery'],
    def: {
      name: 'search_leads',
      description: 'Search leads by name/business/contact fields. Returns compact list.',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          state: { type: 'string', enum: ['lead', 'contacted', 'invited', 'live'] },
        },
        required: ['q'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach', 'discovery'],
    def: {
      name: 'get_lead',
      description: 'Full lead profile: fields, tags, score, counters.',
      parameters: { type: 'object', properties: { id: leadIdArg }, required: ['id'] },
    },
  },
  {
    toolsets: ['triage', 'discovery'],
    def: {
      name: 'create_lead',
      description: 'Create a new lead (state=lead).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, ...LEAD_FIELDS },
        required: ['name'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach', 'discovery'],
    def: {
      name: 'update_lead',
      description: 'Patch lead fields (contact info, tags, deal value, next action, agent mode).',
      parameters: {
        type: 'object',
        properties: {
          id: leadIdArg,
          ...LEAD_FIELDS,
          agentMode: { type: 'string', enum: ['off', 'draft', 'auto'] },
        },
        required: ['id'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach'],
    def: {
      name: 'set_state',
      description: 'Move a lead along the pipeline (writes state history).',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          state: { type: 'string', enum: ['lead', 'contacted', 'invited', 'live'] },
        },
        required: ['leadId', 'state'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach', 'discovery'],
    def: {
      name: 'add_note',
      description: 'Append a note to the lead timeline.',
      parameters: {
        type: 'object',
        properties: { leadId: leadIdArg, body: { type: 'string' } },
        required: ['leadId', 'body'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach'],
    def: {
      name: 'create_task',
      description: 'Create a follow-up task for staff or self.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          title: { type: 'string' },
          dueAt: { type: 'string', description: 'ISO-8601' },
        },
        required: ['leadId', 'title'],
      },
    },
  },
  {
    toolsets: ['reply', 'outreach'],
    def: {
      name: 'draft_message',
      description: 'Draft an outbound message for human approval — always allowed, never sends.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          channel: { type: 'string', enum: ['email', 'whatsapp', 'manual'] },
          body: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['leadId', 'channel', 'body'],
      },
    },
  },
  {
    toolsets: ['reply', 'outreach'],
    def: {
      name: 'send_message',
      description:
        'Send an outbound message now. Guardrails decide whether it queues (auto mode) or falls back to draft.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          channel: { type: 'string', enum: ['email', 'whatsapp'] },
          body: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['leadId', 'channel', 'body'],
      },
    },
  },
  {
    toolsets: ['triage', 'reply', 'outreach', 'discovery'],
    def: {
      name: 'remember',
      description:
        'Persist a durable learning (agent memory — e.g. "docerias respond better at night"). Bounded: keep ≤40 facts, consolidate instead of duplicating.',
      parameters: {
        type: 'object',
        properties: { fact: { type: 'string' } },
        required: ['fact'],
      },
    },
  },
  {
    toolsets: ['reply', 'outreach'],
    def: {
      name: 'request_human',
      description: 'Pause the agent on this thread and hand the lead to staff (creates a task).',
      parameters: {
        type: 'object',
        properties: { leadId: leadIdArg, reason: { type: 'string' } },
        required: ['leadId', 'reason'],
      },
    },
  },
  {
    toolsets: ['discovery'],
    def: {
      name: 'web_search',
      description:
        'Search the web for prospects via the discovery provider (TinyFish). Returns ranked results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          purpose: { type: 'string', description: 'why — used to rank results' },
        },
        required: ['query'],
      },
    },
  },
  {
    toolsets: ['discovery'],
    def: {
      name: 'extract_page',
      description: 'Extract structured contact info from a page via the discovery provider.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, goal: { type: 'string' } },
        required: ['url', 'goal'],
      },
    },
  },
];

/** Toolset filter — the Hermes enabled_toolsets pattern: each run kind sees
 *  only the tools its job needs. */
export function toolsFor(kind: string): AgentTool[] {
  return REGISTRY.filter((t) => t.toolsets.includes(kind)).map((t) => t.def);
}

export async function executeTool(
  ctx: ToolContext,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { sql, runId, step } = ctx;
  // deterministic per call — a retried call replays, a batched second call
  // with the same name in one step gets its own key.
  const key = `agent:${runId}:${step}:${name}:${callId}`;
  switch (name) {
    case 'search_leads': {
      const q = typeof args.q === 'string' && args.q ? args.q : null;
      const state = typeof args.state === 'string' ? (args.state as never) : null;
      const { leads } = await listLeads(sql, {
        ...(q ? { q } : {}),
        ...(state ? { state } : {}),
        limit: 10,
      });
      return leads.map((l) => ({
        id: l.id,
        name: l.name,
        business: l.businessName,
        state: l.state,
        score: l.score,
        city: l.city,
        segment: l.segment,
      }));
    }
    case 'get_lead':
      return getLeadDetail(sql, String(args.id ?? ''));
    case 'create_lead': {
      const payload = { ...args };
      if (ctx.runKind === 'discovery' && payload.discoveredVia === undefined) {
        payload.discoveredVia = 'agente';
      }
      const res = await createLead(sql, leadInsert(payload), key);
      return res.body;
    }
    case 'update_lead': {
      const { id, ...rest } = args;
      const res = await updateLead(sql, String(id), leadPatch(rest), key, 'agent');
      return res.body;
    }
    case 'set_state': {
      const res = await updateLead(
        sql,
        String(args.leadId),
        leadPatch({ state: args.state }),
        key,
        'agent',
      );
      return res.body;
    }
    case 'add_note': {
      const res = await addActivity(
        sql,
        String(args.leadId),
        { kind: 'note', body: String(args.body), createdBy: 'agent' },
        key,
      );
      return res.body;
    }
    case 'create_task': {
      const res = await createTask(
        sql,
        String(args.leadId),
        { title: String(args.title), dueAt: (args.dueAt as string) ?? null, createdBy: 'agent' },
        key,
      );
      return res.body;
    }
    case 'draft_message': {
      const res = await composeMessage(
        sql,
        {
          leadId: String(args.leadId),
          channel: channel(args.channel),
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          status: 'draft',
        },
        key,
      );
      return res.body;
    }
    case 'send_message': {
      const leadId = String(args.leadId);
      const chan = channel(args.channel);
      const verdict = await checkSendAllowed(sql, leadId, chan);
      if (!verdict.ok) {
        return { blocked: true, reason: verdict.reason };
      }
      const res = await composeMessage(
        sql,
        {
          leadId,
          channel: chan,
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          status: verdict.forceDraft ? 'draft' : 'queued',
        },
        key,
      );
      if (!verdict.forceDraft) {
        await dispatchMessage(sql, res.body.message.id);
      }
      return { ...res.body, draftFallback: verdict.forceDraft };
    }
    case 'remember': {
      const fact = String(args.fact ?? '').slice(0, 500);
      const memory = await getSetting<{ facts: string[] }>(sql, 'agent_memory', { facts: [] });
      const facts = [...memory.facts.filter((f) => f !== fact), fact].slice(-40);
      await claimlessPut(sql, 'agent_memory', { facts });
      return { remembered: fact, total: facts.length };
    }
    case 'request_human': {
      const leadId = String(args.leadId);
      if (ctx.threadId) await setThreadAgent(sql, ctx.threadId, false, key + ':thread');
      await createTask(
        sql,
        leadId,
        { title: `[humano] ${String(args.reason).slice(0, 200)}`, createdBy: 'agent' },
        key + ':task',
      );
      return { handedOff: true };
    }
    case 'web_search': {
      const { discoveryFor } = await import('./channels/discovery.ts');
      const provider = await discoveryFor(sql);
      return provider.search(String(args.query), String(args.purpose ?? ''));
    }
    case 'extract_page': {
      const { discoveryFor } = await import('./channels/discovery.ts');
      const provider = await discoveryFor(sql);
      return provider.extract(String(args.url), String(args.goal));
    }
    default:
      throw new HttpError(422, 'UNKNOWN_TOOL', `unknown tool: ${name}`);
  }
}

async function claimlessPut(sql: Sql, key: string, value: unknown) {
  await controlTx(
    sql,
    (tx) => tx`
      insert into control_settings (key, value) values (${key}, ${tx.json(value as never)})
      on conflict (key) do update set value = excluded.value
    `,
  );
}

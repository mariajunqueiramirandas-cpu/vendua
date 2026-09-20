import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { AgentTool } from './llm.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import {
  getLeadDetail,
  insertLeadTx,
  leadInsert,
  leadPatch,
  listLeads,
  updateLead,
} from '../modules/leads.ts';
import { addActivity, createTask } from '../modules/activities.ts';
import { composeMessage, composeMessageTx, setThreadAgent, channel } from '../modules/threads.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import { checkSendAllowedTx, type SendVerdict } from './guardrails.ts';
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
  /** In-flight/finished extract_page calls by page identity — a repeat call
   *  (same step's batch or a later step) shares the same provider call
   *  instead of paying for the identical page twice. */
  extractCache: Map<string, Promise<unknown>>;
  /** Discovery-brief runs stamp created leads' discovered_via with the brief
   *  name so the board can tell scheduled-autopilot finds from ad-hoc ones. */
  briefName: string | null;
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
  fitScore: { type: 'integer', description: '0–10 ICP fit — how well this business matches the target audience' },
  fitReason: { type: 'string', description: 'one line: why this fit score' },
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
      description:
        'Create a new lead (state=lead). Pass fitScore/fitReason — the ICP match judgment. Self-dedupes on name/phone/instagram — a duplicate returns {duplicate, existing} instead of inserting.',
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
        'Search the web for prospects. Results come annotated: kind=contact/profile already carry the parsed phone/@handle from the URL (no extract needed); kind=site is the extract_page candidate; kind=listing is a directory. Emit 2-3 different-angled queries per step — they run in parallel.',
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
      description:
        'Extract structured contacts from a page via the discovery provider. Only worth it on kind=site results — social roots are login-walled (the handle is already in the search result). Re-extracting a URL returns its cached output.',
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

  // toolsFor() only decides what the model is TOLD about — nothing stops it
  // emitting another name. Enforce the toolset here too, or a discovery run
  // can emit send_message and reach the real dispatch path.
  if (!toolsFor(ctx.runKind).some((t) => t.name === name)) {
    return { error: `tool ${name} not available for ${ctx.runKind} runs` };
  }

  // Lead-bound runs (triage/reply/outreach) may only mutate THEIR lead — the
  // model picks the leadId arg, so enforce the binding in code. Read-only
  // tools (search_leads, get_lead) stay unscoped: triage legitimately inspects
  // other leads, e.g. to spot duplicates.
  const leadBoundArg =
    {
      update_lead: 'id',
      set_state: 'leadId',
      add_note: 'leadId',
      create_task: 'leadId',
      draft_message: 'leadId',
      send_message: 'leadId',
      request_human: 'leadId',
    }[name] ?? null;
  if (ctx.leadId && leadBoundArg) {
    const target = String(args[leadBoundArg] ?? '');
    if (target !== ctx.leadId) {
      return {
        error: `LEAD_MISMATCH — this run is bound to lead ${ctx.leadId}; pass that leadId`,
      };
    }
  }

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
      if (ctx.runKind === 'discovery') {
        if (payload.discoveredVia === undefined)
          payload.discoveredVia = ctx.briefName ? `agente·${ctx.briefName}`.slice(0, 120) : 'agente';
        // The Discovery UI panel queries `tag=descoberto` — tag it here so
        // agent-found leads are always findable there.
        const tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
        if (!tags.includes('descoberto')) tags.push('descoberto');
        payload.tags = tags;
      }
      const input = leadInsert(payload);
      const res = await claimControl(sql, key, async (tx) => {
        if (ctx.runKind === 'discovery') {
          // One per-run advisory lock serializes dedupe + cap + insert:
          // batched create_lead calls in a step run concurrently, so without
          // the lock two parallel calls could both pass the dup check before
          // either inserts.
          await tx`select pg_advisory_xact_lock(hashtext(${`discovery-cap:${ctx.runId}`}))`;
          // Dedupe before the cap check so a repeat prospect can't burn cap:
          // phone/whatsapp compare digit-only, instagram handle case-folded,
          // and a name hit needs the same city — common names alone don't
          // merge distinct businesses.
          const digits = (v: unknown) =>
            typeof v === 'string' && v.replace(/\D/g, '').length >= 8 ? v.replace(/\D/g, '') : null;
          const phone = digits(input.phone) ?? digits(input.whatsapp);
          const ig =
            typeof input.instagram === 'string' && input.instagram.trim()
              ? input.instagram.trim().replace(/^@/, '').toLowerCase()
              : null;
          const nameKey = String(input.name ?? '')
            .trim()
            .toLowerCase();
          const bizKey =
            typeof input.business_name === 'string' && input.business_name.trim()
              ? input.business_name.trim().toLowerCase()
              : null;
          const city =
            typeof input.city === 'string' && input.city.trim()
              ? input.city.trim().toLowerCase()
              : null;
          const dup = (
            await tx<{ id: string; name: string; state: string }[]>`
              select id, name, state from leads
              where archived_at is null and (
                (${phone}::text is not null and
                  (regexp_replace(coalesce(phone,''), '\\D','','g') = ${phone}
                   or regexp_replace(coalesce(whatsapp,''), '\\D','','g') = ${phone}))
                or (${ig}::text is not null and
                  lower(regexp_replace(coalesce(instagram,''), '^@', '')) = ${ig})
                or ((${bizKey}::text is not null and lower(business_name) = ${bizKey}
                     or lower(name) = ${nameKey})
                    and (${city}::text is null
                         or lower(coalesce(city,'')) = ${city}))
              )
              limit 3
            `
          )[0];
          if (dup) {
            return {
              status: 200,
              body: { duplicate: true as const, existing: dup } as never,
            };
          }
          // Hard cap, enforced in code the prompt can't talk away: count this
          // run's claim keys whose stored response actually created a lead
          // (`response.lead.id`) — duplicate/no-op responses commit a claim
          // row but must not burn cap slots. This call's own claim row has no
          // response yet, so n = leads already created.
          const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
          const cap = g.discoveryMaxLeads ?? DEFAULT_GUARDRAILS.discoveryMaxLeads;
          const n =
            (
              await tx<{ n: number }[]>`
            select count(*)::int as n from control_idempotency_keys
            where key like ${`agent:${ctx.runId}:%:create_lead:%`}
              and response->'lead'->>'id' is not null
          `
            )[0]?.n ?? 0;
          if (n >= cap) {
            throw new HttpError(
              409,
              'DISCOVERY_CAP',
              `discovery cap reached — max ${cap} leads per run`,
            );
          }
        }
        return insertLeadTx(tx, input);
      });
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
      // Claimed: a retried tool call replays the recorded decision instead of
      // composing again. The advisory lock serializes concurrent sends on the
      // lead so the daily-cap count sees the winner's queued row.
      type SendBody =
        | { blocked: true; reason: string | undefined }
        | {
            blocked: false;
            verdict: SendVerdict;
            composed: Awaited<ReturnType<typeof composeMessageTx>>;
          };
      const res = await claimControl<SendBody>(sql, key, async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        // Run-scoped dedupe: a run reclaimed after a mid-send crash re-executes
        // the whole conversation — the model may emit a different callId, so
        // `key` can't catch it. The run's own prior dispatch can.
        const already = await tx`
          select 1 from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.agent_run_id = ${ctx.runId}
            and m.status in ('queued', 'sending', 'sent', 'delivered')
          limit 1
        `;
        if (already[0]) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'already dispatched by this run' },
          };
        }
        // Pause applies per (lead, channel) — staff disabling the DESTINATION
        // thread (or request_human earlier in this same run) must stop sends
        // even when the lead's agent_mode still allows them. No thread yet =
        // ensureThread creates it enabled, so only an existing paused one blocks.
        const destThread = (
          await tx<{ agent_enabled: boolean }[]>`
            select agent_enabled from lead_threads
            where lead_id = ${leadId} and channel = ${chan}
            for update
          `
        )[0];
        if (destThread && !destThread.agent_enabled) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'thread paused for agent' },
          };
        }
        const g = await getSettingTx(tx, 'guardrails', {} as Partial<Guardrails>);
        const verdict = await checkSendAllowedTx(
          tx,
          { ...DEFAULT_GUARDRAILS, ...g },
          leadId,
          chan,
        );
        if (!verdict.ok) {
          return { status: 200, body: { blocked: true as const, reason: verdict.reason } };
        }
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: chan,
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          status: verdict.forceDraft ? 'draft' : 'queued',
          agentRunId: ctx.runId,
        });
        return { status: 200, body: { blocked: false as const, verdict, composed } };
      });
      const out = res.body;
      if (out.blocked) return { blocked: true, reason: out.reason };
      // dispatchMessage no-ops unless the row is still 'queued' — safe when
      // this response replays.
      if (!res.replayed && out.verdict.forceDraft === false) {
        await dispatchMessage(sql, out.composed.body.message.id);
      }
      return { ...out.composed.body, draftFallback: out.verdict.forceDraft };
    }
    case 'remember': {
      const fact = String(args.fact ?? '').slice(0, 500);
      // Row lock on the settings row makes the read-modify-write atomic —
      // concurrent remembers serialize instead of clobbering each other.
      const total = await controlTx(sql, async (tx) => {
        await tx`
          insert into control_settings (key, value)
          values ('agent_memory', ${tx.json({ facts: [] } as never)})
          on conflict (key) do nothing
        `;
        const rows = await tx<{ value: { facts?: unknown } }[]>`
          select value from control_settings where key = 'agent_memory' for update
        `;
        const cur = Array.isArray(rows[0]?.value?.facts) ? (rows[0]!.value.facts as string[]) : [];
        const facts = [...cur.filter((f) => f !== fact), fact].slice(-40);
        await tx`
          update control_settings set value = ${tx.json({ facts } as never)}
          where key = 'agent_memory'
        `;
        return facts.length;
      });
      return { remembered: fact, total };
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
      const { discoveryFor, annotateResults } = await import('./channels/discovery.ts');
      const provider = await discoveryFor(sql);
      const raw = await provider.search(String(args.query), String(args.purpose ?? ''));
      const { results, droppedDupes } = annotateResults(raw.results);
      return {
        results,
        ...(droppedDupes ? { droppedDupes } : {}),
        note: 'kind=contact/profile já traz o contato parseado da URL — use direto; kind=site é o que vale extract_page; listing = diretório, pista de nome.',
      };
    }
    case 'extract_page': {
      const { discoveryFor, pageKey } = await import('./channels/discovery.ts');
      const url = String(args.url);
      const key2 = pageKey(url);
      // Same page this run → share the in-flight/cached call. Provably
      // identical output for zero provider spend; covers both batched
      // duplicates and a later step re-trying a URL.
      if (key2) {
        const hit = ctx.extractCache.get(key2);
        if (hit) {
          const out = await hit;
          return { ...(typeof out === 'object' && out !== null ? out : { out }), cached: true };
        }
      }
      const provider = await discoveryFor(sql);
      const p = provider.extract(url, String(args.goal)).then(
        (out) => out,
        (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
      );
      if (key2) ctx.extractCache.set(key2, p);
      return p;
    }
    default:
      throw new HttpError(422, 'UNKNOWN_TOOL', `unknown tool: ${name}`);
  }
}

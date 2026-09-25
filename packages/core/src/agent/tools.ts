import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';
import type { AgentTool } from './llm.ts';
import { claimControl, controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  getLeadDetail,
  insertLeadTx,
  leadInsert,
  leadPatch,
  listLeads,
  updateLead,
} from '../modules/leads.ts';
import { addActivity, createTask } from '../modules/activities.ts';
import { composeMessageTx, channel } from '../modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  getSetting,
  getSettingTx,
  type Guardrails,
} from '../modules/integrations.ts';
import {
  LEAD_FACT_KEY_RE,
  hasMemoryTablesTx,
  rememberTx,
  upsertLeadFactTx,
} from '../modules/agent-memory.ts';
import { recordBlockedSendTx } from '../modules/channel-health.ts';
import {
  agentPausedForChannelTx,
  checkSendAllowedTx,
  resolveChannelTx,
  whatsappReadyTx,
  type SendVerdict,
} from './guardrails.ts';
import { dispatchMessage } from './send.ts';
import { whatsappRegistered } from './channels/whatsapp.ts';
import { leadBoundArg, toolAvailable } from './tool-meta.ts';
import { parseWakeupAt, scheduleWakeupTx } from './wakeups.ts';
import { automationAllowedTx, discoveryBudgetTx } from './policy.ts';

/** central tool registry — every tool validates args and executes against modules; the model never touches SQL. */

export interface ToolContext {
  sql: Sql;
  runId: string;
  runKind: 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
  leadId: string | null;
  threadId: string | null;
  /** tool call index within the run — seeds deterministic idempotency keys */
  step: number;
  /** live claim on agent_runs — mutating tools fence on it; null outside a real claim (tests/sims). */
  claimToken: string | null;
  /** in-flight/finished read_pages calls by page identity — a repeat read shares the same provider call. */
  pageCache: Map<string, Promise<unknown>>;
  /** stamps created leads' discovered_via so the board tells brief finds from ad-hoc ones. */
  briefName: string | null;
  /** hard per-run ceiling on created leads — enforced in code so the prompt can't talk past it. */
  leadCap: number;
  /** staff channel override (params.channel) — trumps the model's pick on send/draft. */
  channelOverride: 'email' | 'whatsapp' | null;
  /** run-scoped working memory — the `book` prospect ledger + `plan` campaign plan. */
  book: Map<string, BookEntry>;
  plan: string | null;
  /** monid.ai spend guard — enrichment charges against a per-run cap; never null in a real run. */
  monid: import('./channels/monid.ts').MonidBudget | null;
  /** contact values already banked this run — a repeat isn't progress. */
  seenContacts: Set<string>;
  /** read_pages fetches spent this run — reply's cap; counts fetches (cache misses + chased hops), not calls. */
  pageReads: number;
  /** binds spend to the call's pending journal entry so a reclaim mid-batch replays real spend. */
  markReadSpent?: (delta: number) => Promise<void>;
  /** staff-assist runs: send_message may only compose to the approvals queue. */
  draftOnly: boolean;
  /** job kinds this run may call as — drained mail adds its requestedKind; the dispatcher gate reads this. */
  toolKinds?: ReadonlySet<string>;
}

/** One prospect in the agent's ledger — what it found and which moves it already spent. */
export interface BookEntry {
  name: string;
  city: string | null;
  status: 'open' | 'resolved' | 'dead';
  channels: Record<string, string>;
  /** move tags — 'maps', 'ig', 'hub', 'serp', 'dir', free-form */
  tried: string[];
  note: string | null;
}

/** Compact ledger render — echoes inside book/plan tool results and feeds
 *  the reflection tick + finish nudge. */
export function bookDigest(book: Map<string, BookEntry>): string {
  if (!book.size) return '(livro vazio)';
  return [...book.values()]
    .slice(0, 20)
    .map((e) => {
      const ch = Object.entries(e.channels)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join('+');
      const mark = e.status === 'dead' ? '✗' : e.status === 'resolved' ? '✓' : '·';
      return `${mark} ${e.name}${e.city ? ` (${e.city})` : ''} — tentou: ${e.tried.join(',') || 'nada'} — canais: ${ch || 'nenhum'}${e.note ? ` — ${e.note}` : ''}`;
    })
    .join('\n');
}

/** Per-run read_pages budget for reply runs — enough for a sent link, never a rabbit hole; charged per fetch (cache misses + chased hops). */
const REPLY_READ_PAGES_CAP = 2;

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  nextActionRequested: {
    type: 'boolean',
    description:
      "true when the LEAD asked to be contacted at nextActionAt (\"me chama terça\") — marks the date 'requested': a promised callback that survives the lead's next message. Omit for the agent's own cadence.",
  },
  fitScore: {
    type: 'integer',
    description: '0–10 ICP fit — how well this business matches the target audience',
  },
  fitReason: { type: 'string', description: 'one line: why this fit score' },
  intentScore: {
    type: 'integer',
    description:
      '0–10 buying intent — what the research showed: whatsapp-active business with NO ordering link of its own (sells via iFood/WhatsApp only), recent reviews asking for menu/ordering, hiring or other growth signals',
  },
  intentReason: { type: 'string', description: 'one line: the intent signals observed' },
} as const;

const REGISTRY: { def: AgentTool }[] = [
  {
    def: {
      name: 'search_leads',
      description:
        'Check names against the leads already registered — free + instant. In discovery the flow is: a maps/web sweep surfaces CANDIDATE names → search_leads filters them → only the misses are real targets worth paid investigation. A hit is a POSSIBLE duplicate — the match is a broad substring search, so compare the returned name/business/city against your candidate before discarding it. q matches name/business/instagram/email/phone/whatsapp (phone digits match normalized numbers). Returns channel flags + whatsappVerified.',
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
    def: {
      name: 'get_lead',
      description: 'Full lead profile: fields, tags, score, counters.',
      parameters: { type: 'object', properties: { id: leadIdArg }, required: ['id'] },
    },
  },
  {
    def: {
      name: 'create_lead',
      description:
        'Create a new lead (state=lead) — only AFTER researching it. Required in discovery runs: findings (the 2-4 line dossier — what the business sells, size/channel signals, where each contact came from) and at least one contact channel. Pass fitScore/fitReason (the ICP match) and intentScore/intentReason (buying intent — wa-active without an ordering link, recent reviews, hiring posts). Self-dedupes on name/phone/instagram — a duplicate merges your new contacts + findings into the existing lead and returns {duplicate, merged, existing}.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ...LEAD_FIELDS,
          findings: {
            type: 'string',
            description:
              'the research dossier — what the business sells, fit signals, best channel, sources',
          },
          sources: {
            type: 'array',
            items: { type: 'string' },
            description: 'urls consulted while researching',
          },
        },
        required: ['name'],
      },
    },
  },
  {
    def: {
      name: 'update_lead',
      description: 'Patch lead fields (contact info, tags, deal value, next action, goal).',
      parameters: {
        type: 'object',
        properties: {
          id: leadIdArg,
          ...LEAD_FIELDS,
          archived: {
            type: 'boolean',
            description:
              "true archives the lead — off the board (staff sees it under 'arquivados'), suppressed from every agent gate; the kill switch for off-ICP/dead leads",
          },
          agentGoal: {
            type: 'string',
            enum: ['negotiation', 'meeting'],
            description:
              'switch what the agent is driving toward — flip it when the lead signals the other goal (wants a call while on negotiation, wants to close in-thread while on meeting)',
          },
        },
        required: ['id'],
      },
    },
  },
  {
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
    def: {
      name: 'set_fact',
      description:
        'Record a durable structured fact about THIS lead — snake_case key (e.g. "team_size", "decision_maker", "monthly_volume"), short value. It lands in lead memory: every later run on this lead sees it under FATOS. Facts are for durable structured data; add_note is for prose. Same key upserts the value.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          key: { type: 'string', description: 'snake_case, ≤60 chars' },
          value: { type: 'string', description: '≤500 chars' },
          confidence: {
            type: 'number',
            description: 'how sure you are, 0..1 (default 1)',
          },
        },
        required: ['leadId', 'key', 'value'],
      },
    },
  },
  {
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
    def: {
      name: 'schedule',
      description:
        'Book your own next touch on this lead: at the given time an outreach run wakes up with this focus. One pending agenda item per lead — scheduling again replaces it. A new message from the lead cancels it unless requested=true (the lead asked for that date).',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          at: { type: 'string', description: 'ISO-8601, ≥10 min and ≤90 days ahead' },
          focus: { type: 'string', description: 'what that run must do and why (≤500 chars)' },
          requested: {
            type: 'boolean',
            description: 'true only when the lead asked for this date',
          },
        },
        required: ['leadId', 'at', 'focus'],
      },
    },
  },
  {
    // triage gets draft_message (its first-contact write-up) but never send_message — a new lead can't be sent unreviewed.
    def: {
      name: 'draft_message',
      description:
        'Draft an outbound message for human approval — always allowed, never sends. Omit channel to auto-pick the reachable one (last inbound channel, else whatsapp > email); if you pass a dead channel you get {blocked, reason, use} — retry on `use`.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          channel: { type: 'string', enum: ['email', 'whatsapp', 'manual'] },
          body: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['leadId', 'body'],
      },
    },
  },
  {
    def: {
      name: 'send_message',
      description:
        'Send an outbound message now. Guardrails decide whether it queues (auto mode) or falls back to draft. Omit channel to auto-pick the reachable one; a dead channel returns {blocked, reason, use} — retry on `use`.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          channel: { type: 'string', enum: ['email', 'whatsapp'] },
          body: { type: 'string' },
          subject: { type: 'string' },
        },
        required: ['leadId', 'body'],
      },
    },
  },
  {
    def: {
      name: 'remember',
      description:
        'Persist a durable learning (agent memory — e.g. "docerias respond better at night"). scope: "workspace" (default — applies to every run) or "segment" + `segment` for a learning that only fits one niche. Deduped case-insensitively per scope/segment — repeating a learning refreshes it instead of duplicating. Cap 200 workspace+segment learnings (staff-pinned items never drop); when the cap drops an old learning the result returns it as `evicted` — fold it into a consolidated learning on a later call. For a structured fact about THIS lead, prefer `set_fact`.',
      parameters: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          scope: { type: 'string', enum: ['workspace', 'segment'] },
          segment: { type: 'string', description: 'required when scope=segment' },
        },
        required: ['fact'],
      },
    },
  },
  {
    def: {
      name: 'propose_brief',
      description:
        'Propose a NEW discovery brief as a DISABLED draft — staff approves it on the board with one click; you never enable anything. Only propose gaps the BRIEFS list does not already cover: a segment that converts but lacks volume, a city/flavor with no brief, an angle memory says works. `reason` is the one-line justification staff reads before approving.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'short slug — e.g. "docerias fortaleza"' },
          query: { type: 'string', description: 'the search a discovery run would execute' },
          segment: { type: 'string' },
          city: { type: 'string' },
          target: {
            type: 'integer',
            description: 'leads per run, 1–1000 (3–10 is normal)',
          },
          reason: { type: 'string', description: 'one line — why staff should approve' },
        },
        required: ['name', 'query', 'reason'],
      },
    },
  },
  {
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
    def: {
      name: 'unsubscribe',
      description:
        'The sender asked to stop receiving messages / be removed — opts the lead out (unsubscribed_at). `reply` is an optional one-line farewell sent as the final message; never send anything else after calling this.',
      parameters: {
        type: 'object',
        properties: {
          leadId: leadIdArg,
          reason: { type: 'string' },
          reply: { type: 'string' },
        },
        required: ['leadId'],
      },
    },
  },
  {
    // reply keeps web_search as fallback only — in a live conversation asking beats searching.
    def: {
      name: 'web_search',
      description:
        'Search the web for prospects. Results come annotated: kind=contact already carries the parsed phone/whatsapp link from the URL; kind=profile is a social root — instagram profiles are worth a read_pages (the bio carries whatsapp + link-in-bio), facebook is login-walled; kind=site is the read_pages candidate; kind=listing is a directory/ordering platform. Snippet-carried phones/emails arrive pre-parsed. Emit 2-3 different-angled queries per step — they run in parallel.',
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
    // reply gets read_pages too but capped — a live conversation can't afford a rabbit hole.
    def: {
      name: 'read_pages',
      description:
        "Read pages via the fetch provider — returns each page's markdown text (read it: contact channels hide in prose — 'chama a Ju no zap', '(22) 9xxxx-xxxx' in a bio, a footer mailto), foundContacts (the deterministic safety net: phone/whatsapp/email/socials parsed out of the page's links AND body text AND meta title/description + any redirect's final URL — a bit.ly that lands on wa.me gives the phone free; phoneHints = '9xxxx-xxxx' sem DDD, prova de whatsapp pra resolver via busca/diretório), and nav (contact-ish follow-up reads: same-host pages + link-in-bio hubs like linktr.ee). The provider also AUTO-CHASES one hop of the links that exist only to hold contacts — link-in-bio hubs and google-business/maps pointers come back as extra pages marked chasedFrom. A page flagged truncated:true was cut mid-render (instagram '…mais') — its contact line may be past the fold, resolve via web_search/diretório. Use it on every prospect's own pages AND instagram profiles: home + contato/sobre/cardápio + the profile's bio link, up to 6 urls per call. Facebook roots are login-walled. A repeated URL returns its cached output.",
      parameters: {
        type: 'object',
        properties: {
          urls: {
            type: 'array',
            items: { type: 'string' },
            description: '1–6 urls of the SAME prospect',
          },
          goal: { type: 'string', description: 'what you are looking for' },
        },
        required: ['urls'],
      },
    },
  },
  {
    def: {
      name: 'plan',
      description:
        "Your plan. Discovery: the campaign map for this run — call it at the start (segments/angles you'll try, kill-criteria) and again when results change the picture; run-scoped working memory. Lead kinds (triage/reply/outreach): the negotiation checklist for THIS lead — write it once you understand the business (methodology stages tailored to them, ending at the lead's GOAL), then send it back marking items done as they complete — it persists on the lead across runs and is your memory between messages. Items merge by step: a step you omit is kept — mark dead ends 'skip' instead of dropping them; on steps you do send, fields you omit keep their stored values (≤12 items).",
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'discovery only — the plan, free text (≤2000 chars)',
          },
          items: {
            type: 'array',
            description: 'lead kinds only — the full checklist, current state',
            items: {
              type: 'object',
              properties: {
                step: { type: 'string', description: 'what must happen' },
                status: { type: 'string', enum: ['todo', 'done', 'skip'] },
                note: { type: 'string', description: 'evidence/outcome, one line' },
              },
              required: ['step'],
            },
          },
        },
      },
    },
  },
  {
    def: {
      name: 'book',
      description:
        "Your prospect ledger — working memory. 'upsert' the moment a prospect enters the radar, BEFORE the next move on it: name, channels found (whatsapp/phone/instagram/email/site with values), the move tags already spent (tried: 'maps','ig','hub','serp','dir'), status open|resolved|dead, and a short note. 'list' dumps it. The harness injects the ledger into reflection ticks and the finish gate — dead must be earned with spent moves, and an abandoned book is what the reflection shows you back.",
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['upsert', 'list'] },
          name: { type: 'string' },
          city: { type: 'string' },
          status: { type: 'string', enum: ['open', 'resolved', 'dead'] },
          channels: {
            type: 'object',
            description: 'channel → value, e.g. {"whatsapp":"+55...","instagram":"@h"}',
          },
          tried: {
            type: 'array',
            items: { type: 'string' },
            description: 'move tags already spent on this prospect',
          },
          note: { type: 'string' },
        },
        required: ['action'],
      },
    },
  },
  {
    // A fresh card (staff-created or manual triage) with a business name +
    // city resolves contacts here before the first-contact draft.
    def: {
      name: 'maps_lookup',
      description:
        "Google Maps business lookup via monid (~$0.0045/result against the run's monid cap). query='what' + city='where' → structured candidates: name, phone, whatsappLikely (true when the phone is a BR mobile — that number IS the whatsapp, carry it into the lead's whatsapp field), address, website, rating, category. The strongest open for physical segments; the agent picks when.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: "business/segment, e.g. 'padaria artesanal'" },
          city: { type: 'string' },
          limit: { type: 'number', description: 'max results, ≤10 (default 8)' },
        },
        required: ['query', 'city'],
      },
    },
  },
  {
    def: {
      name: 'instagram_profile',
      description:
        "Full Instagram profile via monid (~$0.003/profile). Returns the REAL complete biography (never the '…mais' truncation), externalUrl (the link-in-bio), category, followers, and any public contact fields — with bio text parsed into contacts. The fix for profiles that render as shells in read_pages.",
      parameters: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'instagram @handle (with or without @)' },
        },
        required: ['handle'],
      },
    },
  },
  {
    def: {
      name: 'serp',
      description:
        "One Google SERP via monid (~$0.001) — the cheap follow-up round for a named prospect ('<nome> <cidade>' telefone/whatsapp). Snippets arrive phone-parsed; the result that names the prospect (even a directory — cylex, apontador, guia local) is worth a read_pages.",
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
  },
];

export function toolsFor(kind: string): AgentTool[] {
  return REGISTRY.filter((t) => toolAvailable(kind, t.def.name)).map((t) => t.def);
}

export function registeredToolNames(): string[] {
  return REGISTRY.map((t) => t.def.name);
}

/** Side-effect fence on the live claim — runs FIRST inside the mutation's claim
 *  tx so it commits strictly before a reclaim or throws un-stored. */
export async function assertRunClaimTx(tx: Sql, ctx: ToolContext): Promise<void> {
  if (!ctx.claimToken) return;
  const row = (
    await tx<{ status: string; claim_token: string | null }[]>`
      select status, claim_token from agent_runs where id = ${ctx.runId} for update
    `
  )[0];
  if (row?.status !== 'running' || row.claim_token !== ctx.claimToken) {
    throw new HttpError(409, 'STALE_CLAIM', 'run claim lost — tool effects suppressed');
  }
}

/** Auto outreach's dispatch-boundary recheck — re-evaluated inside the send-claim
 *  tx under capfin so a committed inbound can't be followed by the auto nudge it answered. */
export async function refuseOnFresherInboundTx(tx: Sql, ctx: ToolContext): Promise<string | null> {
  if (ctx.runKind !== 'outreach' || !ctx.leadId || !ctx.claimToken) return null;
  const run = (
    await tx<{ auto: string | null; started_at: string | null }[]>`
      select params->>'auto' as auto, started_at from agent_runs where id = ${ctx.runId}
    `
  )[0];
  // 'agent' exempt like 'regenerate' — the pre-'auto' marker is ambiguous, so treated as a possible promise.
  if (!run?.started_at || run.auto == null || run.auto === 'regenerate' || run.auto === 'agent')
    return null;
  const { capLockTx } = await import('./runner.ts');
  await capLockTx(tx, ctx.leadId);
  const replied = await tx<{ id: string }[]>`
    select m.id from lead_messages m
    join lead_threads t on t.id = m.thread_id
    where t.lead_id = ${ctx.leadId} and m.direction = 'in' and not m.historical
      and m.received_at is not null
      and m.received_at > ${run.started_at}::timestamptz
      and not exists (
        select 1 from agent_inbox i
        where i.consumed_by_run = ${ctx.runId}
          and i.payload->>'messageId' = m.id::text
      )
    limit 1
  `;
  // Mail this run already drained doesn't refuse its answer.
  return replied.length ? 'lead respondeu' : null;
}

export async function executeTool(
  ctx: ToolContext,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { sql, runId, step } = ctx;
  // deterministic per call — a retried call replays, a batched same-name call gets its own key.
  const key = `agent:${runId}:${step}:${name}:${callId}`;
  // forwarded to module mutations so their claim tx fences on the live claim.
  const guard = (tx: Sql) => assertRunClaimTx(tx, ctx);

  // toolsFor() is only what the model is told — enforce it here too; drained mail widens the set via ctx.toolKinds.
  const kinds = ctx.toolKinds ?? new Set([ctx.runKind]);
  const allowed = [...kinds].some((k) => toolAvailable(k, name));
  if (!allowed || !REGISTRY.some((t) => t.def.name === name)) {
    return { error: `tool ${name} not available for ${ctx.runKind} runs` };
  }

  // lead-bound runs may only mutate their own lead — reads stay unscoped (triage inspects other leads for dupes).
  const boundArg = leadBoundArg(name);
  if (ctx.leadId && boundArg) {
    const target = String(args[boundArg] ?? '');
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
      const matches = leads.map((l) => ({
        id: l.id,
        name: l.name,
        business: l.businessName,
        state: l.state,
        score: l.score,
        city: l.city,
        segment: l.segment,
        // channel flags — the agent sees what the card already holds before hunting.
        hasWhatsapp: Boolean(l.whatsapp),
        whatsappVerified: l.whatsappVerified,
        hasPhone: Boolean(l.phone),
        hasInstagram: Boolean(l.instagram),
      }));
      return {
        matches,
        count: matches.length,
        next: matches.length
          ? 'possível registro existente — compare nome/negócio/cidade; correspondência parcial em outro campo não prova duplicata'
          : 'nenhuma correspondência — prospect provavelmente novo, vale a investigação paga',
      };
    }
    case 'get_lead':
      return getLeadDetail(sql, String(args.id ?? ''));
    case 'create_lead': {
      const payload = { ...args };
      const findings = typeof args.findings === 'string' ? args.findings.trim() : '';
      const sources = (Array.isArray(args.sources) ? args.sources : [])
        .map((s) => String(s ?? '').trim())
        // over-long "sources" are dropped, not truncated — a stored URL is never a fragment.
        .filter((s) => s.length > 0 && s.length <= 500)
        .slice(0, 10);
      // findings/sources are writeup args, not lead columns — strip them.
      delete payload.findings;
      delete payload.sources;
      // phone-derived whatsapp is reachable but NOT verified evidence — the autocontact gate must not treat it as confirmed.
      let whatsappDerived = false;
      if (ctx.runKind === 'discovery') {
        // a pasted wa.me/whatsapp URL is a channel mention, not a number — resolve or drop it before the channel gate counts it.
        const { contactFromUrl, phoneFromText, isBrMobilePhone } =
          await import('./channels/discovery.ts');
        for (const f of ['phone', 'whatsapp'] as const) {
          const v = payload[f];
          if (typeof v === 'string' && /wa\.me|whatsapp\.com/i.test(v)) {
            let u: URL | null = null;
            for (const candidate of [v, `https://${v}`]) {
              try {
                u = new URL(candidate);
                break;
              } catch {
                /* try next form */
              }
            }
            payload[f] = u ? contactFromUrl(u).phone : undefined;
          } else if (typeof v === 'string' && /^[\d\s()+.-]+$/.test(v.trim())) {
            // digit-ish values normalize like the extractors (10-11 digits = BR local, 12+ = intl).
            const p = phoneFromText(v.trim());
            if (p) payload[f] = p;
          }
        }
        // instagram lands one shape — '@handle' — or dedupe's comparison splits the column into two formats.
        const ig = payload.instagram;
        if (typeof ig === 'string' && ig.trim()) {
          let u: URL | null = null;
          for (const candidate of [ig.trim(), `https://${ig.trim()}`]) {
            try {
              u = new URL(candidate);
              break;
            } catch {
              /* try next form */
            }
          }
          const h = u?.hostname.toLowerCase().replace(/^www\./, '') ?? '';
          if (u && (h === 'instagram.com' || h === 'm.instagram.com')) {
            payload.instagram = contactFromUrl(u).instagram;
          } else {
            const m = /^@?([\w.-]+)$/.exec(ig.trim());
            payload.instagram = m ? `@${m[1]}` : undefined;
          }
        }
        // a BR mobile IS whatsapp-reachable — fill it, marked derived so the autocontact gate still requires real evidence (eligible, not proven).
        whatsappDerived =
          !payload.whatsapp && typeof payload.phone === 'string' && isBrMobilePhone(payload.phone);
        if (whatsappDerived) payload.whatsapp = payload.phone;
        // discovered-lead bar, enforced in code: a dossier AND a reachable channel — a name-only row is a dead card.
        if (findings.length < 20) {
          return {
            error:
              'FINDINGS_REQUIRED — escreva o dossiê do prospect (2-4 linhas: o que o negócio vende, sinais de porte/canal, de onde veio cada contato). Lead sem pesquisa não entra no CRM.',
          };
        }
        const channels = ['phone', 'whatsapp', 'email', 'instagram', 'website'];
        if (!channels.some((f) => typeof payload[f] === 'string' && String(payload[f]).trim())) {
          return {
            error:
              'NO_CHANNEL — o lead precisa de ≥1 canal de contato (phone/whatsapp/email/instagram/website). Pesquise mais o prospect (read_pages, web_search "nome cidade") ou desista dele.',
          };
        }
        if (payload.discoveredVia === undefined)
          payload.discoveredVia = ctx.briefName
            ? `agente·${ctx.briefName}`.slice(0, 120)
            : 'agente';
        // the Discovery panel queries `tag=descoberto` — tag it here.
        const tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
        if (!tags.includes('descoberto')) tags.push('descoberto');
        payload.tags = tags;
      }
      const input = leadInsert(payload);
      // explicit whatsapp is verified; the mobile-derived fill stays unverified.
      input.whatsapp_verified = Boolean(input.whatsapp) && !whatsappDerived;
      // derived-but-promotable: probe the live socket for registration —
      // registered clears `derived`. Runs before the claim tx (network never
      // inside a DB tx); null = can't tell, stays unverified.
      if (whatsappDerived && typeof input.whatsapp === 'string' && input.whatsapp) {
        const g = await getSetting<Partial<Guardrails>>(sql, 'guardrails', {});
        const score = typeof input.fit_score === 'number' ? input.fit_score : null;
        const waReady = await controlTx(sql, (tx) => whatsappReadyTx(tx));
        if (
          (g.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact) &&
          waReady &&
          score !== null &&
          score >= (g.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore)
        ) {
          if ((await whatsappRegistered(input.whatsapp).catch(() => null)) === true) {
            whatsappDerived = false;
            input.whatsapp_verified = true;
          }
        }
      }
      // retired runs emit post-commit — emitting inside the claim would leak a false event on rollback.
      const retiredOutreach: string[] = [];
      const res = await claimControl(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        // The research dossier lands on the timeline as a note — created with
        // the lead in the same claim so a lead can never exist without it.
        let guardrails: Partial<Guardrails> = {};
        let autoOn = false;
        let minScore: number = DEFAULT_GUARDRAILS.discoveryContactMinScore;
        let waDriverOn = false;
        /** autocontact gate: verified whatsapp (never a guessed phone), live wa driver, fitScore ≥ min. */
        const gateFires = (score: number | null, wa: string) =>
          ctx.runKind === 'discovery' &&
          autoOn &&
          waDriverOn &&
          score !== null &&
          score >= minScore &&
          Boolean(wa);
        /** first-contact suppresses on live runs AND any outbound row — a
         *  'failed' send may still have reached the wire; 'rejected' is a veto. */
        const outreachActive = async (leadId: string) => {
          const live = (
            await tx`
            select 1 from agent_runs
            where lead_id = ${leadId} and kind = 'outreach'
              and status in ('queued', 'running')
            limit 1
          `
          )[0];
          if (live) return true;
          return Boolean(
            (
              await tx`
            select 1 from lead_messages m
            join lead_threads t on t.id = m.thread_id
            where t.lead_id = ${leadId} and m.direction = 'out'
            limit 1
          `
            )[0],
          );
        };
        const queueOutreach = async (leadId: string, score: number | null) => {
          if (await outreachActive(leadId)) return null;
          if (!(await automationAllowedTx(tx, 'outreach')).ok) return null;
          const { insertRun } = await import('./runner.ts');
          const params = {
            channel: 'whatsapp',
            auto: 'discovery',
            focus: `primeiro contato — lead descoberto (fitScore ${String(score)}). O dossiê de pesquisa está na timeline do lead.`,
          };
          const cap: { retired?: string[] } = {};
          const runId = await insertRun(tx, { kind: 'outreach', leadId, params }, cap);
          retiredOutreach.push(...(cap.retired ?? []));
          if (!runId) return null;
          // the intent rides the mailbox too — one pending discovery event per lead is enough.
          const pending = (
            await tx<{ n: number }[]>`
              select count(*)::int n from agent_inbox
              where lead_id = ${leadId} and kind = 'event' and consumed_at is null
                and payload->>'requestedKind' = 'outreach'
                and payload->'params'->>'auto' = 'discovery'
            `
          )[0]!.n;
          if (!pending) {
            const { enqueueInboxTx } = await import('./inbox.ts');
            await enqueueInboxTx(tx, leadId, 'event', {
              text: 'lead descoberto — primeiro contato',
              requestedKind: 'outreach',
              params,
            });
          }
          return runId;
        };
        const writeFindings = async (leadId: string, extra: Record<string, unknown> = {}) => {
          if (!findings) return;
          await tx`
            insert into lead_activities (lead_id, kind, body, meta, created_by)
            values (${leadId}, 'note', ${findings.slice(0, 4000)},
                    ${tx.json({ type: 'research', sources, ...extra } as never)}, 'agent')
          `;
        };
        if (ctx.runKind === 'discovery') {
          // one advisory key serializes dedupe + cap + insert — concurrent runs must not insert the same prospect twice.
          await tx`select pg_advisory_xact_lock(hashtext('lead-dedupe'))`;
          guardrails = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
          autoOn = guardrails.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact;
          minScore =
            guardrails.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore;
          waDriverOn = await whatsappReadyTx(tx);
          // dedupe before the cap check so a repeat can't burn cap — name/business hits only merge when city matches too.
          const digits = (v: unknown) =>
            typeof v === 'string' && v.replace(/\D/g, '').length >= 8 ? v.replace(/\D/g, '') : null;
          const phones = [digits(input.phone), digits(input.whatsapp)].filter(
            (d): d is string => d !== null,
          );
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
            await tx<Record<string, unknown>[]>`
              select * from leads
              where archived_at is null and (
                (${phones.length}::int > 0 and
                  (regexp_replace(coalesce(phone,''), '\\D','','g') = any(${phones})
                   or regexp_replace(coalesce(whatsapp,''), '\\D','','g') = any(${phones})))
                or (${ig}::text is not null and
                  lower(regexp_replace(coalesce(instagram,''), '^@', '')) = ${ig})
                or (${city}::text is not null
                    and lower(coalesce(city,'')) = ${city}
                    and (${bizKey}::text is not null and lower(business_name) = ${bizKey}
                         or lower(name) = ${nameKey}))
              )
              limit 3
            `
          )[0];
          if (dup) {
            // capfin first — must be the tx's first lead lock or an inbound gate holding it can cycle.
            const { capLockTx } = await import('./runner.ts');
            await capLockTx(tx, dup.id as string);
            // fill still-empty columns (never overwrite) and append the dossier to the timeline.
            const FILL_COLS = [
              'business_name',
              'phone',
              'whatsapp',
              'email',
              'instagram',
              'website',
              'city',
              'segment',
              'source',
              'owner',
              'fit_reason',
              'intent_reason',
            ] as const;
            const set: Record<string, unknown> = {};
            const merged: string[] = [];
            for (const col of FILL_COLS) {
              const v = input[col];
              const cur = dup[col];
              if (
                typeof v === 'string' &&
                v.trim() &&
                (cur === null || cur === undefined || String(cur).trim() === '')
              ) {
                set[col] = v.trim();
                merged.push(col);
              }
            }
            // fill score columns separately when the card was never scored.
            for (const col of ['fit_score', 'intent_score'] as const) {
              if (typeof input[col] === 'number' && (dup[col] === null || dup[col] === undefined)) {
                set[col] = input[col];
                merged.push(col);
              }
            }
            // a merged whatsapp is verified only when it wasn't auto-derived.
            if ('whatsapp' in set) set.whatsapp_verified = !whatsappDerived;
            // an explicit whatsapp digit-matching a stored UNVERIFIED value
            // confirms it — the fill loop alone can't flip the flag.
            if (
              !whatsappDerived &&
              input.whatsapp &&
              dup.whatsapp &&
              dup.whatsapp_verified !== true &&
              digits(String(dup.whatsapp)) === digits(String(input.whatsapp))
            ) {
              set.whatsapp_verified = true;
              if (!merged.includes('whatsapp_verified')) merged.push('whatsapp_verified');
            }
            // an enriched dup clears the same gate — but only while untouched
            // ('lead'), agent not 'off' (human veto), and no live outreach.
            const dupScore = (set.fit_score ?? dup.fit_score) as number | null;
            // only VERIFIED whatsapp unlocks autocontact.
            const dupWa =
              (dup.whatsapp_verified === true || set.whatsapp_verified === true
                ? String(dup.whatsapp ?? '').trim()
                : '') || (whatsappDerived ? '' : String(set.whatsapp ?? '').trim());
            const dupContact =
              gateFires(dupScore, dupWa) &&
              dup.state === 'lead' &&
              dup.agent_mode !== 'off' &&
              !(await outreachActive(dup.id as string));
            // agent_mode promotes only after the run is admitted — a cap refusal must not commit 'auto' with no outreach.
            if (merged.length) {
              await tx`update leads set ${tx(set)}, updated_at = now() where id = ${dup.id as string}`;
            }
            const contactRun = dupContact ? await queueOutreach(dup.id as string, dupScore) : null;
            if (contactRun && dup.agent_mode !== 'auto') {
              await tx`update leads set agent_mode = 'auto', updated_at = now() where id = ${dup.id as string}`;
              merged.push('agent_mode');
            }
            await writeFindings(dup.id as string, { merged });
            return {
              status: 200,
              body: {
                duplicate: true as const,
                merged,
                ...(contactRun ? { contactRun } : {}),
                existing: { id: dup.id, name: dup.name, state: dup.state },
                // a merge does NOT count toward META — say so or the model stops hunting.
                next: 'duplicado — NÃO conta pra META; siga o plano e traga prospects novos',
              } as never,
            };
          }
          // hard cap in code: count claim keys whose response created a lead — duplicate/no-op rows don't burn cap slots.
          const cap = ctx.leadCap;
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
        // score gate → first contact without a human: verified whatsapp + live
        // driver → autonomy + queued outreach; messaging guardrails still apply.
        const newScore = typeof input.fit_score === 'number' ? input.fit_score : null;
        const autoContact = gateFires(
          newScore,
          whatsappDerived ? '' : String(input.whatsapp ?? '').trim(),
        );
        const created = await insertLeadTx(tx, input);
        await writeFindings(created.body.lead.id as string);
        if (whatsappDerived) {
          (created.body as Record<string, unknown>).whatsappUnverified = true;
          (created.body as Record<string, unknown>).next =
            'whatsapp derivado do celular — um wa.me/link-in-bio confirma de verdade (e destrava autocontato)';
        }
        if (autoContact) {
          // agent_mode follows the admitted run — a cap refusal must not leave 'auto' with no outreach.
          const contactRun = await queueOutreach(created.body.lead.id, newScore);
          if (contactRun) {
            await tx`update leads set agent_mode = 'auto', updated_at = now()
              where id = ${created.body.lead.id as string}`;
            created.body.lead.agentMode = 'auto';
          }
          return {
            ...created,
            body: { ...created.body, contactRun } as never,
          };
        }
        return created;
      });
      if (!res.replayed) {
        const leadId =
          (res.body as { lead?: { id?: unknown } }).lead?.id ??
          (res.body as { existing?: { id?: unknown } }).existing?.id;
        if (typeof leadId === 'string') emitControlEvent('lead.change', leadId);
        const contactRun = (res.body as { contactRun?: unknown }).contactRun;
        if (typeof contactRun === 'string') emitControlEvent('run.update', contactRun);
        for (const r of retiredOutreach) emitControlEvent('run.update', r);
      }
      return res.body;
    }
    case 'update_lead': {
      const { id, ...rest } = args;
      // staff-set autonomy knobs are refused: agentMode (self-promotion),
      // agentPaused (staff's resume), archived:false (un-suppress); archived:true stays for off-ICP binning.
      delete rest.agentMode;
      delete rest.agentPaused;
      if (rest.archived === false) delete rest.archived;
      // provenance marker, not a column — 'requested' dates survive a fresh inbound; 'agent'-stamped cadence doesn't.
      const nextActionRequested = rest.nextActionRequested === true;
      delete rest.nextActionRequested;
      // an emptied patch returns a refusal note instead of erroring.
      if (Object.keys(rest).length === 0) {
        return {
          ignored: true,
          reason:
            'agentMode, agentPaused and unarchiving are staff-managed; nothing else to update',
        };
      }
      const res = await updateLead(
        sql,
        String(id),
        leadPatch(rest, 'agent', nextActionRequested),
        key,
        'agent',
        guard,
      );
      return res.body;
    }
    case 'set_state': {
      const res = await updateLead(
        sql,
        String(args.leadId),
        leadPatch({ state: args.state }),
        key,
        'agent',
        guard,
      );
      return res.body;
    }
    case 'add_note': {
      const res = await addActivity(
        sql,
        String(args.leadId),
        { kind: 'note', body: String(args.body), createdBy: 'agent' },
        key,
        guard,
      );
      return res.body;
    }
    case 'schedule': {
      const leadId = String(args.leadId ?? '');
      const at = parseWakeupAt(args.at);
      if (typeof at === 'string') return { error: at };
      const focus = String(args.focus ?? '').trim();
      if (!focus) return { error: 'focus is required' };
      const res = await claimControl(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        const lead = (
          await tx<{ archived_at: string | null; unsubscribed_at: string | null }[]>`
            select archived_at, unsubscribed_at from leads where id = ${leadId}
          `
        )[0];
        if (!lead)
          return { status: 200, body: { error: 'lead not found' } as Record<string, unknown> };
        if (lead.archived_at || lead.unsubscribed_at) {
          return { status: 200, body: { blocked: true, reason: 'lead suppressed' } };
        }
        const out = await scheduleWakeupTx(tx, {
          leadId,
          at,
          focus,
          requested: args.requested === true,
          runId: UUID_LIKE.test(ctx.runId) ? ctx.runId : null,
        });
        if ('error' in out) return { status: 200, body: { error: out.error } };
        return {
          status: 200,
          body: { scheduled: true, id: out.wakeup.id, at: out.wakeup.at, replaced: out.replaced },
        };
      });
      if (!res.replayed && res.body.scheduled === true) emitControlEvent('lead.change', leadId);
      return res.body;
    }
    case 'create_task': {
      const res = await createTask(
        sql,
        String(args.leadId),
        { title: String(args.title), dueAt: (args.dueAt as string) ?? null, createdBy: 'agent' },
        key,
        guard,
      );
      return res.body;
    }
    case 'draft_message': {
      const leadId = String(args.leadId);
      // resolve + write in one claim — a bounce between resolution and insert can't strand a draft on a dead channel.
      type DraftBody =
        | { blocked: true; reason: string | undefined; use?: string | null }
        | (Awaited<ReturnType<typeof composeMessageTx>>['body'] & {
            channel: string;
            via: string;
          });
      const res = await claimControl<DraftBody>(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        const pick = await resolveChannelTx(tx, leadId, {
          requested: args.channel ? channel(args.channel) : null,
          override: ctx.channelOverride,
          threadId: ctx.threadId,
        });
        if (!pick.ok) {
          return {
            status: 200,
            body: { blocked: true as const, reason: pick.reason, use: pick.available[0] ?? null },
          };
        }
        // same pause check as send_message — a staff-paused thread gets no output, drafts included.
        if (await agentPausedForChannelTx(tx, leadId, pick.channel)) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'thread paused for agent' },
          };
        }
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: pick.channel,
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          status: 'draft',
          // stamped like send paths — inbound retire scopes stale drafts by authoring run.
          agentRunId: ctx.runId,
        });
        return {
          status: composed.status,
          body: { ...composed.body, channel: pick.channel, via: pick.via },
        };
      });
      if (!res.replayed && !('blocked' in res.body)) {
        emitControlEvent('draft.change', res.body.thread.id);
        emitControlEvent('thread.message', res.body.thread.id);
      }
      return res.body;
    }
    case 'send_message': {
      const leadId = String(args.leadId);
      const chanArg = args.channel ? channel(args.channel) : null;
      // claimed — retries replay; the advisory lock serializes concurrent sends so the daily cap sees the winner's row.
      type SendBody =
        | { blocked: true; reason: string | undefined; use?: string | null }
        | {
            blocked: false;
            verdict: SendVerdict;
            composed: Awaited<ReturnType<typeof composeMessageTx>>;
            pick: Extract<Awaited<ReturnType<typeof resolveChannelTx>>, { ok: true }>;
          };
      const res = await claimControl<SendBody>(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        // run-scoped dedupe — a reclaimed run re-executes and may emit a
        // different callId; scoped to the latest mail batch so a drained batch re-arms exactly one answer.
        const already = await tx`
          select 1 from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId} and m.agent_run_id = ${ctx.runId}
            and m.status in ('queued', 'sending', 'sent', 'delivered')
            and m.created_at > coalesce(
              (select max(i.consumed_at) from agent_inbox i
               where i.consumed_by_run = ${ctx.runId}),
              '-infinity'::timestamptz)
          limit 1
        `;
        if (already[0]) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'already dispatched by this run' },
          };
        }
        // channel resolution in-claim: override > arg > continuity > whatsapp > email; a dead channel blocks with the alternative.
        const pick = await resolveChannelTx(tx, leadId, {
          requested: chanArg,
          override: ctx.channelOverride,
          threadId: ctx.threadId,
        });
        if (!pick.ok) {
          return {
            status: 200,
            body: { blocked: true as const, reason: pick.reason, use: pick.available[0] ?? null },
          };
        }
        const chan = pick.channel;
        // a new callId with the same body would dispatch a second copy — match
        // on body across channels; pre-wire failures (no dispatch_attempted_at) stay retryable.
        const attemptedFailed = await tx<{ id: string }[]>`
          select m.id from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where t.lead_id = ${leadId}
            and m.agent_run_id = ${ctx.runId} and m.status = 'failed'
            and m.body = ${String(args.body).trim()}
            and m.dispatch_attempted_at is not null
          limit 1
        `;
        if (attemptedFailed[0]) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'already dispatched by this run' },
          };
        }
        // pause applies per (lead, channel) — a lead-wide handoff survives a channel hop.
        if (await agentPausedForChannelTx(tx, leadId, chan)) {
          return {
            status: 200,
            body: { blocked: true as const, reason: 'thread paused for agent' },
          };
        }
        // draft-only runs skip the verdict — its gates stop wire sends and a draft never leaves anyway.
        const verdict = ctx.draftOnly
          ? ({ ok: true, forceDraft: false } as const)
          : await checkSendAllowedTx(
              tx,
              {
                ...DEFAULT_GUARDRAILS,
                ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
              },
              leadId,
              chan,
            );
        if (!verdict.ok) {
          // durable signal for the channel-health rollup — blocks otherwise leave no record.
          await recordBlockedSendTx(tx, leadId, chan, verdict.reason ?? 'guardrail');
          return { status: 200, body: { blocked: true as const, reason: verdict.reason } };
        }
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: chan,
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          // draftOnly composes like the supervised first-contact draft — the send just never leaves.
          status: verdict.forceDraft || ctx.draftOnly ? 'draft' : 'queued',
          agentRunId: ctx.runId,
        });
        if (!verdict.forceDraft && !ctx.draftOnly) {
          // record which message answered held inbound NOW inside the claim tx —
          // a released item can never hide an in-flight answer; a marker onto a
          // provably-dead send re-points here.
          await tx`
            update agent_inbox
            set payload = payload || jsonb_build_object('answeredBy', ${composed.body.message.id}::text)
            where consumed_by_run = ${ctx.runId} and kind = 'inbound'
              and not exists (
                select 1 from lead_messages m
                where m.id::text = payload->>'answeredBy'
                  and (
                    m.status in ('queued', 'sending', 'sent', 'delivered')
                    or m.dispatch_attempted_at is not null
                  )
              )
          `;
        }
        return {
          status: 200,
          body: { blocked: false as const, verdict, composed, pick },
        };
      });
      const out = res.body;
      if (out.blocked) return { blocked: true, reason: out.reason, use: out.use };
      if (!res.replayed) {
        const tid = out.composed.body.thread.id;
        emitControlEvent('thread.message', tid);
        if (out.verdict.forceDraft || ctx.draftOnly) emitControlEvent('draft.change', tid);
      }
      // no-ops unless still 'queued'; replayed and fresh both dispatch under
      // this attempt's claim — a cancel/reclaim stops the message via the guard.
      let sendError: string | undefined;
      if (out.verdict.forceDraft === false && !ctx.draftOnly) {
        const sent = await dispatchMessage(sql, out.composed.body.message.id, async (tx) => {
          // capfin BEFORE the claim fence — a run-row → capfin order is the AB-BA the capfin-first rule prevents.
          if (ctx.leadId) {
            const { capLockTx } = await import('./runner.ts');
            await capLockTx(tx, ctx.leadId);
          }
          await assertRunClaimTx(tx, ctx);
          // recheck fresher inbound under capfin — the step-boundary probe can't see one committed since.
          return refuseOnFresherInboundTx(tx, ctx);
        });
        // a composed-but-failed send isn't a landed action — {error} keeps the finish gate honest.
        if (!sent.ok) sendError = sent.reason ?? 'send failed';
      }
      return {
        ...out.composed.body,
        ...(sendError ? { error: sendError } : {}),
        draftFallback: out.verdict.forceDraft || ctx.draftOnly,
        channel: out.pick.channel,
        via: out.pick.via,
        switchedFrom:
          out.pick.prevChannel && out.pick.prevChannel !== out.pick.channel
            ? out.pick.prevChannel
            : undefined,
      };
    }
    case 'remember': {
      const fact = String(args.fact ?? '').slice(0, 500);
      if (!fact) return { error: 'fact is required' };
      const scope = args.scope === 'segment' ? 'segment' : 'workspace';
      const segment = typeof args.segment === 'string' ? args.segment.trim() : '';
      if (scope === 'segment' && !segment) {
        return { error: 'scope=segment needs the `segment` arg' };
      }
      try {
        const { item, evicted } = await controlTx(sql, async (tx) => {
          await assertRunClaimTx(tx, ctx);
          if (!(await hasMemoryTablesTx(tx))) {
            throw new HttpError(
              503,
              'MEMORY_NOT_MIGRATED',
              'agent memory tables not deployed (migration 0035 pending)',
            );
          }
          return rememberTx(tx, {
            scope,
            ...(scope === 'segment' ? { segment } : {}),
            content: fact,
            source: 'agent',
            // stamped only for a real claimed run — sims/tests carry synthetic ids
            sourceRunId: UUID_RE.test(ctx.runId) ? ctx.runId : null,
          });
        });
        return {
          remembered: item.content,
          scope: item.scope,
          ...(item.segment ? { segment: item.segment } : {}),
          ...(evicted.length ? { evicted } : {}),
        };
      } catch (e) {
        // validation/cap/pre-migration rejections are model feedback, not run failures.
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'set_fact': {
      const leadId = String(args.leadId ?? '');
      const key = String(args.key ?? '');
      const value = String(args.value ?? '').slice(0, 500);
      if (!LEAD_FACT_KEY_RE.test(key)) {
        return { error: 'key must be snake_case — ^[a-z][a-z0-9_]{0,59}$' };
      }
      if (!value) return { error: 'value is required' };
      const confidence = args.confidence === undefined ? null : Number(args.confidence);
      if (
        confidence !== null &&
        (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
      ) {
        return { error: 'confidence must be a number in [0, 1]' };
      }
      try {
        const fact = await controlTx(sql, async (tx) => {
          await assertRunClaimTx(tx, ctx);
          if (!(await hasMemoryTablesTx(tx))) {
            throw new HttpError(503, 'MEMORY_NOT_MIGRATED', 'lead facts need migration 0035');
          }
          const lead = await tx`select id from leads where id = ${leadId} limit 1`;
          if (!lead.length) {
            throw new HttpError(404, 'LEAD_NOT_FOUND', 'no such lead', { field: 'leadId' });
          }
          return upsertLeadFactTx(tx, leadId, {
            key,
            value,
            ...(confidence !== null ? { confidence } : {}),
            source: 'agent',
            sourceRunId: UUID_RE.test(ctx.runId) ? ctx.runId : null,
          });
        });
        emitControlEvent('lead.change', leadId);
        return { fact };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    }
    case 'propose_brief': {
      const bname = String(args.name ?? '')
        .trim()
        .slice(0, 120);
      const bquery = String(args.query ?? '')
        .trim()
        .slice(0, 500);
      const reason = String(args.reason ?? '')
        .trim()
        .slice(0, 300);
      if (!bname || !bquery || !reason) {
        return {
          error:
            'propose_brief needs name + query + reason (staff approve on the rationale — a blank one lands a note-less draft)',
        };
      }
      const bsegment =
        String(args.segment ?? '')
          .trim()
          .slice(0, 80) || null;
      const bcity =
        String(args.city ?? '')
          .trim()
          .slice(0, 120) || null;
      let btarget: number | null = null;
      if (args.target !== undefined && args.target !== null && args.target !== '') {
        const n = Number(args.target);
        if (!Number.isInteger(n) || n < 1 || n > 1000) {
          return { error: 'target must be an integer in [1, 1000]' };
        }
        btarget = n;
      }
      const res = await claimControl(
        sql,
        key,
        async (tx): Promise<{ status: number; body: Record<string, unknown> }> => {
          await assertRunClaimTx(tx, ctx);
          // one shared advisory lock makes dup-check+insert atomic across runs (same idiom as 'lead-dedupe').
          await tx`select pg_advisory_xact_lock(hashtext('brief-proposals'))`;
          // name/query dupes come back as a skip — proposing what exists adds noise.
          const dup = (
            await tx<{ id: string; name: string }[]>`
              select id, name from discovery_briefs
              where lower(name) = ${bname.toLowerCase()}
                 or lower(query) = ${bquery.toLowerCase()}
              limit 1
            `
          )[0];
          if (dup) {
            return {
              status: 200,
              body: { proposed: false, duplicate: true, existingName: dup.name },
            };
          }
          // budgeted auto-approval: goes live only when 7d spend + open-work reservation + this brief fits the ceiling; the lock serializes the check.
          const b = await discoveryBudgetTx(tx);
          const autoOn = b.capCents > 0 && b.spent + (b.open + 1) * b.est <= b.capCents;
          const row = (
            await tx<{ id: string; name: string }[]>`
              insert into discovery_briefs (name, query, segment, city, target, enabled, created_by, note)
              values (${bname}, ${bquery}, ${bsegment}, ${bcity}, ${btarget}, ${autoOn}, 'strategist', ${reason || null})
              returning id, name
            `
          )[0]!;
          return {
            status: 200,
            body: {
              proposed: true,
              brief: row,
              enabled: autoOn,
              next: autoOn
                ? 'ativado automaticamente dentro do orçamento semanal de descoberta'
                : 'rascunho desativado no quadro — staff aprova ou descarta; você nunca ativa',
            },
          };
        },
      );
      if (!res.replayed && res.body.proposed === true) {
        emitControlEvent('draft.change', (res.body.brief as { id?: string } | undefined)?.id);
      }
      return res.body;
    }
    case 'request_human': {
      const leadId = String(args.leadId);
      const reason = String(args.reason).slice(0, 500);
      // the whole handoff commits under ONE claim — sub-claims could half-commit
      // on crash and a retry would duplicate the task/note.
      await claimControl(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        const exists = await tx`select 1 from leads where id = ${leadId}`;
        if (!exists[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
        if (ctx.threadId) {
          const rows = await tx`
            update lead_threads set agent_enabled = false where id = ${ctx.threadId}
            returning id
          `;
          if (!rows[0]) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        } else {
          // unbound run: lead-wide pause marker — blocks every channel until staff lifts it; per-thread toggles untouched.
          await tx`
            update leads set agent_paused_at = now(), updated_at = now()
            where id = ${leadId} and agent_paused_at is null
          `;
        }
        await tx`
          insert into lead_tasks (lead_id, title, due_at, created_by)
          values (${leadId}, ${`[humano] ${reason.slice(0, 200)}`}, null, 'agent')
        `;
        await tx`
          insert into lead_activities (lead_id, kind, body, created_by)
          values (${leadId}, 'system', ${`Handoff para humano — ${reason}`}, 'agent')
        `;
        return { status: 200, body: { handedOff: true } };
      });
      return { handedOff: true };
    }
    case 'unsubscribe': {
      const leadId = String(args.leadId);
      const reason = typeof args.reason === 'string' ? args.reason.slice(0, 200) : null;
      const reply = typeof args.reply === 'string' ? args.reply.slice(0, 500) : null;
      // ONE claimed tx under the send:lead lock: farewell + opt-out stamp + note —
      // a concurrent send serializes behind and sees the opt-out; only is_farewell survives.
      type UnsubBody = {
        messageId: string | null;
        threadId: string | null;
        sendBlocked: string | null;
        drafted: boolean;
        changed: boolean;
      };
      const res = await claimControl<UnsubBody>(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        await tx`select pg_advisory_xact_lock(hashtext(${`send:${leadId}`}))`;
        let messageId: string | null = null;
        let threadId: string | null = null;
        let sendBlocked: string | null = null;
        let drafted = false;
        if (reply) {
          const pick = await resolveChannelTx(tx, leadId, {
            requested: null,
            override: ctx.channelOverride,
            threadId: ctx.threadId,
          });
          if (!pick.ok) {
            sendBlocked = pick.reason ?? 'no channel';
          } else {
            const g = await getSettingTx(tx, 'guardrails', {} as Partial<Guardrails>);
            // draft-only runs skip the verdict — a draft never leaves anyway.
            const verdict = ctx.draftOnly
              ? ({ ok: true, forceDraft: false } as const)
              : await checkSendAllowedTx(tx, { ...DEFAULT_GUARDRAILS, ...g }, leadId, pick.channel);
            if (!verdict.ok) {
              sendBlocked = verdict.reason ?? 'guardrail';
              await recordBlockedSendTx(tx, leadId, pick.channel, sendBlocked);
            } else {
              // forceDraft keeps the opt-out but the farewell becomes an approval draft.
              drafted = verdict.forceDraft || ctx.draftOnly;
              const composed = await composeMessageTx(tx, {
                leadId,
                channel: pick.channel,
                body: reply,
                author: 'agent',
                status: drafted ? 'draft' : 'queued',
                agentRunId: ctx.runId,
                farewell: true,
              });
              messageId = composed.body.message.id;
              threadId = composed.body.thread.id;
            }
          }
        }
        const changed = await tx<{ id: string }[]>`
          update leads set unsubscribed_at = now(), updated_at = now()
          where id = ${leadId} and unsubscribed_at is null
          returning id
        `;
        if (changed.length) {
          // opt-out never lifts — kill queued runs now instead of parking them as zombies.
          await tx`
            update agent_runs set status = 'canceled', finished_at = now(), error = 'descadastrado'
            where lead_id = ${leadId} and status = 'queued'
          `;
          // pending mail dies with the opt-out.
          await tx`
            update agent_inbox set consumed_at = now()
            where lead_id = ${leadId} and consumed_at is null
          `;
          await tx`
            insert into lead_activities (lead_id, kind, body, created_by)
            values (${leadId}, 'system', ${`Pediu para sair — opt-out registrado${reason ? ` (${reason})` : ''}`}, 'agent')
          `;
        }
        return {
          status: 200,
          body: {
            messageId,
            threadId,
            sendBlocked,
            drafted,
            changed: changed.length > 0,
          },
        };
      });
      if (!res.replayed) {
        if (res.body.threadId) {
          emitControlEvent('thread.message', res.body.threadId);
          if (res.body.drafted) emitControlEvent('draft.change', res.body.threadId);
        }
        if (res.body.changed) emitControlEvent('lead.change', leadId);
      }
      if (res.body.messageId && !res.body.drafted) {
        // same compose→dispatch gap as send_message — the farewell dies with the run that queued it.
        await dispatchMessage(sql, res.body.messageId, guard);
      }
      return {
        unsubscribed: true,
        farewellSent: !!res.body.messageId && !res.body.drafted,
        ...(res.body.drafted ? { farewellDrafted: true } : {}),
      };
    }
    case 'web_search': {
      const { discoveryFor, annotateResults } = await import('./channels/discovery.ts');
      const provider = await discoveryFor(sql);
      const raw = await provider.search(String(args.query), String(args.purpose ?? ''));
      const { results, droppedDupes } = annotateResults(raw.results);
      return {
        results,
        ...(droppedDupes ? { droppedDupes } : {}),
        note: 'kind=contact já traz phone/whatsappLink da URL; kind=profile instagram vale read_pages (a bio entrega whatsapp + link-in-bio — facebook é login wall); kind=site é o que vale read_pages; listing = diretório/plataforma de pedido — evidência mais que fonte, EXCETO quando o título cita o nome do prospect pesquisado: aí read_pages vale (diretório carrega telefone/endereço). phone/email podem vir do snippet.',
      };
    }
    case 'read_pages': {
      const {
        assertFetchable,
        chaseLinks,
        discoveryFor,
        isMapPointer,
        mapPointerName,
        pageKey,
        resolveMapPointer,
      } = await import('./channels/discovery.ts');
      type ReadPage = import('./channels/discovery.ts').ReadPage;
      const urls = (Array.isArray(args.urls) ? args.urls : [args.url])
        .map((u) => String(u ?? '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (!urls.length) return { error: 'read_pages needs urls: ["https://…"] (1–6)' };
      // dedupe by page identity across run cache and this batch — same page
      // twice = one fetch; validate each miss before it reserves a slot.
      type PageResult = { page: ReadPage | null; error?: string };
      const missOut = new Map<string, Promise<PageResult>>(); // url → its slice
      const fetchable: string[] = [];
      const mapDirects: string[] = [];
      const queued = new Set<string>();
      const replyBound = ctx.runKind === 'reply';
      // reserve-and-charge per real fetch — named map pointers are free
      // (in-process); a nameless shortlink's hop chain pays per issued fetch.
      const reserve = replyBound
        ? async (): Promise<boolean> => {
            if (ctx.pageReads >= REPLY_READ_PAGES_CAP) return false;
            ctx.pageReads++;
            await ctx.markReadSpent?.(1);
            return true;
          }
        : undefined;
      for (const url of urls) {
        const id = pageKey(url) ?? url;
        // validate before the cache short-circuit — pageKey drops the scheme,
        // so an ftp:// miss could inherit a cached https:// page.
        try {
          assertFetchable(url);
        } catch (e) {
          missOut.set(
            url,
            Promise.resolve({
              page: null,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
          continue;
        }
        if (ctx.pageCache.has(id) || queued.has(id)) continue;
        queued.add(id);
        // direct map pointers collect here, resolve after admission —
        // starting now would spend reservations on a batch that may refuse.
        if (isMapPointer(url)) {
          mapDirects.push(url);
          continue;
        }
        fetchable.push(url);
      }
      // reply's bound prices fetches, not calls — all-or-nothing before any
      // fetch issues; cache hits and map pointers spend nothing.
      if (replyBound && fetchable.length) {
        if (ctx.pageReads + fetchable.length > REPLY_READ_PAGES_CAP) {
          return {
            error: `read_pages: limite de ${REPLY_READ_PAGES_CAP} leituras por run de reply — pergunte na conversa o que ainda faltar`,
          };
        }
        ctx.pageReads += fetchable.length;
        // stamp the reservation on the pending journal entry — a reclaim
        // mid-batch replays the real spend.
        await ctx.markReadSpent?.(fetchable.length);
      }
      // admission settled — pointer resolutions behave like any other miss:
      // cached under the pointer's key, a failed resolve doesn't bank.
      for (const url of mapDirects) {
        const key2 = pageKey(url);
        const p: Promise<PageResult> = resolveMapPointer(url, reserve)
          .then((page): PageResult => {
            if (!page) {
              if (key2) ctx.pageCache.delete(key2);
              return { page: null, error: 'map pointer did not resolve' };
            }
            return { page };
          })
          .catch((e): PageResult => {
            if (key2) ctx.pageCache.delete(key2);
            return {
              page: null,
              error: e instanceof Error ? e.message : String(e),
            };
          });
        missOut.set(url, p);
        if (key2) ctx.pageCache.set(key2, p);
      }
      const provider = await discoveryFor(sql);
      const goal = String(args.goal ?? '');
      if (fetchable.length) {
        // one provider call for the whole miss batch — the Fetch API is natively batched.
        const batch: Promise<import('./channels/discovery.ts').ReadPagesResult> = provider
          .readPages(fetchable, goal)
          .then(
            (out) => out,
            (e: unknown) => ({
              pages: [],
              errors: fetchable.map((url) => ({
                url,
                error: e instanceof Error ? e.message : String(e),
              })),
            }),
          );
        for (const url of fetchable) {
          const key2 = pageKey(url);
          const p: Promise<PageResult> = batch.then(async (res) => {
            const page = res.pages.find(
              (pg) => pageKey(pg.url) === key2 || pageKey(pg.finalUrl ?? '') === key2,
            );
            if (page) return { page };
            const err = res.errors.find((er) => pageKey(er.url) === key2);
            // a failed fetch doesn't bank — a retry must reissue it.
            if (key2) ctx.pageCache.delete(key2);
            return { page: null, error: err?.error ?? 'no result for url' };
          });
          missOut.set(url, p);
          if (key2) ctx.pageCache.set(key2, p);
        }
      }
      const pages: unknown[] = [];
      const errs: { url: string; error: string }[] = [];
      for (const url of urls) {
        const key2 = pageKey(url);
        // this url's own slot first — a rejection must never inherit a
        // fetchable twin's page.
        const p =
          missOut.get(url) ??
          (key2 ? (ctx.pageCache.get(key2) as Promise<PageResult> | undefined) : undefined);
        const out = p ? await p : null;
        if (out?.page) {
          // fresh only when the url itself was queued — a shared identity came from another slot's fetch.
          const shared = key2 !== null && queued.has(key2) && !missOut.has(url);
          const fromCache = key2 !== null && !queued.has(key2);
          pages.push({ ...out.page, ...(shared || fromCache ? { cached: true } : {}) });
        } else {
          errs.push({ url, error: out?.error ?? 'no result for url' });
        }
      }
      // one free hop on pointer-only links (link-in-bio hubs, google-business)
      // — chasing inline keeps profile → hub → wa.me in one call.
      const chaseOf: { url: string; from: string }[] = [];
      const chaseSeen = new Set<string>();
      for (const pg of pages as ReadPage[]) {
        for (const link of chaseLinks(pg)) {
          const id = pageKey(link) ?? link;
          if (ctx.pageCache.has(id) || chaseSeen.has(id)) continue;
          chaseSeen.add(id);
          chaseOf.push({ url: link, from: pg.url });
        }
      }
      // chases spend the same reply budget — free map pointers neither spend
      // nor displace slots; paid hops stop when the budget's gone.
      const chases: typeof chaseOf = [];
      if (replyBound) {
        let slots = Math.max(0, REPLY_READ_PAGES_CAP - ctx.pageReads);
        for (const c of chaseOf) {
          if (chases.length >= 4) break;
          const free = mapPointerName(c.url) !== null;
          if (!free) {
            // a paid candidate validates before claiming a slot.
            try {
              assertFetchable(c.url);
            } catch (e) {
              errs.push({
                url: c.url,
                error: e instanceof Error ? e.message : String(e),
              });
              continue;
            }
            if (slots <= 0) continue;
            slots--;
          }
          chases.push(c);
        }
      } else {
        chases.push(...chaseOf.slice(0, 4));
      }
      const hubChases = chases.filter((c) => !isMapPointer(c.url));
      const mapChases = chases.filter((c) => isMapPointer(c.url));
      // non-reply selections never ran the guard — un-fetchable chase urls spend nothing.
      const fetchableHubs = hubChases.filter((c) => {
        try {
          assertFetchable(c.url);
          return true;
        } catch (e) {
          errs.push({
            url: c.url,
            error: e instanceof Error ? e.message : String(e),
          });
          return false;
        }
      });
      if (fetchableHubs.length) {
        if (replyBound) {
          ctx.pageReads += fetchableHubs.length;
          await ctx.markReadSpent?.(fetchableHubs.length);
        }
        const res = await provider
          .readPages(
            fetchableHubs.map((c) => c.url),
            goal,
          )
          .then(
            (out) => out,
            (e: unknown) => ({
              pages: [] as ReadPage[],
              errors: fetchableHubs.map((c) => ({
                url: c.url,
                error: e instanceof Error ? e.message : String(e),
              })),
            }),
          );
        for (const c of fetchableHubs) {
          const key2 = pageKey(c.url);
          const page = res.pages.find(
            (pg) => pageKey(pg.url) === key2 || pageKey(pg.finalUrl ?? '') === key2,
          );
          if (page) {
            pages.push({ ...page, chasedFrom: c.from });
            if (key2) ctx.pageCache.set(key2, Promise.resolve({ page }));
          } else {
            const error =
              res.errors.find((er) => pageKey(er.url) === key2)?.error ?? 'no result for url';
            errs.push({ url: c.url, error });
            // chase failures don't bank either — a retry refetches
          }
        }
      }
      // maps/google-business pointers captcha the fetch provider — resolve
      // the 302 in-process (free); chased hub pages surface them too.
      const mapWave = [...mapChases];
      for (const pg of pages.filter((p) => (p as ReadPage).chasedFrom) as ReadPage[]) {
        for (const link of chaseLinks(pg)) {
          if (!isMapPointer(link)) continue;
          const id = pageKey(link) ?? link;
          if (ctx.pageCache.has(id) || chaseSeen.has(id)) continue;
          if (mapWave.length >= 6) break;
          chaseSeen.add(id);
          mapWave.push({ url: link, from: pg.url });
        }
      }
      for (const c of mapWave.slice(0, 6)) {
        const key2 = pageKey(c.url);
        const page = await resolveMapPointer(c.url, reserve).catch(() => null);
        if (page) {
          pages.push({ ...page, chasedFrom: c.from });
          if (key2) ctx.pageCache.set(key2, Promise.resolve({ page }));
        } else {
          errs.push({ url: c.url, error: 'map pointer did not resolve' });
        }
      }
      return { pages, ...(errs.length ? { errors: errs } : {}) };
    }
    case 'plan': {
      if (ctx.runKind === 'discovery') {
        ctx.plan = String(args.content ?? '').slice(0, 2000);
        return { stored: true, plan: ctx.plan, book: bookDigest(ctx.book) };
      }
      // lead kinds: the checklist persists on the lead; writes merge by step
      // under a row lock — omitted steps survive, 'skip' removes.
      if (!ctx.leadId) return { error: 'plan needs a run bound to a lead' };
      const raw = args.items;
      if (!Array.isArray(raw)) return { error: 'items must be an array' };
      // patch-merge: omitted status/note keep their stored value — a bare step must not un-tick progress.
      const norm = (
        it: unknown,
      ): {
        step: string;
        status: 'todo' | 'done' | 'skip' | null;
        note: string | null | undefined;
      } | null => {
        if (typeof it !== 'object' || it === null) return null;
        const o = it as Record<string, unknown>;
        const step = String(o.step ?? '')
          .trim()
          .slice(0, 200);
        if (!step) return null;
        const status =
          o.status === 'todo' || o.status === 'done' || o.status === 'skip' ? o.status : null;
        const note =
          typeof o.note === 'string'
            ? o.note.trim()
              ? o.note.trim().slice(0, 200)
              : null
            : undefined;
        return { step, status, note };
      };
      const steps = raw
        .slice(0, 12)
        .map(norm)
        .filter((s) => s !== null);
      if (!steps.length) return { error: 'plan needs ≥1 item with a step' };
      const res = await claimControl(sql, key, async (tx) => {
        await assertRunClaimTx(tx, ctx);
        const cur = await tx<{ agent_plan: unknown }[]>`
          select agent_plan from leads where id = ${ctx.leadId!} for update`;
        const prev = Array.isArray(cur[0]?.agent_plan) ? cur[0].agent_plan : [];
        const merged: { step: string; status: string; note: string | null }[] = [];
        const index = new Map<string, number>();
        for (const it of prev) {
          const s = norm(it);
          if (!s || index.has(s.step.toLowerCase())) continue;
          index.set(s.step.toLowerCase(), merged.length);
          merged.push({ step: s.step, status: s.status ?? 'todo', note: s.note ?? null });
        }
        for (const s of steps) {
          const i = index.get(s.step.toLowerCase());
          if (i === undefined) {
            index.set(s.step.toLowerCase(), merged.length);
            merged.push({ step: s.step, status: s.status ?? 'todo', note: s.note ?? null });
          } else {
            const cur0 = merged[i]!;
            merged[i] = {
              step: s.step,
              status: s.status ?? cur0.status,
              note: s.note === undefined ? cur0.note : s.note,
            };
          }
        }
        // 'skip' frees its cap slot — skipped steps ride the tail as history, evicted first.
        const open = merged.filter((s) => s.status !== 'skip');
        const next = open.concat(merged.filter((s) => s.status === 'skip')).slice(0, 12);
        await tx`update leads set agent_plan = ${tx.json(next)}, updated_at = now() where id = ${ctx.leadId!}`;
        return { status: 200 as const, body: { stored: true, plan: next } };
      });
      if (!res.replayed) emitControlEvent('lead.change', ctx.leadId ?? undefined);
      return res.body;
    }
    case 'book': {
      if (args.action === 'list') {
        return { book: bookDigest(ctx.book), entries: [...ctx.book.values()] };
      }
      const name = String(args.name ?? '').trim();
      if (!name) return { error: 'book upsert precisa de name' };
      const key = name.toLowerCase();
      const e = ctx.book.get(key) ?? {
        name,
        city: null,
        status: 'open' as const,
        channels: {},
        tried: [],
        note: null,
      };
      if (typeof args.city === 'string' && args.city.trim()) e.city = args.city.trim();
      if (args.status === 'open' || args.status === 'resolved' || args.status === 'dead')
        e.status = args.status;
      const addedChannels: string[] = [];
      if (args.channels && typeof args.channels === 'object') {
        for (const [k, v] of Object.entries(args.channels as Record<string, unknown>)) {
          const val = String(v ?? '')
            .trim()
            .slice(0, 200);
          const ck = k.toLowerCase().slice(0, 20);
          if (val && e.channels[ck] !== val) {
            e.channels[ck] = val;
            addedChannels.push(ck);
            ctx.seenContacts.add(val);
          }
        }
      }
      if (Array.isArray(args.tried)) {
        for (const t of args.tried) {
          const tag = String(t ?? '')
            .trim()
            .slice(0, 24);
          if (tag && !e.tried.includes(tag)) e.tried.push(tag);
        }
      }
      if (typeof args.note === 'string' && args.note.trim()) e.note = args.note.slice(0, 200);
      ctx.book.set(key, e);
      return { entry: e, addedChannels, book: bookDigest(ctx.book) };
    }
    case 'maps_lookup':
    case 'instagram_profile':
    case 'serp': {
      const { monidRun } = await import('./channels/monid.ts');
      const { contactsFromText, contactFromUrl, isProfileHubUrl, isBrMobilePhone } =
        await import('./channels/discovery.ts');
      const apiKey = process.env.MONID_API_KEY;
      if (!apiKey) return { error: 'MONID_API_KEY não configurada — use web_search/read_pages' };
      const budget = () => ({ spentUsd: ctx.monid?.spent ?? 0, capUsd: ctx.monid?.cap() ?? 0 });
      // contact values that hadn't been banked yet — counts progress
      const freshContacts = (vals: (string | null | undefined)[]): number => {
        let n = 0;
        for (const v of vals) {
          if (v && !ctx.seenContacts.has(v)) {
            ctx.seenContacts.add(v);
            n++;
          }
        }
        return n;
      };
      const str = (v: unknown): string | null => {
        const s = String(v ?? '').trim();
        return s || null;
      };
      const igFrom = (o: Record<string, unknown>): string | null => {
        const m = /instagram\.com\/([\w.]+)/i.exec(JSON.stringify(o));
        return m ? `@${m[1]}` : null;
      };
      if (name === 'maps_lookup') {
        const limit = Math.min(10, Math.max(1, Math.floor(Number(args.limit) || 8)));
        const est = 0.0045 * limit;
        ctx.monid?.reserve(est);
        const city = String(args.city ?? '').trim();
        const res = await monidRun(
          { provider: 'apify', endpoint: '/damilo/google-maps-scraper' },
          {
            query: String(args.query ?? ''),
            // bare city names drift to neighboring towns — anchor on Brasil
            // unless the caller already qualified (", RJ" etc.)
            location: /,/.test(city) ? city : `${city}, Brasil`,
            language: 'pt',
            max_results: limit,
          },
          apiKey,
        );
        ctx.monid?.reconcile(est, res.costUsd || 0.0045 * res.output.length);
        const candidates = res.output.map((r) => {
          const phone = str(r.phone ?? r.phoneNumber ?? r.phone_number ?? r.telefone);
          return {
            name: str(r.name ?? r.title),
            phone,
            // a BR mobile is the whatsapp line — flag it so create_lead can
            // carry it straight into the whatsapp field
            whatsappLikely: phone ? isBrMobilePhone(phone) : false,
            address: str(r.address ?? r.fullAddress ?? r.street),
            website: str(r.website),
            instagram: igFrom(r),
            rating:
              typeof (r.rating ?? r.totalScore) === 'number' ? (r.rating ?? r.totalScore) : null,
            category: str(r.categoryName ?? r.category),
          };
        });
        return {
          candidates,
          newContacts: freshContacts(candidates.map((c) => c.phone)),
          ...budget(),
          next: candidates
            .filter((c) => !c.phone)
            .slice(0, 5)
            .map((c) =>
              c.instagram
                ? `${c.name}: sem telefone — instagram_profile('${c.instagram}') ou serp "${c.name} ${args.city}" telefone`
                : `${c.name}: sem telefone — serp "${c.name} ${args.city}" telefone`,
            ),
        };
      }
      if (name === 'instagram_profile') {
        const handle = String(args.handle ?? '')
          .replace(/^@/, '')
          .trim();
        if (!handle) return { error: 'handle vazio' };
        ctx.monid?.reserve(0.003);
        const res = await monidRun(
          { provider: 'apify', endpoint: '/apify/instagram-profile-scraper' },
          { usernames: [handle] },
          apiKey,
        );
        ctx.monid?.reconcile(0.003, res.costUsd || 0.003 * res.output.length);
        const p = res.output[0];
        if (!p) return { error: `perfil @${handle} não encontrado`, ...budget() };
        const bio = str(p.biography) ?? '';
        const externalUrl =
          str(p.externalUrl) ?? str((p.externalUrls as { url?: string }[])?.[0]?.url);
        const contacts = contactsFromText(bio);
        if (externalUrl) {
          try {
            const c = contactFromUrl(new URL(externalUrl));
            if (c.phone) contacts.phones.push(c.phone);
            if (c.whatsappLink) contacts.whatsappLinks.push(c.whatsappLink);
            if (c.instagram) contacts.instagram.push(c.instagram);
          } catch {
            /* not a url */
          }
        }
        for (const f of ['publicEmail', 'contactPhoneNumber', 'whatsappNumber'] as const) {
          const v = str(p[f]);
          if (v) {
            if (/@/.test(v)) contacts.emails.push(v);
            else contacts.phones.push(v);
          }
        }
        const next: string[] = [];
        const extIsHub = (() => {
          try {
            return externalUrl ? isProfileHubUrl(new URL(externalUrl)) : false;
          } catch {
            return false;
          }
        })();
        if (extIsHub)
          next.push(
            `externalUrl é hub — read_pages("${externalUrl}") entrega os links reais (wa.me mora lá)`,
          );
        else if (externalUrl) next.push(`externalUrl="${externalUrl}" — read_pages vale`);
        if (contacts.phoneHints.length && !contacts.phones.length)
          next.push(
            `phoneHints ${contacts.phoneHints.join(', ')} sem DDD — serp "${handle} ${contacts.phoneHints[0]}" ou "<nome> <cidade>" telefone resolve`,
          );
        return {
          profile: {
            username: str(p.username) ?? handle,
            fullName: str(p.fullName),
            biography: bio,
            externalUrl,
            followers: p.followersCount ?? null,
            category: str(p.businessCategoryName),
          },
          foundContacts: contacts,
          newContacts: freshContacts([
            ...contacts.phones,
            ...contacts.whatsappLinks,
            ...contacts.emails,
          ]),
          ...budget(),
          ...(next.length ? { next } : {}),
        };
      }
      ctx.monid?.reserve(0.001);
      const res = await monidRun(
        { provider: 'mrscraper', endpoint: '/serp/google' },
        { query: String(args.query ?? ''), region: 'br', language: 'pt' },
        apiKey,
      );
      ctx.monid?.reconcile(0.001, res.costUsd || 0.001);
      const results = res.output.slice(0, 10).map((r) => {
        const snippet = str(r.snippet ?? r.description) ?? '';
        return {
          title: str(r.title),
          url: str(r.link ?? r.url),
          snippet: snippet.slice(0, 300),
          contacts: contactsFromText(snippet),
        };
      });
      return {
        results,
        newContacts: freshContacts(
          results.flatMap((r) => [
            ...(r.contacts.phones ?? []),
            ...(r.contacts.whatsappLinks ?? []),
            ...(r.contacts.emails ?? []),
          ]),
        ),
        ...budget(),
        next: [
          'o resultado que citar o nome do prospect (mesmo diretório/guia) → read_pages — é onde telefone mora',
        ],
      };
    }
    default:
      throw new HttpError(422, 'UNKNOWN_TOOL', `unknown tool: ${name}`);
  }
}

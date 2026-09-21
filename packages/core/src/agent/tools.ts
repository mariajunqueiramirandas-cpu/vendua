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
import { composeMessageTx, setThreadAgent, channel } from '../modules/threads.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';
import {
  checkSendAllowedTx,
  resolveChannelTx,
  whatsappReadyTx,
  type SendVerdict,
} from './guardrails.ts';
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
  /** In-flight/finished read_pages calls by page identity — a repeat read
   *  (same step's batch or a later step) shares the same provider call
   *  instead of paying for the identical page twice. */
  pageCache: Map<string, Promise<unknown>>;
  /** Discovery-brief runs stamp created leads' discovered_via with the brief
   *  name so the board can tell scheduled-autopilot finds from ad-hoc ones. */
  briefName: string | null;
  /** Hard per-run ceiling on created leads — the run's meta (params.target),
   *  enforced in code so the prompt can't talk past it. */
  leadCap: number;
  /** Staff channel override from dispatch (`params.channel`) — trumps the
   *  model's own channel pick on send_message/draft_message. */
  channelOverride: 'email' | 'whatsapp' | null;
  /** Working memory — the prospect ledger the agent maintains via `book`
   *  and its self-authored campaign plan via `plan`. Run-scoped; the runner
   *  renders it into reflection ticks and the finish nudge. */
  book: Map<string, BookEntry>;
  plan: string | null;
  /** monid.ai spend guard — enrichment calls charge against a per-run cap
   *  (`params.monidCapUsd`, default 0.25) so a live balance can't loop-drain. */
  monid: import('./channels/monid.ts').MonidBudget | null;
  /** Contact values already banked this run (book channels + enrichment
   *  hits) — a repeated phone/email isn't progress, only a fresh one is. */
  seenContacts: Set<string>;
}

/** One prospect in the agent's ledger — what it found and which moves it
 *  already spent, so the strategist can decide instead of re-walking. */
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
  fitScore: {
    type: 'integer',
    description: '0–10 ICP fit — how well this business matches the target audience',
  },
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
        'Create a new lead (state=lead) — only AFTER researching it. Required in discovery runs: findings (the 2-4 line dossier — what the business sells, size/channel signals, where each contact came from) and at least one contact channel. Pass fitScore/fitReason too — the ICP match judgment. Self-dedupes on name/phone/instagram — a duplicate merges your new contacts + findings into the existing lead and returns {duplicate, merged, existing}.',
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
    // triage included: the first-contact draft IS triage's write-up — but
    // send_message stays out, so a new lead can never be sent unreviewed.
    toolsets: ['triage', 'reply', 'outreach'],
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
    toolsets: ['reply', 'outreach'],
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
    toolsets: ['discovery'],
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
    toolsets: ['discovery'],
    def: {
      name: 'plan',
      description:
        "Write or rewrite your campaign plan — the strategist's map. Call it at the start of the run (segments/angles you'll try, which lane per prospect type, kill-criteria for a prospect that resists) and again whenever field results change the picture. The harness reflects it back at every reflection tick — write what you'd want to be reminded of mid-run. Not scored; your judgment is the point.",
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'the plan, free text (≤2000 chars)' },
        },
        required: ['content'],
      },
    },
  },
  {
    toolsets: ['discovery'],
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
    toolsets: ['discovery'],
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
    toolsets: ['discovery'],
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
    toolsets: ['discovery'],
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
      const findings = typeof args.findings === 'string' ? args.findings.trim() : '';
      const sources = (Array.isArray(args.sources) ? args.sources : [])
        .map((s) => String(s ?? '').trim())
        // Count and length are both bounded — a multi-megabyte "source" is
        // dropped, not truncated, so a stored URL is never a silent fragment.
        .filter((s) => s.length > 0 && s.length <= 500)
        .slice(0, 10);
      // findings/sources are writeup args, not lead columns — strip them so
      // leadInsert/leadPatch never see them.
      delete payload.findings;
      delete payload.sources;
      if (ctx.runKind === 'discovery') {
        // A wa.me/whatsapp URL pasted into phone/whatsapp is a channel
        // mention, not a dialable number — resolve it through contactFromUrl
        // (path-segment aware, so a wa.me/message code or a ?text= full of
        // digits can't masquerade as a phone) or drop it BEFORE the channel
        // gate counts it, or a link-only card would slip through as reachable.
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
            // digit-ish values normalize like the extractors: 10-11 digits =
            // BR local → +55…, 12+ w/ country code → +…, unparseable kept as-is.
            const p = phoneFromText(v.trim());
            if (p) payload[f] = p;
          }
        }
        // instagram lands one shape only — '@handle'. A profile URL
        // (instagram.com/x) or a bare 'x' would otherwise dodge dedupe's
        // handle comparison and split the column into two formats.
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
        // A BR mobile IS whatsapp-reachable — maps listings and directories
        // print "phone" for what is the whatsapp line. Fill the channel when
        // the model left it empty instead of shipping a wa-less lead that the
        // finish gate then has to recover.
        if (
          !payload.whatsapp &&
          typeof payload.phone === 'string' &&
          isBrMobilePhone(payload.phone)
        )
          payload.whatsapp = payload.phone;
        // The bar for a discovered lead, enforced where the prompt can't be
        // talked around: it must carry a research dossier AND a reachable
        // channel — a name-only row is a dead card on the board.
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
        // The Discovery UI panel queries `tag=descoberto` — tag it here so
        // agent-found leads are always findable there.
        const tags = Array.isArray(payload.tags) ? [...payload.tags] : [];
        if (!tags.includes('descoberto')) tags.push('descoberto');
        payload.tags = tags;
      }
      const input = leadInsert(payload);
      const res = await claimControl(sql, key, async (tx) => {
        // The research dossier lands on the timeline as a note — created with
        // the lead in the same claim so a lead can never exist without it.
        let guardrails: Partial<Guardrails> = {};
        let autoOn = false;
        let minScore: number = DEFAULT_GUARDRAILS.discoveryContactMinScore;
        let waDriverOn = false;
        /** The autocontact gate, evaluated on whatever contact data the lead
         *  ends up with — a verified whatsapp (never a guessed phone), a live
         *  whatsapp driver, and fitScore ≥ the configured minimum. */
        const gateFires = (score: number | null, wa: string) =>
          ctx.runKind === 'discovery' &&
          autoOn &&
          waDriverOn &&
          score !== null &&
          score >= minScore &&
          Boolean(wa);
        /** Autocontact is a first-contact, so it suppresses on live runs —
         *  and on ANY outbound message row for the lead: 'failed' sends may
         *  have been accepted by the provider before the crash (recovery
         *  deliberately never retries them), 'rejected' is a staff veto.
         *  A 'done' run that produced no message doesn't count. */
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
          const { insertRun } = await import('./runner.ts');
          return insertRun(tx, {
            kind: 'outreach',
            leadId,
            params: {
              channel: 'whatsapp',
              auto: 'discovery',
              focus: `primeiro contato — lead descoberto (fitScore ${String(score)}). O dossiê de pesquisa está na timeline do lead.`,
            },
          });
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
          // A single advisory key serializes dedupe + cap + insert across ALL
          // runs: batched calls in a step and concurrent discovery runs (brief
          // sweep + manual launch) must not observe the same empty dedupe read
          // and then insert the same prospect twice.
          await tx`select pg_advisory_xact_lock(hashtext('lead-dedupe'))`;
          guardrails = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
          autoOn = guardrails.discoveryAutoContact ?? DEFAULT_GUARDRAILS.discoveryAutoContact;
          minScore =
            guardrails.discoveryContactMinScore ?? DEFAULT_GUARDRAILS.discoveryContactMinScore;
          waDriverOn = await whatsappReadyTx(tx);
          // Dedupe before the cap check so a repeat prospect can't burn cap:
          // each phone/whatsapp number is normalized independently and matched
          // against BOTH stored columns (a landline and a WhatsApp can differ),
          // instagram handles compare case-folded, and a name/business hit only
          // counts when the incoming city is present and equal — common names
          // alone don't merge distinct businesses.
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
            // Known prospect, new research: fill still-empty contact/profile
            // columns (never overwrite what a human or earlier run set) and
            // append the dossier to its timeline instead of dropping it.
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
            // fit_score isn't a text column — fill it separately when the
            // existing card never got scored.
            if (
              typeof input.fit_score === 'number' &&
              (dup.fit_score === null || dup.fit_score === undefined)
            ) {
              set.fit_score = input.fit_score;
              merged.push('fit_score');
            }
            // An enriched dup clears the same gate a fresh lead would — but
            // only while the card is still untouched ('lead'), nobody
            // switched its agent off ('off' is a human veto, never override),
            // and no outreach is already live for it.
            const dupScore = (set.fit_score ?? dup.fit_score) as number | null;
            const dupWa = String(set.whatsapp ?? dup.whatsapp ?? '').trim();
            const dupContact =
              gateFires(dupScore, dupWa) &&
              dup.state === 'lead' &&
              dup.agent_mode !== 'off' &&
              !(await outreachActive(dup.id as string));
            if (dupContact && dup.agent_mode !== 'auto') {
              set.agent_mode = 'auto';
              merged.push('agent_mode');
            }
            if (merged.length) {
              await tx`update leads set ${tx(set)}, updated_at = now() where id = ${dup.id as string}`;
            }
            await writeFindings(dup.id as string, { merged });
            const contactRun = dupContact ? await queueOutreach(dup.id as string, dupScore) : null;
            return {
              status: 200,
              body: {
                duplicate: true as const,
                merged,
                ...(contactRun ? { contactRun } : {}),
                existing: { id: dup.id, name: dup.name, state: dup.state },
              } as never,
            };
          }
          // Hard cap, enforced in code the prompt can't talk away: count this
          // run's claim keys whose stored response actually created a lead
          // (`response.lead.id`) — duplicate/no-op responses commit a claim
          // row but must not burn cap slots. This call's own claim row has no
          // response yet, so n = leads already created. The cap IS the run's
          // meta — "criar até N" enforced, no separate guardrail setting.
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
        // Score gate → first contact without a human round-trip: a high-fit
        // lead with a VERIFIED whatsapp (never a guessed phone — a `phone`
        // can be a landline) and a live whatsapp driver gets agent autonomy
        // + an outreach run queued in the same claim. The send still obeys
        // the messaging guardrails (firstContactDraftOnly → approval queue).
        const newScore = typeof input.fit_score === 'number' ? input.fit_score : null;
        const autoContact = gateFires(newScore, String(input.whatsapp ?? '').trim());
        if (autoContact) input.agent_mode = 'auto';
        const created = await insertLeadTx(tx, input);
        await writeFindings(created.body.lead.id as string);
        if (autoContact) {
          const contactRun = await queueOutreach(created.body.lead.id, newScore);
          return {
            ...created,
            body: { ...created.body, contactRun } as never,
          };
        }
        return created;
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
      const leadId = String(args.leadId);
      // Resolve inside the same claim that writes the draft — a bounce or
      // contact edit landing between resolution and insert can't strand a
      // draft on a dead channel for staff to approve into a failure.
      type DraftBody =
        | { blocked: true; reason: string | undefined; use?: string | null }
        | (Awaited<ReturnType<typeof composeMessageTx>>['body'] & {
            channel: string;
            via: string;
          });
      const res = await claimControl<DraftBody>(sql, key, async (tx) => {
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
        const composed = await composeMessageTx(tx, {
          leadId,
          channel: pick.channel,
          body: String(args.body),
          subject: (args.subject as string) ?? undefined,
          author: 'agent',
          status: 'draft',
        });
        return {
          status: composed.status,
          body: { ...composed.body, channel: pick.channel, via: pick.via },
        };
      });
      return res.body;
    }
    case 'send_message': {
      const leadId = String(args.leadId);
      const chanArg = args.channel ? channel(args.channel) : null;
      // Claimed: a retried tool call replays the recorded decision instead of
      // composing again. The advisory lock serializes concurrent sends on the
      // lead so the daily-cap count sees the winner's queued row.
      type SendBody =
        | { blocked: true; reason: string | undefined; use?: string | null }
        | {
            blocked: false;
            verdict: SendVerdict;
            composed: Awaited<ReturnType<typeof composeMessageTx>>;
            pick: Extract<Awaited<ReturnType<typeof resolveChannelTx>>, { ok: true }>;
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
        // Channel resolution inside the same claim: staff override > the
        // model's arg > continuity > whatsapp > email. A dead channel blocks
        // with the reachable alternative so the model retries on it — never
        // compose on air.
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
        const verdict = await checkSendAllowedTx(tx, { ...DEFAULT_GUARDRAILS, ...g }, leadId, chan);
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
        return {
          status: 200,
          body: { blocked: false as const, verdict, composed, pick },
        };
      });
      const out = res.body;
      if (out.blocked) return { blocked: true, reason: out.reason, use: out.use };
      // dispatchMessage no-ops unless the row is still 'queued' — safe when
      // this response replays.
      if (!res.replayed && out.verdict.forceDraft === false) {
        await dispatchMessage(sql, out.composed.body.message.id);
      }
      return {
        ...out.composed.body,
        draftFallback: out.verdict.forceDraft,
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
        note: 'kind=contact já traz phone/whatsappLink da URL; kind=profile instagram vale read_pages (a bio entrega whatsapp + link-in-bio — facebook é login wall); kind=site é o que vale read_pages; listing = diretório/plataforma de pedido — evidência mais que fonte, EXCETO quando o título cita o nome do prospect pesquisado: aí read_pages vale (diretório carrega telefone/endereço). phone/email podem vir do snippet.',
      };
    }
    case 'read_pages': {
      const { chaseLinks, discoveryFor, isMapPointer, pageKey, resolveMapPointer } =
        await import('./channels/discovery.ts');
      type ReadPage = import('./channels/discovery.ts').ReadPage;
      const urls = (Array.isArray(args.urls) ? args.urls : [args.url])
        .map((u) => String(u ?? '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (!urls.length) return { error: 'read_pages needs urls: ["https://…"] (1–6)' };
      const provider = await discoveryFor(sql);
      const goal = String(args.goal ?? '');
      type PageResult = {
        page: import('./channels/discovery.ts').ReadPage | null;
        error?: string;
      };
      // Dedupe by page identity across the run cache AND this call — the
      // same page twice in one batch (https vs https://www, trailing slash)
      // resolves to one fetch, not two.
      const miss: string[] = [];
      const queued = new Set<string>();
      for (const url of urls) {
        const id = pageKey(url) ?? url;
        if (ctx.pageCache.has(id) || queued.has(id)) continue;
        queued.add(id);
        miss.push(url);
      }
      const missOut = new Map<string, Promise<PageResult>>(); // miss url → its slice
      if (miss.length) {
        // One provider call for the whole miss batch — the Fetch API is
        // natively batched, so N misses still cost a single HTTP round-trip.
        const batch: Promise<import('./channels/discovery.ts').ReadPagesResult> = provider
          .readPages(miss, goal)
          .then(
            (out) => out,
            (e: unknown) => ({
              pages: [],
              errors: miss.map((url) => ({
                url,
                error: e instanceof Error ? e.message : String(e),
              })),
            }),
          );
        for (const url of miss) {
          const key2 = pageKey(url);
          const p: Promise<PageResult> = batch.then(async (res) => {
            const page = res.pages.find(
              (pg) => pageKey(pg.url) === key2 || pageKey(pg.finalUrl ?? '') === key2,
            );
            if (page) return { page };
            const err = res.errors.find((er) => pageKey(er.url) === key2);
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
        const p =
          (key2 ? (ctx.pageCache.get(key2) as Promise<PageResult> | undefined) : undefined) ??
          missOut.get(url);
        const out = p ? await p : null;
        if (out?.page) {
          // fresh this call only when the url itself was queued — a shared
          // identity means the output came from another slot's fetch.
          const shared = key2 !== null && queued.has(key2) && !missOut.has(url);
          const fromCache = key2 !== null && !queued.has(key2);
          pages.push({ ...out.page, ...(shared || fromCache ? { cached: true } : {}) });
        } else {
          errs.push({ url, error: out?.error ?? 'no result for url' });
        }
      }
      // One free hop on the pointer-only links a page surfaces — link-in-bio
      // hubs and google-business/maps entries exist solely to hold the real
      // contact block. Chasing them inline keeps the profile → hub → wa.me
      // path inside a single tool call instead of spending a model step on
      // a read we already know pays off.
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
      const chases = chaseOf.slice(0, 4);
      const hubChases = chases.filter((c) => !isMapPointer(c.url));
      const mapChases = chases.filter((c) => isMapPointer(c.url));
      if (hubChases.length) {
        const res = await provider
          .readPages(
            hubChases.map((c) => c.url),
            goal,
          )
          .then(
            (out) => out,
            (e: unknown) => ({
              pages: [] as ReadPage[],
              errors: hubChases.map((c) => ({
                url: c.url,
                error: e instanceof Error ? e.message : String(e),
              })),
            }),
          );
        for (const c of hubChases) {
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
            if (key2) ctx.pageCache.set(key2, Promise.resolve({ page: null, error }));
          }
        }
      }
      // Maps/google-business pointers captcha the fetch provider — resolve the
      // 302 in-process instead: the target URL names the business profile,
      // which is the exact web_search query that exposes its phone. Second
      // wave: chased hub pages surface these pointers too (instagram →
      // linktr.ee → g.co/kgs), and in-process resolution is free, so map
      // pointers on chased pages resolve as well (no extra provider call).
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
        const page = await resolveMapPointer(c.url).catch(() => null);
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
      ctx.plan = String(args.content ?? '').slice(0, 2000);
      return { stored: true, plan: ctx.plan, book: bookDigest(ctx.book) };
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
      // serp — one cheap google page for a named prospect
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

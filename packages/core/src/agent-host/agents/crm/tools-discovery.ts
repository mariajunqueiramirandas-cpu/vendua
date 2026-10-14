import { defineTool, s, ToolError, type Json, type ToolResult } from '@vendua/agent-runtime';
import { PLATFORM_TENANT_ID } from '../../../platform/tenancy.ts';
import type { Sql } from '../../../platform/db.ts';
import { getLeadDetail, insertLeadTx, leadInsert, listLeads } from '../../../modules/leads.ts';
import {
  DEFAULT_GUARDRAILS,
  getSettingTx,
  newLeadModesOf,
  type Guardrails,
} from '../../../modules/integrations.ts';
import { instagramHandle } from '../../../modules/threads.ts';
import { contactFromUrl, isBrMobilePhone, phoneFromText } from '../../../crm/channels/discovery.ts';
import { whatsappRegistered } from '../../../crm/channels/whatsapp.ts';
import { instagramReadyTx, whatsappReadyTx } from '../../../crm/guardrails.ts';
import { parseWakeupAt } from '../../../crm/agenda.ts';
import { requestLeadTx } from '../../../crm/dispatch.ts';
import { LEAD_FIELDS } from './fields.ts';
import { addNoteAs, updateLeadAs } from './tools-lead.ts';
import { crm, emitAfter, refusals, turn, type BookEntry, type Ctx } from './shared.ts';

// The discovery agent's hands on the CRM: it finds prospects, files them as leads and, past the
// score gate, wakes each new lead's own agent for the first contact. It sees leads by alias
// (`l3`), never by id, and may change only the leads this turn created or merged into.

/** created leads per turn when the request names no target */
export const DISCOVERY_LEAD_CAP = 20;
const LEAD = 'lead';

const leadCap = (ctx: Ctx): number => {
  const t = Math.floor(Number(turn(ctx.state).params.target));
  return Number.isFinite(t) && t > 0 ? Math.min(1000, t) : DISCOVERY_LEAD_CAP;
};

/** A lead this turn created or merged into; anything else is out of reach. */
function ownLead(ctx: Ctx, ref: string): string {
  const id = ctx.resolve(ref, LEAD);
  if (!turn(ctx.state).leads.includes(id))
    throw new ToolError(
      `${ref} não foi criado nem mesclado nesta run — só leads desta run podem ser alterados`,
    );
  return id;
}

export const searchLeadsTool = defineTool<{ q: string; state?: string | undefined }, Sql>({
  name: 'search_leads',
  description:
    'Check names against the leads already registered: free + instant. A maps/web sweep surfaces CANDIDATE names → search_leads filters them → only the misses are worth paid investigation. A hit is a POSSIBLE duplicate (broad substring match): compare name/business/city before discarding. q matches name/business/instagram/email/phone/whatsapp (phone digits match normalized numbers). Returns channel flags + whatsappVerified.',
  effect: 'read',
  input: s.object({
    q: s.string({ min: 1, max: 200 }),
    state: s.enum(['lead', 'contacted', 'invited', 'live']).optional(),
  }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const { leads } = await listLeads(ctx.tx, {
        q: input.q,
        ...(input.state ? { state: input.state as never } : {}),
        limit: 10,
      });
      const matches = leads.map((l) => ({
        ref: ctx.alias(LEAD, l.id),
        name: l.name,
        business: l.businessName,
        state: l.state,
        score: l.score,
        city: l.city,
        segment: l.segment,
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
      } as unknown as Json;
    }),
});

export const discoveryGetLeadTool = defineTool<{ lead: string }, Sql>({
  name: 'get_lead',
  description: 'Full lead profile (fields, tags, score, counters) of a lead ref from this run.',
  effect: 'read',
  input: s.object({ lead: s.string({ min: 1, max: 20 }).describe('lead ref, e.g. l3') }),
  run: (ctx: Ctx, input) =>
    refusals(async () => {
      const lead = await getLeadDetail(ctx.tx, ctx.resolve(input.lead, LEAD));
      if (!lead) throw new ToolError(`${input.lead}: lead não encontrado`);
      const { id: _id, ...rest } = lead;
      return { ref: input.lead, ...rest } as unknown as Json;
    }),
});

export const discoveryUpdateLeadTool = defineTool<Record<string, unknown>, Sql>({
  name: 'update_lead',
  description:
    'Patch a lead this run created or merged (contact info, tags, scores). A contact field can only be filled while empty.',
  effect: 'write',
  input: s.object({ lead: s.string({ min: 1, max: 20 }).describe('lead ref'), ...LEAD_FIELDS }),
  run: (ctx: Ctx, input) => {
    const { lead, ...rest } = input as { lead: string } & Record<string, unknown>;
    return updateLeadAs(ctx, ownLead(ctx, lead), rest);
  },
});

export const discoveryAddNoteTool = defineTool<{ lead: string; body: string }, Sql>({
  name: 'add_note',
  description: 'Append a note to the timeline of a lead this run created or merged.',
  effect: 'write',
  input: s.object({
    lead: s.string({ min: 1, max: 20 }).describe('lead ref'),
    body: s.string({ min: 1, max: 4000 }),
  }),
  run: (ctx: Ctx, input) => addNoteAs(ctx, ownLead(ctx, input.lead), input.body),
});

type CreateInput = Record<string, unknown> & {
  name: string;
  findings: string;
  sources?: string[] | undefined;
};

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

const digits = (v: unknown) =>
  typeof v === 'string' && v.replace(/\D/g, '').length >= 8 ? v.replace(/\D/g, '') : null;

function asUrl(v: string): URL | null {
  for (const candidate of [v, `https://${v}`]) {
    try {
      return new URL(candidate);
    } catch {
      /* try next form */
    }
  }
  return null;
}

/** Contact values in the shapes dedupe compares: wa.me links resolved, phones normalized,
 *  instagram as '@handle'. Returns whether the whatsapp was derived from a BR mobile. */
function normalizeContacts(payload: Record<string, unknown>): boolean {
  for (const f of ['phone', 'whatsapp'] as const) {
    const v = payload[f];
    if (typeof v === 'string' && /wa\.me|whatsapp\.com/i.test(v)) {
      const u = asUrl(v);
      payload[f] = u ? (contactFromUrl(u).phone ?? undefined) : undefined;
    } else if (typeof v === 'string' && /^[\d\s()+.-]+$/.test(v.trim())) {
      const p = phoneFromText(v.trim());
      if (p) payload[f] = p;
    }
  }
  const ig = payload.instagram;
  if (typeof ig === 'string' && ig.trim()) {
    const u = asUrl(ig.trim());
    const h = u?.hostname.toLowerCase().replace(/^www\./, '') ?? '';
    if (u && (h === 'instagram.com' || h === 'm.instagram.com'))
      payload.instagram = contactFromUrl(u).instagram ?? undefined;
    else {
      const m = /^@?([\w.-]+)$/.exec(ig.trim());
      payload.instagram = m ? `@${m[1]}` : undefined;
    }
  }
  // a BR mobile IS whatsapp-reachable: filled, but marked derived so the autocontact gate still
  // asks for real evidence
  const derived =
    !payload.whatsapp && typeof payload.phone === 'string' && isBrMobilePhone(payload.phone);
  if (derived) payload.whatsapp = payload.phone;
  return derived;
}

export const createLeadTool = defineTool<CreateInput, Sql>({
  name: 'create_lead',
  description:
    'Create a new lead (state=lead), only AFTER researching it. Requires findings (the 2-4 line dossier: what the business sells, size/channel signals, where each contact came from) and at least one contact channel. Pass fitScore/fitReason (ICP match) and intentScore/intentReason (buying intent). Self-dedupes on name+city/phone/instagram: a duplicate merges your new contacts + findings into the existing lead and returns {duplicate, merged, existing}.',
  effect: 'write',
  input: s.object({
    name: s.string({ min: 1, max: 200 }),
    ...LEAD_FIELDS,
    findings: s
      .string({ max: 4000 })
      .describe(
        'the research dossier: what the business sells, fit signals, best channel, sources',
      ),
    sources: s
      .array(s.string({ max: 2000 }), { max: 20 })
      .describe('urls consulted while researching')
      .optional(),
  }),
  run: (ctx: Ctx, input): Promise<ToolResult> =>
    refusals(async (): Promise<ToolResult> => {
      const t = turn(ctx.state);
      const { findings: rawFindings, sources: rawSources, ...fields } = input;
      const payload: Record<string, unknown> = { ...fields };
      for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
      const findings = rawFindings.trim();
      // an over-long source is dropped, not cut: a stored URL is never a fragment
      const sources = (rawSources ?? [])
        .map((x) => x.trim())
        .filter((x) => x.length > 0 && x.length <= 500)
        .slice(0, 10);
      let whatsappDerived = normalizeContacts(payload);
      // the discovered-lead bar, in code: a dossier AND a reachable channel
      if (findings.length < 20)
        return {
          error:
            'FINDINGS_REQUIRED — escreva o dossiê do prospect (2-4 linhas: o que o negócio vende, sinais de porte/canal, de onde veio cada contato). Lead sem pesquisa não entra no CRM.',
        };
      const channels = ['phone', 'whatsapp', 'email', 'instagram', 'website'];
      if (!channels.some((f) => typeof payload[f] === 'string' && String(payload[f]).trim()))
        return {
          error:
            'NO_CHANNEL — o lead precisa de ≥1 canal de contato (phone/whatsapp/email/instagram/website). Pesquise mais o prospect (read_pages, web_search "nome cidade", serp "nome cidade") ou desista dele.',
        };
      payload.discoveredVia = t.params.briefName
        ? `agente·${t.params.briefName}`.slice(0, 120)
        : 'agente';
      // the Discovery panel queries tag=descoberto
      const tags = Array.isArray(payload.tags) ? [...(payload.tags as string[])] : [];
      if (!tags.includes('descoberto')) tags.push('descoberto');
      payload.tags = tags;
      const row = leadInsert(payload);
      // a date set here is the agent's own plan (insertLeadTx books it), with the agent's floor
      if (typeof row.next_action_at === 'string') {
        const at = parseWakeupAt(row.next_action_at, ctx.now.getTime());
        if (typeof at === 'string') throw new ToolError(`nextActionAt: ${at}`);
      }
      row.whatsapp_verified = Boolean(row.whatsapp) && !whatsappDerived;

      const out = await crm(ctx, async (tx) => {
        const g = {
          ...DEFAULT_GUARDRAILS,
          ...(await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {})),
        };
        const waReady = await whatsappReadyTx(tx);
        const igReady = g.instagramColdDmsPerDay > 0 && (await instagramReadyTx(tx));
        // a derived whatsapp is promoted when the number is registered: the probe is a network
        // call, made only when it could unlock a first contact
        const score = typeof row.fit_score === 'number' ? row.fit_score : null;
        if (
          whatsappDerived &&
          g.discoveryAutoContact &&
          waReady &&
          score !== null &&
          score >= g.discoveryContactMinScore &&
          (await whatsappRegistered(String(row.whatsapp), tx).catch(() => null)) === true
        ) {
          whatsappDerived = false;
          row.whatsapp_verified = true;
        }
        /** the autocontact gate: fitScore ≥ min, then a verified whatsapp on a live driver, else
         *  an instagram handle on a live sidecar with cold DMs on */
        const gateFires = (
          sc: number | null,
          wa: string,
          ig: unknown,
        ): 'whatsapp' | 'instagram' | null => {
          if (!g.discoveryAutoContact || sc === null || sc < g.discoveryContactMinScore)
            return null;
          if (waReady && wa) return 'whatsapp';
          if (igReady && typeof ig === 'string' && instagramHandle(ig)) return 'instagram';
          return null;
        };
        /** a first contact waits on nothing already in flight: pending outreach mail, any
         *  outbound row (a failed send may still have reached the wire), or a lead who already
         *  wrote (their reply turn is the contact) */
        const outreachActive = async (leadId: string) => {
          const [hit] = await tx`
            select 1 from lead_messages m join lead_threads th on th.id = m.thread_id
            where th.lead_id = ${leadId} and m.direction in ('out', 'in')
            union all
            select 1 from agent_mailbox mb join agent_actors a on a.id = mb.actor_id
            where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = 'crm' and a.subject_kind = 'lead' and a.subject_id = ${leadId}
              and mb.consumed_by_turn is null
              and mb.kind in ('lead.first_contact', 'timer.followup')
            limit 1`;
          return Boolean(hit);
        };
        const firstContact = async (
          leadId: string,
          sc: number | null,
          chan: 'whatsapp' | 'instagram',
        ) => {
          if (await outreachActive(leadId)) return false;
          const r = await requestLeadTx(tx, {
            leadId,
            kind: 'lead.first_contact',
            source: 'first_contact',
            dedupeKey: `crm:first_contact:${leadId}`,
            payload: {
              channel: chan,
              focus: `primeiro contato — lead descoberto (fitScore ${String(sc)}). O dossiê de pesquisa está na timeline do lead.`,
            },
          });
          return r.mailboxId !== null;
        };
        const writeFindings = (leadId: string, extra: Record<string, unknown> = {}) => tx`
          insert into lead_activities (lead_id, kind, body, meta, created_by)
          values (${leadId}, 'note', ${findings.slice(0, 4000)},
                  ${tx.json({ type: 'research', sources, ...extra } as never)}, 'agent')`;

        // one key serializes dedupe + cap + insert: concurrent hunts never file one prospect twice
        await tx`select pg_advisory_xact_lock(hashtext('lead-dedupe'))`;
        const phones = [digits(row.phone), digits(row.whatsapp)].filter(
          (d): d is string => d !== null,
        );
        const ig =
          typeof row.instagram === 'string' && row.instagram.trim()
            ? row.instagram.trim().replace(/^@/, '').toLowerCase()
            : null;
        const nameKey = String(row.name ?? '')
          .trim()
          .toLowerCase();
        const bizKey =
          typeof row.business_name === 'string' && row.business_name.trim()
            ? row.business_name.trim().toLowerCase()
            : null;
        const city =
          typeof row.city === 'string' && row.city.trim() ? row.city.trim().toLowerCase() : null;
        // dedupe before the cap so a repeat can't burn it; a name only merges within its city
        const [dup] = await tx<Record<string, unknown>[]>`
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
          limit 1`;
        if (dup) {
          const dupId = dup.id as string;
          // fill still-empty columns, never overwrite
          const set: Record<string, unknown> = {};
          const merged: string[] = [];
          for (const col of FILL_COLS) {
            const v = row[col];
            const cur = dup[col];
            if (typeof v === 'string' && v.trim() && (cur == null || String(cur).trim() === '')) {
              set[col] = v.trim();
              merged.push(col);
            }
          }
          for (const col of ['fit_score', 'intent_score'] as const)
            if (typeof row[col] === 'number' && dup[col] == null) {
              set[col] = row[col];
              merged.push(col);
            }
          if ('whatsapp' in set) set.whatsapp_verified = !whatsappDerived;
          // an explicit whatsapp matching a stored unverified one confirms it
          if (
            !whatsappDerived &&
            row.whatsapp &&
            dup.whatsapp &&
            dup.whatsapp_verified !== true &&
            digits(String(dup.whatsapp)) === digits(String(row.whatsapp))
          ) {
            set.whatsapp_verified = true;
            if (!merged.includes('whatsapp_verified')) merged.push('whatsapp_verified');
          }
          const dupScore = (set.fit_score ?? dup.fit_score) as number | null;
          const dupWa =
            (dup.whatsapp_verified === true || set.whatsapp_verified === true
              ? String(dup.whatsapp ?? '').trim()
              : '') || (whatsappDerived ? '' : String(set.whatsapp ?? '').trim());
          const dupChan = gateFires(dupScore, dupWa, set.instagram ?? dup.instagram);
          if (merged.length)
            await tx`update leads set ${tx(set)}, updated_at = now() where id = ${dupId}`;
          // an enriched dup clears the gate only while untouched and not vetoed by staff
          const contacted =
            dupChan && dup.state === 'lead' && dup.agent_mode !== 'off'
              ? await firstContact(dupId, dupScore, dupChan)
              : false;
          if (contacted && dup.agent_mode !== 'auto') {
            await tx`update leads set agent_mode = 'auto', updated_at = now() where id = ${dupId}`;
            merged.push('agent_mode');
          }
          await writeFindings(dupId, { merged });
          return {
            id: dupId,
            created: false,
            shown: {
              duplicate: true,
              merged,
              ...(contacted ? { firstContactQueued: true } : {}),
              existing: { ref: ctx.alias(LEAD, dupId), name: dup.name, state: dup.state },
              // a merge does NOT count toward META: say so or the model stops hunting
              next: 'duplicado — NÃO conta pra META; siga o plano e traga prospects novos',
            },
          };
        }
        const cap = leadCap(ctx);
        if (t.leadsCreated >= cap)
          throw new ToolError(`DISCOVERY_CAP: discovery cap reached — max ${cap} leads per run`);
        const autoContact = gateFires(
          score,
          whatsappDerived ? '' : String(row.whatsapp ?? '').trim(),
          row.instagram,
        );
        const created = await insertLeadTx(
          tx,
          { ...row, agent_mode: newLeadModesOf(await getSettingTx(tx, 'agent', null)).discovery },
          'agent',
        );
        const lead = created.body.lead;
        await writeFindings(lead.id);
        const contacted = autoContact ? await firstContact(lead.id, score, autoContact) : false;
        if (contacted && lead.agentMode !== 'auto') {
          await tx`update leads set agent_mode = 'auto', updated_at = now() where id = ${lead.id}`;
          lead.agentMode = 'auto';
        }
        const { id: _id, ...visible } = lead;
        return {
          id: lead.id,
          created: true,
          shown: {
            lead: { ref: ctx.alias(LEAD, lead.id), ...visible },
            ...(contacted ? { firstContactQueued: true } : {}),
            ...(whatsappDerived
              ? {
                  whatsappUnverified: true,
                  next: 'whatsapp derivado do celular — um wa.me/link-in-bio confirma de verdade (e destrava autocontato)',
                }
              : {}),
            leadsCreated: t.leadsCreated + 1,
            cap,
          },
        };
      });
      emitAfter(ctx, 'lead.change', out.id);
      // data carries the real id for the turn's fold; the model reads the ref
      return {
        content: JSON.stringify(out.shown),
        data: { ...(out.shown as Record<string, Json>), leadId: out.id, created: out.created },
      };
    }),
});

export const campaignPlanTool = defineTool<{ content: string }, Sql>({
  name: 'plan',
  description:
    "The campaign map for this run: call it at the start (segments/angles you'll try, kill-criteria) and again when results change the picture. Run-scoped working memory.",
  effect: 'write',
  input: s.object({ content: s.string({ min: 1, max: 2000 }) }),
  run: (ctx: Ctx, input) => ({
    stored: true,
    campaign: input.content,
    book: bookDigest(turn(ctx.state).book),
  }),
});

/** Compact ledger render: echoed by book/plan and shown on every step of a discovery turn. */
export function bookDigest(book: readonly BookEntry[]): string {
  if (!book.length) return '(livro vazio)';
  return book
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

interface BookInput {
  action: 'upsert' | 'list';
  name?: string | undefined;
  city?: string | undefined;
  status?: 'open' | 'resolved' | 'dead' | undefined;
  channels?:
    | {
        whatsapp?: string | undefined;
        phone?: string | undefined;
        instagram?: string | undefined;
        email?: string | undefined;
        site?: string | undefined;
      }
    | undefined;
  tried?: string[] | undefined;
  note?: string | undefined;
}

export const bookTool = defineTool<BookInput, Sql>({
  name: 'book',
  description:
    "Your prospect ledger: working memory. 'upsert' the moment a prospect enters the radar, BEFORE the next move on it: name, channels found (whatsapp/phone/instagram/email/site with values), the move tags already spent (tried: 'maps','ig','hub','serp','dir'), status open|resolved|dead, and a short note. 'list' dumps it. The ledger is shown back to you every step: dead must be earned with spent moves.",
  effect: 'write',
  input: s.object({
    action: s.enum(['upsert', 'list']),
    name: s.string({ max: 200 }).optional(),
    city: s.string({ max: 120 }).optional(),
    status: s.enum(['open', 'resolved', 'dead']).optional(),
    channels: s
      .object({
        whatsapp: s.string({ max: 200 }).optional(),
        phone: s.string({ max: 200 }).optional(),
        instagram: s.string({ max: 200 }).optional(),
        email: s.string({ max: 200 }).optional(),
        site: s.string({ max: 200 }).optional(),
      })
      .describe('the channels found, with values')
      .optional(),
    tried: s
      .array(s.string({ max: 24 }), { max: 12 })
      .describe('move tags already spent on this prospect')
      .optional(),
    note: s.string({ max: 400 }).optional(),
  }),
  run(ctx: Ctx, input) {
    const book = turn(ctx.state).book;
    if (input.action === 'list')
      return { book: bookDigest(book), entries: book } as unknown as Json;
    const name = (input.name ?? '').trim().slice(0, 200);
    if (!name) throw new ToolError('book upsert precisa de name');
    const prev = book.find((e) => e.name.toLowerCase() === name.toLowerCase());
    const e: BookEntry = prev
      ? { ...prev, channels: { ...prev.channels }, tried: [...prev.tried] }
      : { name, city: null, status: 'open', channels: {}, tried: [], note: null };
    if (input.city?.trim()) e.city = input.city.trim();
    if (input.status) e.status = input.status;
    const added: string[] = [];
    const contacts: string[] = [];
    for (const [k, v] of Object.entries(input.channels ?? {})) {
      const val = String(v ?? '')
        .trim()
        .slice(0, 200);
      const ck = k.toLowerCase().slice(0, 20);
      if (val && e.channels[ck] !== val) {
        e.channels[ck] = val;
        added.push(ck);
        contacts.push(val);
      }
    }
    for (const tag of input.tried ?? []) {
      const x = tag.trim();
      if (x && !e.tried.includes(x)) e.tried.push(x);
    }
    if (input.note?.trim()) e.note = input.note.trim().slice(0, 200);
    const next = [...book.filter((b) => b !== prev), e];
    return {
      content: JSON.stringify({ entry: e, addedChannels: added, book: bookDigest(next) }),
      data: { entry: e, contacts } as unknown as Json,
    };
  },
});

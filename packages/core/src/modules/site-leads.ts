import type { Hono } from 'hono';
import { retireWakeupsOnInboundTx } from '../crm/agenda.ts';
import { salesAttentionTx } from '../crm/delivery-policy.ts';
import { CRM_AGENT_ID, requestLeadTx } from '../crm/dispatch.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, clientIp, windowCounter } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { controlTx } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { getSettingTx, newLeadModesOf, phoneIsIgnored } from './integrations.ts';
import { e164Phone, insertLeadTx } from './leads.ts';
import { contactDigits } from './threads.ts';
import { blockedPhonesTx } from './staff.ts';
import { recordStaffEventTx } from './staff-events.ts';

// "Quer ajuda para começar?" on the marketing site: a shop owner leaves a name and a WhatsApp and
// asks to be called. It becomes a CRM lead (source 'site'), the team hears, and, when the agent's
// policy allows outreach, the sales agent makes the first contact through its one producer
// (requestLeadTx → dispatchTx) inside the same transaction. The visitor asked for it: this is the only
// reason the agent writes first here. Public, through the site's own nginx; rate limited per IP,
// a honeypot field, and idempotent by its natural key (a WhatsApp already in the CRM gets a note
// on its lead, never a second lead).

const SEGMENTS = [
  'doces',
  'salgados',
  'pizzaria',
  'lanches',
  'marmitas',
  'acai',
  'padaria',
  'japonesa',
  'bebidas',
  'outro',
] as const;

const bad = (field: string, message: string) =>
  new HttpError(422, 'BAD_REQUEST', message, { field });

function str(v: unknown, field: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw bad(field, `${field} is required`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < min || s.length > max) throw bad(field, `${field} must have ${min}–${max} chars`);
  return s;
}
const optStr = (v: unknown, field: string, max: number) =>
  v === undefined || v === null || v === '' ? null : str(v, field, max);

export function mountSiteLeads(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  trustProxy: boolean;
  proxyHops: number;
}) {
  const allow = windowCounter({ windowMs: 10 * 60_000, max: 5 });
  o.app.post('/site/v1/leads', async (c) => {
    const ip = clientIp(c, { trustForwardedFor: o.trustProxy, proxyHops: o.proxyHops });
    if (!allow(ip)) throw new HttpError(429, 'RATE_LIMITED', 'too many requests — wait a little');
    const body = await bodyJson(c, 4096);
    if (typeof body.website === 'string' && body.website !== '')
      return c.json({ received: true }, 202);
    const name = str(body.name, 'name', 80, 2);
    const raw = typeof body.whatsapp === 'string' ? body.whatsapp : '';
    const whatsapp = e164Phone(raw);
    if (!whatsapp || !/^\+55[1-9][0-9]{9,10}$/.test(whatsapp))
      throw bad('whatsapp', 'whatsapp must be a Brazilian number');
    const business = optStr(body.business, 'business', 80);
    const segment =
      body.segment === undefined || body.segment === null || body.segment === ''
        ? null
        : (body.segment as string);
    if (segment !== null && !(SEGMENTS as readonly string[]).includes(segment))
      throw bad('segment', 'unknown segment');
    const message = optStr(body.message, 'message', 500);
    const note = `Pediu contato pelo site${message ? `: “${message}”` : '.'}`;

    const leadId = await controlTx(o.sql, async (tx) => {
      if (phoneIsIgnored(await blockedPhonesTx(tx), whatsapp)) return null;
      const variants = contactDigits(whatsapp).sort();
      const lock = variants[0] ?? whatsapp.replace(/\D/g, '');
      await tx`select pg_advisory_xact_lock(hashtext(${`lead-contact:whatsapp:${lock}`}))`;
      const [known] = await tx<{ id: string }[]>`
        select id from leads
        where whatsapp = ${whatsapp} or phone = ${whatsapp}
          or exists (select 1 from unnest(${variants}::text[]) v
            where right(regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g'), length(v)) = v
               or right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), length(v)) = v)
        order by (whatsapp is not distinct from ${whatsapp}) desc, updated_at desc limit 1`;
      const mode = newLeadModesOf(await getSettingTx<unknown>(tx, 'agent', null)).inbound;
      const id =
        known?.id ??
        (
          await insertLeadTx(tx, {
            name,
            business_name: business,
            whatsapp,
            segment,
            source: 'site',
            discovered_via: 'site',
            agent_mode: mode,
          })
        ).body.lead.id;
      // Preserve verified contacts. A known phone lead with no WhatsApp can receive
      // the callback on the same number just supplied through the form.
      if (known)
        await tx`update leads set whatsapp = ${whatsapp}, updated_at = now()
        where id = ${id} and (whatsapp is null or whatsapp = '')`;
      // Repeated submissions are visible, but identical callbacks inside the retry window share work.
      const [recent] = await tx`select 1 from lead_activities where lead_id = ${id}
        and meta->>'type' = 'site_callback' and body = ${note}
        and at > now() - interval '5 minutes'`;
      const [activity] = await tx<{ id: string }[]>`
        insert into lead_activities (lead_id, kind, body, meta, created_by, at)
        values (${id}, 'system', ${note}, ${tx.json({ type: recent ? 'site_callback_repeat' : 'site_callback' })},
          'system', clock_timestamp()) returning id`;
      if (!known)
        await recordStaffEventTx(tx, 'lead.created', {
          leadId: id,
          leadName: name,
          business,
          channel: 'site',
          excerpt: message ?? 'pediu contato pelo site',
        });
      if (recent) return id;
      await retireWakeupsOnInboundTx(tx, id);
      // Replace outstanding callbacks for this lead so the turn reads the most recent request.
      await tx`delete from agent_mailbox m using agent_actors a
        where m.actor_id = a.id and a.agent_id = ${CRM_AGENT_ID} and a.subject_id = ${id}
          and m.kind = 'lead.first_contact' and m.source = 'site' and m.consumed_by_turn is null`;
      const requested = await requestLeadTx(tx, {
        leadId: id,
        kind: 'lead.first_contact',
        source: 'site',
        dedupeKey: `crm:site:${activity!.id}`,
        payload: {
          channel: 'whatsapp',
          focus: 'retorno pedido pelo site',
          callbackActivityId: activity!.id,
        },
      });
      if (!requested.mailboxId)
        await salesAttentionTx(
          tx,
          id,
          `site:${activity!.id}`,
          'retorno solicitado no site — chame pelo WhatsApp',
        );
      return id;
    });
    if (leadId) emitControlEvent('lead.change', leadId);
    return c.json({ received: true }, 202);
  });
}

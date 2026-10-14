import type { Hono } from 'hono';
import { requestLeadTx } from '../crm/dispatch.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, clientIp, windowCounter } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { controlTx } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { getSettingTx, newLeadModesOf } from './integrations.ts';
import { e164Phone, insertLeadTx } from './leads.ts';
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
      // one WhatsApp, one lead: a repeat (or a lead the team already has) gets a note
      const known = (
        await tx<{ id: string }[]>`select id from leads where whatsapp = ${whatsapp} limit 1`
      )[0];
      if (known) {
        await tx`
          insert into lead_activities (lead_id, kind, body, created_by)
          values (${known.id}, 'system', ${note}, 'system')
        `;
        return known.id;
      }
      const mode = newLeadModesOf(await getSettingTx<unknown>(tx, 'agent', null)).inbound;
      const created = await insertLeadTx(tx, {
        name,
        business_name: business,
        whatsapp,
        segment,
        source: 'site',
        discovered_via: 'site',
        agent_mode: mode,
      });
      const lead = created.body.lead;
      await tx`
        insert into lead_activities (lead_id, kind, body, created_by)
        values (${lead.id}, 'system', ${note}, 'system')
      `;
      await recordStaffEventTx(tx, 'lead.created', {
        leadId: lead.id,
        leadName: name,
        business,
        channel: 'site',
        excerpt: message ?? 'pediu contato pelo site',
      });
      // a draft-mode lead gets the agent's draft for staff to send; auto sends live. The
      // producer files it only while the policy allows outreach; what the visitor wrote is in
      // the note above, which the agent reads as data
      await requestLeadTx(tx, {
        leadId: lead.id,
        kind: 'lead.first_contact',
        source: 'site',
        dedupeKey: `crm:first_contact:${lead.id}`,
        payload: {
          focus:
            'a pessoa pediu pelo site para ser chamada no WhatsApp: apresente-se, responda ao que ela escreveu e ajude a criar a loja',
        },
      });
      return lead.id;
    });
    emitControlEvent('lead.change', leadId);
    return c.json({ received: true }, 202);
  });
}

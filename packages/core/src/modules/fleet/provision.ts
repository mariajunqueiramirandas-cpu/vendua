import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { platformHost, storeOrigin } from '../../platform/store-origin.ts';
import { controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { addActivity } from '../activities.ts';
import { updateLead } from '../leads.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import type { FleetDeps } from './deps.ts';
import { lockOpsTx, pendingTx, reconcileTx } from './deploy.ts';
import {
  alertStaff,
  fleetLog,
  openIncidentTx,
  resolveIncidentTx,
  type IncidentRow,
} from './incidents.ts';
import { latestPassedTx } from './releases.ts';

// The provisioner (docs/architecture/08 "Provisioner"): a state machine per store, never a
// script. provision_store() creates the tenant, its <slug>.<store domain> host (covered by the
// wildcard DNS record and certificate) and this row; then
//   release — the store gets its bundle's newest passed release (a `provision` deployment)
//   verify  — a probe sees the edge serve it (deployment live)
//   invite  — staff invites only: the owner gets the store and admin links; the lead is invited
//   live    — done; the lead is live
// Every step is idempotent, so a crash or a second Core replica resumes where it stopped.

export type ProvisionState = 'release' | 'verify' | 'invite' | 'live';

export interface ProvisioningRow {
  id: string;
  tenant_id: string;
  source: 'signup' | 'invite';
  lead_id: string | null;
  state: ProvisionState;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  log: { at: string; state: string; note: string }[];
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  live_at: Date | null;
}

/** a store not live this long after it was created is stuck: staff hear about it */
const STUCK_AFTER_MS = 30 * 60_000;
const LOG_MAX = 40;

const backoff = (attempts: number) => Math.min(15_000 * 2 ** attempts, 10 * 60_000);

async function logTx(tx: Sql, id: string, state: string, note: string) {
  await tx`
    update provisionings set log = (
      select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(
          log || jsonb_build_array(jsonb_build_object('at', now(), 'state', ${state}::text,
                                                      'note', ${note.slice(0, 300)}::text))
        ) with ordinality as x(e, n)
        order by n desc limit ${LOG_MAX}
      ) last
    ), updated_at = now()
    where id = ${id}
  `;
}

interface StoreFacts {
  slug: string;
  name: string;
  origin: string;
  owner: { name: string; phone: string; email: string | null } | null;
}

async function factsTx(tx: Sql, d: FleetDeps, tenantId: string): Promise<StoreFacts> {
  // merchant_users is tenant-scoped: read it as the store
  await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
  const t = (
    await tx<
      { slug: string; name: string }[]
    >`select slug, name from tenants where id = ${tenantId}`
  )[0]!;
  const owner = (
    await tx<{ name: string; phone: string; email: string | null }[]>`
      select name, phone, email from merchant_users
      where tenant_id = ${tenantId} and role = 'owner' order by created_at limit 1
    `
  )[0];
  return {
    ...t,
    origin: await storeOrigin(tx, { id: tenantId, slug: t.slug }, d.storeDomain),
    owner: owner ?? null,
  };
}

/** A self-serve signup whose phone or email is already a lead graduates that lead. */
async function linkLeadTx(tx: Sql, p: ProvisioningRow, f: StoreFacts): Promise<string | null> {
  if (p.lead_id || !f.owner) return p.lead_id;
  const digits = f.owner.phone.replace(/\D/g, '');
  const lead = (
    await tx<{ id: string }[]>`
      select id from leads
      where tenant_id is null and archived_at is null and (
        (length(${digits}) >= 10
          and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), length(${digits})) = ${digits})
        or (${f.owner.email ?? ''} <> '' and lower(email) = lower(${f.owner.email ?? ''})))
      order by updated_at desc limit 1
    `
  )[0];
  if (!lead) return null;
  await tx`update leads set tenant_id = ${p.tenant_id}, updated_at = now() where id = ${lead.id}`;
  await tx`update provisionings set lead_id = ${lead.id} where id = ${p.id}`;
  await logTx(tx, p.id, p.state, 'o cadastro é de um lead do pipeline: ligado a ele');
  return lead.id;
}

type Step =
  { next: ProvisionState; note: string } | { wait: string; retryInMs?: number } | { error: string };

async function releaseStep(tx: Sql, d: FleetDeps, p: ProvisioningRow): Promise<Step> {
  const ops = await lockOpsTx(tx, p.tenant_id);
  const dep = await reconcileTx(tx, d, p.tenant_id, { kind: 'provision', actor: 'provisioner' });
  if (dep)
    return {
      next: 'verify',
      note: `versão ${dep.release_id.slice(0, 7)} de ${ops.bundle} promovida`,
    };
  const after = await lockOpsTx(tx, p.tenant_id);
  if (after.live_release_id)
    return { next: 'verify', note: `versão ${after.live_release_id.slice(0, 7)} já no ar` };
  const latest = await latestPassedTx(tx, ops.bundle);
  return {
    error: latest
      ? 'a versão não pôde ser promovida'
      : `nenhuma versão publicada de ${ops.bundle} ainda — rode vendua release publish`,
  };
}

async function verifyStep(tx: Sql, p: ProvisioningRow): Promise<Step> {
  const ops = await lockOpsTx(tx, p.tenant_id);
  if (!ops.live_release_id)
    return { next: 'release', note: 'sem versão no ar — de volta à promoção' };
  if (await pendingTx(tx, p.tenant_id))
    return { wait: 'esperando a sonda ver a versão no ar', retryInMs: 15_000 };
  const last = (
    await tx<{ status: string; detail: string | null }[]>`
      select status, detail from deployments
      where tenant_id = ${p.tenant_id} and release_id = ${ops.live_release_id}
      order by started_at desc limit 1
    `
  )[0];
  if (last?.status === 'live') return { next: 'invite', note: 'a sonda viu a loja no ar' };
  return { error: `a versão não subiu${last?.detail ? `: ${last.detail}` : ''}` };
}

interface Invite {
  sent: string[];
  errors: string[];
}

/** WhatsApp + email to the owner. Runs outside any transaction: a rollback after it can't
 *  un-send a message, so the provisioning records the outcome in a transaction of its own. */
async function sendInvite(d: FleetDeps, p: ProvisioningRow, f: StoreFacts): Promise<Invite> {
  const out: Invite = { sent: [], errors: [] };
  if (!f.owner) return { sent: [], errors: ['a loja não tem dono cadastrado'] };
  const admin = d.adminHost ? `https://${d.adminHost}/admin/` : `${f.origin}/admin/`;
  const first = f.owner.name.split(/\s+/)[0] ?? f.owner.name;
  const text =
    `Olá, ${first}! A sua loja ${f.name} já está no ar: ${f.origin}\n\n` +
    `Para cuidar dela (cardápio, horários, pedidos), entre no painel com este WhatsApp: ${admin}\n\n` +
    'A loja abre para pedidos assim que você ativar o plano no painel.';
  await d.notify
    .whatsapp(f.owner.phone, text)
    .then(() => out.sent.push('whatsapp'))
    .catch((e) => out.errors.push(`whatsapp: ${e instanceof Error ? e.message : String(e)}`));
  if (f.owner.email)
    await d.notify
      .email(f.owner.email, `A sua loja ${f.name} está no ar`, text, `provision:${p.id}:invite`)
      .then(() => out.sent.push('email'))
      .catch((e) => out.errors.push(`email: ${e instanceof Error ? e.message : String(e)}`));
  return out;
}

function inviteStep(p: ProvisioningRow, invite: Invite | null): Step | 'send' {
  if (p.source !== 'invite')
    return { next: 'live', note: 'cadastro próprio: o dono já está no painel' };
  if (!invite) return 'send';
  if (!invite.sent.length) return { error: `o convite não saiu (${invite.errors.join('; ')})` };
  return { next: 'live', note: `convite enviado por ${invite.sent.join(' e ')}` };
}

/** while the invite is out, the row is held this long (no one else sends it meanwhile) */
const SENDING_MS = 2 * 60_000;

interface Pass {
  row: ProvisioningRow | null;
  facts: StoreFacts | null;
  send: boolean;
  leadMoves: { leadId: string; state: 'invited' | 'live'; note?: string }[];
  alerts: IncidentRow[];
  wentLive: boolean;
}

/** One transaction of steps; stops when the owner's invite has to go out (`send`). */
async function pass(d: FleetDeps, id: string, invite: Invite | null): Promise<Pass> {
  const out: Pass = {
    row: null,
    facts: null,
    send: false,
    leadMoves: [],
    alerts: [],
    wentLive: false,
  };
  out.row = await controlTx(d.sql, async (tx) => {
    let p = (
      await tx<ProvisioningRow[]>`select * from provisionings where id = ${id} for update`
    )[0];
    if (!p || p.state === 'live') return p ?? null;
    // an invite someone is sending right now (or backing off): leave it to them
    if (!invite && p.state === 'invite' && p.source === 'invite' && p.next_attempt_at > d.now())
      return p;
    if (invite && p.state !== 'invite') return p;
    const facts = await factsTx(tx, d, p.tenant_id);
    out.facts = facts;
    const leadId = await linkLeadTx(tx, p, facts);
    for (let hops = 0; hops < 4 && p.state !== 'live'; hops++) {
      const step: Step | 'send' =
        p.state === 'release'
          ? await releaseStep(tx, d, p)
          : p.state === 'verify'
            ? await verifyStep(tx, p)
            : inviteStep(p, invite);
      if (step === 'send') {
        out.send = true;
        p = (
          await tx<ProvisioningRow[]>`
            update provisionings set next_attempt_at = ${new Date(d.now().getTime() + SENDING_MS)},
              updated_at = now()
            where id = ${p.id} returning *
          `
        )[0]!;
        return p;
      }
      if ('next' in step) {
        await logTx(tx, p.id, step.next, step.note);
        p = (
          await tx<ProvisioningRow[]>`
            update provisionings set state = ${step.next}, attempts = 0, last_error = null,
              next_attempt_at = now(), live_at = ${step.next === 'live' ? tx`now()` : null}
            where id = ${p.id} returning *
          `
        )[0]!;
        if (leadId && p.source === 'invite' && step.next === 'live')
          out.leadMoves.push({ leadId, state: 'invited' });
        if (step.next === 'live') {
          out.wentLive = true;
          await recordStaffEventTx(
            tx,
            'store.live',
            { storeName: facts.name, host: facts.origin.replace(/^https?:\/\//, '') },
            { tenantId: p.tenant_id, dedupeKey: `store.live:${p.tenant_id}` },
          );
          await recordStaffEventTx(
            tx,
            'store.onboarding',
            { step: 'live' },
            { tenantId: p.tenant_id, dedupeKey: `onboarding:${p.tenant_id}:live` },
          );
          if (leadId) out.leadMoves.push({ leadId, state: 'live', note: facts.origin });
          const closed = await resolveIncidentTx(
            tx,
            'provisioning_stuck',
            p.id,
            'a loja ficou no ar',
          );
          if (closed) out.alerts.push(closed);
        }
        continue;
      }
      const error = 'error' in step ? step.error : null;
      const retry = 'wait' in step ? (step.retryInMs ?? 15_000) : backoff(p.attempts);
      p = (
        await tx<ProvisioningRow[]>`
          update provisionings set
            attempts = attempts + ${error ? 1 : 0}, last_error = ${error ?? p.last_error},
            next_attempt_at = ${new Date(d.now().getTime() + retry)}, updated_at = now()
          where id = ${p.id} returning *
        `
      )[0]!;
      if (error && p.attempts === 1) await logTx(tx, p.id, p.state, error);
      break;
    }
    if (p.state !== 'live' && d.now().getTime() - p.created_at.getTime() > STUCK_AFTER_MS) {
      const opened = await openIncidentTx(tx, {
        tenantId: p.tenant_id,
        kind: 'provisioning_stuck',
        subject: p.id,
        summary: `${facts.slug}: a loja não ficou no ar em 30 min (${p.state}${p.last_error ? `: ${p.last_error}` : ''})`,
      });
      if (opened) out.alerts.push(opened);
    }
    await tx`update provisionings set lease_until = null where id = ${p.id}`;
    return p;
  });
  return out;
}

/** Moves one provisioning as far as it can go now. */
export async function advance(d: FleetDeps, id: string): Promise<ProvisioningRow | null> {
  const passes = [await pass(d, id, null)];
  if (passes[0]!.send && passes[0]!.row && passes[0]!.facts)
    passes.push(await pass(d, id, await sendInvite(d, passes[0]!.row, passes[0]!.facts)));
  const row = passes.at(-1)!.row;
  for (const p of passes) {
    for (const a of p.alerts) alertStaff(d, a, a.resolved_at !== null);
    for (const m of p.leadMoves) await moveLead(d, id, m.leadId, m.state, m.note);
    if (p.wentLive && p.facts) {
      const f = p.facts;
      void d
        .staff({
          subject: `Loja no ar: ${f.name}`,
          body: `${f.name} está no ar em ${f.origin} (${row?.source === 'invite' ? 'convite da equipe' : 'cadastro próprio'}).`,
          idemKey: `provision:${id}:live`,
        })
        .catch((err) => fleetLog.warn({ err }, 'staff alert failed'));
    }
  }
  if (row) emitControlEvent('fleet.change', row.tenant_id);
  return row;
}

/** invited when the invite goes out, live when the store is — never backwards. */
async function moveLead(
  d: FleetDeps,
  provisioningId: string,
  leadId: string,
  to: 'invited' | 'live',
  storeUrl?: string,
) {
  const ORDER = ['lead', 'contacted', 'invited', 'live'];
  try {
    const cur = await controlTx(
      d.sql,
      (tx) => tx<{ state: string }[]>`select state from leads where id = ${leadId}`,
    );
    if (!cur[0] || ORDER.indexOf(cur[0].state) >= ORDER.indexOf(to)) return;
    await updateLead(
      d.sql,
      leadId,
      { state: to },
      `fleet:provision:${provisioningId}:${to}`,
      'system',
    );
    if (to === 'live' && storeUrl)
      await addActivity(
        d.sql,
        leadId,
        { kind: 'system', body: `loja no ar: ${storeUrl}`, createdBy: 'system' },
        `fleet:provision:${provisioningId}:activity`,
      );
  } catch (err) {
    fleetLog.warn({ err, leadId }, 'lead move failed');
  }
}

/** One pass: every provisioning that is due, under a lease so replicas don't double-step. */
export async function runProvisionings(d: FleetDeps): Promise<{ advanced: number }> {
  const due = await controlTx(
    d.sql,
    (tx) => tx<{ id: string }[]>`
      update provisionings set lease_until = now() + interval '2 minutes'
      where id in (
        select id from provisionings
        where state <> 'live' and next_attempt_at <= now()
          and (lease_until is null or lease_until < now())
        order by next_attempt_at limit 20
        for update skip locked
      )
      returning id
    `,
  );
  for (const { id } of due) {
    try {
      await advance(d, id);
    } catch (err) {
      fleetLog.warn({ err, provisioning: id }, 'provisioning step failed');
    }
  }
  return { advanced: due.length };
}

/** "tentar de novo": start the store's provisioning over from its release. */
export async function retryTx(tx: Sql, id: string): Promise<ProvisioningRow> {
  const p = (
    await tx<ProvisioningRow[]>`select * from provisionings where id = ${id} for update`
  )[0];
  if (!p) throw new HttpError(404, 'PROVISIONING_NOT_FOUND', 'provisioning not found');
  if (p.state === 'live')
    throw new HttpError(409, 'PROVISIONING_DONE', 'this store is already live');
  if (p.state === 'release' || p.state === 'verify') {
    // a release that never went live is dropped, so the promotion runs fresh
    await tx`
      update storefront_ops o set live_release_id = null, live_since = null
      where o.tenant_id = ${p.tenant_id} and o.live_release_id is not null
        and not exists (
          select 1 from deployments dp where dp.tenant_id = o.tenant_id and dp.status = 'live'
        )
        and not exists (
          select 1 from deployments dp where dp.tenant_id = o.tenant_id and dp.status = 'pending'
        )
    `;
  }
  await logTx(
    tx,
    id,
    p.state === 'verify' ? 'release' : p.state,
    'a equipe pediu para tentar de novo',
  );
  return (
    await tx<ProvisioningRow[]>`
      update provisionings set state = ${p.state === 'verify' ? 'release' : p.state}, attempts = 0,
        last_error = null, next_attempt_at = now(), lease_until = null
      where id = ${id} returning *
    `
  )[0]!;
}

export interface InviteInput {
  slug: string;
  storeName: string;
  planId: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  leadId: string | null;
}

/** Staff invite: the store is born now (so a taken slug is a 409 here, not a stuck row). */
export async function createInviteTx(
  tx: Sql,
  d: FleetDeps,
  i: InviteInput,
  actor: string,
): Promise<ProvisioningRow> {
  if (i.leadId) {
    const lead = (
      await tx<{ tenant_id: string | null }[]>`select tenant_id from leads where id = ${i.leadId}`
    )[0];
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    if (lead.tenant_id) throw new HttpError(409, 'LEAD_HAS_STORE', 'this lead already has a store');
  }
  if (!(await tx`select 1 from plans where id = ${i.planId}`)[0])
    throw new HttpError(422, 'BAD_REQUEST', 'unknown plan', { field: 'planId' });
  let tenantId: string;
  try {
    tenantId = (
      await tx<{ id: string }[]>`
        select provision_store(${i.slug}, ${i.storeName}, ${i.planId},
          ${platformHost(i.slug, d.storeDomain)}, ${i.ownerName}, ${i.ownerPhone}, ${i.ownerEmail},
          'invite', ${i.leadId}, ${actor}) as id
      `
    )[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new HttpError(409, 'SLUG_TAKEN', 'this address is taken', { field: 'slug' });
    throw err;
  }
  await recordStaffEventTx(
    tx,
    'store.created',
    {
      storeName: i.storeName,
      slug: i.slug,
      source: 'invite',
      owner: i.ownerName,
      leadId: i.leadId,
      plan: null,
      segment: null,
    },
    { tenantId, dedupeKey: `store.created:${tenantId}` },
  );
  return (
    await tx<ProvisioningRow[]>`select * from provisionings where tenant_id = ${tenantId}`
  )[0]!;
}

export function provisioningJson(
  p: ProvisioningRow & {
    slug?: string;
    name?: string;
    lead_name?: string | null;
    host?: string | null;
  },
) {
  return {
    id: p.id,
    tenantId: p.tenant_id,
    tenant: p.slug ?? null,
    host: p.host ?? null,
    storeName: p.name ?? null,
    source: p.source,
    leadId: p.lead_id,
    leadName: p.lead_name ?? null,
    state: p.state,
    attempts: p.attempts,
    lastError: p.last_error,
    nextAttemptAt: p.next_attempt_at,
    log: p.log,
    createdBy: p.created_by,
    createdAt: p.created_at,
    liveAt: p.live_at,
  };
}

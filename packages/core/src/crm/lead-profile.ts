import type { Sql } from '../platform/db.ts';
import { afterCommit } from '../platform/db.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { e164Phone, updateLeadTx, type LeadRow } from '../modules/leads.ts';
import { contactDigits } from '../modules/threads.ts';

// What the owner told the store about itself (signup's answers, then the Bem-vindo's) written on
// the CRM lead the store came from, so the pipeline knows the customer by their own answers.
// Who they are (owner's name, store name, city) follows the store. A contact the CRM already holds
// stays, since threads deliver to it, and so does a segment, which the CRM's segment stats group by:
// those are only filled when blank.

const LABELS = {
  name: 'nome',
  business_name: 'nome da loja',
  city: 'cidade',
  segment: 'segmento',
  email: 'e-mail',
  instagram: 'instagram',
  whatsapp: 'whatsapp',
  whatsapp_verified: 'whatsapp verificado',
} as const;

const FOLLOWS_STORE = ['name', 'business_name', 'city'] as const;
const FILLS_BLANK = ['segment', 'email', 'instagram'] as const;

interface StoreProfile {
  name: string | null;
  business_name: string | null;
  city: string | null;
  segment: string | null;
  email: string | null;
  instagram: string | null;
}

const clean = (v: string | null | undefined) => v?.trim() || null;

/** Runs `fn` with a setting on the caller's transaction, then puts back what was there. The sync
 *  runs in a store's transaction (the onboarding), where the control scope must close again, and
 *  in control ones (signup's link, provisioning), where it must stay open. controlTx can't serve
 *  the first: inside a transaction it leaves the scope open. */
async function withSetting<T>(
  tx: Sql,
  name: 'vendua.control' | 'vendua.tenant_id',
  value: string,
  fn: () => Promise<T>,
): Promise<T> {
  const [prev] = await tx<{ v: string | null }[]>`select current_setting(${name}, true) as v`;
  if (prev?.v === value) return fn();
  await tx`select set_config(${name}, ${value}, true)`;
  const out = await fn();
  await tx`select set_config(${name}, ${prev?.v ?? ''}, true)`;
  return out;
}

/** Read as the store: merchant_users and store_settings are tenant-scoped. */
async function storeProfileTx(tx: Sql, tenantId: string): Promise<StoreProfile | null> {
  const [row] = await tx<(StoreProfile & { handle: string | null })[]>`
    select t.name as business_name, s.city, s.segment, s.instagram as handle, o.name, o.email
    from tenants t
    left join store_settings s on s.tenant_id = t.id
    left join lateral (
      select name, email from merchant_users m
      where m.tenant_id = t.id and m.role = 'owner' order by m.created_at limit 1
    ) o on true
    where t.id = ${tenantId}`;
  if (!row) return null;
  const handle = clean(row.handle);
  return {
    name: clean(row.name),
    business_name: clean(row.business_name),
    city: clean(row.city),
    segment: clean(row.segment),
    email: clean(row.email)?.toLowerCase() ?? null,
    instagram: handle ? `@${handle.replace(/^@/, '')}` : null,
  };
}

function sameNumber(stored: string, variants: string[]): boolean {
  if (stored.endsWith('@lid')) return false;
  const d = stored.replace(/\D/g, '');
  return variants.some((v) => v === d || v.slice(2) === d);
}

function profilePatch(
  cur: LeadRow,
  store: StoreProfile,
  verifiedPhone: string | null,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const col of FOLLOWS_STORE) {
    const v = store[col];
    if (v && v !== clean(cur[col])) set[col] = v;
  }
  for (const col of FILLS_BLANK) {
    const v = store[col];
    if (v && !clean(cur[col])) set[col] = v;
  }
  // signup's code reached this number on WhatsApp: that is the proof the badge asks for
  const phone = verifiedPhone ? e164Phone(verifiedPhone) : null;
  if (phone) {
    if (!clean(cur.whatsapp)) {
      set.whatsapp = phone;
      set.whatsapp_verified = true;
    } else if (!cur.whatsapp_verified && sameNumber(cur.whatsapp!, contactDigits(phone))) {
      set.whatsapp_verified = true;
    }
  }
  return set;
}

/** Brings every lead linked to the store up to what the store says about itself, and notes
 *  what changed on each one's timeline. `verifiedPhone` is the owner's number signup just
 *  confirmed with a code. Runs inside the caller's transaction, which it leaves as it found it. */
export async function syncLeadProfileTx(
  tx: Sql,
  tenantId: string,
  o: { verifiedPhone?: string; via: 'signup' | 'onboarding' },
): Promise<void> {
  const changed = await withSetting(tx, 'vendua.control', '1', async () => {
    const leads = await tx<LeadRow[]>`
      select * from leads where tenant_id = ${tenantId} and archived_at is null
      order by id for update`;
    if (!leads.length) return [];
    const store = await withSetting(tx, 'vendua.tenant_id', tenantId, () =>
      storeProfileTx(tx, tenantId),
    );
    if (!store) return [];
    const ids: string[] = [];
    for (const cur of leads) {
      const set = profilePatch(cur, store, o.verifiedPhone ?? null);
      const cols = Object.keys(set) as (keyof typeof LABELS)[];
      if (!cols.length) continue;
      const changes = Object.fromEntries(cols.map((c) => [c, { from: cur[c], to: set[c] }]));
      await updateLeadTx(tx, cur.id, set, 'system');
      const shown = cols.filter((c) => c !== 'whatsapp_verified' || !('whatsapp' in set));
      await tx`insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${cur.id}, 'system',
          ${`perfil atualizado com os dados da loja: ${shown.map((c) => LABELS[c]).join(', ')}`},
          ${tx.json({ type: 'store_profile', via: o.via, tenantId, changes } as never)}, 'system')`;
      ids.push(cur.id);
    }
    return ids;
  });
  for (const id of changed) afterCommit(tx, () => emitControlEvent('lead.change', id));
}

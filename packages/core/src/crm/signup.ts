import { createHmac, timingSafeEqual } from 'node:crypto';
import { publicPlans } from '../modules/billing/plans.ts';
import type { PaymentProvider } from '../modules/payments/provider.ts';
import { signupReadiness } from '../modules/billing/signup-gate.ts';
import { controlTx } from '../modules/control.ts';
import { contactDigits } from '../modules/threads.ts';
import { UUID_RE } from '../platform/http.ts';
import type { Sql } from '../platform/db.ts';
import { afterCommit } from '../platform/db.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import { dropLeadMailTx } from './agenda.ts';
import { syncLeadProfileTx } from './lead-profile.ts';

let config: {
  origin: string | null;
  secret: string;
  provider: Pick<PaymentProvider, 'platformConfigured'>;
} | null = null;

export function configureCrmSignup(value: typeof config): void {
  config = value;
}

const legacySignature = (data: string, secret: string) =>
  createHmac('sha256', secret).update(`crm-signup:${data}`).digest('base64url');

const compactSignature = (payload: Buffer, secret: string) =>
  createHmac('sha256', secret).update('crm-signup:v2:').update(payload).digest().subarray(0, 8);

const formatUuid = (bytes: Buffer): string => {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Compact 38-char signed attribution token (16B uuid + 4B expiry + 8B HMAC) so links don't look like phishing walls on mobile. */
export function crmSignupToken(leadId: string, secret: string, now = Date.now()): string {
  const expiry = Math.floor(now / 1000) + 30 * 86_400;
  if (!UUID_RE.test(leadId)) {
    const data = `${leadId}.${expiry}`;
    return `${data}.${legacySignature(data, secret)}`;
  }
  const payload = Buffer.alloc(20);
  Buffer.from(leadId.replaceAll('-', ''), 'hex').copy(payload, 0);
  payload.writeUInt32BE(expiry >>> 0, 16);
  const mac = compactSignature(payload, secret);
  return Buffer.concat([payload, mac]).toString('base64url');
}

/** Verifies both compact tokens and legacy `<uuid>.<expiry>.<mac>` links already sent to leads. */
export function verifyCrmSignupToken(
  token: unknown,
  secret: string,
  now = Date.now(),
): string | null {
  if (typeof token !== 'string' || token.length > 120) return null;
  if (token.includes('.')) {
    const [id, expiry, mac, extra] = token.split('.');
    if (
      !id ||
      !UUID_RE.test(id) ||
      !expiry ||
      !/^\d{10,12}$/.test(expiry) ||
      Number(expiry) <= now / 1000 ||
      !mac ||
      extra !== undefined
    )
      return null;
    const expected = Buffer.from(legacySignature(`${id}.${expiry}`, secret));
    const actual = Buffer.from(mac);
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? id : null;
  }
  if (!/^[A-Za-z0-9_-]{38}$/.test(token)) return null;
  const buf = Buffer.from(token, 'base64url');
  if (buf.length !== 28) return null;
  const payload = buf.subarray(0, 20);
  const mac = buf.subarray(20, 28);
  const expiry = payload.readUInt32BE(16);
  if (expiry <= now / 1000) return null;
  const expected = compactSignature(payload, secret);
  if (!timingSafeEqual(expected, mac)) return null;
  const id = formatUuid(payload.subarray(0, 16));
  return UUID_RE.test(id) ? id : null;
}

const signupLeadId = (token: unknown, secret: string) => verifyCrmSignupToken(token, secret);

export async function crmOfferTx(tx: Sql) {
  const plans = (await publicPlans(tx)).filter((p) => p.available);
  const readiness = config ? await signupReadiness(tx, config.provider) : null;
  return {
    plans,
    signupOpen: Boolean(config?.origin && readiness?.open && config.provider.platformConfigured),
  };
}

export function crmSignupLink(leadId: string, planId: string): string | null {
  if (!config?.origin) return null;
  const url = new URL('/admin/comecar', config.origin);
  url.searchParams.set('plano', planId);
  url.searchParams.set('lead', crmSignupToken(leadId, config.secret));
  return url.href;
}

/** Signup has verified the owner phone. The link can attribute a contact with no stored
 * phone, or disambiguate a matching phone. It grants no store access or billing privileges. */
export async function linkCrmSignupTx(
  sql: Sql,
  tenantId: string,
  phone: string,
  token: unknown,
  secret?: string,
): Promise<string | null> {
  const raw = phone.replace(/\D/g, '');
  const digits = contactDigits(raw.length <= 11 ? `55${raw}` : raw);
  const linkedId = secret ? signupLeadId(token, secret) : null;
  return controlTx(sql, async (tx) => {
    const [lead] = await tx<{ id: string }[]>`
      select id from leads
      where tenant_id is null and archived_at is null and (
        exists (select 1 from unnest(${digits}::text[]) d where
          (regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g') in (d, substr(d, 3)) and coalesce(whatsapp, '') not like '%@lid')
          or regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') in (d, substr(d, 3)))
        or (id = ${linkedId} and phone is null and whatsapp is null)
      )
      order by (id is not distinct from ${linkedId}::uuid) desc, updated_at desc, id
      limit 1`;
    if (!lead) return null;
    await dropLeadMailTx(tx, lead.id);
    const [changed] =
      await tx`update leads set tenant_id = ${tenantId}, agent_mode = 'off', updated_at = now()
      where id = ${lead.id} and tenant_id is null returning id`;
    if (!changed) return null;
    await tx`update provisionings set lead_id = ${lead.id} where tenant_id = ${tenantId} and source = 'signup'`;
    await tx`insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${lead.id}, 'system', 'cadastro confirmado pelo WhatsApp',
        ${tx.json({ type: 'sales_signup', tenantId, fromLink: linkedId === lead.id })}, 'system')`;
    await syncLeadProfileTx(tx, tenantId, { verifiedPhone: phone, via: 'signup' });
    afterCommit(tx, () => emitControlEvent('lead.change', lead.id));
    return lead.id;
  });
}

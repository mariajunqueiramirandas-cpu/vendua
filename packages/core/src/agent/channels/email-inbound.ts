import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { Sql } from '../../platform/db.ts';
import { HttpError, str } from '../../platform/http.ts';
import { getIntegration } from '../../modules/integrations.ts';
import { controlTx } from '../../modules/control.ts';
import type { InboundResult } from '../../modules/threads.ts';
import { ingestInbound } from '../inbound.ts';

/**
 * agent/channels/email-inbound — the Resend half of the inbound email path.
 * Resend can't set custom headers: its events arrive signed (svix scheme)
 * and carry metadata only, so this module verifies the svix signature
 * against RESEND_WEBHOOK_SECRET — `email.received` pulls the body from the
 * received-emails API into the shared ingestInbound; `email.delivered`,
 * `email.bounced`, `email.failed` and `email.complained` are deliverability
 * feedback applied straight to the message/lead they name.
 */

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

export function svixHeaders(c: Context): SvixHeaders | null {
  const id = c.req.header('svix-id');
  const timestamp = c.req.header('svix-timestamp');
  const signature = c.req.header('svix-signature');
  return id && timestamp && signature ? { id, timestamp, signature } : null;
}

// svix signs `${id}.${timestamp}.${rawBody}` with HMAC-SHA256 keyed by the
// base64 half of `whsec_…`; the header lists `v1,<b64>` candidates (key
// rotation). The 5-minute timestamp window bounds replay.
const SVIX_TOLERANCE_S = 5 * 60;

export function svixVerified(rawBody: string, h: SvixHeaders, secret: string): boolean {
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SVIX_TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  if (!key.length) return false;
  const expected = Buffer.from(
    createHmac('sha256', key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest('base64'),
    'utf8',
  );
  return h.signature.split(' ').some((entry) => {
    const [version, sig] = entry.split(',', 2);
    if (version !== 'v1' || !sig) return false;
    const sigBytes = Buffer.from(sig, 'utf8');
    return sigBytes.length === expected.length && timingSafeEqual(sigBytes, expected);
  });
}

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; message_id?: string; to?: string[] | string };
}

interface ReceivedEmail {
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  message_id?: string;
  headers?: { from?: string };
}

function splitFrom(raw: string | undefined, fallback: string): { from: string; fromName?: string } {
  const m = raw?.match(/^\s*(?:"([^"]*)"|([^<>,]*?))\s*<([^>\s]+)>\s*$/);
  if (!m) return { from: (raw ?? fallback).trim() };
  const name = (m[1] ?? m[2] ?? '').trim();
  return name ? { from: m[3]!.trim(), fromName: name } : { from: m[3]!.trim() };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export type ResendWebhookResult =
  InboundResult | { ok: true; leadId?: string } | { ignored: string };

/** Verify the svix signature, then route: received → fetch+ingest; delivered
 *  → mark sent message delivered; bounced/failed/complained → flag the lead.
 *  Signature failures throw 404 — the route must not reveal that it exists
 *  to unsigned callers. Unknown types ack-and-ignore so Resend doesn't
 *  retry them forever. */
export async function ingestResendEvent(
  sql: Sql,
  rawBody: string,
  svix: SvixHeaders,
): Promise<ResendWebhookResult> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !svixVerified(rawBody, svix, secret)) {
    throw new HttpError(404, 'NOT_FOUND', 'not found');
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody) as ResendEvent;
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'body is not valid JSON');
  }
  if (event.type !== 'email.received') {
    // Deliverability feedback events carry the send's email_id (+ recipient
    // for bounce/complaint) — nothing to fetch, apply and ack. Unknown types
    // ack too so Resend doesn't retry them forever.
    const deliveryId = typeof event.data?.email_id === 'string' ? event.data.email_id : null;
    if (event.type === 'email.delivered' && deliveryId) {
      // The provider id stored on dispatch is channel-namespaced ('email:<id>').
      await controlTx(
        sql,
        (tx) =>
          tx`update lead_messages set status = 'delivered', updated_at = now()
             where provider_message_id = ${`email:${deliveryId}`} and status = 'sent'`,
      );
      return { ok: true } as ResendWebhookResult;
    }
    if (
      (event.type === 'email.bounced' ||
        event.type === 'email.failed' ||
        event.type === 'email.complained') &&
      deliveryId
    ) {
      return applyDeliveryEvent(sql, event.type, deliveryId, event.data?.to);
    }
    return { ignored: event.type ?? 'unknown' };
  }
  const emailId = str(event.data?.email_id, 'data.email_id', 100);

  const integration = await getIntegration(sql, 'email');
  const apiKey =
    (integration?.secret_ref && process.env[integration.secret_ref]) ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new HttpError(503, 'EMAIL_PROVIDER_UNAVAILABLE', 'resend api key not configured');
  }
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // 5xx so Resend retries — the received email may not be readable the
    // instant the event fires.
    throw new HttpError(502, 'EMAIL_FETCH_FAILED', `resend responded ${res.status}`);
  }
  const mail = (await res.json()) as ReceivedEmail;
  const { from, fromName } = splitFrom(mail.headers?.from, mail.from ?? '');
  if (!from) throw new HttpError(422, 'BAD_REQUEST', 'received email has no sender');
  // The sender doesn't control our limits — clip to the message contract
  // (body 8000, subject 300) instead of dropping the email. Replies keep
  // quoted history at the bottom, so the head holds the newest content.
  let body = mail.text?.trim() || (mail.html ? htmlToText(mail.html) : '');
  if (!body) throw new HttpError(422, 'BAD_REQUEST', 'received email has no readable body');
  if (body.length > 8000) body = `${body.slice(0, 7950).trimEnd()}\n[… truncado]`;

  return ingestInbound(sql, {
    channel: 'email',
    from,
    ...(fromName ? { fromName } : {}),
    ...(mail.subject ? { subject: str(mail.subject.slice(0, 300), 'subject', 300) } : {}),
    body,
    providerMessageId: mail.message_id ?? event.data?.message_id ?? emailId,
  });
}

/** Deliverability feedback for outbound sends: bounce/fail flags the lead's
 *  address dead (email_bounced_at blocks further email sends via guardrails
 *  and dispatch), complaint = legal unsubscribe. Also fails any email still
 *  queued to the dead address so it never leaves the building. Unknown
 *  recipients ack-and-ignore — we only send to leads we recorded. */
async function applyDeliveryEvent(
  sql: Sql,
  type: 'email.bounced' | 'email.failed' | 'email.complained',
  emailId: string,
  to: string[] | string | undefined,
): Promise<{ ok: true; leadId: string } | { ignored: string }> {
  const tos = Array.isArray(to) ? to : typeof to === 'string' ? [to] : [];
  const recipient = (tos[0] ?? '').trim().toLowerCase();
  if (!recipient) return { ignored: 'no recipient' };
  return controlTx(sql, async (tx) => {
    const lead = (
      await tx<{ id: string }[]>`
        select id from leads where lower(email) = ${recipient} limit 1
      `
    )[0];
    if (!lead) return { status: 200, body: { ignored: 'unknown recipient' } };

    // Fail the sending row when the event names it — keeps message status
    // honest even for sends that predate the flag.
    await tx`
      update lead_messages set status = 'failed', error = ${type}, updated_at = now()
      where provider_message_id = ${`email:${emailId}`} and status in ('sent', 'queued', 'sending')
    `;

    if (type === 'email.complained') {
      await tx`
        update leads set unsubscribed_at = now(), updated_at = now()
        where id = ${lead.id} and unsubscribed_at is null
      `;
      await tx`
        insert into lead_activities (lead_id, kind, body, created_by)
        values (${lead.id}, 'system', 'Reclamação de spam (${type}) — descadastrado', 'system')
      `;
    } else {
      await tx`
        update leads set email_bounced_at = now(), updated_at = now() where id = ${lead.id}
      `;
      await tx`
        insert into lead_activities (lead_id, kind, body, created_by)
        values (${lead.id}, 'system', ${`Email ${type === 'email.bounced' ? 'bounce' : 'falhou'} — endereço morto, agente muda de canal`}, 'system')
      `;
      // Nothing still queued should go out to a dead address.
      await tx`
        update lead_messages m set status = 'failed', error = 'email bounced', updated_at = now()
        from lead_threads t
        where m.thread_id = t.id and t.lead_id = ${lead.id}
          and t.channel = 'email' and m.status in ('queued', 'sending')
      `;
    }
    return { status: 200, body: { ok: true as const, leadId: lead.id } };
  }).then((r) => r.body);
}

import type { Json, ModelGateway } from '@vendua/agent-runtime';
import { dispatchTx } from '../agent-host/dispatch.ts';
import { emitAdminTx } from '../admin/live.ts';
import { searchCatalog } from '../modules/catalog-search.ts';
import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { claimForTurnTx } from './allowance.ts';
import { readPhoto, type MediaProviders } from './media.ts';
import { sendDirectTx, typingTx } from './outbound.ts';
import { loadAgent } from './settings.ts';
import { readsAsShopper, triggerOf } from './signals.ts';
import {
  AGENT_ID,
  SUBJECT_KIND,
  loadStoreSettings,
  mustThread,
  storeStatus,
  threadFloor,
  type Thread,
} from './threads.ts';

// The ingest (sales-agent.md §4.5): each message the gateway stored becomes text — a voice
// note is transcribed, a photo described and matched against the menu — and then, in one
// transaction, the thread's floor moves (a merchant reply is a takeover; a code trigger hands
// off) and the message is dispatched to the thread's actor. The only path from WhatsApp to a turn.

const ingestLog = log.child({ mod: 'vendedor-ingest' });
const LEASE_S = 60;
const MAX_ATTEMPTS = 5;

export interface IngestDeps {
  sql: Sql;
  media: MediaProviders | null;
  gateway: ModelGateway | null;
}

interface Row {
  id: string;
  tenant_id: string;
  thread_id: string;
  author: 'shopper' | 'merchant' | 'agent' | 'core';
  kind: string;
  body: string | null;
  meta: Record<string, unknown>;
  quoted_wa_id: string | null;
  created_at: Date;
  ingest_attempts: number;
}

export async function claimPending(sql: Sql, limit = 10): Promise<Row[]> {
  return controlTx(
    sql,
    (tx) => tx<Row[]>`
      update shopper_messages m set ingest_lease_until = now() + make_interval(secs => ${LEASE_S}),
        ingest_attempts = m.ingest_attempts + 1
      where m.id in (
        select id from shopper_messages
        where ingest = 'pending' and (ingest_lease_until is null or ingest_lease_until < now())
        order by created_at limit ${limit} for update skip locked)
      returning m.id, m.tenant_id, m.thread_id, m.author, m.kind, m.body, m.meta, m.quoted_wa_id,
        m.created_at, m.ingest_attempts`,
  );
}

interface Derived {
  transcript: string | null;
  confidence: number | null;
  description: string | null;
  candidates: string[];
  receipt: boolean;
}

/** Network calls happen here, outside any transaction. */
async function derive(d: IngestDeps, r: Row): Promise<Derived> {
  const out: Derived = {
    transcript: null,
    confidence: null,
    description: null,
    candidates: [],
    receipt: false,
  };
  if (r.author !== 'shopper' || (r.kind !== 'audio' && r.kind !== 'image')) return out;
  const media = await withTenant(
    d.sql,
    r.tenant_id,
    (tx) =>
      tx<{ bytes: Uint8Array; mime: string }[]>`
      select bytes, mime from shopper_media where tenant_id = ${r.tenant_id} and message_id = ${r.id} limit 1`,
  );
  const m = media[0];
  if (!m) return out;
  if (r.kind === 'audio' && d.media) {
    const t = await d.media.transcribe(m.bytes, m.mime);
    if (t) {
      out.transcript = t.text;
      out.confidence = t.confidence;
    }
  }
  if (r.kind === 'image' && d.gateway) {
    const names = await withTenant(
      d.sql,
      r.tenant_id,
      (tx) =>
        tx<
          { name: string }[]
        >`select name from products where tenant_id = ${r.tenant_id} and status = 'active' limit 120`,
    );
    const p = await readPhoto(
      d.gateway,
      r.tenant_id,
      m.bytes,
      m.mime,
      names.map((n) => n.name),
    );
    if (p) {
      out.description = p.description;
      out.receipt = p.looksLikeReceipt;
      if (p.looksLikeFood) {
        const hits = await withTenant(d.sql, r.tenant_id, (tx) =>
          searchCatalog(tx, r.tenant_id, p.description.slice(0, 100), { limit: 3 }),
        ).catch(() => []);
        out.candidates = hits.map((h) => `${h.product.slug} (${h.product.name})`);
      }
    }
  }
  return out;
}

function closedNotice(status: { status: string; resumesAt?: string }, tz: string): string {
  if (status.status === 'open') return '';
  if (!status.resumesAt) return ' A loja está fechada agora; respondemos assim que abrir.';
  const when = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(status.resumesAt));
  return ` A loja está fechada agora e abre ${when}; respondemos assim que abrir.`;
}

/** One message: the floor moves and the actor hears about it, in one transaction. */
export async function ingestOne(d: IngestDeps, r: Row): Promise<void> {
  const derived = await derive(d, r);
  await withTenant(d.sql, r.tenant_id, async (tx) => {
    const [still] = await tx<{ ingest: string | null }[]>`
      select ingest from shopper_messages where id = ${r.id} for update`;
    if (still?.ingest !== 'pending') return;
    const thread = await mustThread(tx, r.tenant_id, r.thread_id, { forUpdate: true });
    const agent = await loadAgent(tx, r.tenant_id);
    const settings = await loadStoreSettings(tx, r.tenant_id);
    const now = new Date();
    const status = storeStatus(settings, now);
    const actor = {
      tenantId: r.tenant_id,
      agentId: AGENT_ID,
      subject: { kind: SUBJECT_KIND, id: thread.id },
    };
    const at = new Date(r.created_at).toISOString();
    const done = async (state: 'done' | 'skipped') => {
      await tx`update shopper_messages set ingest = ${state}, ingest_lease_until = null,
        transcript = coalesce(${derived.transcript}, transcript),
        meta = meta || ${tx.json({
          ...(derived.confidence !== null ? { confidence: derived.confidence } : {}),
          ...(derived.description ? { description: derived.description } : {}),
          ...(derived.candidates.length ? { candidates: derived.candidates } : {}),
          ...(derived.receipt ? { receipt: true } : {}),
        })}
        where id = ${r.id}`;
      await emitAdminTx(tx, r.tenant_id, 'vendedor', thread.id);
    };

    if (r.author === 'merchant') {
      // the store answered: it holds the floor for its window, and the shopper isn't waiting anymore
      if (thread.owner !== 'muted')
        await tx`update shopper_threads set owner = 'human', owner_reason = coalesce(owner_reason, 'a loja respondeu'),
          human_until = now() + make_interval(mins => ${agent.settings.humanSilenceMin}),
          waiting_since = null, pending_since = null, updated_at = now() where id = ${thread.id}`;
      if (agent.enabled || thread.channel === 'test') {
        await dispatchTx(tx, {
          actor,
          kind: 'merchant.message',
          source: 'whatsapp:merchant',
          dedupeKey: `merchant:${r.id}`,
          payload: { text: (r.body ?? `[${r.kind}]`).slice(0, 2000), at },
        });
        await dispatchTx(tx, {
          actor,
          kind: 'timer.handback',
          source: 'whatsapp:merchant',
          dedupeKey: `handback:${thread.id}:${r.id}`,
          deliverAt: new Date(now.getTime() + agent.settings.humanSilenceMin * 60_000 + 5_000),
        });
        await learnFromMerchant(tx, thread, r);
      }
      return done('done');
    }
    if (r.author !== 'shopper') return done('skipped');

    if (thread.owner === 'muted' || (!agent.enabled && thread.channel !== 'test'))
      return done('skipped');
    let cls = thread.class;
    if (cls === 'unknown' && thread.channel === 'whatsapp') {
      const [o] = thread.phone
        ? await tx<{ n: number }[]>`select count(*)::int as n from orders
            where tenant_id = ${r.tenant_id} and customer_phone = ${thread.phone}`
        : [{ n: 0 }];
      cls =
        (o?.n ?? 0) > 0 || agent.settings.unknownNumbers === 'all' || readsAsShopper(r.body)
          ? 'shopper'
          : 'other';
      await tx`update shopper_threads set class = ${cls} where id = ${thread.id}`;
    }
    if (cls === 'other') return done('skipped');

    const floor = threadFloor({ ...thread, class: cls }, agent, status, now);
    const text = derived.transcript ?? r.body;
    const trigger =
      floor.floor === 'agent'
        ? (triggerOf(text, agent.settings.handoff) ??
          (r.kind === 'document' ? ('pediu uma pessoa' as const) : null) ??
          (derived.receipt ? ('pagamento' as const) : null))
        : null;
    if (trigger) {
      // Core's own words, once: the shopper knows a person is coming, and when
      await sendDirectTx(tx, thread, {
        author: 'core',
        key: `handoff:${r.id}`,
        text: `Vou chamar alguém da loja para te ajudar com isso.${closedNotice(status, settings?.hours?.timezone ?? 'America/Sao_Paulo')}`,
      });
      await tx`update shopper_threads set owner = 'human', owner_reason = ${trigger},
        human_until = now() + make_interval(mins => ${agent.settings.humanSilenceMin}),
        waiting_since = coalesce(waiting_since, now()), updated_at = now() where id = ${thread.id}`;
      await emitAdminTx(tx, r.tenant_id, 'vendedor.waiting', thread.id);
      await dispatchTx(tx, {
        actor,
        kind: 'timer.handback',
        source: 'vendedor:trigger',
        dedupeKey: `handback:${thread.id}:${r.id}`,
        deliverAt: new Date(now.getTime() + agent.settings.humanSilenceMin * 60_000 + 5_000),
      });
    }

    // the plan's conversations (ADR 0032): counted once a day before any model call (the turn
    // claims again for floors that answer later, e.g. "quando eu demorar")
    if (
      !trigger &&
      !(await claimForTurnTx(tx, thread, floor.floor, {
        key: `allowance:${r.id}`,
        silenceMin: agent.settings.humanSilenceMin,
        note: closedNotice(status, settings?.hours?.timezone ?? 'America/Sao_Paulo'),
        now,
      }))
    )
      return done('skipped');

    const meta = r.meta ?? {};
    let quoted: string | null = null;
    if (r.quoted_wa_id) {
      const [q] = await tx<{ body: string | null }[]>`
        select body from shopper_messages where tenant_id = ${r.tenant_id} and wa_id = ${r.quoted_wa_id}`;
      quoted = q?.body?.slice(0, 200) ?? null;
    }
    const payload: Record<string, Json> = {
      messageId: r.id,
      kind: r.kind,
      text: (r.body ?? '').slice(0, 2000),
      at,
      ...(derived.transcript ? { transcript: derived.transcript } : {}),
      ...(derived.confidence !== null ? { confidence: derived.confidence } : {}),
      ...(derived.description ? { description: derived.description } : {}),
      ...(derived.candidates.length ? { candidates: derived.candidates } : {}),
      ...(derived.receipt ? { receipt: true } : {}),
      ...(typeof meta.emoji === 'string' ? { emoji: meta.emoji } : {}),
      ...(quoted ? { quoted } : {}),
      ...(trigger ? { handoff: trigger } : {}),
    };
    await dispatchTx(tx, {
      actor,
      kind: 'message.inbound',
      source: `${thread.channel}`,
      dedupeKey: `in:${r.id}`,
      payload,
    });
    if (floor.floor === 'wait' && floor.until)
      await dispatchTx(tx, {
        actor,
        kind: 'timer.slow',
        source: 'vendedor:coverage',
        dedupeKey: `slow:${thread.id}:${(thread.pendingSince ?? new Date(r.created_at)).toISOString()}`,
        deliverAt: floor.until,
      });
    if (floor.floor === 'agent' && !trigger && thread.channel === 'whatsapp')
      await typingTx(tx, r.tenant_id, thread.id);
    return done('done');
  });
}

/**
 * "Aprendi com você" (UX §3.5): the store's answer to a question the Vendedor queued becomes a
 * proposed answer. It goes live only when the merchant taps "ensinar".
 */
async function learnFromMerchant(tx: Sql, thread: Thread, r: Row): Promise<void> {
  if (r.kind !== 'text' || !r.body || r.body.length < 8) return;
  const open = await tx<{ id: string; question: string }[]>`
    select id, question from store_knowledge
    where tenant_id = ${thread.tenantId} and kind = 'question' and status = 'open' and thread_id = ${thread.id}
    order by last_asked_at desc limit 3`;
  const q = open[0];
  if (!q) return;
  const [dup] = await tx<{ id: string }[]>`
    select id from store_knowledge where tenant_id = ${thread.tenantId} and kind = 'answer'
      and status in ('proposed', 'live') and question = ${q.question} limit 1`;
  if (dup) return;
  await tx`
    insert into store_knowledge (tenant_id, kind, status, source, question, answer, thread_id)
    values (${thread.tenantId}, 'answer', 'proposed', 'learned', ${q.question}, ${r.body.slice(0, 2000)}, ${thread.id})`;
  await emitAdminTx(tx, thread.tenantId, 'vendedor', 'knowledge');
}

/** The shopper is typing or recording: the quiet window waits (once per 3 s per thread). */
export async function presenceOne(sql: Sql, tenantId: string, threadId: string): Promise<void> {
  await withTenant(sql, tenantId, async (tx) => {
    const [t] = await tx<{ pending_since: Date | null; owner: string }[]>`
      select pending_since, owner from shopper_threads where tenant_id = ${tenantId} and id = ${threadId}`;
    if (!t?.pending_since || t.owner === 'muted') return;
    const [a] = await tx<{ id: string }[]>`
      select id from agent_actors where tenant_id = ${tenantId} and agent_id = ${AGENT_ID}
        and subject_kind = ${SUBJECT_KIND} and subject_id = ${threadId}`;
    if (!a) return;
    await dispatchTx(tx, {
      actor: { tenantId, agentId: AGENT_ID, subject: { kind: SUBJECT_KIND, id: threadId } },
      kind: 'presence.typing',
      source: 'whatsapp:presence',
      dedupeKey: `typing:${threadId}:${Math.floor(Date.now() / 3000)}`,
    });
  });
}

export async function ingestPass(d: IngestDeps): Promise<number> {
  const rows = await claimPending(d.sql);
  for (const r of rows) {
    try {
      await ingestOne(d, r);
    } catch (err) {
      ingestLog.error({ err, messageId: r.id, attempts: r.ingest_attempts }, 'ingest failed');
      if (r.ingest_attempts >= MAX_ATTEMPTS)
        await withTenant(
          d.sql,
          r.tenant_id,
          (tx) =>
            tx`update shopper_messages set ingest = 'failed', ingest_lease_until = null where id = ${r.id}`,
        ).catch(() => undefined);
    }
  }
  return rows.length;
}

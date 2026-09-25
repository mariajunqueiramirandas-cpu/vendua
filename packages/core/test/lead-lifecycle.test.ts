import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { claimRun, drain, flagCappedLeads, insertRun, runOnce } from '../src/agent/runner.ts';
import { enqueueInboxTx, sweepOrphanInbox } from '../src/agent/inbox.ts';
import { estimateModelCostUsd } from '../src/agent/llm.ts';
import {
  capCentsOf,
  DEFAULT_GUARDRAILS,
  validateSetting,
  type Guardrails,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { subscribeControlEvents, type ControlEvent } from '../src/modules/control-events.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { approveMessage, composeMessageTx } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

describe('guardrails — cadence + stale-draft knobs', () => {
  test('defaults', () => {
    expect(DEFAULT_GUARDRAILS.followupCadenceDays).toBe(2);
    expect(DEFAULT_GUARDRAILS.staleDraftDays).toBe(7);
    expect(DEFAULT_GUARDRAILS.firstContactDelayMin).toBe(0);
  });

  test('validateSetting accepts the new keys in range', () => {
    expect(() =>
      validateSetting('guardrails', { followupCadenceDays: 14, staleDraftDays: 0 }),
    ).not.toThrow();
  });

  test('validateSetting rejects out-of-range and non-integers', () => {
    for (const k of ['followupCadenceDays', 'staleDraftDays'] as const) {
      expect(() => validateSetting('guardrails', { [k]: -1 })).toThrow();
      expect(() => validateSetting('guardrails', { [k]: 91 })).toThrow();
      expect(() => validateSetting('guardrails', { [k]: 1.5 })).toThrow();
      expect(() => validateSetting('guardrails', { [k]: '7' })).toThrow();
    }
  });

  test('leadLifetimeCostCapUsd takes a bounded number — 0 disables', () => {
    for (const v of [5, 0, 2.5, 1000]) {
      expect(() => validateSetting('guardrails', { leadLifetimeCostCapUsd: v })).not.toThrow();
    }
    for (const v of [-1, '5', 1001, Number.NaN]) {
      expect(() => validateSetting('guardrails', { leadLifetimeCostCapUsd: v })).toThrow();
    }
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('lead lifecycle (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  // autoDrain off: endpoint enqueues would claim queued runs mid-assertion
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  // claims are durable across test runs — fresh keys, else replays mask
  // the asserted work
  const nonce = crypto.randomUUID().slice(0, 12);
  const key = (s: string) => `llc-${nonce}-${s}`;
  let migrated = false;
  const setup = async () => {
    if (!migrated) {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      migrated = true;
    }
  };

  const postLead = (body: Record<string, unknown>, idem: string) =>
    app.request('/control/v1/leads', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl-secret',
        'idempotency-key': idem,
      },
      body: JSON.stringify(body),
    });

  const runsFor = async (leadId: string) =>
    sql<{ id: string; kind: string; status: string; params: Record<string, unknown> }[]>`
      select id, kind, status, params from agent_runs where lead_id = ${leadId} order by created_at
    `;

  const setGuardrails = (g: Partial<Guardrails>) =>
    controlTx(
      sql,
      (tx) => tx`
        insert into control_settings (key, value) values ('guardrails', ${tx.json(g as never)})
        on conflict (key) do update set value = excluded.value
      `,
    );

  // claimRun scans the whole queue — cancel candidates outside `ids` so
  // assertions only see this test's runs
  const claimAmong = async (ids: string[]): Promise<string | null> => {
    const allowed = new Set(ids);
    for (;;) {
      const r = await claimRun(sql);
      if (!r) return null;
      if (allowed.delete(r.id)) return r.id;
      await sql`update agent_runs set status = 'canceled', finished_at = now() where id = ${r.id}`;
    }
  };

  describe('A1 — POST /leads automation opt-out', () => {
    test('automation:false creates the lead with no agent runs', async () => {
      await setup();
      await setGuardrails({ firstContactDelayMin: 60 });
      try {
        const res = await postLead(
          { name: 'No Automation', whatsapp: '+55 85 90000-0001', automation: false },
          key('a1-auto-off'),
        );
        expect(res.status).toBe(201);
        const { lead } = (await res.json()) as {
          lead: { id: string; agentMode: string };
          runId?: string;
          contactRunId?: string;
        };
        expect(lead.id).toBeTruthy();
        expect(lead.agentMode).not.toBe('off');
        // automation:false — the staff-managed CSV path runs no agent work
        expect(await runsFor(lead.id)).toHaveLength(0);
      } finally {
        await setGuardrails({});
      }
    });

    test('firstContactDelayMin > 0 schedules the single contact run', async () => {
      await setup();
      await setGuardrails({ firstContactDelayMin: 60 });
      try {
        const res = await postLead(
          { name: 'Delayed Contact', whatsapp: '+55 85 90000-0002' },
          key('a1-delayed'),
        );
        expect(res.status).toBe(201);
        const { lead } = (await res.json()) as { lead: { id: string } };
        const runs = await runsFor(lead.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.kind).toBe('outreach');
        expect(runs[0]!.params.draftOnly).toBeUndefined();
      } finally {
        await setGuardrails({});
      }
    });

    test('default — one outreach run, draft-only approval path', async () => {
      await setup();
      // pin supervised so an ambient agent preset can't flip the verdict
      const prior = (
        await sql<{ value: unknown }[]>`select value from control_settings where key = 'agent'`
      )[0];
      await sql`insert into control_settings (key, value) values ('agent', ${sql.json({ level: 'supervised' } as never)})
        on conflict (key) do update set value = excluded.value`;
      try {
        const res = await postLead(
          { name: 'Default Automation', whatsapp: '+55 85 90000-0003' },
          key('a1-default'),
        );
        expect(res.status).toBe(201);
        const { lead, runId } = (await res.json()) as {
          lead: { id: string };
          runId?: string;
        };
        expect(runId).toBeTruthy();
        const runs = await runsFor(lead.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.kind).toBe('outreach');
        // no draftOnly stamped — decided live at send time so a policy
        // flip between create and claim takes effect
        expect(runs[0]!.params.draftOnly).toBeUndefined();
        expect(runs[0]!.params.auto).toBe('first-contact');
      } finally {
        if (prior) {
          await sql`update control_settings set value = ${sql.json(prior.value as never)} where key = 'agent'`;
        } else {
          await sql`delete from control_settings where key = 'agent'`;
        }
      }
    });
  });

  describe('A2 — cadence floor after an agent send', () => {
    const compose = async (leadId: string, author: 'staff' | 'agent', status: 'draft' | 'queued') =>
      controlTx(sql, async (tx) => {
        const r = await composeMessageTx(tx, {
          leadId,
          channel: 'manual',
          body: 'oi',
          author,
          status,
        });
        return r.body.message.id;
      });

    const nextAction = async (leadId: string) =>
      (
        await sql<{ next_action_at: string | null }[]>`
        select next_action_at from leads where id = ${leadId}
      `
      )[0]!.next_action_at;

    const mkLead = (fields: Record<string, unknown> = {}) =>
      controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: `Cadence ${crypto.randomUUID()}`, agent_mode: 'auto', ...fields }),
      ).then((r) => r.body.lead.id);

    test('agent send stamps next_action_at ≈ +followupCadenceDays', async () => {
      await setup();
      const leadId = await mkLead();
      const messageId = await compose(leadId, 'agent', 'queued');
      const res = await dispatchMessage(sql, messageId);
      expect(res.ok).toBe(true);
      const at = await nextAction(leadId);
      expect(at).not.toBeNull();
      const delta = new Date(at!).getTime() - Date.now();
      const expected = DEFAULT_GUARDRAILS.followupCadenceDays * 86_400_000;
      expect(delta).toBeGreaterThan(expected - 60_000);
      expect(delta).toBeLessThanOrEqual(expected);
    });

    test('an existing next_action_at is never clobbered', async () => {
      await setup();
      const preset = new Date(Date.now() + 10 * 86_400_000);
      const leadId = await mkLead({ next_action_at: preset });
      const messageId = await compose(leadId, 'agent', 'queued');
      expect((await dispatchMessage(sql, messageId)).ok).toBe(true);
      expect(new Date((await nextAction(leadId))!).getTime()).toBe(preset.getTime());
    });

    test('staff sends never stamp the floor', async () => {
      await setup();
      const leadId = await mkLead();
      const messageId = await compose(leadId, 'staff', 'queued');
      expect((await dispatchMessage(sql, messageId)).ok).toBe(true);
      expect(await nextAction(leadId)).toBeNull();
    });

    test('suppressed leads get no stamp — off/archived leads are not queued again', async () => {
      await setup();
      const off = await mkLead({ agent_mode: 'off' });
      const m1 = await compose(off, 'agent', 'queued');
      expect((await dispatchMessage(sql, m1)).ok).toBe(true);
      expect(await nextAction(off)).toBeNull();

      const dead = await mkLead({ archived_at: new Date() });
      const m2 = await compose(dead, 'agent', 'queued');
      // archived suppresses the send itself — and must not stamp either.
      expect((await dispatchMessage(sql, m2)).ok).toBe(false);
      expect(await nextAction(dead)).toBeNull();
    });

    test('followupCadenceDays: 0 disables the floor', async () => {
      await setup();
      await setGuardrails({ followupCadenceDays: 0 });
      try {
        const leadId = await mkLead();
        const messageId = await compose(leadId, 'agent', 'queued');
        expect((await dispatchMessage(sql, messageId)).ok).toBe(true);
        expect(await nextAction(leadId)).toBeNull();
      } finally {
        await setGuardrails({});
      }
    });

    test('a live inbound past the send boundary suppresses the floor', async () => {
      await setup();
      const leadId = await mkLead();
      const messageId = await compose(leadId, 'agent', 'queued');
      const [msg] = await sql<{ thread_id: string }[]>`
        select thread_id from lead_messages where id = ${messageId}
      `;
      // received_at after 'sending' = answered on the wire — the floor
      // must not reschedule
      await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at, received_at)
        values (${msg!.thread_id}, 'in', 'lead', 'quero', 'received',
                now(), now() + interval '1 minute')`;
      expect((await dispatchMessage(sql, messageId)).ok).toBe(true);
      expect(await nextAction(leadId)).toBeNull();
    });

    test('a history import past the send boundary never suppresses the floor', async () => {
      await setup();
      const leadId = await mkLead();
      const messageId = await compose(leadId, 'agent', 'queued');
      const [msg] = await sql<{ thread_id: string }[]>`
        select thread_id from lead_messages where id = ${messageId}
      `;
      // context-only import — 'historical' rows are never an answer
      await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at, received_at, historical)
        values (${msg!.thread_id}, 'in', 'lead', 'contexto antigo', 'received',
                now() - interval '2 days', now() + interval '1 minute', true)`;
      expect((await dispatchMessage(sql, messageId)).ok).toBe(true);
      expect(await nextAction(leadId)).not.toBeNull();
    });
  });

  describe('A3 — stale draft approval regenerates', () => {
    const mkDraft = async (
      leadId: string,
      author: 'staff' | 'agent',
      ageDays: number,
    ): Promise<string> => {
      const messageId = await controlTx(sql, async (tx) => {
        const r = await composeMessageTx(tx, {
          leadId,
          channel: 'manual',
          body: 'mensagem antiga',
          author,
          status: 'draft',
        });
        await tx`
          update lead_messages set created_at = now() - make_interval(days => ${ageDays})
          where id = ${r.body.message.id}
        `;
        return r.body.message.id;
      });
      return messageId;
    };

    test('stale agent draft → superseded + draftOnly outreach run', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Stale Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);

      const res = await approveMessage(sql, messageId, 'staff', key('a3-stale'));
      expect(res.body.stale).toBe(true);
      expect(res.body.runId).toBeTruthy();
      expect(res.body.message.status).toBe('rejected');

      const runs = await runsFor(leadId);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.kind).toBe('outreach');
      expect(runs[0]!.params.draftOnly).toBe(true);
      expect(runs[0]!.id).toBe(res.body.runId!);

      const acts = await sql<{ kind: string }[]>`
        select kind from lead_activities where lead_id = ${leadId} and kind = 'system'
      `;
      expect(acts.length).toBeGreaterThan(0);

      // replay returns the stored body — never queues a second run
      const replay = await approveMessage(sql, messageId, 'staff', key('a3-stale'));
      expect(replay.replayed).toBe(true);
      expect(await runsFor(leadId)).toHaveLength(1);
    });

    test('fresh agent draft approves normally', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Fresh Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 0);
      const res = await approveMessage(sql, messageId, 'staff', key('a3-fresh'));
      expect(res.body.stale).toBeUndefined();
      expect(res.body.message.status).toBe('queued');
    });

    test('stale draft on a suppressed lead approves normally — no orphan regen', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Off Lead', agent_mode: 'off' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);
      const res = await approveMessage(sql, messageId, 'staff', key('a3-suppressed'));
      // claimRun's gate can't run the regen — normal approve; dispatch
      // suppression still applies
      expect(res.body.stale).toBeUndefined();
      expect(res.body.message.status).toBe('queued');
      expect(await runsFor(leadId)).toHaveLength(0);
    });

    test('stale draft on an agent-disabled thread approves normally', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Thread Off', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);
      await sql`update lead_threads set agent_enabled = false
                where id = (select thread_id from lead_messages where id = ${messageId})`;
      const res = await approveMessage(sql, messageId, 'staff', key('a3-thread-off'));
      expect(res.body.stale).toBeUndefined();
      expect(res.body.message.status).toBe('queued');
      expect(await runsFor(leadId)).toHaveLength(0);
    });

    test('a generic queued outreach does NOT block the regen — the intent mails into it', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Busy Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const generic = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId })))!;
      const messageId = await mkDraft(leadId, 'agent', 8);
      const res = await approveMessage(sql, messageId, 'staff', key('a3-active-run'));
      expect(res.body.stale).toBe(true);
      // one active run per lead → the regen intent lands as an 'event'
      // item; drainInbox defers draftOnly mail so runId is absent (the
      // orphan sweep spawns the real run later)
      expect(res.body.runId).toBeUndefined();
      const runs = await runsFor(leadId);
      expect(runs).toHaveLength(1);
      const items = await sql<{ payload: Record<string, unknown> }[]>`
        select payload from agent_inbox
        where lead_id = ${leadId} and kind = 'event' and consumed_at is null
      `;
      expect(items).toHaveLength(1);
      expect(items[0]!.payload.auto).toBe('regenerate');
      expect(items[0]!.payload.src).toBe(messageId);
      expect((items[0]!.payload.params as Record<string, unknown>).draftOnly).toBe(true);
    });

    test('queued regen dedupes per source draft — other drafts spawn their own', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Regen Queued', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);
      // a regen queued for THIS draft is reused…
      const existing = (await controlTx(sql, (tx) =>
        insertRun(tx, {
          kind: 'outreach',
          leadId,
          params: { auto: 'regenerate', draftOnly: true, src: messageId },
        }),
      ))!;
      const res = await approveMessage(sql, messageId, 'staff', key('a3-regen-queued'));
      expect(res.body.stale).toBe(true);
      expect(res.body.runId).toBe(existing);
      expect(await runsFor(leadId)).toHaveLength(1);
      const otherId = await mkDraft(leadId, 'agent', 8);
      const res2 = await approveMessage(sql, otherId, 'staff', key('a3-regen-other'));
      expect(res2.body.stale).toBe(true);
      // …but a regen pending on another draft doesn't swallow this one —
      // the distinct src earns its own ITEM inside the same queued run
      expect(res2.body.runId).toBe(existing);
      expect(await runsFor(leadId)).toHaveLength(1);
      const items = await sql<{ payload: Record<string, unknown> }[]>`
        select payload from agent_inbox
        where lead_id = ${leadId} and kind = 'event' and consumed_at is null
        order by created_at
      `;
      expect(items).toHaveLength(1);
      expect(items[0]!.payload.src).toBe(otherId);
    });

    test('one active run per lead — a second insertRun reuses the first', async () => {
      await setup();
      // drain the slate so assertions only see this test's rows
      await sql`update agent_runs set status = 'canceled', finished_at = now()
                where status in ('queued', 'running')`;
      const leadA = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Serial A', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const leadB = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Serial B', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const mkRun = (leadId: string) =>
        controlTx(sql, async (tx) => (await insertRun(tx, { kind: 'outreach', leadId }))!);
      const a1 = await mkRun(leadA);
      // partial unique index → insertRun returns the live row's id —
      // "deliver into existing run" keys on it
      expect(await mkRun(leadA)).toBe(a1);
      expect(await runsFor(leadA)).toHaveLength(1);
      const b1 = await mkRun(leadB);
      // claimRun orders created_at — pin explicit offsets or pick order
      // is a coin toss
      await sql`update agent_runs set created_at = now() - interval '2 seconds' where id = ${a1}`;
      await sql`update agent_runs set created_at = now() - interval '1 seconds' where id = ${b1}`;
      const ours = [a1, b1];
      expect(await claimAmong(ours)).toBe(a1);
      expect(await claimAmong(ours)).toBe(b1);
      expect(await claimAmong(ours)).toBeNull();
      await sql`update agent_runs set status = 'done', finished_at = now() where id in (${a1}, ${b1})`;
      const a2 = await mkRun(leadA);
      expect(a2).not.toBe(a1);
      expect(await claimAmong([a2])).toBe(a2);
    });

    test('a durably-blocked lead does not starve later runnable work', async () => {
      await setup();
      await sql`update agent_runs set status = 'canceled', finished_at = now()
                where status in ('queued', 'running')`;
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Blocked Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const owner = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId })))!;
      expect(await claimAmong([owner])).toBe(owner); // takes the lead's ownership
      // more queued same-lead outreach than the claim bound — the in-scan
      // exclusion keeps them out of candidacy
      for (let i = 0; i < 9; i++) {
        await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId }));
      }
      const disc = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'discovery' })))!;
      expect(await claimAmong([disc])).toBe(disc);
    });

    test('stale STAFF draft still approves — staff owns its own cadence', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Staff Stale', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'staff', 10);
      const res = await approveMessage(sql, messageId, 'staff', key('a3-staff'));
      expect(res.body.stale).toBeUndefined();
      expect(res.body.message.status).toBe('queued');
    });

    test('stale draft on a capped lead → 422 refusal, draft preserved for staff', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.01 });
      try {
        const leadId = await controlTx(sql, (tx) =>
          insertLeadTx(tx, { name: 'Capped Stale', agent_mode: 'auto' }),
        ).then((r) => r.body.lead.id);
        // prior spend over the 1¢ cap — insertRun refuses the regen
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('outreach', ${leadId}, 'done', 50, now())
        `;
        const messageId = await mkDraft(leadId, 'agent', 8);
        const res = await approveMessage(sql, messageId, 'staff', key('a3-cap-stale'));
        // the expired text must NOT go out — approve refuses; the draft
        // survives untouched
        expect(res.status).toBe(422);
        const [m] = await sql<{ status: string; error: string | null }[]>`
          select status, error from lead_messages where id = ${messageId}
        `;
        expect(m!.status).toBe('draft');
        expect(m!.error).toContain('teto de custo');
        expect((await runsFor(leadId)).filter((r) => r.status === 'queued')).toHaveLength(0);
      } finally {
        await setGuardrails({});
      }
    });

    test('stale draft with a parked regen on a capped lead → same 422, draft preserved', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.01 });
      try {
        const leadId = await controlTx(sql, (tx) =>
          insertLeadTx(tx, { name: 'Capped Reuse', agent_mode: 'auto' }),
        ).then((r) => r.body.lead.id);
        const messageId = await mkDraft(leadId, 'agent', 8);
        // the regen queued BEFORE the cap crossing — blind reuse would
        // reject the draft while the run parks forever
        await controlTx(sql, (tx) =>
          insertRun(tx, {
            kind: 'outreach',
            leadId,
            params: { auto: 'regenerate', draftOnly: true, src: messageId },
          }),
        );
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('outreach', ${leadId}, 'done', 50, now())
        `;
        const res = await approveMessage(sql, messageId, 'staff', key('a3-cap-reuse'));
        expect(res.status).toBe(422);
        const [m] = await sql<{ status: string }[]>`
          select status from lead_messages where id = ${messageId}
        `;
        expect(m!.status).toBe('draft');
      } finally {
        await setGuardrails({});
      }
    });

    test('staleDraftDays: 0 disables the gate', async () => {
      await setup();
      await setGuardrails({ staleDraftDays: 0 });
      try {
        const leadId = await controlTx(sql, (tx) =>
          insertLeadTx(tx, { name: 'Gate Off', agent_mode: 'auto' }),
        ).then((r) => r.body.lead.id);
        const messageId = await mkDraft(leadId, 'agent', 30);
        const res = await approveMessage(sql, messageId, 'staff', key('a3-off'));
        expect(res.body.stale).toBeUndefined();
        expect(res.body.message.status).toBe('queued');
      } finally {
        await setGuardrails({});
      }
    });
  });

  describe('A4 — enqueue endpoints mirror the claim gate', () => {
    const post = (path: string, body: Record<string, unknown>, idem: string) =>
      app.request(path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vendua-control': 'ctl-secret',
          'idempotency-key': idem,
        },
        body: JSON.stringify(body),
      });
    const errCode = async (res: Response) =>
      ((await res.json()) as { error?: { code?: string } }).error ?? {};
    const mkLeadApi = async (body: Record<string, unknown>, idem: string) => {
      // automation:false keeps assertions counting only runs the gated
      // endpoints enqueue
      const res = await post('/control/v1/leads', { automation: false, ...body }, idem);
      expect(res.status).toBe(201);
      return ((await res.json()) as { lead: { id: string } }).lead.id;
    };

    test('POST /leads/:id/run rejects a suppressed lead — queued run could never claim', async () => {
      await setup();
      const offId = await mkLeadApi({ name: 'Run Off', agentMode: 'off' }, key('a4-off-lead'));
      const unsubId = await mkLeadApi({ name: 'Run Unsub' }, key('a4-unsub-lead'));
      const pausedId = await mkLeadApi({ name: 'Run Paused Lead' }, key('a4-pause-lead'));
      await sql`update leads set unsubscribed_at = now() where id = ${unsubId}`;
      await sql`update leads set agent_paused_at = now() where id = ${pausedId}`;
      for (const [leadId, tag] of [
        [offId, 'off'],
        [unsubId, 'unsub'],
        [pausedId, 'paused'],
      ] as const) {
        const res = await post(
          `/control/v1/leads/${leadId}/run`,
          { kind: 'outreach' },
          key(`a4-${tag}`),
        );
        expect(res.status).toBe(422);
        expect((await errCode(res)).code).toBe('LEAD_SUPPRESSED');
        expect(await runsFor(leadId)).toHaveLength(0);
      }
    });

    test('POST /messages/:id/approve returns the cap refusal instead of a fake dispatch', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.01 });
      try {
        const leadId = await mkLeadApi(
          { name: 'Approve Cap', agentMode: 'auto' },
          key('a4-cap-lead'),
        );
        const messageId = await controlTx(sql, async (tx) => {
          const r = await composeMessageTx(tx, {
            leadId,
            channel: 'manual',
            body: 'cópia velha',
            author: 'agent',
            status: 'draft',
          });
          await tx`update lead_messages set created_at = now() - interval '8 days'
                   where id = ${r.body.message.id}`;
          return r.body.message.id;
        });
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('outreach', ${leadId}, 'done', 50, now())
        `;
        const res = await post(
          `/control/v1/messages/${messageId}/approve`,
          {},
          key('a4-cap-approve'),
        );
        // the refusal must reach staff as 422 — never a 200 no-op dispatch
        expect(res.status).toBe(422);
        expect((await errCode(res)).code).toBe('LEAD_COST_CAP');
        const [m] = await sql<{ status: string }[]>`
          select status from lead_messages where id = ${messageId}
        `;
        expect(m!.status).toBe('draft');
      } finally {
        await setGuardrails({});
      }
    });

    test('POST /leads/:id/run rejects a staff-paused thread — 422 THREAD_PAUSED', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Run Paused' }, key('a4-paused-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel, agent_enabled)
        values (${leadId}, 'manual', false) returning id
      `;
      const res = await post(
        `/control/v1/leads/${leadId}/run`,
        { kind: 'reply', threadId: thread!.id },
        key('a4-paused'),
      );
      expect(res.status).toBe(422);
      expect((await errCode(res)).code).toBe('THREAD_PAUSED');
      expect(await runsFor(leadId)).toHaveLength(0);
    });

    test('POST /leads/:id/unsubscribe cancels queued runs along with the flag', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Unsub Queue' }, key('a4-unsub-lead2'));
      const queued = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId })))!;
      const res = await post(`/control/v1/leads/${leadId}/unsubscribe`, {}, key('a4-unsub'));
      expect(res.status).toBe(200);
      const [r] = await sql<{ status: string }[]>`
        select status from agent_runs where id = ${queued}
      `;
      expect(r!.status).toBe('canceled');
    });

    test('POST /agent/runs applies the same gates for lead- and thread-scoped calls', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Runs Paused' }, key('a4-aruns-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel, agent_enabled)
        values (${leadId}, 'manual', false) returning id
      `;
      const paused = await post(
        '/control/v1/agent/runs',
        { kind: 'reply', threadId: thread!.id },
        key('a4-aruns-paused'),
      );
      expect(paused.status).toBe(422);
      expect((await errCode(paused)).code).toBe('THREAD_PAUSED');
      await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
      const suppressed = await post(
        '/control/v1/agent/runs',
        { kind: 'triage', leadId },
        key('a4-aruns-off'),
      );
      expect(suppressed.status).toBe(422);
      expect((await errCode(suppressed)).code).toBe('LEAD_SUPPRESSED');
      expect(await runsFor(leadId)).toHaveLength(0);
    });

    test('POST /agent/runs thread-only adopts the thread’s lead — suppression applies', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Thread Only' }, key('a4-tol-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel)
        values (${leadId}, 'manual') returning id
      `;
      // suppressed owner: the run must not bypass the lead gate via lead_id null
      await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
      const suppressed = await post(
        '/control/v1/agent/runs',
        { kind: 'reply', threadId: thread!.id },
        key('a4-tol-off'),
      );
      expect(suppressed.status).toBe(422);
      expect((await errCode(suppressed)).code).toBe('LEAD_SUPPRESSED');
      // live owner: the run inserts with lead_id bound, not null
      await sql`update leads set agent_mode = 'draft' where id = ${leadId}`;
      const ok = await post(
        '/control/v1/agent/runs',
        { kind: 'reply', threadId: thread!.id },
        key('a4-tol-ok'),
      );
      expect(ok.status).toBe(201);
      const [run] = await sql<{ lead_id: string | null }[]>`
        select lead_id from agent_runs where lead_id = ${leadId}
      `;
      expect(run!.lead_id?.toLowerCase()).toBe(leadId.toLowerCase());
    });

    test('POST /agent/runs/:id/cancel tombstones the run’s own request — no sweep restart', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Cancel Owns' }, key('a4-cxl-lead'));
      // the run rides the whatsapp thread — effective channel is the
      // thread's
      const [waThread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
      `;
      const run = await post(
        '/control/v1/agent/runs',
        { kind: 'outreach', leadId, threadId: waThread!.id },
        key('a4-cxl-run'),
      );
      expect(run.status).toBe(201);
      const { runId } = (await run.json()) as { runId: string };
      // an email-pinned request is never deliverable to this whatsapp
      // run — survives the tombstone
      await sql`
        insert into agent_inbox (lead_id, kind, payload)
        values (${leadId}, 'staff', ${sql.json({
          text: "a equipe pediu uma run 'reply'",
          requestedKind: 'reply',
          params: { channel: 'email', origin: 'staff' },
          forRunId: runId,
        })})
      `;
      // 'auto' normalizes to unpinned → deliverable to this run → dies
      // with it like the minted request
      const autoId = await controlTx(sql, (tx) =>
        enqueueInboxTx(tx, leadId, 'staff', {
          text: "a equipe pediu uma run 'discovery'",
          requestedKind: 'discovery',
          params: { channel: 'auto', origin: 'staff' },
          forRunId: runId,
        }),
      );
      const autoRow = await sql<{ payload: { params?: { channel?: string } } }[]>`
        select payload from agent_inbox where id = ${autoId}
      `;
      expect(autoRow[0]!.payload.params?.channel).toBeUndefined();
      const cancel = await post(`/control/v1/agent/runs/${runId}/cancel`, {}, key('a4-cxl-cancel'));
      expect(cancel.status).toBe(200);
      // the minted request dies with its run (a pending 'staff' item would
      // respawn the canceled run); email survives; auto→unpinned tombstoned
      const pending = await sql<{ payload: { params?: { channel?: string } } }[]>`
        select payload from agent_inbox where lead_id = ${leadId} and consumed_at is null
        order by created_at
      `;
      expect(pending).toHaveLength(1);
      expect(pending[0]!.payload.params?.channel).toBe('email');
      // the survivor isn't stranded — the sweep spawns a run for it
      // (the restart the canceled request must not get)
      await sweepOrphanInbox(sql);
      const runs = await runsFor(leadId);
      expect(runs).toHaveLength(2);
      expect(runs[1]!.status).toBe('queued');
      expect(runs[1]!.kind).toBe('reply');
      await sql`delete from agent_runs where status = 'queued'`;
    });

    test('POST /agent/dispatch skips a capped lead without committing its goal', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadId = await mkLeadApi({ name: 'Dispatch Capped' }, key('a4-dcap-lead'));
        // prior spend ≥ cap — the insert refuses; the goal write must not
        // survive or future runs would read it
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('reply', ${leadId}, 'done', 60, now())
        `;
        const res = await post(
          '/control/v1/agent/dispatch',
          { leadIds: [leadId], goal: 'meeting' },
          key('a4-dcap-post'),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          enqueued: number;
          skipped: { id: string; reason: string }[];
        };
        expect(body.enqueued).toBe(0);
        expect(body.skipped).toEqual([{ id: leadId, reason: 'lead over its agent cost cap' }]);
        const [lead] = await sql<{ agent_goal: string }[]>`
          select agent_goal from leads where id = ${leadId}
        `;
        expect(lead!.agent_goal).toBe('negotiation');
      } finally {
        await setGuardrails({});
      }
    });
  });

  describe('A5 — agent business rules', () => {
    const mkLead = (fields: Record<string, unknown> = {}) =>
      controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: `A5 ${crypto.randomUUID()}`, agent_mode: 'auto', ...fields }),
      ).then((r) => r.body.lead.id);

    const compose = async (
      leadId: string,
      author: 'staff' | 'agent',
      channel: 'manual' | 'whatsapp' = 'manual',
    ) =>
      controlTx(sql, async (tx) => {
        const r = await composeMessageTx(tx, {
          leadId,
          channel,
          body: 'oi',
          author,
          status: 'queued',
        });
        return r.body.message.id;
      });

    // 'log' driver completes a whatsapp send with no socket — the only
    // no-network path counting as real outbound
    const waLogDriver = () =>
      sql`
        insert into control_integrations (kind, driver, enabled)
        values ('whatsapp', 'log', true)
        on conflict (kind, driver) do update set enabled = true
      `;

    test('a sent outbound promotes lead → contacted and writes the transition trail', async () => {
      await setup();
      await waLogDriver();
      const leadId = await mkLead({ whatsapp: '5511955551234' });
      expect((await dispatchMessage(sql, await compose(leadId, 'agent', 'whatsapp'))).ok).toBe(
        true,
      );
      const lead = (
        await sql<{ state: string }[]>`select state from leads where id = ${leadId}`
      )[0]!;
      expect(lead.state).toBe('contacted');
      const hist = await sql`
        select 1 from lead_state_history
        where lead_id = ${leadId} and from_state = 'lead' and to_state = 'contacted'
      `;
      expect(hist).toHaveLength(1);
      const act = await sql`
        select 1 from lead_activities
        where lead_id = ${leadId} and kind = 'state_change' and body = 'lead → contacted'
      `;
      expect(act).toHaveLength(1);
    });

    test('the transition is forward-only — an invited lead is never demoted', async () => {
      await setup();
      await waLogDriver();
      const leadId = await mkLead({ whatsapp: '5511955551234' });
      await sql`update leads set state = 'invited' where id = ${leadId}`;
      expect((await dispatchMessage(sql, await compose(leadId, 'agent', 'whatsapp'))).ok).toBe(
        true,
      );
      const lead = (
        await sql<{ state: string }[]>`select state from leads where id = ${leadId}`
      )[0]!;
      expect(lead.state).toBe('invited');
    });

    test('a manual dispatch is not contact — the lead stays a lead', async () => {
      await setup();
      const leadId = await mkLead();
      expect((await dispatchMessage(sql, await compose(leadId, 'agent'))).ok).toBe(true);
      const lead = (
        await sql<{ state: string }[]>`select state from leads where id = ${leadId}`
      )[0]!;
      expect(lead.state).toBe('lead');
    });

    test('a run reclaimed into failed leaves a [humano] task on the lead', async () => {
      await setup();
      const leadId = await mkLead();
      const runId = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId })))!;
      // at the attempt cap the lease reclaim lands 'failed' — the task
      // is the staff-visible trace
      await sql`
        update agent_runs
        set status = 'running', attempts = max_attempts - 1,
            started_at = now() - interval '30 minutes',
            alive_at = now() - interval '30 minutes'
        where id = ${runId}
      `;
      await drain(sql);
      const [run] = await sql<{ status: string }[]>`
        select status from agent_runs where id = ${runId}
      `;
      expect(run!.status).toBe('failed');
      const tasks = await sql<{ title: string }[]>`
        select title from lead_tasks where lead_id = ${leadId}
      `;
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.title).toContain('[humano]');
      expect(tasks[0]!.title).toContain('outreach');
    });

    test('insertRun refuses a lead over its lifetime cost cap — flagged once', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadId = await mkLead();
        // prior spend ≥ cap (50¢): the next insertRun must refuse
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('reply', ${leadId}, 'done', 60, now())
        `;
        expect(
          await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId })),
        ).toBeNull();
        // a second refusal reuses the same flag — no spam
        expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId }))).toBeNull();
        const flags = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags).toHaveLength(1);
        const tasks = await sql`
          select 1 from lead_tasks where lead_id = ${leadId} and title like '[humano]%'
        `;
        expect(tasks).toHaveLength(1);
        // dedupe is per cap level — raise the ceiling, re-cross → a NEW flag
        await setGuardrails({ leadLifetimeCostCapUsd: 0.6 });
        expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId }))).toBeNull();
        const flags2 = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags2).toHaveLength(2);
        // board-scoped runs carry no lead — uncapped
        expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'strategist' }))).toBeTruthy();
        const other = await mkLead();
        expect(
          await controlTx(sql, (tx) => insertRun(tx, { kind: 'outreach', leadId: other })),
        ).toBeTruthy();
      } finally {
        await setGuardrails({});
      }
    });

    test('flagCappedLeads flags leads a lowered cap stranded — once', async () => {
      await setup();
      // spend under the old ceiling — no flag since nothing saw the crossing
      const leadId = await mkLead();
      await sql`
        insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
        values ('reply', ${leadId}, 'done', 60, now())
      `;
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        // ≥1: shared-DB leads may flag alongside — the function working
        expect(await flagCappedLeads(sql)).toBeGreaterThanOrEqual(1);
        const flags = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags).toHaveLength(1);
        expect(await flagCappedLeads(sql)).toBe(0);
        const flags2 = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags2).toHaveLength(1);
      } finally {
        await setGuardrails({});
      }
    });

    test('claimRun parks a queued run once the lead crosses the cap', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadId = await mkLead();
        const runId = (await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId })))!;
        // spend lands after queueing — the claim gate re-checks the ceiling
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('reply', ${leadId}, 'done', 60, now())
        `;
        await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
        expect(await claimRun(sql)).toBeNull();
        const [r] = await sql<{ status: string }[]>`
          select status from agent_runs where id = ${runId}
        `;
        // parked, not canceled — raising the cap resumes it
        expect(r!.status).toBe('queued');
        await setGuardrails({ leadLifetimeCostCapUsd: 10 });
        expect(await claimAmong([runId])).toBe(runId);
      } finally {
        await setGuardrails({});
      }
    });

    test('staff run endpoints answer LEAD_COST_CAP — a retry after the raise works', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      const post = (path: string, body: Record<string, unknown>, idem: string) =>
        app.request(path, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-vendua-control': 'ctl-secret',
            'idempotency-key': idem,
          },
          body: JSON.stringify(body),
        });
      try {
        const leadId = await mkLead();
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('reply', ${leadId}, 'done', 60, now())
        `;
        const capped = await post(
          `/control/v1/leads/${leadId}/run`,
          { kind: 'reply' },
          key('a5-cap-run'),
        );
        expect(capped.status).toBe(422);
        const err = (await capped.json()) as { error?: { code?: string } };
        expect(err.error?.code).toBe('LEAD_COST_CAP');
        // the refusal committed — the flag survives the 422
        const flags = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags).toHaveLength(1);
        // same key replays the refusal; a fresh key after the raise works
        const replay = await post(
          `/control/v1/leads/${leadId}/run`,
          { kind: 'reply' },
          key('a5-cap-run'),
        );
        expect(replay.status).toBe(422);
        await setGuardrails({ leadLifetimeCostCapUsd: 10 });
        const retry = await post(
          `/control/v1/leads/${leadId}/run`,
          { kind: 'reply' },
          key('a5-cap-run-2'),
        );
        expect(retry.status).toBe(201);
        expect(((await retry.json()) as { runId?: string }).runId).toBeTruthy();
      } finally {
        await setGuardrails({});
      }
    });

    test('model spend estimates from tokens when the provider reports no USD', async () => {
      await setup();
      const leadId = await mkLead();
      // mock-as-gemini reports costUsd:null → runOnce prices journaled
      // tokens at list rate; 1M in × $0.10 + 100k out × $0.40 = 14¢
      const runId = (await controlTx(sql, (tx) =>
        insertRun(tx, {
          kind: 'reply',
          leadId,
          params: {
            providerName: 'gemini:gemini-3.5-flash-lite',
            script: [{ text: 'ok', tokensIn: 1_000_000, tokensOut: 100_000 }],
          },
        }),
      ))!;
      await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const [r] = await sql<{ status: string; cost_cents: number }[]>`
        select status, cost_cents from agent_runs where id = ${runId}`;
      expect(r!.status).toBe('done');
      expect(r!.cost_cents).toBe(14);
    });

    test('a successful run crossing the cap emits lead.change for the fresh flag', async () => {
      await setup();
      // the mock spends 14¢ — a 10¢ cap makes this run the crossing
      await setGuardrails({ leadLifetimeCostCapUsd: 0.1 });
      const events: ControlEvent[] = [];
      const unsub = subscribeControlEvents((e) => events.push(e));
      try {
        const leadId = await mkLead();
        const runId = (await controlTx(sql, (tx) =>
          insertRun(tx, {
            kind: 'reply',
            leadId,
            params: {
              providerName: 'gemini:gemini-3.5-flash-lite',
              script: [{ text: 'ok', tokensIn: 1_000_000, tokensOut: 100_000 }],
            },
          }),
        ))!;
        await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
        expect(await runOnce(sql)).toBe(true);
        const [r] = await sql<{ status: string }[]>`
          select status from agent_runs where id = ${runId}`;
        expect(r!.status).toBe('done');
        // a SUCCESSFUL crossing must emit lead.change too (Tasks refresh
        // on it); unscoped — the coalescer drops middle refs
        expect(events.some((e) => e.type === 'lead.change' && e.ref === undefined)).toBe(true);
        const flags = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags).toHaveLength(1);
      } finally {
        unsub();
        await setGuardrails({});
      }
    });

    test('a canceled run crossing the cap persists its spend and flags the lead', async () => {
      await setup();
      // canceling mid-flight persists 14¢ — the cap check must run in the
      // abort path too
      await setGuardrails({ leadLifetimeCostCapUsd: 0.1 });
      const events: ControlEvent[] = [];
      const unsub = subscribeControlEvents((e) => events.push(e));
      try {
        const leadId = await mkLead();
        const runId = (await controlTx(sql, (tx) =>
          insertRun(tx, {
            kind: 'reply',
            leadId,
            params: {
              providerName: 'gemini:gemini-3.5-flash-lite',
              // turn 1 must COMMIT before the cancel or persistAborted
              // journals 0¢; turn 2's delay keeps it in-flight while the
              // fence detects 'lost'
              script: [
                { text: 'ok', delayMs: 50, tokensIn: 1_000_000, tokensOut: 100_000 },
                { text: 'ok', delayMs: 2_000 },
              ],
            },
          }),
        ))!;
        await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
        const running = runOnce(sql);
        // wait for the first model turn in the journal — the deterministic
        // point where cost is accrued
        for (let i = 0; i < 400; i++) {
          const [s] = await sql<{ m: boolean }[]>`
            select exists(
              select 1 from jsonb_array_elements(steps) e where e->>'type' = 'model'
            ) as m from agent_runs where id = ${runId}`;
          if (s?.m) break;
          await new Promise((r) => setTimeout(r, 10));
        }
        await sql`update agent_runs set status = 'canceled', finished_at = now() where id = ${runId}`;
        expect(await running).toBe(true);
        const [r] = await sql<{ status: string; cost_cents: number }[]>`
          select status, cost_cents from agent_runs where id = ${runId}`;
        expect(r!.status).toBe('canceled');
        expect(r!.cost_cents).toBe(14);
        // spend crossed the cap → flag + task in the abort tx, lead.change
        // post-commit
        const flags = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags).toHaveLength(1);
        expect(events.some((e) => e.type === 'lead.change' && e.ref === undefined)).toBe(true);
      } finally {
        unsub();
        await setGuardrails({});
      }
    });

    test('estimateModelCostUsd prices listed, free and unknown models', () => {
      expect(estimateModelCostUsd('gemini:gemini-3.5-flash-lite', 1_000_000, 0)).toBeCloseTo(0.1);
      expect(
        estimateModelCostUsd('openrouter:liquid/lfm-2.5-2.6b:free', 1_000_000, 1_000_000),
      ).toBe(0);
      // unknown models price at mid-tier fallback — a cap can't treat an
      // unrecognized driver as free
      expect(estimateModelCostUsd('gemini:gemini-future-pro', 500_000, 500_000)).toBeCloseTo(2.5);
      expect(estimateModelCostUsd('mock', 0, 0)).toBe(0);
    });

    test('a positive sub-cent cap still binds — insert and scan agree', async () => {
      await setup();
      // capCentsOf ceils: 0.4¢ → 1¢ — rounding to 0 would refuse unspent
      // leads while the claim scan treated them as uncapped
      expect(capCentsOf({ leadLifetimeCostCapUsd: 0.004 })).toBe(1);
      expect(capCentsOf({ leadLifetimeCostCapUsd: 0 })).toBe(0);
      await setGuardrails({ leadLifetimeCostCapUsd: 0.004 });
      try {
        const leadId = await mkLead();
        expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId }))).toBeTruthy();
        // the refusal binds only a lead with NO active run — delivery into
        // an active one costs nothing extra
        await sql`update agent_runs set status = 'done', finished_at = now() where lead_id = ${leadId}`;
        await sql`
          insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
          values ('reply', ${leadId}, 'done', 1, now())
        `;
        // 1¢ ≥ 1¢ — spent over the ceiled cap refuses
        expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId }))).toBeNull();
      } finally {
        await setGuardrails({});
      }
    });

    test('flagCappedLeads batches past its window until every unflagged lead is flagged', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadIds = [await mkLead(), await mkLead(), await mkLead()];
        for (const leadId of leadIds) {
          await sql`
            insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
            values ('reply', ${leadId}, 'done', 60, now())
          `;
        }
        // window of 1 — only looping reaches all three
        expect(await flagCappedLeads(sql, 1)).toBeGreaterThanOrEqual(3);
        for (const leadId of leadIds) {
          const flags = await sql`
            select 1 from lead_activities
            where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
          `;
          expect(flags).toHaveLength(1);
        }
      } finally {
        await setGuardrails({});
      }
    });
  });
});

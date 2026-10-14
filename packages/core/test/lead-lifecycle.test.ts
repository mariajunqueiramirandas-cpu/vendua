import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { dispatchMessage } from '../src/crm/send.ts';
import { requestLeadTx } from '../src/crm/dispatch.ts';
import { dropLeadMailTx } from '../src/crm/agenda.ts';
import {
  capCentsOf,
  DEFAULT_GUARDRAILS,
  validateSetting,
  type Guardrails,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { approveMessage, composeMessageTx } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';
import { PLATFORM_TENANT_ID } from '../src/platform/tenancy.ts';

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

  /** The lead's mailbox, oldest first (consumed rows included). */
  const mailFor = (leadId: string) =>
    sql<
      {
        id: string;
        kind: string;
        source: string;
        payload: Record<string, unknown>;
        deliver_at: Date;
      }[]
    >`
      select m.id, m.kind, m.source, m.payload, m.deliver_at from agent_mailbox m
      join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.subject_id = ${leadId}
      order by m.created_at`;

  // a finished turn's spend lives on its crm_turns row; the cap sums those
  const spend = (leadId: string, cents: number) =>
    sql`insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, status, started_at, cost_cents)
      values (gen_random_uuid(), gen_random_uuid(), 'crm', 'reply', 'whatsapp', ${leadId}, 'done', now(), ${cents})`;

  const setGuardrails = (g: Partial<Guardrails>) =>
    controlTx(
      sql,
      (tx) => tx`
        insert into control_settings (key, value) values ('guardrails', ${tx.json(g as never)})
        on conflict (key) do update set value = excluded.value
      `,
    );

  describe('A1 — POST /leads automation opt-out', () => {
    test('automation:false creates the lead with no agent work', async () => {
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
        // automation:false — the staff-managed CSV path files no agent mail
        expect(await mailFor(lead.id)).toHaveLength(0);
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
        const filed = await mailFor(lead.id);
        expect(filed.map((m) => m.kind)).toEqual(['lead.first_contact']);
        expect(filed[0]!.payload.draftOnly).toBeUndefined();
        // the contact waits out the delay (quiet hours can only push it later)
        expect(filed[0]!.deliver_at.getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
      } finally {
        await setGuardrails({});
      }
    });

    test('default — one first-contact mail, draft-only approval path', async () => {
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
        const filed = await mailFor(lead.id);
        expect(filed.map((m) => [m.kind, m.source])).toEqual([
          ['lead.first_contact', 'first_contact'],
        ]);
        // no draftOnly stamped — decided live at send time so a policy
        // flip between create and turn takes effect
        expect(filed[0]!.payload.draftOnly).toBeUndefined();
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

    const regenFor = async (leadId: string) =>
      (await mailFor(leadId)).filter((m) => m.kind === 'staff.regenerate');

    test('stale agent draft → superseded + one draftOnly regeneration', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Stale Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);

      const res = await approveMessage(sql, messageId, 'staff', key('a3-stale'));
      expect(res.body.stale).toBe(true);
      expect(res.body.runId).toBeTruthy();
      expect(res.body.message.status).toBe('rejected');

      const regen = await regenFor(leadId);
      expect(regen).toHaveLength(1);
      expect(regen[0]!.payload).toMatchObject({ draftOnly: true, src: messageId });
      expect(regen[0]!.id).toBe(res.body.runId!);

      const acts = await sql<{ kind: string }[]>`
        select kind from lead_activities where lead_id = ${leadId} and kind = 'system'
      `;
      expect(acts.length).toBeGreaterThan(0);

      // replay returns the stored body — never files a second regeneration
      const replay = await approveMessage(sql, messageId, 'staff', key('a3-stale'));
      expect(replay.replayed).toBe(true);
      expect(await regenFor(leadId)).toHaveLength(1);
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
      // a suppressed lead gets no regen — normal approve; dispatch
      // suppression still applies
      expect(res.body.stale).toBeUndefined();
      expect(res.body.message.status).toBe('queued');
      expect(await regenFor(leadId)).toHaveLength(0);
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
      expect(await regenFor(leadId)).toHaveLength(0);
    });

    test('a generic queued outreach does NOT block the regen — both wait in the mailbox', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Busy Lead', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const queued = await controlTx(sql, (tx) =>
        requestLeadTx(tx, {
          leadId,
          kind: 'staff.request',
          source: 'staff',
          dedupeKey: key('a3-queued-outreach'),
          payload: { kind: 'outreach' },
        }),
      );
      const messageId = await mkDraft(leadId, 'agent', 8);
      const res = await approveMessage(sql, messageId, 'staff', key('a3-active-run'));
      expect(res.body.stale).toBe(true);
      expect(res.body.runId).toBeTruthy();
      const filed = await mailFor(leadId);
      expect(filed.map((m) => m.kind)).toEqual(['staff.request', 'staff.regenerate']);
      expect(filed[0]!.id).toBe(queued.mailboxId!);
      expect(filed[1]!.payload).toMatchObject({ draftOnly: true, src: messageId });
    });

    test('queued regen dedupes per source draft — other drafts spawn their own', async () => {
      await setup();
      const leadId = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Regen Queued', agent_mode: 'auto' }),
      ).then((r) => r.body.lead.id);
      const messageId = await mkDraft(leadId, 'agent', 8);
      // a regen filed for THIS draft is reused…
      const existing = await controlTx(sql, (tx) =>
        requestLeadTx(tx, {
          leadId,
          kind: 'staff.regenerate',
          source: 'regenerate',
          dedupeKey: `crm:regenerate:${messageId}`,
          payload: { draftOnly: true, src: messageId },
        }),
      );
      const res = await approveMessage(sql, messageId, 'staff', key('a3-regen-queued'));
      expect(res.body.stale).toBe(true);
      expect((await regenFor(leadId)).map((m) => m.id)).toEqual([existing.mailboxId!]);
      const otherId = await mkDraft(leadId, 'agent', 8);
      const res2 = await approveMessage(sql, otherId, 'staff', key('a3-regen-other'));
      expect(res2.body.stale).toBe(true);
      // …but a regen for another draft earns its own row
      expect((await regenFor(leadId)).map((m) => m.payload.src)).toEqual([messageId, otherId]);
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
        // prior spend over the 1¢ cap — the regen is refused
        await spend(leadId, 50);
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
        expect(await regenFor(leadId)).toHaveLength(0);
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
        // a regen filed BEFORE the cap crossing still never ships the expired text
        await controlTx(sql, (tx) =>
          requestLeadTx(tx, {
            leadId,
            kind: 'staff.regenerate',
            source: 'regenerate',
            dedupeKey: `crm:regenerate:${messageId}`,
            payload: { draftOnly: true, src: messageId },
          }),
        );
        await spend(leadId, 50);
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

  describe('A4 — enqueue endpoints mirror the turn gate', () => {
    const errCode = async (res: Response) =>
      ((await res.json()) as { error?: { code?: string } }).error ?? {};
    const mkLeadApi = async (body: Record<string, unknown>, idem: string) => {
      // automation:false keeps assertions counting only runs the gated
      // endpoints enqueue
      const res = await post('/control/v1/leads', { automation: false, ...body }, idem);
      expect(res.status).toBe(201);
      return ((await res.json()) as { lead: { id: string } }).lead.id;
    };

    test('POST /agent/requests rejects a suppressed lead — nothing is filed for it', async () => {
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
          '/control/v1/agent/requests',
          { kind: 'outreach', leadId },
          key(`a4-${tag}`),
        );
        expect(res.status).toBe(422);
        expect((await errCode(res)).code).toBe('LEAD_SUPPRESSED');
        expect(await mailFor(leadId)).toHaveLength(0);
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
        await spend(leadId, 50);
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

    test('POST /agent/requests rejects a staff-paused thread — 422 THREAD_PAUSED', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Run Paused' }, key('a4-paused-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel, agent_enabled)
        values (${leadId}, 'manual', false) returning id
      `;
      const res = await post(
        '/control/v1/agent/requests',
        { kind: 'reply', leadId, threadId: thread!.id },
        key('a4-paused'),
      );
      expect(res.status).toBe(422);
      expect((await errCode(res)).code).toBe('THREAD_PAUSED');
      expect(await mailFor(leadId)).toHaveLength(0);
    });

    test('POST /leads/:id/unsubscribe drops queued mail along with the flag', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Unsub Queue' }, key('a4-unsub-lead2'));
      const queued = await controlTx(sql, (tx) =>
        requestLeadTx(tx, {
          leadId,
          kind: 'staff.request',
          source: 'staff',
          dedupeKey: key('a4-unsub-queued'),
          payload: { kind: 'outreach' },
        }),
      );
      const res = await post(`/control/v1/leads/${leadId}/unsubscribe`, {}, key('a4-unsub'));
      expect(res.status).toBe(200);
      expect(await sql`select 1 from agent_mailbox where id = ${queued.mailboxId!}`).toHaveLength(
        0,
      );
    });

    test('POST /agent/requests applies the same gates for lead- and thread-scoped calls', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Runs Paused' }, key('a4-aruns-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel, agent_enabled)
        values (${leadId}, 'manual', false) returning id
      `;
      const paused = await post(
        '/control/v1/agent/requests',
        { kind: 'reply', threadId: thread!.id },
        key('a4-aruns-paused'),
      );
      expect(paused.status).toBe(422);
      expect((await errCode(paused)).code).toBe('THREAD_PAUSED');
      await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
      const suppressed = await post(
        '/control/v1/agent/requests',
        { kind: 'triage', leadId },
        key('a4-aruns-off'),
      );
      expect(suppressed.status).toBe(422);
      expect((await errCode(suppressed)).code).toBe('LEAD_SUPPRESSED');
      expect(await mailFor(leadId)).toHaveLength(0);
    });

    test('POST /agent/requests thread-only adopts the thread’s lead — suppression applies', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Thread Only' }, key('a4-tol-lead'));
      const [thread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel)
        values (${leadId}, 'manual') returning id
      `;
      // suppressed owner: the run must not bypass the lead gate via lead_id null
      await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
      const suppressed = await post(
        '/control/v1/agent/requests',
        { kind: 'reply', threadId: thread!.id },
        key('a4-tol-off'),
      );
      expect(suppressed.status).toBe(422);
      expect((await errCode(suppressed)).code).toBe('LEAD_SUPPRESSED');
      // live owner: the run inserts with lead_id bound, not null
      await sql`update leads set agent_mode = 'draft' where id = ${leadId}`;
      const ok = await post(
        '/control/v1/agent/requests',
        { kind: 'reply', threadId: thread!.id },
        key('a4-tol-ok'),
      );
      expect(ok.status).toBe(201);
      // the request files on the lead's own mailbox, with the thread kept
      const filed = await mailFor(leadId);
      expect(filed.map((m) => [m.kind, m.payload.threadId])).toEqual([
        ['staff.request', thread!.id],
      ]);
    });

    test('POST /agent/runs/:id/cancel drops the run’s own request — other mail stays', async () => {
      await setup();
      const leadId = await mkLeadApi({ name: 'Cancel Owns' }, key('a4-cxl-lead'));
      // the run rides the whatsapp thread — effective channel is the
      // thread's
      const [waThread] = await sql<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
      `;
      const run = await post(
        '/control/v1/agent/requests',
        { kind: 'outreach', leadId, threadId: waThread!.id },
        key('a4-cxl-run'),
      );
      expect(run.status).toBe(201);
      const { runId } = (await run.json()) as { runId: string };
      // a request pinned to email is not this run's — it stays queued
      const other = await post(
        '/control/v1/agent/requests',
        { kind: 'reply', leadId, channel: 'email' },
        key('a4-cxl-other'),
      );
      expect(other.status).toBe(201);
      const cancel = await post(`/control/v1/agent/runs/${runId}/cancel`, {}, key('a4-cxl-cancel'));
      expect(cancel.status).toBe(200);
      expect(((await cancel.json()) as { status: string }).status).toBe('canceled');
      const pending = await mailFor(leadId);
      expect(pending.map((m) => m.id)).not.toContain(runId);
      expect(pending.map((m) => [m.payload.kind, m.payload.channel])).toEqual([['reply', 'email']]);
      await controlTx(sql, (tx) => dropLeadMailTx(tx, leadId));
    });

    test('bulk POST /agent/requests skips a capped lead without committing its goal', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const capped = await mkLeadApi({ name: 'Dispatch Capped' }, key('a4-dcap-lead'));
        const fine = await mkLeadApi({ name: 'Dispatch Fine' }, key('a4-dcap-fine'));
        // prior spend ≥ cap — the request refuses; the goal write must not
        // survive or future turns would read it
        await spend(capped, 60);
        const res = await post(
          '/control/v1/agent/requests',
          { kind: 'outreach', leadIds: [capped, fine], goal: 'meeting' },
          key('a4-dcap-post'),
        );
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          runs: { leadId: string; runId: string }[];
          skipped: { leadId: string; code: string; reason: string }[];
        };
        expect(body.runs.map((r) => r.leadId)).toEqual([fine]);
        expect(body.skipped).toEqual([
          { leadId: capped, code: 'LEAD_COST_CAP', reason: 'lead over its agent cost cap' },
        ]);
        const goals = await sql<{ id: string; agent_goal: string }[]>`
          select id, agent_goal from leads where id in ${sql([capped, fine])}
        `;
        const goal = Object.fromEntries(goals.map((g) => [g.id, g.agent_goal]));
        expect(goal[capped]).toBe('negotiation');
        expect(goal[fine]).toBe('meeting');
        // the refused lead files nothing — nothing lingers to fire when the cap moves
        expect(await mailFor(capped)).toHaveLength(0);
        await controlTx(sql, (tx) => dropLeadMailTx(tx, fine));
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

    test('a lead over its cost cap refuses staff requests — flagged once', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadId = await mkLead();
        // prior spend ≥ cap (50¢): the next request must refuse
        await spend(leadId, 60);
        const ask = (idem: string, lead = leadId) =>
          post('/control/v1/agent/requests', { kind: 'reply', leadId: lead }, key(idem));
        expect((await ask('a5-refuse-1')).status).toBe(422);
        // a second refusal reuses the same flag — no spam
        expect((await ask('a5-refuse-2')).status).toBe(422);
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
        expect((await ask('a5-refuse-3')).status).toBe(422);
        const flags2 = await sql`
          select 1 from lead_activities
          where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        `;
        expect(flags2).toHaveLength(2);
        // board-scoped requests carry no lead — uncapped
        const board = await post(
          '/control/v1/agent/requests',
          { kind: 'strategist' },
          key('a5-board'),
        );
        expect(board.status).toBe(201);
        expect(((await board.json()) as { runId?: string }).runId).toBeTruthy();
        const other = await mkLead();
        expect((await ask('a5-other', other)).status).toBe(201);
      } finally {
        await setGuardrails({});
      }
    });

    test('staff run endpoints answer LEAD_COST_CAP — a retry after the raise works', async () => {
      await setup();
      await setGuardrails({ leadLifetimeCostCapUsd: 0.5 });
      try {
        const leadId = await mkLead();
        await spend(leadId, 60);
        const capped = await post(
          '/control/v1/agent/requests',
          { kind: 'reply', leadId },
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
          '/control/v1/agent/requests',
          { kind: 'reply', leadId },
          key('a5-cap-run'),
        );
        expect(replay.status).toBe(422);
        await setGuardrails({ leadLifetimeCostCapUsd: 10 });
        const retry = await post(
          '/control/v1/agent/requests',
          { kind: 'reply', leadId },
          key('a5-cap-run-2'),
        );
        expect(retry.status).toBe(201);
        expect(((await retry.json()) as { runId?: string }).runId).toBeTruthy();
      } finally {
        await setGuardrails({});
      }
    });

    test('a positive sub-cent cap still binds', async () => {
      await setup();
      // capCentsOf ceils: 0.4¢ → 1¢ — rounding to 0 would mean uncapped
      expect(capCentsOf({ leadLifetimeCostCapUsd: 0.004 })).toBe(1);
      expect(capCentsOf({ leadLifetimeCostCapUsd: 0 })).toBe(0);
      await setGuardrails({ leadLifetimeCostCapUsd: 0.004 });
      try {
        const leadId = await mkLead();
        const ask = (idem: string) =>
          post('/control/v1/agent/requests', { kind: 'reply', leadId }, key(idem));
        expect((await ask('a5-sub-1')).status).toBe(201);
        // 1¢ ≥ 1¢ — spent over the ceiled cap refuses
        await spend(leadId, 1);
        expect((await ask('a5-sub-2')).status).toBe(422);
      } finally {
        await setGuardrails({});
      }
    });
  });
});

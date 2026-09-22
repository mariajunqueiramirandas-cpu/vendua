import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import {
  DEFAULT_GUARDRAILS,
  validateSetting,
  type Guardrails,
} from '../src/modules/integrations.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { approveMessage, composeMessageTx } from '../src/modules/threads.ts';
import { migrate } from '../src/platform/db.ts';

describe('guardrails — cadence + stale-draft knobs', () => {
  test('defaults', () => {
    expect(DEFAULT_GUARDRAILS.followupCadenceDays).toBe(2);
    expect(DEFAULT_GUARDRAILS.staleDraftDays).toBe(7);
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
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('lead lifecycle (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret' });
  // Claims are durable across `bun test` runs — keys must be fresh per
  // invocation or the second run replays the stored response instead of
  // executing the work being asserted.
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
        // automation:false covers BOTH the triage run and the delayed
        // first-contact run — the staff-managed CSV-import path.
        expect(await runsFor(lead.id)).toHaveLength(0);
      } finally {
        await setGuardrails({});
      }
    });

    test('triage:false skips only the triage run — scheduled contact still queues', async () => {
      await setup();
      await setGuardrails({ firstContactDelayMin: 60 });
      try {
        const res = await postLead(
          { name: 'No Triage', whatsapp: '+55 85 90000-0002', triage: false },
          key('a1-triage-off'),
        );
        expect(res.status).toBe(201);
        const { lead } = (await res.json()) as { lead: { id: string } };
        const runs = await runsFor(lead.id);
        expect(runs).toHaveLength(1);
        expect(runs[0]!.kind).toBe('outreach');
      } finally {
        await setGuardrails({});
      }
    });

    test('default behavior unchanged — triage run queues', async () => {
      await setup();
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
      expect(runs[0]!.kind).toBe('triage');
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

      // Replay returns the stored body — never queues a second run.
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
});

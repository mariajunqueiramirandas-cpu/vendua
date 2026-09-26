import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { serveOrphan } from '../src/agent/dispatch.ts';
import { enqueueInboxTx } from '../src/agent/inbox.ts';
import { stopClaims } from '../src/agent/runner.ts';
import {
  CHANNEL,
  nextWorkAt,
  startScheduler,
  stopScheduler,
  type WakeEvent,
} from '../src/agent/scheduler.ts';
import { fireDueWakeups, nextWakeupAtTx } from '../src/agent/wakeups.ts';
import { controlTx } from '../src/modules/control.ts';
import { digestNextAtTx } from '../src/modules/digest.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'scheduler — due times + notifications (db)',
  () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
    const MIGRATIONS = join(import.meta.dir, '../db/migrations');
    const mkLead = async () =>
      (
        await controlTx(sql, (tx) =>
          insertLeadTx(tx, { name: `Sched ${crypto.randomUUID()}`, agent_mode: 'auto' }),
        )
      ).body.lead.id as string;
    const until = async (check: () => Promise<boolean>, ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await check()) return true;
        await Bun.sleep(50);
      }
      return check();
    };
    const cleanup = async (leadId: string) => {
      await sql`update agent_runs set status = 'canceled', finished_at = now()
              where lead_id = ${leadId} and status in ('queued', 'running')`;
      await sql`update agent_wakeups set status = 'canceled' where lead_id = ${leadId} and status = 'pending'`;
      await sql`update agent_inbox set consumed_at = now() where lead_id = ${leadId} and consumed_at is null`;
    };

    test('triggers notify on the changes that make work due — and not on noise', async () => {
      await migrate(sql, MIGRATIONS);
      const events: WakeEvent[] = [];
      const sub = await sql.listen(CHANNEL, (p) => events.push(JSON.parse(p) as WakeEvent));
      const leadId = await mkLead();
      try {
        const seen = (t: string, l: string | null) =>
          until(async () => events.some((e) => e.t === t && e.l === l), 2000);

        await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
        expect(await seen('leads', leadId)).toBe(true);

        const [run] = await sql<{ id: string }[]>`
        insert into agent_runs (kind, lead_id, source) values ('outreach', ${leadId}, 'staff')
        returning id
      `;
        expect(await seen('agent_runs', leadId)).toBe(true);

        await sql`insert into control_settings (key, value) values ('guardrails', '{}'::jsonb)
                on conflict (key) do update set value = control_settings.value`;
        expect(await seen('control_settings', null)).toBe(true);

        // runtime state and heartbeats stay quiet
        events.length = 0;
        await sql`update agent_runs set alive_at = now() where id = ${run!.id}`;
        await sql`update leads set name = name where id = ${leadId}`;
        await sql`insert into control_settings (key, value) values ('digest_state', '{}'::jsonb)
                on conflict (key) do update set value = control_settings.value`;
        // a marker change after them proves the quiet ones had time to arrive
        await sql`update leads set agent_paused_at = null where id = ${leadId}`;
        expect(await seen('leads', leadId)).toBe(true);
        expect(events.filter((e) => e.t !== 'leads')).toEqual([]);
      } finally {
        await sub.unlisten();
        await cleanup(leadId);
      }
    });

    test('next due: only future work counts — due-but-parked rows wait for an event', async () => {
      await migrate(sql, MIGRATIONS);
      const leadId = await mkLead();
      try {
        const soon = new Date(Date.now() + 60_000);
        await sql`insert into agent_wakeups (lead_id, at, focus, created_by)
                values (${leadId}, ${soon}, 'retomar', 'staff'),
                       (${leadId}, now() - interval '1 minute', 'vencida', 'staff')`;
        const next = await controlTx(sql, (tx) => nextWakeupAtTx(tx));
        expect(next).not.toBeNull();
        expect(next!.getTime()).toBeGreaterThan(Date.now());
        expect(next!.getTime()).toBeLessThanOrEqual(soon.getTime());

        await sql`insert into agent_runs (kind, lead_id, source, run_at)
                values ('outreach', ${leadId}, 'staff', ${soon})`;
        const work = await nextWorkAt(sql);
        expect(work).not.toBeNull();
        expect(work!.getTime()).toBeGreaterThan(Date.now());
        expect(work!.getTime()).toBeLessThanOrEqual(soon.getTime());

        // the digest is always somewhere in the future or due now — never null
        const digest = await controlTx(sql, (tx) => digestNextAtTx(tx));
        expect(digest.getTime()).toBeGreaterThan(Date.now() - 1000);
      } finally {
        await cleanup(leadId);
      }
    });

    test('agenda batches past the page size and skips rows already seen', async () => {
      await migrate(sql, MIGRATIONS);
      const leads = await Promise.all(Array.from({ length: 23 }, () => mkLead()));
      try {
        for (const l of leads) {
          await sql`insert into agent_wakeups (lead_id, at, focus, created_by)
                  values (${l}, now() - interval '1 second', 'retomar', 'staff')`;
        }
        await fireDueWakeups(sql);
        const left = await sql`
        select 1 from agent_wakeups where lead_id in ${sql(leads)} and status = 'pending'
      `;
        expect(left.length).toBe(0);
      } finally {
        for (const l of leads) await cleanup(l);
      }
    });

    test('serveOrphan spawns a run for one lead’s pending mail', async () => {
      await migrate(sql, MIGRATIONS);
      const leadId = await mkLead();
      try {
        await controlTx(sql, (tx) =>
          enqueueInboxTx(
            tx,
            leadId,
            'event',
            { text: 'retomar', requestedKind: 'outreach' },
            { source: 'staff', promised: false },
          ),
        );
        expect(await serveOrphan(sql, leadId)).toBe(true);
        const runs = await sql`
        select 1 from agent_runs where lead_id = ${leadId} and status = 'queued'
      `;
        expect(runs.length).toBe(1);
        // an active run owns the mail now — serving again is a no-op
        expect(await serveOrphan(sql, leadId)).toBe(false);
      } finally {
        await cleanup(leadId);
      }
    });

    test('live: sleeps until a wakeup is due, and a notification wakes it at once', async () => {
      await migrate(sql, MIGRATIONS);
      const leadId = await mkLead();
      const fired = (id: string) => async () =>
        (await sql<{ status: string }[]>`select status from agent_wakeups where id = ${id}`)[0]
          ?.status === 'fired';
      startScheduler(sql, { jobs: ['agenda'], work: false });
      // no run executes in this test — only the agenda materializing them
      stopClaims(true);
      try {
        // wait out the boot pass
        await Bun.sleep(500);
        const [timed] = await sql<{ id: string }[]>`
        insert into agent_wakeups (lead_id, at, focus, created_by)
        values (${leadId}, now() + interval '1500 milliseconds', 'retomar', 'staff')
        returning id
      `;
        expect(await fired(timed!.id)()).toBe(false);
        await Bun.sleep(800);
        expect(await fired(timed!.id)()).toBe(false);
        expect(await until(fired(timed!.id), 3000)).toBe(true);

        // already due when written: the insert's notification is the only thing that can wake it
        const t0 = Date.now();
        const [now] = await sql<{ id: string }[]>`
        insert into agent_wakeups (lead_id, at, focus, created_by)
        values (${leadId}, now(), 'de novo', 'staff')
        returning id
      `;
        expect(await until(fired(now!.id), 3000)).toBe(true);
        expect(Date.now() - t0).toBeLessThan(2000);
      } finally {
        await stopScheduler(2000);
        stopClaims(false);
        await cleanup(leadId);
      }
    });
  },
);

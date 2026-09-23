import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('tasks (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  let migrated = false;
  const setup = async () => {
    if (!migrated) {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      migrated = true;
    }
  };

  const mkLead = () =>
    controlTx(sql, (tx) => insertLeadTx(tx, { name: `Tasks ${crypto.randomUUID()}` })).then(
      (r) => r.body.lead.id,
    );

  const mkTask = async (leadId: string, title: string, done: boolean) =>
    (
      await sql<{ id: string }[]>`
        insert into lead_tasks (lead_id, title, done_at, created_by)
        values (${leadId}, ${title}, ${done ? new Date() : null}, 'staff') returning id
      `
    )[0]!.id;

  const listTasks = async (qs: string) => {
    const res = await app.request(`/control/v1/tasks?${qs}`, {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { tasks: { id: string; leadId: string; doneAt: string | null }[] };
  };

  test('the done filter applies when leadId is also set', async () => {
    await setup();
    const leadId = await mkLead();
    const open = await mkTask(leadId, 'open', false);
    const done = await mkTask(leadId, 'done', true);

    const openOnly = await listTasks(`leadId=${leadId}&done=false`);
    expect(openOnly.tasks.map((t) => t.id)).toEqual([open]);

    const doneOnly = await listTasks(`leadId=${leadId}&done=true`);
    expect(doneOnly.tasks.map((t) => t.id)).toEqual([done]);

    const all = await listTasks(`leadId=${leadId}`);
    expect(all.tasks.map((t) => t.id).sort()).toEqual([done, open].sort());
  });

  test('the done filter still scopes the lead-less list', async () => {
    await setup();
    const leadId = await mkLead();
    const open = await mkTask(leadId, 'open', false);
    const done = await mkTask(leadId, 'done', true);

    const openOnly = await listTasks('done=false');
    expect(openOnly.tasks.map((t) => t.id)).toContain(open);
    expect(openOnly.tasks.map((t) => t.id)).not.toContain(done);

    const doneOnly = await listTasks('done=true');
    expect(doneOnly.tasks.map((t) => t.id)).toContain(done);
    expect(doneOnly.tasks.map((t) => t.id)).not.toContain(open);
  });
});

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { insertRun } from '../src/agent/runner.ts';
import {
  appendDebriefTx,
  leadFactsTx,
  memoryForRunTx,
  rememberTx,
  upsertLeadFactTx,
} from '../src/modules/agent-memory.ts';
import { controlTx } from '../src/modules/control.ts';
import { insertLeadTx } from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('agent memory v2 (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  // Memory content carries the nonce so assertions ignore rows from other runs.
  const nm = (s: string) => `zzm-${nonce}-${s}`;
  // Idem keys are nonce-scoped too — claims persist in the shared test DB and
  // a bare key would replay a previous run's response instead of writing.
  const idem = (s: string) => `mem-${nonce}-${s}`;
  let migrated = false;
  const setup = async () => {
    if (!migrated) {
      await migrate(sql, join(import.meta.dir, '../db/migrations'));
      migrated = true;
    }
  };

  const headers = (idem?: string) => ({
    'content-type': 'application/json',
    'x-vendua-control': 'ctl-secret',
    ...(idem ? { 'idempotency-key': idem } : {}),
  });
  const ctlGet = (path: string) => app.request(path, { headers: headers() });
  const post = (path: string, body: unknown, idem?: string) =>
    app.request(path, { method: 'POST', headers: headers(idem), body: JSON.stringify(body) });
  const patch = (path: string, body: unknown, idem?: string) =>
    app.request(path, { method: 'PATCH', headers: headers(idem), body: JSON.stringify(body) });
  const put = (path: string, body: unknown, idem?: string) =>
    app.request(path, { method: 'PUT', headers: headers(idem), body: JSON.stringify(body) });
  const del = (path: string, idem?: string) =>
    app.request(path, { method: 'DELETE', headers: headers(idem) });

  const mkLead = () =>
    controlTx(sql, (tx) => insertLeadTx(tx, { name: `Mem ${nonce} ${crypto.randomUUID()}` })).then(
      (r) => r.body.lead.id,
    );
  const mkRun = () =>
    controlTx(sql, (tx) => insertRun(tx, { kind: 'discovery' })).then((id) => {
      if (!id) throw new Error('insertRun refused');
      return id;
    });

  type MemRow = {
    id: string;
    scope: string;
    segment: string | null;
    content: string;
    pinned: boolean;
    source: string;
    uses: number;
  };
  const catchErr = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return e as { status?: number };
    }
  };
  const myItems = () =>
    sql<MemRow[]>`
      select id, scope, segment, content, pinned, source, uses
      from agent_memory_items where content like ${`zzm-${nonce}-%`} order by created_at
    `;

  // ---- routes: memory items -------------------------------------------------

  test('GET /agent/memory requires control auth and validates scope', async () => {
    await setup();
    const unauth = await app.request('/control/v1/agent/memory');
    expect(unauth.status).toBe(404); // gate 404s — the surface stays invisible to scans
    const res = await ctlGet('/control/v1/agent/memory?scope=bogus');
    expect(res.status).toBe(422);
  });

  test('POST/PATCH/DELETE memory round-trip with validation', async () => {
    await setup();
    const missingIdem = await post('/control/v1/agent/memory', {
      scope: 'workspace',
      content: nm('a'),
    });
    expect(missingIdem.status).toBe(400);

    const badScope = await post('/control/v1/agent/memory', { scope: 'bogus', content: nm('a') }, idem('k1'));
    expect(badScope.status).toBe(422);
    const noSegment = await post('/control/v1/agent/memory', { scope: 'segment', content: nm('a') }, idem('k2'));
    expect(noSegment.status).toBe(422);
    const tooLong = await post(
      '/control/v1/agent/memory',
      { scope: 'workspace', content: 'x'.repeat(501) },
      idem('k3'),
    );
    expect(tooLong.status).toBe(422);

    const created = await post(
      '/control/v1/agent/memory',
      { scope: 'segment', segment: 'Pudim São Paulo', content: nm('created') },
      idem('k4'),
    );
    expect(created.status).toBe(200);
    const { item } = (await created.json()) as { item: MemRow & { sourceRunId: string | null } };
    expect(item.scope).toBe('segment');
    expect(item.segment).toBe('pudim são paulo'); // lowercased
    expect(item.source).toBe('staff');
    expect(item.pinned).toBe(false);
    expect(item.sourceRunId).toBeNull();

    // Replay: same idem key → same item, replay header, no second row.
    const replay = await post(
      '/control/v1/agent/memory',
      { scope: 'segment', segment: 'Pudim São Paulo', content: nm('created') },
      idem('k4'),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    expect(((await replay.json()) as { item: MemRow }).item.id).toBe(item.id);

    const dup = await post(
      '/control/v1/agent/memory',
      { scope: 'segment', segment: 'pudim são paulo', content: nm('CREATED') },
      idem('k5'),
    );
    expect(dup.status).toBe(200); // case-insensitive dedupe → upsert, not 422
    expect(((await dup.json()) as { item: MemRow }).item.id).toBe(item.id);
    expect((await myItems()).filter((r) => r.id === item.id)).toHaveLength(1);

    const noFields = await patch(`/control/v1/agent/memory/${item.id}`, {}, idem('k6'));
    expect(noFields.status).toBe(422);
    const badPinned = await patch(`/control/v1/agent/memory/${item.id}`, { pinned: 'yes' }, idem('k7'));
    expect(badPinned.status).toBe(422);
    const pinned = await patch(`/control/v1/agent/memory/${item.id}`, { pinned: true }, idem('k8'));
    expect(pinned.status).toBe(200);
    expect(((await pinned.json()) as { item: MemRow }).item.pinned).toBe(true);

    const ghost = await patch(
      `/control/v1/agent/memory/${crypto.randomUUID()}`,
      { pinned: true },
      idem('k9'),
    );
    expect(ghost.status).toBe(404);

    const gone = await del(`/control/v1/agent/memory/${item.id}`, idem('k10'));
    expect((await gone.json()) as { ok: boolean }).toEqual({ ok: true });
    const again = await del(`/control/v1/agent/memory/${item.id}`, idem('k11'));
    expect(again.status).toBe(404);
  });

  // ---- routes: lead facts ---------------------------------------------------

  test('lead facts routes: 404s, key regex, round-trip', async () => {
    await setup();
    const leadId = await mkLead();
    const ghostId = crypto.randomUUID();

    const ghostFacts = await ctlGet(`/control/v1/leads/${ghostId}/facts`);
    expect(ghostFacts.status).toBe(404);
    const ghostPut = await put(`/control/v1/leads/${ghostId}/facts/size`, { value: 'xl' }, idem('f1'));
    expect(ghostPut.status).toBe(404); // FK-checked, not a 23503 500

    const badKey = await put(`/control/v1/leads/${leadId}/facts/Bad-Key`, { value: 'x' }, idem('f2'));
    expect(badKey.status).toBe(422);
    const noValue = await put(`/control/v1/leads/${leadId}/facts/size`, {}, idem('f3'));
    expect(noValue.status).toBe(422);
    const badConf = await put(
      `/control/v1/leads/${leadId}/facts/size`,
      { value: 'xl', confidence: 1.4 },
      idem('f4'),
    );
    expect(badConf.status).toBe(422);

    const wrote = await put(
      `/control/v1/leads/${leadId}/facts/size`,
      { value: 'xl', confidence: 0.8 },
      idem('f5'),
    );
    expect(wrote.status).toBe(200);
    const { fact } = (await wrote.json()) as {
      fact: { key: string; value: string; confidence: number; source: string };
    };
    expect({ key: fact.key, value: fact.value, source: fact.source }).toEqual({
      key: 'size',
      value: 'xl',
      source: 'staff',
    });
    expect(fact.confidence).toBe(0.8);

    const rewrote = await put(`/control/v1/leads/${leadId}/facts/size`, { value: 'xxl' }, idem('f6'));
    expect(rewrote.status).toBe(200);
    const facts = await ctlGet(`/control/v1/leads/${leadId}/facts`);
    const list = ((await facts.json()) as { facts: { key: string; value: string }[] }).facts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'size', value: 'xxl' });

    const gone = await del(`/control/v1/leads/${leadId}/facts/size`, idem('f7'));
    expect((await gone.json()) as { ok: boolean }).toEqual({ ok: true });
    const again = await del(`/control/v1/leads/${leadId}/facts/size`, idem('f8'));
    expect(again.status).toBe(404);
  });

  // ---- module behaviour -----------------------------------------------------

  test('rememberTx dedupes case-insensitively per scope/segment', async () => {
    await setup();
    const first = await controlTx(sql, (tx) =>
      rememberTx(tx, { scope: 'workspace', content: nm('dupe'), source: 'agent' }),
    );
    const second = await controlTx(sql, (tx) =>
      rememberTx(tx, { scope: 'workspace', content: nm('DUPE'), source: 'agent' }),
    );
    expect(second.item.id).toBe(first.item.id);
    const otherScope = await controlTx(sql, (tx) =>
      rememberTx(tx, { scope: 'segment', segment: 'pudim', content: nm('dupe'), source: 'agent' }),
    );
    expect(otherScope.item.id).not.toBe(first.item.id); // dedupe key includes scope+segment
    const runId = await mkRun();
    const withRun = await controlTx(sql, (tx) =>
      rememberTx(tx, {
        scope: 'workspace',
        content: nm('withrun'),
        source: 'agent',
        sourceRunId: runId,
      }),
    );
    expect(withRun.item.sourceRunId).toBe(runId);
    const badRun = controlTx(sql, (tx) =>
      rememberTx(tx, {
        scope: 'workspace',
        content: nm('badr'),
        source: 'agent',
        sourceRunId: crypto.randomUUID(), // no such agent_runs row
      }),
    );
    expect((await catchErr(badRun))?.status).toBe(422);
  });

  test('learnings cap 200: evicts oldest unpinned, keeps pinned', async () => {
    await setup();
    // Clean slate — the cap is global across all learnings.
    await sql`delete from agent_memory_items`;
    await controlTx(sql, (tx) => tx`
      insert into agent_memory_items (scope, content, source, created_at, updated_at)
      select 'workspace', ${nm('seed-')} || g, 'staff',
             now() - g * interval '1 second', now() - g * interval '1 second'
      from generate_series(1, 200) g
    `);
    // Pin the oldest seed — it must survive the next insert.
    await sql`update agent_memory_items set pinned = true where content = ${nm('seed-200')}`;

    const res = await controlTx(sql, (tx) =>
      rememberTx(tx, { scope: 'workspace', content: nm('fresh'), source: 'agent' }),
    );
    const items = await myItems();
    const learnings = await sql<{ n: number }[]>`
      select count(*)::int as n from agent_memory_items where scope in ('workspace', 'segment')
    `;
    expect(learnings[0]!.n).toBe(200);
    expect(res.evicted).toEqual([nm('seed-199')]); // oldest UNPINNED
    expect(items.some((r) => r.content === nm('seed-200') && r.pinned)).toBe(true);
    expect(items.some((r) => r.content === nm('seed-199'))).toBe(false);
    expect(items.some((r) => r.content === nm('fresh'))).toBe(true);
  });

  test('debrief cap 60: appendDebriefTx evicts the oldest debrief only', async () => {
    await setup();
    await sql`delete from agent_memory_items`;
    await controlTx(sql, (tx) => tx`
      insert into agent_memory_items (scope, content, source, created_at)
      select 'debrief', ${nm('db-')} || g, 'debrief', now() - g * interval '1 second'
      from generate_series(1, 60) g
    `);
    const res = await controlTx(sql, (tx) =>
      appendDebriefTx(tx, { content: nm('db-new') }),
    );
    expect(res.item.scope).toBe('debrief');
    expect(res.item.source).toBe('debrief');
    expect(res.evicted).toEqual([nm('db-60')]);
    const counts = await sql<{ debriefs: number; learnings: number }[]>`
      select count(*) filter (where scope = 'debrief')::int as debriefs,
             count(*) filter (where scope in ('workspace','segment'))::int as learnings
      from agent_memory_items
    `;
    expect(counts[0]!.debriefs).toBe(60);
    // learnings untouched by the debrief cap
    expect(counts[0]!.learnings).toBe(0);
  });

  test('memoryForRunTx orders pinned → segment → workspace → debriefs; bumps uses', async () => {
    await setup();
    await sql`delete from agent_memory_items`;
    const seg = 'pudim';
    await controlTx(sql, async (tx) => {
      // 10 debriefs — feed takes the latest 8 only.
      for (let i = 1; i <= 10; i++) {
        await tx`insert into agent_memory_items (scope, content, source, created_at)
                 values ('debrief', ${nm(`db${i}-`)}, 'debrief', now() - ${i} * interval '1 second')`;
      }
      await tx`insert into agent_memory_items (scope, segment, content, source)
               values ('segment', ${seg}, ${nm('seg-hit')}, 'agent'),
                      ('segment', 'outro', ${nm('seg-miss')}, 'agent'),
                      ('workspace', null, ${nm('ws')}, 'agent'),
                      ('workspace', null, ${nm('pin')}, 'agent')`;
      await tx`update agent_memory_items set pinned = true where content = ${nm('pin')}`;
      // Make the matched debrief visibly newer than older non-matched ones.
      await tx`update agent_memory_items set segment = ${seg} where content = ${nm('db3-')}`;
      return null;
    });

    const feed = await controlTx(sql, (tx) => memoryForRunTx(tx, { segment: seg }));
    expect(feed[0]).toBe(nm('pin'));
    expect(feed).toContain(nm('seg-hit'));
    expect(feed).not.toContain(nm('seg-miss'));
    expect(feed.indexOf(nm('seg-hit'))).toBeLessThan(feed.indexOf(nm('ws')));
    const debriefs = feed.filter((c) => c.startsWith(nm('db')));
    expect(debriefs).toHaveLength(8); // DEBRIEF_FEED cap
    expect(debriefs).not.toContain(nm('db10-')); // oldest dropped
    expect(debriefs[0]).toBe(nm('db3-')); // segment-matched debrief first

    const rows = await myItems();
    const uses = Object.fromEntries(rows.map((r) => [r.content, r.uses]));
    expect(uses[nm('pin')]).toBe(1);
    expect(uses[nm('seg-hit')]).toBe(1);
    expect(uses[nm('ws')]).toBe(1);
    expect(uses[nm('seg-miss')]).toBe(0); // not returned
    expect(uses[nm('db1-')]).toBe(0); // debriefs never bump uses
  });

  test('leadFactsTx/upsertLeadFactTx round-trip with key validation', async () => {
    await setup();
    const leadId = await mkLead();
    const bad = controlTx(sql, (tx) =>
      upsertLeadFactTx(tx, leadId, { key: 'BAD KEY', value: 'x', source: 'agent' }),
    );
    expect((await catchErr(bad))?.status).toBe(422);

    await controlTx(sql, (tx) =>
      upsertLeadFactTx(tx, leadId, { key: 'size', value: 'xl', confidence: 0.5, source: 'agent' }),
    );
    await controlTx(sql, (tx) =>
      upsertLeadFactTx(tx, leadId, { key: 'size', value: 'xxl', source: 'staff' }),
    );
    const facts = await controlTx(sql, (tx) => leadFactsTx(tx, leadId));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ key: 'size', value: 'xxl', confidence: 1, source: 'staff' });
  });

  // ---- migration backfill ---------------------------------------------------

  test('0035 backfill classifies agent_memory.facts into debrief vs workspace', async () => {
    await setup();
    // Re-run the migration's backfill against a controlled settings row:
    // drop the objects, pull the ledger row, seed facts, migrate again.
    await sql`drop table if exists agent_memory_items, lead_facts`;
    await sql`delete from schema_migrations where name = '0035_agent_memory_v2.sql'`;
    await sql`
      insert into control_settings (key, value) values ('agent_memory', ${sql.json({
        facts: [
          `run ${nonce}a: 12 leads (3 c/ whatsapp)`,
          `run ${nonce}b/centro: 0 leads`,
          nm('plain learning'),
          { not: 'a string' } as never, // non-string entries are skipped
        ],
      })})
      on conflict (key) do update set value = excluded.value
    `;
    await migrate(sql, join(import.meta.dir, '../db/migrations'));

    const rows = await sql<{ scope: string; source: string; content: string }[]>`
      select scope, source, content from agent_memory_items order by created_at
    `;
    expect(rows.map((r) => [r.scope, r.source])).toEqual([
      ['debrief', 'staff'],
      ['debrief', 'staff'],
      ['workspace', 'staff'],
    ]);
    // The old settings row is left untouched for the parent to retire.
    const kept = await sql<{ v: unknown }[]>`select value as v from control_settings where key = 'agent_memory'`;
    expect(kept).toHaveLength(1);
  });
});

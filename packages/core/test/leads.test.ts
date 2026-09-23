import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { controlTx } from '../src/modules/control.ts';
import {
  insertLeadTx,
  LEAD_STATES,
  leadInsert,
  leadJson,
  leadPatch,
  leadState,
  type LeadRow,
} from '../src/modules/leads.ts';
import { migrate } from '../src/platform/db.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('leadState', () => {
  test('every enum value passes', () => {
    for (const s of LEAD_STATES) expect(leadState(s)).toBe(s);
  });
  test('bad value → INVALID_STATE', () => {
    expect(code(() => leadState('bogus'))).toBe('INVALID_STATE');
    expect(code(() => leadState(''))).toBe('INVALID_STATE');
    expect(code(() => leadState(42))).toBe('INVALID_STATE');
    expect(code(() => leadState(null))).toBe('INVALID_STATE');
  });
});

describe('leadInsert', () => {
  test('name required → INVALID_LEAD', () => {
    expect(code(() => leadInsert({}))).toBe('INVALID_LEAD');
    expect(code(() => leadInsert({ name: '  ' }))).toBe('INVALID_LEAD');
    expect(code(() => leadInsert({ name: null }))).toBe('INVALID_LEAD');
  });
  test('name + optionals map to snake_case columns', () => {
    const out = leadInsert({
      name: 'Ana',
      businessName: 'Doces da Ana',
      phone: '2299',
      city: 'RJ',
    });
    expect(out).toEqual({
      name: 'Ana',
      business_name: 'Doces da Ana',
      phone: '2299',
      whatsapp: null,
      whatsapp_verified: false,
      email: null,
      instagram: null,
      website: null,
      city: 'RJ',
      segment: null,
      source: null,
      owner: null,
      lost_reason: null,
      discovered_via: null,
      fit_reason: null,
      intent_reason: null,
    });
  });
  test('non-string field → BAD_REQUEST', () => {
    expect(code(() => leadInsert({ name: 'Ana', phone: 123 }))).toBe('BAD_REQUEST');
  });
  test('agentGoal + fitScore map to snake_case columns', () => {
    const out = leadInsert({ name: 'Ana', agentGoal: 'meeting', fitScore: 8 });
    expect(out.agent_goal).toBe('meeting');
    expect(out.fit_score).toBe(8);
  });
  test('bad agentGoal / fitScore → 422', () => {
    expect(code(() => leadInsert({ name: 'A', agentGoal: 'spam' }))).toBe('INVALID_AGENT_GOAL');
    expect(code(() => leadInsert({ name: 'A', fitScore: 11 }))).toBe('BAD_REQUEST');
    expect(code(() => leadInsert({ name: 'A', fitScore: 3.5 }))).toBe('BAD_REQUEST');
  });
});

describe('leadPatch', () => {
  test('partial fields only', () => {
    expect(leadPatch({ city: 'RJ' })).toEqual({ city: 'RJ' });
    expect(leadPatch({ state: 'contacted' })).toEqual({ state: 'contacted' });
  });
  test('explicit null clears a field', () => {
    expect(leadPatch({ phone: null })).toEqual({ phone: null });
  });
  test('whatsapp writes carry the verified flag', () => {
    expect(leadPatch({ whatsapp: '5522999990000' })).toEqual({
      whatsapp: '5522999990000',
      whatsapp_verified: true,
    });
    expect(leadPatch({ whatsapp: null })).toEqual({ whatsapp: null, whatsapp_verified: false });
  });
  test('name cannot be emptied', () => {
    expect(code(() => leadPatch({ name: null }))).toBe('INVALID_LEAD');
    expect(code(() => leadPatch({ name: '' }))).toBe('INVALID_LEAD');
  });
  test('bad state → INVALID_STATE', () => {
    expect(code(() => leadPatch({ state: 'archived' }))).toBe('INVALID_STATE');
  });
  test('empty patch → BAD_REQUEST', () => {
    expect(code(() => leadPatch({}))).toBe('BAD_REQUEST');
    expect(code(() => leadPatch({ unknownField: 'x' }))).toBe('BAD_REQUEST');
  });
});

describe('leadJson', () => {
  const row: LeadRow = {
    id: 'l1',
    name: 'Ana',
    business_name: 'Doces da Ana',
    phone: '2299',
    whatsapp: '85999990000',
    whatsapp_verified: true,
    email: null,
    instagram: '@doces',
    website: null,
    city: 'RJ',
    segment: 'doceria',
    source: 'indicação',
    owner: null,
    tags: ['vip'],
    deal_value_cents: 12000,
    state: 'contacted',
    agent_mode: 'draft',
    agent_goal: 'negotiation',
    agent_plan: [
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ],
    fit_score: null,
    fit_reason: null,
    intent_score: null,
    intent_reason: null,
    email_bounced_at: null,
    next_action_at: null,
    lost_reason: null,
    archived_at: null,
    unsubscribed_at: null,
    agent_paused_at: null,
    discovered_via: null,
    created_at: '2026-09-18T00:00:00.000Z',
    updated_at: '2026-09-19T00:00:00.000Z',
  };
  test('snake_case row → camelCase contract', () => {
    const l = leadJson(row);
    expect(l.businessName).toBe('Doces da Ana');
    expect(l.createdAt).toBe('2026-09-18T00:00:00.000Z');
    expect(l.tags).toEqual(['vip']);
    expect(l.agentMode).toBe('draft');
    expect(l.dealValueCents).toBe(12000);
    expect(l.agentPlan).toEqual([
      { step: 'contexto: o que vende', status: 'done', note: 'dossiê lido' },
      { step: 'commit: enviar proposta', status: 'todo', note: null },
    ]);
  });
  test('null tags → empty array', () => {
    expect(leadJson({ ...row, tags: null }).tags).toEqual([]);
  });
});

// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
describe.skipIf(!process.env.TEST_DATABASE_URL)('lead list sort (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-secret', autoDrain: false });
  // A q-scoped prefix keeps the assertions blind to other suites' leads.
  const nonce = crypto.randomUUID().slice(0, 8);
  const pfx = `zzsrt-${nonce}`;
  let migrated = false;
  const setup = async () => {
    if (migrated) return;
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // Alpha=3000, Bravo=null, Charlie=1000 — every sort has a distinct order.
    await controlTx(sql, async (tx) => {
      const mk = async (name: string, deal: number | null) =>
        (await insertLeadTx(tx, { name: `${pfx} ${name}`, deal_value_cents: deal })).body.lead.id;
      const a = await mk('Alpha', 3000);
      const b = await mk('Bravo', null);
      const c = await mk('Charlie', 1000);
      // now() is transaction-time — same-tx inserts share created_at, so the
      // 'new' walk would fall to the uuid tiebreak. Stagger them explicitly.
      await tx`update leads set created_at = now() - interval '3 days' where id = ${a}`;
      await tx`update leads set created_at = now() - interval '2 days' where id = ${b}`;
      await tx`update leads set created_at = now() - interval '1 days' where id = ${c}`;
      // Explicit activity recency: Charlie newest, Alpha old, Bravo none.
      await tx`insert into lead_activities (lead_id, kind, body, at)
               values (${a}, 'note', 'x', now() - interval '5 days'),
                      (${c}, 'note', 'x', now())`;
      return [a, b, c];
    });
    migrated = true;
  };

  const list = async (qs: string) => {
    const res = await app.request(`/control/v1/leads?${qs}`, {
      headers: { 'x-vendua-control': 'ctl-secret' },
    });
    const body = (await res.json()) as {
      leads?: { id: string; name: string; score?: number }[];
      nextCursor?: string | null;
      error?: { code?: string };
    };
    return { status: res.status, body };
  };
  const order = async (sort: string) =>
    ((await list(`q=${pfx}&sort=${sort}`)).body.leads ?? []).map((l) => l.name.split(' ').pop());
  test('sort=name asc', async () => {
    await setup();
    expect(await order('name')).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });
  test('sort=new is created_at desc', async () => {
    await setup();
    expect(await order('new')).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });
  test('sort=value desc, nulls last', async () => {
    await setup();
    expect(await order('value')).toEqual(['Alpha', 'Charlie', 'Bravo']);
  });
  test('sort=activity — recent first, no-activity last', async () => {
    await setup();
    expect(await order('activity')).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
  test('sort=score desc — monotonically non-increasing', async () => {
    await setup();
    const { body } = await list(`q=${pfx}&sort=score`);
    const scores = (body.leads ?? []).map((l) => Number(l.score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
  test('keyset walk — limit=1 pages all three, no repeats', async () => {
    await setup();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const qs = `q=${pfx}&sort=name&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const { status, body } = await list(qs);
      expect(status).toBe(200);
      seen.push(...(body.leads ?? []).map((l) => l.name));
      cursor = body.nextCursor ?? null;
      if (!cursor) break;
    }
    expect(seen).toEqual([`${pfx} Alpha`, `${pfx} Bravo`, `${pfx} Charlie`]);
    // The activity walk also survives its null-key boundary (Bravo has none).
    cursor = null;
    const acts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const qs = `q=${pfx}&sort=activity&limit=1${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await list(qs);
      acts.push(...(body.leads ?? []).map((l) => l.name));
      cursor = body.nextCursor ?? null;
      if (!cursor) break;
    }
    expect(acts).toEqual([`${pfx} Charlie`, `${pfx} Alpha`, `${pfx} Bravo`]);
  });
  test('a cursor minted under one sort 400s under another', async () => {
    await setup();
    const first = await list(`q=${pfx}&sort=name&limit=1`);
    expect(first.body.nextCursor).toBeTruthy();
    const bad = await list(`q=${pfx}&sort=value&cursor=${first.body.nextCursor}`);
    expect(bad.status).toBe(400);
  });
  test('sort=bogus → INVALID_SORT', async () => {
    await setup();
    const { status, body } = await list(`q=${pfx}&sort=bogus`);
    expect(status).toBe(422);
    expect(body.error?.code).toBe('INVALID_SORT');
  });
});

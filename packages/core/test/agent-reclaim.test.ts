import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  claimRun,
  drain,
  enqueueRun,
  insertRun,
  replayJournal,
  runOnce,
} from '../src/agent/runner.ts';
import { enqueueInboxTx } from '../src/agent/inbox.ts';
import { executeTool, assertRunClaimTx, type ToolContext } from '../src/agent/tools.ts';
import { mapPointerName, pageKey } from '../src/agent/channels/discovery.ts';
import { dispatchMessage } from '../src/agent/send.ts';
import { controlTx } from '../src/modules/control.ts';
import { subscribeControlEvents, type ControlEvent } from '../src/modules/control-events.ts';
import { insertLeadTx, getLeadDetail } from '../src/modules/leads.ts';
import { ensureThread } from '../src/modules/threads.ts';
import { rememberTx } from '../src/modules/agent-memory.ts';
import { migrate } from '../src/platform/db.ts';

// ---------------------------------------------------------------------------
// replayJournal — pure journal → conversation rebuild (no DB).
// ---------------------------------------------------------------------------

describe('replayJournal', () => {
  test('empty journal replays nothing', () => {
    const r = replayJournal([]);
    expect(r.baseStep).toBe(0);
    expect(r.messages).toHaveLength(0);
    expect(r.book.size).toBe(0);
  });

  test('model + tool turns replay verbatim, in order', () => {
    const r = replayJournal([
      { type: 'system_prompt', content: 'SYS' },
      {
        type: 'model',
        content: 'buscando leads',
        toolCalls: [
          { id: 'call_1', name: 'web_search', args: { query: 'pudim' }, thoughtSignature: 'sig1' },
        ],
      },
      { type: 'tool', name: 'web_search', args: { query: 'pudim' }, out: { results: [] } },
      { type: 'model', content: 'fim', toolCalls: [] },
    ]);
    expect(r.baseStep).toBe(2);
    expect(r.messages).toEqual([
      {
        role: 'assistant',
        content: 'buscando leads',
        toolCalls: [
          { id: 'call_1', name: 'web_search', args: { query: 'pudim' }, thoughtSignature: 'sig1' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', name: 'web_search', content: '{"results":[]}' },
      { role: 'assistant', content: 'fim' },
    ]);
  });

  test('legacy names-only toolCalls still replay', () => {
    const r = replayJournal([
      { type: 'model', content: 'x', toolCalls: ['send_message'] },
      { type: 'tool', name: 'send_message', args: { body: 'oi' }, out: { ok: 1 } },
    ]);
    const assistant = r.messages[0]!;
    expect(assistant.role).toBe('assistant');
    const tc = (assistant as { toolCalls?: { id: string; args: unknown }[] }).toolCalls![0]!;
    // args restored from the journaled tool entry, id pairs with the result
    expect(tc.args).toEqual({ body: 'oi' });
    expect((r.messages[1] as { toolCallId: string }).toolCallId).toBe(tc.id);
  });

  test('a crashed batch replays interrupted results for unfulfilled calls', () => {
    const r = replayJournal([
      {
        type: 'model',
        content: null,
        toolCalls: [
          { id: 'a', name: 'maps_lookup', args: {} },
          { id: 'b', name: 'serp', args: {} },
        ],
      },
      // first call journaled pending (never resolved), second never journaled
      { type: 'tool', name: 'maps_lookup', args: {}, pending: true },
      { type: 'model', content: 'retry', toolCalls: [] },
    ]);
    const tools = r.messages.filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(2);
    expect(JSON.parse(tools[0]!.content).interrupted).toBe(true);
    expect(JSON.parse(tools[1]!.content).interrupted).toBe(true);
    expect(tools[1]!.toolCallId).toBe('b');
  });

  test('read_pages replay restores the fetch spend each entry represents', () => {
    const r = replayJournal([
      // numeric marker: two real fetches charged
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/1', 'https://a.co/2'] },
        readSpent: 2,
        out: { pages: [] },
      },
      // a call served fully from cache spent nothing
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/1'] },
        readSpent: 0,
        out: { pages: [{ url: 'https://a.co/1', cached: true }] },
      },
      // legacy boolean marker: one call = one spend
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/3'] },
        readSpent: true,
        out: { pages: [] },
      },
      // pre-marker completed call: one spend
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/4'] },
        out: { pages: [] },
      },
      // REPEAT suppression never reached the counter
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/4'] },
        out: { error: 'REPEAT — chamada idêntica à anterior já foi executada nesta run' },
      },
      // a pending entry stamped its reservation before dying mid-batch —
      // replay takes it at face value
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/5', 'https://a.co/6'] },
        readSpent: 2,
        pending: true,
      },
      // a pending entry stamped 0 died before validation — spent nothing
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/7'] },
        readSpent: 0,
        pending: true,
      },
      // a pending entry with NO marker can only be a legacy journal —
      // whether its fetch issued is unknowable, so it conservatively
      // reserves one spend (the safe side for a budget)
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/8', 'https://a.co/9'] },
        pending: true,
      },
    ]);
    // 2 + 0 + 1 + 1 + 0 + 2 + 0 + 1 = 7
    expect(r.pageReads).toBe(7);
  });

  test('replay rebuilds pageCache from journaled read_pages results', async () => {
    const r = replayJournal([
      {
        type: 'tool',
        name: 'read_pages',
        args: { urls: ['https://a.co/m'] },
        out: {
          pages: [{ url: 'https://a.co/m', finalUrl: 'https://a.co/menu', content: 'x' }],
        },
      },
    ]);
    for (const u of ['https://a.co/m', 'https://a.co/menu']) {
      const hit = r.pageCache.get(pageKey(u)!);
      expect(hit).toBeDefined();
      const out = (await hit) as { page: { url: string } };
      expect(out.page.url).toBe('https://a.co/m');
    }
  });

  test('nudge/reflection entries replay as user turns', () => {
    const r = replayJournal([
      { type: 'model', content: 'ok', toolCalls: [] },
      { type: 'nudge', content: 'continue' },
      { type: 'monid_spend', spentUsd: 0.01 },
    ]);
    expect(r.messages).toEqual([
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'continue' },
    ]);
  });

  test('only the latest attempt replays; baseStep counts all', () => {
    const prior = [
      { type: 'model', content: 'attempt1', toolCalls: [] },
      { type: 'resumed', attempt: 1 },
      { type: 'model', content: 'attempt2', toolCalls: [] },
    ];
    const r = replayJournal(prior);
    expect(r.baseStep).toBe(2);
    expect(r.messages).toEqual([{ role: 'assistant', content: 'attempt2' }]);
  });

  test('harness state accumulates across ALL attempts — not just the replayed one', () => {
    const r = replayJournal([
      // attempt 1: a maps hit and a serp contact — then the worker died
      {
        type: 'tool',
        name: 'maps_lookup',
        args: {},
        out: {
          candidates: [
            { name: 'A', phone: '+55111' },
            { name: 'B', phone: null },
          ],
        },
      },
      {
        type: 'tool',
        name: 'serp',
        args: {},
        out: {
          results: [{ contacts: { phones: ['+55222'], whatsappLinks: ['wa.me/1'], emails: [] } }],
        },
      },
      {
        type: 'tool',
        name: 'book',
        args: {},
        out: {
          entry: {
            name: 'Café Velho',
            city: null,
            status: 'open',
            channels: { email: 'a@velho.br' },
            tried: ['maps'],
            note: null,
          },
        },
      },
      { type: 'resumed', attempt: 1 },
      // attempt 2 replays only its own conversation — but the field state holds
      { type: 'model', content: 'other work', toolCalls: [] },
    ]);
    expect(r.seenContacts.has('+55111')).toBe(true);
    expect(r.seenContacts.has('+55222')).toBe(true);
    expect(r.seenContacts.has('wa.me/1')).toBe(true);
    expect(r.book.get('café velho')?.tried).toEqual(['maps']);
    expect(r.seenContacts.has('a@velho.br')).toBe(true);
    // conversation still bounded to the latest attempt
    expect(r.messages).toEqual([{ role: 'assistant', content: 'other work' }]);
  });

  test('an empty retry does not hide the last substantive attempt', () => {
    // attempt 3 persisted its 'resumed' marker then died before the model —
    // the boundary must fall back to attempt 2, not the empty tail.
    const r = replayJournal([
      { type: 'model', content: 'primeiro', toolCalls: [] },
      { type: 'tool', name: 'add_note', args: {}, out: { activity: { id: '1' } } },
      { type: 'resumed', attempt: 1 },
      { type: 'model', content: 'segundo', toolCalls: [] },
      {
        type: 'tool',
        name: 'send_message',
        args: {},
        out: { message: { id: 'm1', status: 'sent' } },
      },
      { type: 'resumed', attempt: 2 },
    ]);
    expect(r.messages.map((m) => m.role)).toEqual(['assistant', 'tool']);
    expect(r.messages[0]!.content).toBe('segundo');
  });

  test('landed artifact-minting calls rebuild their signatures — unproven pendings stay out', () => {
    const r = replayJournal([
      // a send that landed before the crash — suppressing its re-emission
      // beats a possible double-send
      {
        type: 'tool',
        name: 'send_message',
        args: { leadId: 'l1', body: 'olá' },
        out: { message: { id: 'm1', status: 'sent' } },
      },
      // a task journaled but never resolved — reconcileInterrupted only
      // fills out when the claim proves it committed; unproven means it
      // never ran, so it must stay retryable (not suppressible)
      {
        type: 'tool',
        name: 'create_task',
        args: { leadId: 'l1', title: 'vip' },
        callId: 'c1',
        step: 0,
        pending: true,
      },
      // failures minted nothing — they stay retryable
      {
        type: 'tool',
        name: 'create_task',
        args: { leadId: 'l1', title: 'x' },
        out: { error: 'boom' },
      },
      {
        type: 'tool',
        name: 'send_message',
        args: { leadId: 'l1', body: 'tchau' },
        out: { blocked: true },
      },
      // state-writes never join the set
      { type: 'tool', name: 'update_lead', args: { id: 'l1', city: 'Recife' }, out: { lead: {} } },
    ]);
    expect(r.landedSigs.has(JSON.stringify(['send_message', { leadId: 'l1', body: 'olá' }]))).toBe(
      true,
    );
    expect(r.landedSigs.size).toBe(1);
  });

  test('an unverified claim lookup suppresses pending artifact-mints conservatively', () => {
    const journal = [
      // attempt 1 journaled the task then died — out-less. When the claim
      // lookup fails, it may have committed — suppress the re-emission
      {
        type: 'tool',
        name: 'create_task',
        args: { leadId: 'l1', title: 'vip' },
        callId: 'c1',
        step: 0,
        pending: true,
      },
    ];
    // successful check (proven unclaimed): the entry stays retryable
    expect(
      replayJournal(journal).landedSigs.has(
        JSON.stringify(['create_task', { leadId: 'l1', title: 'vip' }]),
      ),
    ).toBe(false);
    // failed check (unverifiable): suppress rather than risk a duplicate
    expect(
      replayJournal(journal, true).landedSigs.has(
        JSON.stringify(['create_task', { leadId: 'l1', title: 'vip' }]),
      ),
    ).toBe(true);
  });

  test('the latest stored plan rebuilds ctx.plan — no durable field backs it', () => {
    const r = replayJournal([
      {
        type: 'tool',
        name: 'plan',
        args: {},
        out: { stored: true, plan: 'maps first, then SERP' },
      },
      { type: 'resumed', attempt: 1 },
      {
        type: 'tool',
        name: 'plan',
        args: {},
        out: { stored: true, plan: 'serp only now' },
      },
      // a failed/non-plan out must not clobber the last stored plan
      { type: 'tool', name: 'plan', args: {}, out: { error: 'plan needs content' } },
      { type: 'model', content: 'continua', toolCalls: [] },
    ]);
    expect(r.plan).toBe('serp only now');
    // a stored EMPTY plan clears — it must not resurrect the previous string
    expect(
      replayJournal([
        { type: 'tool', name: 'plan', args: {}, out: { stored: true, plan: 'x' } },
        { type: 'tool', name: 'plan', args: {}, out: { stored: true, plan: '' } },
      ]).plan,
    ).toBe('');
    // a journal with no stored plan leaves ctx.plan null
    expect(replayJournal([{ type: 'model', content: 'x', toolCalls: [] }]).plan).toBeNull();
  });

  test('book entries and banked contacts rebuild harness state', () => {
    const r = replayJournal([
      {
        type: 'model',
        content: null,
        toolCalls: [
          { id: 'b1', name: 'book', args: {} },
          { id: 'm1', name: 'instagram_profile', args: {} },
        ],
      },
      {
        type: 'tool',
        name: 'book',
        args: {},
        out: {
          entry: {
            name: 'Café Sol',
            city: 'Rio',
            status: 'open',
            channels: { whatsapp: '+5521999' },
            tried: ['ig'],
            note: null,
          },
        },
      },
      {
        type: 'tool',
        name: 'instagram_profile',
        args: {},
        out: { foundContacts: { phones: ['+5521888'], whatsappLinks: [], emails: ['a@b.co'] } },
      },
    ]);
    expect(r.book.get('café sol')?.tried).toEqual(['ig']);
    expect(r.seenContacts.has('+5521999')).toBe(true);
    expect(r.seenContacts.has('+5521888')).toBe(true);
    expect(r.seenContacts.has('a@b.co')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB-backed — opt-in via TEST_DATABASE_URL (CI has no Postgres).
// ---------------------------------------------------------------------------

describe('mapPointerName', () => {
  test('reads the name a pointer already carries — else null (a redirect hop)', () => {
    expect(mapPointerName('https://www.google.com/maps/place/Acme+Pizza')).toBe('Acme Pizza');
    expect(mapPointerName('https://www.google.com/search?q=Padaria+Central')).toBe(
      'Padaria Central',
    );
    expect(mapPointerName('https://g.co/kgs/abc123')).toBeNull();
    expect(mapPointerName('https://maps.app.goo.gl/xyz')).toBeNull();
    // a ?q= or /maps/place/ on any other host is not a profile pointer —
    // it must not claim the free in-process resolution a name unlocks
    expect(mapPointerName('https://evil.example/x?q=Acme+Pizza')).toBeNull();
    expect(mapPointerName('https://evil.example/maps/place/Acme+Pizza')).toBeNull();
    // a map-pointer host on an unfetchable scheme is not a pointer either
    expect(mapPointerName('ftp://maps.google.com/maps?q=Acme+Pizza')).toBeNull();
    // a continue param can't smuggle a google name through an invalid
    // outer url — the outer host/scheme validates first
    expect(
      mapPointerName(
        'https://unrelated.example/x?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3DAcme',
      ),
    ).toBeNull();
    expect(
      mapPointerName(
        'ftp://maps.google.com/maps?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3DAcme',
      ),
    ).toBeNull();
    // the real captcha-redirect shape still resolves
    expect(
      mapPointerName(
        'https://www.google.com/sorry/?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3DAcme',
      ),
    ).toBe('Acme');
  });

  test('a continue= chain is bounded — past the cap, null hands off to the fetch path', () => {
    // continue= wraps another google url (or itself) — untrusted input; the
    // peel is iterative (no recursion) but still bounded work. The contract
    // under test is only the boundary: mapPointerName returning null is
    // what hands the url to resolveMapPointer's per-hop fetch instead
    // (that side needs live network). The bound is 8 — a peel is cheap,
    // so names up to that depth resolve in-process with no fetch spent.
    const wrap = (u: string) => `https://www.google.com/sorry/?continue=${encodeURIComponent(u)}`;
    // a wrapper chain that never reaches a name carrier — null, no crash
    let loop = 'https://www.google.com/sorry/';
    for (let i = 0; i < 4; i++) loop = wrap(loop);
    expect(mapPointerName(loop)).toBeNull();
    // an empty &continue= is not a wrapper — the url's own name still reads
    expect(mapPointerName('https://www.google.com/search?q=Acme&continue=')).toBe('Acme');
    // …but a duplicated continue= resolves at its first nonempty value —
    // the wrapper's own ?q is never the destination's name
    expect(
      mapPointerName(
        `https://www.google.com/sorry/?q=Wrong&continue=&continue=${encodeURIComponent('https://www.google.com/search?q=Acme')}`,
      ),
    ).toBe('Acme');
    // a chain within the bound still resolves the name — in-process, free
    let chain = 'https://www.google.com/search?q=Acme';
    for (let i = 0; i < 7; i++) chain = wrap(chain);
    expect(mapPointerName(chain)).toBe('Acme');
    // …and exactly at it
    chain = wrap(chain);
    expect(mapPointerName(chain)).toBe('Acme');
    // …but one more is past the bound — null hands it to the fetch path,
    // whose own hops keep peeling (and run assertFetchable)
    chain = wrap(chain);
    expect(mapPointerName(chain)).toBeNull();
    // a wrapper's own ?q is not the destination's name — if the peel cap
    // leaves a leftover continue=, the carrier never resolved → null, not
    // the wrapper's name
    const tail = `https://www.google.com/sorry/?q=Wrong&continue=${encodeURIComponent('https://www.google.com/search?q=Acme')}`;
    let deep = tail;
    for (let i = 0; i < 8; i++) deep = wrap(deep);
    expect(mapPointerName(deep)).toBeNull();
    // a twice-encoded absolute target: get() leaves https%3A… — decode once
    // more only because the result is a complete url
    expect(mapPointerName(wrap(encodeURIComponent('https://www.google.com/search?q=Acme')))).toBe(
      'Acme',
    );
    // the peel never crosses the pointer family — a continue= pointing at a
    // foreign host keeps the wrapper (leftover continue → unresolved →
    // null), so the foreign target never becomes a chase hop
    expect(
      mapPointerName(
        `https://www.google.com/sorry/?continue=${encodeURIComponent('https://evil.example/x?q=Acme')}`,
      ),
    ).toBeNull();
    // same for a non-http target smuggled through continue=
    expect(
      mapPointerName(
        `https://www.google.com/sorry/?continue=${encodeURIComponent('javascript:alert(1)')}`,
      ),
    ).toBeNull();
  });
});

const dbDescribe = describe.skipIf(!process.env.TEST_DATABASE_URL);

dbDescribe('worker robustness (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!);
  const MIGRATIONS = join(import.meta.dir, '../db/migrations');

  const mkCtx = (
    runId: string,
    claimToken: string | null,
    leadId: string | null,
    runKind: ToolContext['runKind'] = 'reply',
    threadId: string | null = null,
  ): ToolContext => ({
    sql,
    runId,
    runKind,
    leadId,
    threadId,
    step: 0,
    claimToken,
    pageCache: new Map(),
    briefName: null,
    leadCap: 20,
    channelOverride: null,
    book: new Map(),
    plan: null,
    monid: null,
    seenContacts: new Set(),
    pageReads: 0,
    draftOnly: false,
  });

  /** Seed a run the lease has already expired on — drain() must reclaim it. */
  const seedStaleRun = async (steps: unknown[] = []): Promise<string> => {
    const id = (await enqueueRun(sql, { kind: 'outreach' }))!;
    const stale = new Date(Date.now() - 11 * 60_000); // past the 10-min lease
    await sql`
      update agent_runs set status = 'running', claim_token = 'stale-token',
        started_at = ${stale}, alive_at = ${stale},
        steps = ${sql.json(steps as never[])}
      where id = ${id}
    `;
    return id;
  };

  const getRun = (id: string) =>
    sql<
      {
        status: string;
        attempts: number;
        max_attempts: number;
        run_at: Date | null;
        claim_token: string | null;
        started_at: Date | null;
        error: string | null;
        finished_at: Date | null;
        steps: unknown[];
        tokens_in: number;
        tokens_out: number;
        cost_cents: number;
      }[]
    >`select status, attempts, max_attempts, run_at, claim_token, started_at, error, finished_at, steps,
      tokens_in, tokens_out, cost_cents
      from agent_runs where id = ${id}`.then((r) => r[0]!);

  test('reclaim requeues with attempts+1 and a ~2min backoff', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    const r = await getRun(id);
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(1);
    expect(r.claim_token).toBeNull();
    expect(r.started_at).toBeNull();
    const delayS = (r.run_at!.getTime() - Date.now()) / 1000;
    // 2^1 = 2min — wide bounds so CI timing noise can't flake it
    expect(delayS).toBeGreaterThan(100);
    expect(delayS).toBeLessThan(150);
    // run_at gates claimability: drain must not pick this run back up now
    await drain(sql, 1);
    expect((await getRun(id)).status).toBe('queued');
  });

  test('reclaims escalate backoff then land failed at max_attempts', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    // second stale period → attempts=2, backoff 2^2 = 4min
    await sql`update agent_runs set status='running',
      started_at=${new Date(Date.now() - 11 * 60_000)},
      alive_at=${new Date(Date.now() - 11 * 60_000)} where id=${id}`;
    await drain(sql, 0);
    let r = await getRun(id);
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(2);
    const delayS = (r.run_at!.getTime() - Date.now()) / 1000;
    expect(delayS).toBeGreaterThan(220);
    expect(delayS).toBeLessThan(260);
    // shrink the cap — the next reclaim must fail, not requeue
    await sql`update agent_runs set max_attempts = 3 where id = ${id}`;
    await sql`update agent_runs set status='running',
      started_at=${new Date(Date.now() - 11 * 60_000)},
      alive_at=${new Date(Date.now() - 11 * 60_000)} where id=${id}`;
    await drain(sql, 0);
    r = await getRun(id);
    expect(r.status).toBe('failed');
    expect(r.attempts).toBe(3);
    expect(r.error).toContain('attempt cap');
    expect(r.finished_at).not.toBeNull();
  });

  test('a terminal reclaim persists journaled spend and fires the cap check', async () => {
    await migrate(sql, MIGRATIONS);
    const events: ControlEvent[] = [];
    const unsub = subscribeControlEvents((e) => events.push(e));
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Capped Dead Run' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ leadLifetimeCostCapUsd: 0.2 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const id = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    const stale = new Date(Date.now() - 11 * 60_000);
    // 15¢ of model usage + monid markers holding CUMULATIVE balances
    // (3¢ then 10¢ — the budget's running total, not per-charge deltas):
    // over the 20¢ cap, but only ever recorded in steps (the attempt died
    // before finishRun). A sum would inflate to 28¢ — the fold must read
    // the LAST marker like priorSpend does on resume.
    await sql`
      update agent_runs set status = 'running', claim_token = 'stale',
        started_at = ${stale}, alive_at = ${stale}, max_attempts = 1,
        steps = ${sql.json([
          { type: 'model', content: 'a', usage: { tokensIn: 1, tokensOut: 1, costUsd: 0.15 } },
          { type: 'monid_spend', spentUsd: 0.03 },
          { type: 'monid_spend', spentUsd: 0.1 },
        ] as never[])}
      where id = ${id}
    `;
    await drain(sql, 0);
    const r = await getRun(id);
    expect(r.status).toBe('failed');
    expect(r.cost_cents).toBe(25);
    const flags = await sql`select 1 from lead_activities
      where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'`;
    expect(flags.length).toBe(1);
    const tasks = await sql`select title from lead_tasks
      where lead_id = ${leadId} and title like '%custo do agente%'`;
    expect(tasks.length).toBe(1);
    expect(events.some((e) => e.type === 'lead.change')).toBe(true);
    unsub();
  });

  test('a terminal reclaim emits lead.change for the failed-run task — no cap needed', async () => {
    await migrate(sql, MIGRATIONS);
    const events: ControlEvent[] = [];
    const unsub = subscribeControlEvents((e) => events.push(e));
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Dead Run' }));
    const leadId = lead.body.lead.id;
    const id = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`
      update agent_runs set status = 'running', claim_token = 'stale',
        started_at = ${stale}, alive_at = ${stale}, max_attempts = 1
      where id = ${id}
    `;
    await drain(sql, 0);
    const r = await getRun(id);
    expect(r.status).toBe('failed');
    // ordinary failure, no cap — the [humano] task still needs the refresh
    const tasks = await sql`select 1 from lead_tasks
      where lead_id = ${leadId} and title like '%tentativas esgotadas%'`;
    expect(tasks).toHaveLength(1);
    const flags = await sql`select 1 from lead_activities
      where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'`;
    expect(flags).toHaveLength(0);
    expect(events.some((e) => e.type === 'lead.change' && e.ref === undefined)).toBe(true);
    unsub();
  });

  test('a requeued run claims once its backoff elapses — attempts intact', async () => {
    await migrate(sql, MIGRATIONS);
    const id = await seedStaleRun();
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now() - interval '1 second' where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(id);
    expect(claimed!.attempts).toBe(1);
    expect(claimed!.claim_token).toBeTruthy();
  });

  test('mutating tools fence on a stale claim — no effect, STALE_CLAIM', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Fence Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);

    // live claim — update_lead applies
    const ok = (await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'u1', 'update_lead', {
      id: leadId,
      city: 'Niterói',
    })) as { lead: { city: string | null } };
    expect(ok.lead.city).toBe('Niterói');

    // simulate the reclaim the worker lost to: queued + cleared token
    await sql`update agent_runs set status='queued', claim_token=null where id=${runId}`;

    for (const call of [
      ['update_lead', { id: leadId, city: 'São Gonçalo' }],
      ['create_task', { leadId, title: 'não deve criar' }],
      ['draft_message', { leadId, body: 'não deve compor' }],
      ['send_message', { leadId, body: 'não deve enviar' }],
      ['unsubscribe', { leadId, reason: 'teste' }],
      ['add_note', { leadId, body: 'não deve anotar' }],
    ] as const) {
      await expect(
        executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'stale-1', call[0], call[1]),
      ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
    }
    const after = await getLeadDetail(sql, leadId);
    expect(after!.city).toBe('Niterói');
    expect(after!.unsubscribedAt).toBeNull();
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks).toHaveLength(0);
  });

  test('no claimToken = no fence (tests/sims path stays unfenced)', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'NoFence' }));
    const leadId = lead.body.lead.id;
    const out = (await executeTool(mkCtx('ghost-run', null, leadId), 'x', 'update_lead', {
      id: leadId,
      city: 'Rio',
    })) as { lead: { city: string | null } };
    expect(out.lead.city).toBe('Rio');
  });

  test('a stale strategist claim cannot land a proposed brief', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'strategist' }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    await sql`update agent_runs set status='canceled', claim_token=null where id=${runId}`;
    await expect(
      executeTool(mkCtx(runId, claimed!.claim_token, null, 'strategist'), 's1', 'propose_brief', {
        name: 'docerias fortaleza',
        query: 'docerias em fortaleza',
        reason: 'boa densidade',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
    const briefs = await sql`select 1 from discovery_briefs where name = 'docerias fortaleza'`;
    expect(briefs).toHaveLength(0);
  });

  test('a canceled run also fences its tools', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'CancelLead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    await sql`update agent_runs set status='canceled' where id=${runId}`;
    await expect(
      executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'c1', 'update_lead', {
        id: leadId,
        city: 'X',
      }),
    ).rejects.toMatchObject({ code: 'STALE_CLAIM' });
  });

  test('resume replays the journal: entries kept, step ids continue past baseStep', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Resume Lead' }));
    const leadId = lead.body.lead.id;
    const priorJournal = [
      { type: 'system_prompt', content: 'SYS' },
      {
        type: 'model',
        content: 'vou anotar',
        toolCalls: [{ id: 'old-1', name: 'add_note', args: { leadId, body: 'primeiro' } }],
      },
      { type: 'tool', name: 'add_note', args: { leadId, body: 'primeiro' }, out: { ok: true } },
      {
        type: 'model',
        content: 'quase',
        toolCalls: [{ id: 'old-2', name: 'create_task', args: { leadId } }],
      },
      // crashed mid-batch — the create_task result was never journaled
    ];
    const id = await seedStaleRun(priorJournal);
    await sql`update agent_runs set lead_id = ${leadId} where id = ${id}`;
    await drain(sql, 0); // reclaim → queued, attempts=1
    // pull the backoff forward; the mock driver consumes params.script
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'add_note', args: { leadId, body: 'segundo' } }] },
          { text: 'pronto' },
        ],
      } as never)}
      where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;

    expect(await runOnce(sql)).toBe(true);

    const r = await getRun(id);
    expect(r.status).toBe('done');
    const types = r.steps.map((s) => (s as { type?: string }).type);
    // prior journal survived; resumed boundary + this attempt's entries follow
    expect(types.slice(0, priorJournal.length)).toEqual(priorJournal.map((s) => s.type));
    expect(types[priorJournal.length]).toBe('resumed');
    expect(types).toContain('system_prompt');
    // the resumed attempt's add_note claimed under the CONTINUED step index —
    // baseStep=2 prior model turns → this turn's key is step 2, not 0/1
    const keys = await sql<{ key: string }[]>`
      select key from control_idempotency_keys where key like ${`agent:${id}:%`}
    `;
    expect(keys.map((k) => k.key)).toContain(`agent:${id}:2:add_note:mock-1-0`);
    const notes = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${leadId} and kind = 'note'
    `;
    expect(notes.map((n) => n.body)).toContain('segundo');
  });

  test('reconcile heals a pending entry whose mutation committed pre-crash', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Reconcile Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // The mutation commits through claimControl under key agent:run:step:name:callId —
    // then the worker "dies" before the result reaches the journal.
    await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'n1', 'add_note', {
      leadId,
      body: 'committed',
    });
    const priorJournal = [
      {
        type: 'model',
        content: 'vou anotar',
        toolCalls: [{ id: 'n1', name: 'add_note', args: { leadId, body: 'committed' } }],
      },
      {
        type: 'tool',
        name: 'add_note',
        args: { leadId, body: 'committed' },
        callId: 'n1',
        step: 0,
        pending: true,
      },
    ];
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`update agent_runs set started_at = ${stale}, alive_at = ${stale},
      steps = ${sql.json(priorJournal as never[])} where id = ${runId}`;
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${runId}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    // the pending entry healed to the stored claim response — not 'interrupted'
    const healed = r.steps.find(
      (s) => (s as { type?: string; callId?: string }).callId === 'n1',
    ) as { pending?: boolean; out?: { activity?: unknown } };
    expect(healed.pending).toBeUndefined();
    expect(healed.out?.activity).toBeTruthy();
    // and no duplicate: the committed note is the only one on the lead
    const notes = await sql<{ body: string }[]>`
      select body from lead_activities where lead_id = ${leadId} and kind = 'note'
    `;
    expect(notes.map((n) => n.body)).toEqual(['committed']);
  });

  test('request_human heals under its canonical claim key', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Handoff Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // Whole handoff commits under ONE claim keyed exactly like the journal
    // entry — suffixed sub-keys would leave reconcile with nothing to find.
    await executeTool(mkCtx(runId, claimed!.claim_token, leadId), 'h1', 'request_human', {
      leadId,
      reason: 'precisa de humano',
    });
    const priorJournal = [
      {
        type: 'model',
        content: 'passando para humano',
        toolCalls: [
          { id: 'h1', name: 'request_human', args: { leadId, reason: 'precisa de humano' } },
        ],
      },
      {
        type: 'tool',
        name: 'request_human',
        args: { leadId, reason: 'precisa de humano' },
        callId: 'h1',
        step: 0,
        pending: true,
      },
    ];
    const stale = new Date(Date.now() - 11 * 60_000);
    await sql`update agent_runs set started_at = ${stale}, alive_at = ${stale},
      steps = ${sql.json(priorJournal as never[])} where id = ${runId}`;
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${runId}`;
    // The handoff's own lead-wide marker parks the requeued run at claim —
    // staff resuming the lead (clearing the flag) releases it to heal.
    await sql`update leads set agent_paused_at = null where id = ${leadId}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const healed = r.steps.find(
      (s) => (s as { type?: string; callId?: string }).callId === 'h1',
    ) as { pending?: boolean; out?: { handedOff?: boolean } };
    expect(healed.pending).toBeUndefined();
    expect(healed.out?.handedOff).toBe(true);
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks.length).toBe(1);
    const notes = await sql`select 1 from lead_activities
      where lead_id = ${leadId} and kind = 'system' and body like 'Handoff para humano%'`;
    expect(notes.length).toBe(1);
  });

  test('resume carries prior-attempt usage into the stored counters', async () => {
    await migrate(sql, MIGRATIONS);
    // Attempt 1 paid for two model calls before dying — finishRun writes
    // counters wholesale, so without the journal usage they'd be lost.
    const id = await seedStaleRun([
      {
        type: 'model',
        content: 'turno um',
        toolCalls: [],
        usage: { tokensIn: 100, tokensOut: 20, costUsd: 0.1 },
      },
      {
        type: 'model',
        content: 'turno dois',
        toolCalls: [],
        usage: { tokensIn: 40, tokensOut: 10, costUsd: 0.15 },
      },
    ]);
    await drain(sql, 0);
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ script: [{ text: 'encerrado' }] } as never)} where id = ${id}`;
    await sql`delete from agent_runs where status = 'queued' and id <> ${id}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(id);
    expect(r.status).toBe('done');
    // prior 140/30 + the mock driver's zeros — not reset to this attempt only.
    expect(r.tokens_in).toBe(140);
    expect(r.tokens_out).toBe(30);
    expect(r.cost_cents).toBe(25);
  });

  test('a stale claim fences dispatch — the queued message stays queued', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Dispatch Fence' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    const [msg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread!.id}, 'out', 'agent', 'não envia', 'queued') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId);
    // cancel/reclaim lands between compose-commit and the dispatch tx
    await sql`update agent_runs set status = 'canceled', claim_token = null where id = ${runId}`;
    await expect(
      dispatchMessage(sql, msg!.id, (tx) => assertRunClaimTx(tx, ctx)),
    ).rejects.toMatchObject({ status: 409, code: 'STALE_CLAIM' });
    const [m] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${msg!.id}
    `;
    expect(m!.status).toBe('queued');
  });

  test('a staff-paused thread holds its queued runs — claim resumes on unpause', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Paused Thread' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel, agent_enabled)
      values (${leadId}, 'whatsapp', false) returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id ?? null).not.toBe(runId);
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
    await sql`update lead_threads set agent_enabled = true where id = ${thread!.id}`;
    const resumed = await claimRun(sql);
    expect(resumed?.id).toBe(runId);
  });

  test('an in-flight pause committing mid-claim is seen — the run stays queued', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Race Pause' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id }))!;
    // A second connection holds an uncommitted pause — the claim's
    // select sees enabled (pre-pause snapshot) but its FOR UPDATE on the
    // thread row blocks until this commits and must re-read 'false'.
    const blocker = await sql.reserve();
    try {
      await blocker`begin`;
      await blocker`update lead_threads set agent_enabled = false where id = ${thread!.id}`;
      const claim = claimRun(sql);
      await blocker`commit`;
      const claimed = await claim;
      expect(claimed?.id ?? null).not.toBe(runId);
    } finally {
      blocker.release();
    }
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
  });

  test('stranded recovery fails agent messages whose run went terminal', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Stranded' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    await claimRun(sql);
    // agent-authored row whose run died before/after the guarded dispatch —
    // created >20s ago so the stranded sweep owns it
    const [msg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'não envia', 'queued', ${runId}, now() - interval '30 seconds')
      returning id
    `;
    // staff-authored control: agent_run_id null → recovery must still send
    const [staffMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, created_at)
      values (${thread!.id}, 'out', 'staff', 'pode enviar', 'queued', now() - interval '30 seconds')
      returning id
    `;
    // approved agent draft on the SAME terminal run: approved_by makes it
    // staff-owned — the sweep must not fail it
    const [approved] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, approved_by, approved_at, created_at)
      values (${thread!.id}, 'out', 'agent', 'aprovado envia', 'queued', ${runId}, 'staff@x', now(), now() - interval '30 seconds')
      returning id
    `;
    await sql`update agent_runs set status = 'canceled', claim_token = null where id = ${runId}`;
    await drain(sql, 0);
    const [m] = await sql<{ status: string; error: string | null }[]>`
      select status, error from lead_messages where id = ${msg!.id}
    `;
    expect(m!.status).toBe('failed');
    expect(m!.error).toBe('authoring run no longer active');
    const [s] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${staffMsg!.id}
    `;
    expect(s!.status).toBe('sent');
    const [a] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${approved!.id}
    `;
    expect(a!.status).toBe('sent');
  });

  test('stranded recovery defers to a live owner — only done runs dispatch', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Owners' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'manual') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    // 'done' run: its committed send has no owner left — recovery delivers it.
    // Marked terminal BEFORE the second insertRun — one active run per lead
    // means a queued sibling can't exist alongside it.
    const doneRun = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    await sql`update agent_runs set status = 'done', claim_token = null where id = ${doneRun}`;
    const [doneMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'done envia', 'queued', ${doneRun}, now() - interval '30 seconds')
      returning id
    `;
    // 'queued' run: the next attempt owns the send — recovery must NOT dispatch
    const queuedRun = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    expect(queuedRun).not.toBe(doneRun);
    const [queuedMsg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, created_at)
      values (${thread!.id}, 'out', 'agent', 'ainda não', 'queued', ${queuedRun}, now() - interval '30 seconds')
      returning id
    `;
    // run_at in the future keeps the queued run unclaimable — drain can't
    // race it into 'running' mid-test
    await sql`update agent_runs set run_at = now() + interval '1 hour' where id = ${queuedRun}`;
    await drain(sql, 0);
    const [d] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${doneMsg!.id}
    `;
    expect(d!.status).toBe('sent');
    const [q] = await sql<{ status: string }[]>`
      select status from lead_messages where id = ${queuedMsg!.id}
    `;
    expect(q!.status).toBe('queued');
  });

  test('request_human on an unbound run sets the lead-wide pause marker', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Unbound Handoff' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp'), (${leadId}, 'email')
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    const claimed = await claimRun(sql);
    // outreach runs carry no threadId — the handoff is for the lead itself
    const ctx = mkCtx(runId, claimed!.claim_token, leadId, 'outreach');
    const out = (await executeTool(ctx, 'h1', 'request_human', {
      leadId,
      reason: 'lead pediu humano',
    })) as { handedOff?: boolean };
    expect(out.handedOff).toBe(true);
    const [l] = await sql<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `;
    expect(l!.agent_paused_at).not.toBeNull();
    // per-thread toggles stay untouched — resuming must not resurrect a
    // thread staff had already paused before the handoff
    const enabled = await sql<{ n: number }[]>`
      select count(*)::int as n from lead_threads
      where lead_id = ${leadId} and agent_enabled = true
    `;
    expect(enabled[0]!.n).toBe(2);
    const tasks = await sql`select 1 from lead_tasks where lead_id = ${leadId}`;
    expect(tasks.length).toBe(1);
    // output on every channel is blocked while the flag stands — even on the
    // channels whose threads were never individually paused ('manual' always
    // resolves, so the pause check is what blocks)
    const draft = (await executeTool(mkCtx('ghost-unbound', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(draft.blocked).toBe(true);
    expect(draft.reason).toContain('paused');
  });

  test('request_human on a bound run pauses only that thread — other channels stay free', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Bound Handoff' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId, threadId: thread!.id }))!;
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId, 'reply', thread!.id);
    const out = (await executeTool(ctx, 'h1', 'request_human', {
      leadId,
      reason: 'falar com humano',
    })) as { handedOff?: boolean };
    expect(out.handedOff).toBe(true);
    // thread-scoped handoff: the single paused thread is NOT a lead-wide
    // signal — the flag must stay clear so a channel hop keeps working
    const [l] = await sql<{ agent_paused_at: string | null }[]>`
      select agent_paused_at from leads where id = ${leadId}
    `;
    expect(l!.agent_paused_at).toBeNull();
    const draft = (await executeTool(mkCtx('ghost-bound', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'canal novo deve compor',
    })) as { blocked?: boolean };
    expect(draft.blocked).toBeUndefined();
  });

  test('update_lead cannot self-promote agent_mode or unarchive', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Gate Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    const ctx = mkCtx(runId, claimed!.claim_token, leadId);
    // draft → auto would bypass every approval gate staff configured
    await executeTool(ctx, 'u1', 'update_lead', { id: leadId, agentMode: 'auto' });
    let [l] = await sql<
      { agent_mode: string }[]
    >`select agent_mode from leads where id = ${leadId}`;
    expect(l!.agent_mode).toBe('draft');
    // 'off' is the human veto — lifting it back to draft is staff's call
    await sql`update leads set agent_mode = 'off' where id = ${leadId}`;
    await executeTool(ctx, 'u2', 'update_lead', { id: leadId, agentMode: 'draft' });
    [l] = await sql<{ agent_mode: string }[]>`select agent_mode from leads where id = ${leadId}`;
    expect(l!.agent_mode).toBe('off');
    // archived:false would resurrect a suppressed lead — stripped the same way
    await sql`update leads set archived_at = now() where id = ${leadId}`;
    await executeTool(ctx, 'u3', 'update_lead', { id: leadId, archived: false });
    const [a] = await sql<{ archived_at: string | null }[]>`
      select archived_at from leads where id = ${leadId}
    `;
    expect(a!.archived_at).not.toBeNull();
    // the rest of the patch still applies — stripping is surgical, not a veto
    await executeTool(ctx, 'u4', 'update_lead', { id: leadId, city: 'Sobral' });
    const [c] = await sql<{ city: string | null }[]>`select city from leads where id = ${leadId}`;
    expect(c!.city).toBe('Sobral');
  });

  test('draft_message honors a staff-paused thread like send_message does', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Paused Draft' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel, agent_enabled)
      values (${leadId}, 'manual', false)
    `;
    const out = (await executeTool(mkCtx('ghost-run', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('paused');
    const msgs = await sql`select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId}`;
    expect(msgs).toHaveLength(0);
  });

  test('a lead-wide handoff gates fresh channels via the flag — not a durable toggle', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Channel Hop' }));
    const leadId = lead.body.lead.id;
    await sql`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp')
    `;
    await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
    // The flag alone carries the pause — a thread created during the handoff
    // must NOT store agent_enabled=false, or clearing the flag would leave
    // it permanently disabled (the pause marker blocks output regardless).
    const fresh = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'email'));
    expect(fresh.agent_enabled).toBe(true);
    // and the send-side check blocks before composing on that channel at all
    const out = (await executeTool(mkCtx('ghost-hop', null, leadId), 'd1', 'draft_message', {
      leadId,
      channel: 'manual',
      body: 'não deve compor',
    })) as { blocked?: boolean; reason?: string };
    expect(out.blocked).toBe(true);
    expect(out.reason).toContain('paused');
    // a lead with zero threads is fresh — not paused
    const lead2 = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Fresh Lead' }));
    const fresh2 = await controlTx(sql, (tx) => ensureThread(tx, lead2.body.lead.id, 'manual'));
    expect(fresh2.agent_enabled).toBe(true);
  });

  test('a lead-paused run parks at claim and resumes when the flag lifts', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Parked Lead' }));
    const leadId = lead.body.lead.id;
    await sql`update leads set agent_paused_at = now() where id = ${leadId}`;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id ?? null).not.toBe(runId);
    const [r] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${runId}
    `;
    expect(r!.status).toBe('queued');
    await sql`update leads set agent_paused_at = null where id = ${leadId}`;
    const resumed = await claimRun(sql);
    expect(resumed?.id).toBe(runId);
  });

  test('drain sweeps queued runs on terminally suppressed leads only', async () => {
    await migrate(sql, MIGRATIONS);
    const mkLead = async (name: string, flag: string) => {
      const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name }));
      await sql.unsafe(`update leads set ${flag} where id = '${lead.body.lead.id}'`);
      return lead.body.lead.id;
    };
    // raw flag writes simulate a suppression writer that skipped the inline
    // cancel (archive never had one) — the sweep is the catch-all.
    const archived = await mkLead('Swept Archived', 'archived_at = now()');
    const unsub = await mkLead('Swept Unsub', 'unsubscribed_at = now()');
    const paused = await mkLead('Kept Paused', 'agent_paused_at = now()');
    const off = await mkLead('Kept Off', `agent_mode = 'off'`);
    const live = await mkLead('Kept Live', 'name = name');
    await sql`delete from agent_runs where status = 'queued'`;
    const runs: Record<string, string> = {};
    for (const [k, id] of Object.entries({ archived, unsub, paused, off, live })) {
      runs[k] = (await enqueueRun(sql, { kind: 'outreach', leadId: id }))!;
    }
    // a 'running' run on an archived lead is mid-flight — not the sweep's.
    // One active row per lead → it needs its own lead (the queued row on
    // `archived` already occupies the index slot).
    const runningLead = await mkLead('Swept Running', 'archived_at = now()');
    const running = (await enqueueRun(sql, { kind: 'outreach', leadId: runningLead }))!;
    await sql`update agent_runs set status = 'running', started_at = now(), alive_at = now(),
      claim_token = 'tok' where id = ${running}`;
    await drain(sql, 0);
    const status = async (id: string) =>
      (
        await sql<{ status: string; error: string | null }[]>`
        select status, error from agent_runs where id = ${id}`
      )[0]!;
    expect(await status(runs.archived!)).toMatchObject({ status: 'canceled', error: 'arquivado' });
    expect(await status(runs.unsub!)).toMatchObject({ status: 'canceled', error: 'descadastrado' });
    // paused/'off' lift — their parked runs must resume, never die
    expect((await status(runs.paused!)).status).toBe('queued');
    expect((await status(runs.off!)).status).toBe('queued');
    expect((await status(runs.live!)).status).toBe('queued');
    expect((await status(running)).status).toBe('running');
  });

  test('unsubscribe clears the lead’s pending mail — an opted-out lead never drains it', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'OptOut Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const replyRun = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(replyRun);
    // One active run per lead — "queued sibling" is no longer constructible;
    // the lead's pending WORK now lives in the inbox, and the opt-out drops
    // it so the next drain (or the running run itself) never sees it.
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', { text: 'mensagem pendente' }),
    );
    const ctx = mkCtx(replyRun, claimed!.claim_token, leadId);
    await executeTool(ctx, 'u1', 'unsubscribe', { leadId, reason: 'pediu para sair' });
    const pending = await sql`select 1 from agent_inbox
      where lead_id = ${leadId} and consumed_at is null`;
    expect(pending).toHaveLength(0);
    // the running run doing the unsubscribe finishes normally
    const [live] = await sql<{ status: string }[]>`
      select status from agent_runs where id = ${replyRun}
    `;
    expect(live!.status).toBe('running');
  });

  test('drain spawns a run for orphan mail — the item is consumed by it', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Orphan Mail', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    await sql`update agent_inbox set consumed_at = now() where consumed_at is null`;
    // Mail with no live run: the sweep inside drain materializes the run
    // (kind from payload.requestedKind) and that very run drains the item.
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'staff', {
        text: 'a equipe pediu um contato',
        requestedKind: 'outreach',
      }),
    );
    // full drain: the sweep inserts the run, then the claim loop runs it —
    // drain(sql, 0) would sweep but never claim
    await drain(sql);
    const runs = await sql<{ id: string; kind: string }[]>`
      select id, kind from agent_runs where lead_id = ${leadId} order by created_at
    `;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind).toBe('outreach');
    const items = await sql<{ consumed_by_run: string | null; consumed_at: string | null }[]>`
      select consumed_by_run, consumed_at from agent_inbox where lead_id = ${leadId}
    `;
    expect(items).toHaveLength(1);
    expect(items[0]!.consumed_at).not.toBeNull();
    expect(items[0]!.consumed_by_run).toBe(runs[0]!.id);
  });

  test('reply read_pages is bounded — the cap refuses the call before fetching', async () => {
    const ctx = mkCtx('rp-cap', null, null, 'reply');
    ctx.pageReads = 2;
    const out = (await executeTool(ctx, 'x', 'read_pages', {
      urls: ['https://x.co'],
    })) as { error?: string };
    expect(out.error).toContain('limite');
  });

  test('remember writes an agent learning and returns cap evictions', async () => {
    await migrate(sql, MIGRATIONS);
    const tag = `rem-${crypto.randomUUID().slice(0, 8)}`;
    // v2 cap is 200 learnings — seeding them makes the 201st write evict.
    await controlTx(sql, async (tx) => {
      for (let i = 0; i < 200; i++) {
        await rememberTx(tx, { scope: 'workspace', content: `${tag}-${i}`, source: 'agent' });
      }
    });
    const out = (await executeTool(mkCtx('mem', null, null, 'strategist'), 'm1', 'remember', {
      fact: `${tag}-novo`,
    })) as { remembered: string; evicted?: string[] };
    expect(out.remembered).toBe(`${tag}-novo`);
    expect(out.evicted?.length).toBeGreaterThanOrEqual(1);
    const row = await sql<{ source: string }[]>`
      select source from agent_memory_items where content = ${`${tag}-novo`}
    `;
    expect(row[0]?.source).toBe('agent');
  });

  test('a consecutive identical call is suppressed and nudged — once', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Loop Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://x.co/catalogo'] } }] },
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://x.co/catalogo'] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(2);
    expect(reads[1]!.out?.error).toMatch(/^REPEAT/);
    // ONE loop nudge — and since request_human acted, no finish nudge joins it
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { content?: string }).content).toContain('LOOP');
  });

  test('a repeated call that errored is a retry, not a loop — it re-executes', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Retry Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'read_pages', args: { urls: [] } }] },
          { toolCalls: [{ name: 'read_pages', args: { urls: [] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(2);
    // both really ran — the second is the same validation error, not REPEAT
    expect(reads[0]!.out?.error).toMatch(/^read_pages needs urls/);
    expect(reads[1]!.out?.error).toMatch(/^read_pages needs urls/);
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(0);
  });

  test('a reply run closing without a visible action gets one finish nudge', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Silent Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({ script: [{ text: 'ok' }] } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { content?: string }).content).toContain('Ação pendente');
  });

  test('a composed-but-failed send is not a landed action — the finish nudge fires', async () => {
    await migrate(sql, MIGRATIONS);
    // An enabled resend integration with no api key: the send composes
    // (email reachable), then the driver throws 'missing RESEND_API_KEY'.
    // A pre-existing resend row is restored at the end — the shared test
    // DB must not lose its configuration.
    const prior = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'resend'
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('email', 'resend', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    const priorGuardrails = (
      await sql<{ value: unknown }[]>`
        select value from control_settings where key = 'guardrails'
      `
    )[0];
    try {
      // First contact must not be draft-forced and quiet hours must be
      // empty (start == end → never quiet) — the send has to reach the
      // dispatch stage to fail.
      await sql`
        insert into control_settings (key, value)
        values ('guardrails',
                ${sql.json({ firstContactDraftOnly: false, quietStart: '00:00', quietEnd: '00:00' } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, {
          name: 'Unsendable Lead',
          email: 'lead@example.com',
          agent_mode: 'auto',
        }),
      );
      const leadId = lead.body.lead.id;
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
      await sql`update agent_runs set
        params = ${sql.json({
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { text: 'fim' },
          ],
        } as never)}
        where id = ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
        out?: { error?: string };
      }[];
      expect(sends).toHaveLength(1);
      expect(sends[0]!.out?.error).toBeTruthy();
      const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
      expect(nudges).toHaveLength(1);
      expect((nudges[0] as { content?: string }).content).toContain('Ação pendente');
    } finally {
      // Don't leak the keyless resend row — the shared DB would let it win
      // getIntegrationTx over other tests' enabled email drivers. Restore
      // whatever was there before (or drop our row entirely).
      if (prior) {
        await sql`
          update control_integrations
          set enabled = ${prior.enabled}, config = ${sql.json(prior.config as never)},
              secret_ref = ${prior.secret_ref}
          where kind = 'email' and driver = 'resend'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'resend'`;
      }
      // Same for the guardrails row — later tests must not inherit
      // disabled first-contact drafts or empty quiet hours.
      if (priorGuardrails) {
        await sql`
          update control_settings set value = ${sql.json(priorGuardrails.value as never)}
          where key = 'guardrails'
        `;
      } else {
        await sql`delete from control_settings where key = 'guardrails'`;
      }
    }
  });

  test('a blocked send is not a reusable result — its retry re-executes', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Blocked Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // the send blocks (this lead has no channel); a write lands after it
          {
            toolCalls: [
              { name: 'send_message', args: { leadId, body: 'olá' } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          // an identical send next turn must execute, not return REPEAT
          { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
      out?: { error?: string; blocked?: boolean };
    }[];
    expect(sends).toHaveLength(2);
    // still blocked (no channel ever appeared) — but it RAN, not REPEAT
    expect(sends[1]!.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(sends[1]!.out?.blocked).toBe(true);
  });

  test('a re-read after a mutation executes — the earlier result went stale', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Stale Read Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'get_lead', args: { id: leadId } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const gets = r.steps.filter((s) => (s as { name?: string }).name === 'get_lead') as {
      out?: unknown;
    }[];
    expect(gets).toHaveLength(2);
    // the second read ran fresh — current profile, not a REPEAT artifact
    expect(JSON.stringify(gets[1]!.out)).toContain('Recife');
  });

  test('a repeated get_lead re-executes — external edits must not hide behind REPEAT', async () => {
    await migrate(sql, MIGRATIONS);
    // A clean get_lead stays reusable only because nothing MUTATED — but
    // stateVersion counts this run's writes, not a staff edit between
    // turns. Mutable-CRM reads are exempt from suppression outright —
    // but still count as repeats for the LOOP nudge.
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Fresh Read Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const gets = r.steps.filter((s) => (s as { name?: string }).name === 'get_lead') as {
      out?: { error?: string };
    }[];
    expect(gets).toHaveLength(3);
    // each ran fresh — no REPEAT on a mutable-state read
    for (const g of gets) expect(g.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(JSON.stringify(gets[2]!.out)).toContain('Fresh Read Lead');
    // the read-only repeats still tripped the loop detector — once
    const nudges = r.steps.filter((s) => (s as { type?: string }).type === 'nudge');
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { content?: string }).content).toContain('LOOP');
  });

  test('a retried send after a dispatch-stage failure adopts the failed row — no second compose', async () => {
    await migrate(sql, MIGRATIONS);
    // resend with no api key: the send composes, reaches 'sending', then
    // the driver throws — the row is failed AND dispatch-attempted (the
    // stamp is conservative: it can't tell whether the provider got the
    // call), so an identical retry must adopt it, not compose a duplicate.
    const prior = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'resend'
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('email', 'resend', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    const priorGuardrails = (
      await sql<{ value: unknown }[]>`
        select value from control_settings where key = 'guardrails'
      `
    )[0];
    try {
      await sql`
        insert into control_settings (key, value)
        values ('guardrails',
                ${sql.json({ firstContactDraftOnly: false, quietStart: '00:00', quietEnd: '00:00' } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, {
          name: 'Dup Send Lead',
          email: 'dup@example.com',
          agent_mode: 'auto',
        }),
      );
      const leadId = lead.body.lead.id;
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
      await sql`update agent_runs set
        params = ${sql.json({
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { text: 'fim' },
          ],
        } as never)}
        where id = ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
        out?: { error?: string; blocked?: boolean; reason?: string };
      }[];
      expect(sends).toHaveLength(2);
      expect(sends[0]!.out?.error).toBeTruthy();
      // the identical retry adopted the failed row — blocked, not re-composed
      expect(sends[1]!.out?.blocked).toBe(true);
      expect(sends[1]!.out?.reason).toBe('already dispatched by this run');
      const rows = await sql<{ status: string; dispatch_attempted_at: string | null }[]>`
        select m.status, m.dispatch_attempted_at from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.agent_run_id = ${runId}
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('failed');
      expect(rows[0]!.dispatch_attempted_at).not.toBeNull();
    } finally {
      if (prior) {
        await sql`
          update control_integrations
          set enabled = ${prior.enabled}, config = ${sql.json(prior.config as never)},
              secret_ref = ${prior.secret_ref}
          where kind = 'email' and driver = 'resend'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'resend'`;
      }
      if (priorGuardrails) {
        await sql`
          update control_settings set value = ${sql.json(priorGuardrails.value as never)}
          where key = 'guardrails'
        `;
      } else {
        await sql`delete from control_settings where key = 'guardrails'`;
      }
    }
  });

  test('a channel-hop retry after an attempted failure is still adopted', async () => {
    await migrate(sql, MIGRATIONS);
    // WhatsApp send attempted then failed; the channel died so the retry
    // resolves email — the body match spans channels, or the lead would
    // get the same text twice.
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, {
        name: 'Chan Hop Lead',
        email: 'hop@example.com',
        agent_mode: 'auto',
      }),
    );
    const leadId = lead.body.lead.id;
    const waThread = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'whatsapp', {}));
    // The fallback channel must actually resolve — enable the email log
    // driver (restored below so it can't leak into other tests).
    const priorLog = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('email', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    try {
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
      // The run's own earlier attempt on the now-dead channel: failed AFTER
      // 'sending' — dispatch_attempted_at is stamped.
      await sql`
        insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, dispatch_attempted_at)
        values (${waThread.id}, 'out', 'agent', 'olá', 'failed', ${runId}, now())
      `;
      await sql`update agent_runs set
        params = ${sql.json({
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { text: 'fim' },
          ],
        } as never)}
        where id = ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
        out?: { blocked?: boolean; reason?: string };
      }[];
      expect(sends).toHaveLength(1);
      // adopted on email too — no second copy on another wire
      expect(sends[0]!.out?.blocked).toBe(true);
      expect(sends[0]!.out?.reason).toBe('already dispatched by this run');
      const rows = await sql<{ status: string }[]>`
        select m.status from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.agent_run_id = ${runId}
      `;
      expect(rows).toHaveLength(1);
    } finally {
      if (priorLog) {
        await sql`
          update control_integrations
          set enabled = ${priorLog.enabled}, config = ${sql.json(priorLog.config as never)},
              secret_ref = ${priorLog.secret_ref}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
    }
  });

  test('a later pre-wire failure cannot mask an earlier attempted send', async () => {
    await migrate(sql, MIGRATIONS);
    // Two failed rows share the body: the OLDER reached 'sending'
    // (dispatch_attempted_at stamped — maybe on the wire), the NEWER died
    // pre-wire (e.g. a refused staff retry). If the lookup only inspected
    // the newest row, the unstamped one would mask the stamped one and the
    // retry would compose a third copy.
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, {
        name: 'Masked Send Lead',
        email: 'masked@example.com',
        agent_mode: 'auto',
      }),
    );
    const leadId = lead.body.lead.id;
    const thread = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'email', {}));
    const priorLog = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('email', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    try {
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
      await sql`
        insert into lead_messages (thread_id, direction, author, body, status, agent_run_id, dispatch_attempted_at, created_at)
        values (${thread.id}, 'out', 'agent', 'olá', 'failed', ${runId}, now(), now() - interval '1 hour')
      `;
      await sql`
        insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
        values (${thread.id}, 'out', 'agent', 'olá', 'failed', ${runId})
      `;
      await sql`update agent_runs set
        params = ${sql.json({
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { text: 'fim' },
          ],
        } as never)}
        where id = ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
        out?: { blocked?: boolean; reason?: string };
      }[];
      expect(sends).toHaveLength(1);
      // the older attempted copy still masks the retry — no third row
      expect(sends[0]!.out?.blocked).toBe(true);
      expect(sends[0]!.out?.reason).toBe('already dispatched by this run');
      const rows = await sql<{ id: string }[]>`
        select m.id from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.agent_run_id = ${runId}
      `;
      expect(rows).toHaveLength(2);
    } finally {
      if (priorLog) {
        await sql`
          update control_integrations
          set enabled = ${priorLog.enabled}, config = ${sql.json(priorLog.config as never)},
              secret_ref = ${priorLog.secret_ref}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
    }
  });

  test('a pre-wire failed send stays retryable — the failure never left the building', async () => {
    await migrate(sql, MIGRATIONS);
    // A 'failed' row with no dispatch_attempted_at provably never reached
    // 'sending' — a deterministic pre-wire refusal. An identical retried
    // send must be allowed to compose a fresh attempt, not adopted.
    const priorGuardrails = (
      await sql<{ value: unknown }[]>`
        select value from control_settings where key = 'guardrails'
      `
    )[0];
    const priorLog = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
    try {
      // First-contact drafts must be off — the retry must compose 'queued'
      // so it actually dispatches — and the email log driver must be
      // reachable or the send dies at pick.
      await sql`
        insert into control_settings (key, value)
        values ('guardrails',
                ${sql.json({ firstContactDraftOnly: false, quietStart: '00:00', quietEnd: '00:00' } as never)})
        on conflict (key) do update set value = excluded.value
      `;
      await sql`
        insert into control_integrations (kind, driver, enabled)
        values ('email', 'log', true)
        on conflict (kind, driver) do update set enabled = true
      `;
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, {
          name: 'Pre Wire Lead',
          email: 'prewire@example.com',
          agent_mode: 'auto',
        }),
      );
      const leadId = lead.body.lead.id;
      const thread = await controlTx(sql, (tx) => ensureThread(tx, leadId, 'email', {}));
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
      // The run's own earlier attempt: failed before the wire (no stamp).
      await sql`
        insert into lead_messages (thread_id, direction, author, body, status, agent_run_id)
        values (${thread.id}, 'out', 'agent', 'olá', 'failed', ${runId})
      `;
      await sql`update agent_runs set
        params = ${sql.json({
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'olá' } }] },
            { text: 'fim' },
          ],
        } as never)}
        where id = ${runId}`;
      expect(await runOnce(sql)).toBe(true);
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      const sends = r.steps.filter((s) => (s as { name?: string }).name === 'send_message') as {
        out?: { error?: string; blocked?: boolean };
      }[];
      expect(sends).toHaveLength(1);
      // the retry was allowed through — it composed and sent fresh
      expect(sends[0]!.out?.blocked).not.toBe(true);
      expect(sends[0]!.out?.error).toBeUndefined();
      const rows = await sql<{ status: string; dispatch_attempted_at: string | null }[]>`
        select m.status, m.dispatch_attempted_at from lead_messages m
        join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.agent_run_id = ${runId}
        order by m.created_at
      `;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.status).toBe('failed');
      expect(rows[0]!.dispatch_attempted_at).toBeNull();
      expect(['sent', 'delivered']).toContain(rows[1]!.status);
    } finally {
      if (priorLog) {
        await sql`
          update control_integrations
          set enabled = ${priorLog.enabled}, config = ${sql.json(priorLog.config as never)},
              secret_ref = ${priorLog.secret_ref}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
      if (priorGuardrails) {
        await sql`
          update control_settings set value = ${sql.json(priorGuardrails.value as never)}
          where key = 'guardrails'
        `;
      } else {
        await sql`delete from control_settings where key = 'guardrails'`;
      }
    }
  });

  test('a repeated write after an intervening write executes — but a duplicate artifact never does', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Restore Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
              { name: 'update_lead', args: { id: leadId, city: 'Natal' } },
            ],
          },
          // restoring Recife is not a REPEAT — Natal landed since it ran
          { toolCalls: [{ name: 'update_lead', args: { id: leadId, city: 'Recife' } }] },
          {
            toolCalls: [
              { name: 'create_task', args: { leadId, title: 'vip' } },
              // a write lands between the task and its repeat — a
              // versioned write would look stale, but a duplicate task
              // mints a second row: never a restore, always suppressed
              { name: 'update_lead', args: { id: leadId, city: 'Olinda' } },
            ],
          },
          { toolCalls: [{ name: 'create_task', args: { leadId, title: 'vip' } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const writes = r.steps.filter((s) => (s as { name?: string }).name === 'update_lead') as {
      out?: { error?: string };
    }[];
    const tasks = r.steps.filter((s) => (s as { name?: string }).name === 'create_task') as {
      out?: { error?: string };
    }[];
    // all four writes really ran — the repeat-as-restore is not REPEAT'd
    expect(writes).toHaveLength(4);
    expect(writes.every((w) => !w.out?.error)).toBe(true);
    // ...while the duplicate task was suppressed on the second emission
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(tasks[1]!.out?.error).toMatch(/^REPEAT/);
    const saved = await sql`select city from leads where id = ${leadId}`;
    expect((saved[0] as { city?: string }).city).toBe('Olinda');
  });

  test('a repeated create_lead is suppressed — outside discovery the repeat inserts a second card', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Dup Source' }));
    const leadId = lead.body.lead.id;
    const before = await sql`select id from leads where name = 'Cafe Azul'`;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'triage', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'create_lead', args: { name: 'Cafe Azul' } },
              // a write lands between the card and its repeat — a versioned
              // write would look stale, but a second insert is never a restore
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          { toolCalls: [{ name: 'create_lead', args: { name: 'Cafe Azul' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    const creates = r.steps.filter((s) => (s as { name?: string }).name === 'create_lead') as {
      out?: { error?: string };
    }[];
    expect(creates).toHaveLength(2);
    expect(creates[0]!.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(creates[1]!.out?.error).toMatch(/^REPEAT/);
    // exactly one new Cafe Azul card — the repeat never reached insertLeadTx
    const after = await sql`select id from leads where name = 'Cafe Azul'`;
    expect(after.length).toBe(before.length + 1);
  });

  test('a duplicate artifact mint is suppressed across turns — the landed set is run-wide', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Gap Task Lead' }));
    const leadId = lead.body.lead.id;
    // title-scoped: the run's request_human ending also writes lead_tasks
    const before = await sql`select id from lead_tasks where lead_id = ${leadId} and title = 'vip'`;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'create_task', args: { leadId, title: 'vip' } }] },
          // a different turn's calls flush the one-turn sig map entirely —
          // the artifact repeat must still be suppressed on the landed set
          { toolCalls: [{ name: 'get_lead', args: { id: leadId } }] },
          { toolCalls: [{ name: 'create_task', args: { leadId, title: 'vip' } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const tasks = r.steps.filter((s) => (s as { name?: string }).name === 'create_task') as {
      out?: { error?: string };
    }[];
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(tasks[1]!.out?.error).toMatch(/^REPEAT/);
    const after = await sql`select id from lead_tasks where lead_id = ${leadId} and title = 'vip'`;
    expect(after.length).toBe(before.length + 1);
  });

  test('a pending artifact-mint retries unless its claim row proves it landed', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Pending Task Lead' }));
    const leadId = lead.body.lead.id;
    const before = await sql`select id from lead_tasks where lead_id = ${leadId} and title = 'vip'`;
    await sql`delete from agent_runs where status = 'queued'`;
    const pendingJournal = () => [
      // attempt 1 journaled the task then died — out-less = unproven
      {
        type: 'tool',
        name: 'create_task',
        args: { leadId, title: 'vip' },
        callId: 'c1',
        step: 0,
        pending: true,
      },
      { type: 'resumed', attempt: 1 },
    ];
    const script = {
      script: [
        { toolCalls: [{ name: 'create_task', args: { leadId, title: 'vip' } }] },
        { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
        { text: 'fim' },
      ],
    };
    // Case 1: no claim row — the call never ran; the retry must execute
    const runA = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      steps = ${sql.json(pendingJournal() as never[])},
      params = ${sql.json(script as never)}
      where id = ${runA}`;
    expect(await runOnce(sql)).toBe(true);
    const rA = await getRun(runA);
    const taskA = rA.steps.find(
      (s) =>
        (s as { name?: string; callId?: string }).name === 'create_task' &&
        (s as { callId?: string }).callId === 'mock-1-0',
    ) as { out?: { error?: string } } | undefined;
    expect(taskA?.out?.error ?? '').not.toMatch(/^REPEAT/);
    expect(
      (await sql`select id from lead_tasks where lead_id = ${leadId} and title = 'vip'`).length,
    ).toBe(before.length + 1);
    // request_human parked the lead — lift it so run B can claim
    await sql`update leads set agent_paused_at = null where id = ${leadId}`;
    // Case 2: a committed claim row proves the crashed call's work landed —
    // the identical retry is suppressed or it would mint a second row
    const runB = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`insert into control_idempotency_keys (key, response, status_code)
      values (${`agent:${runB}:0:create_task:c1`}, '{}', 200)`;
    await sql`update agent_runs set
      steps = ${sql.json(pendingJournal() as never[])},
      params = ${sql.json(script as never)}
      where id = ${runB}`;
    expect(await runOnce(sql)).toBe(true);
    const rB = await getRun(runB);
    const taskB = rB.steps.find(
      (s) =>
        (s as { name?: string; callId?: string }).name === 'create_task' &&
        (s as { callId?: string }).callId === 'mock-1-0',
    ) as { out?: { error?: string } } | undefined;
    expect(taskB?.out?.error).toMatch(/^REPEAT/);
    expect(
      (await sql`select id from lead_tasks where lead_id = ${leadId} and title = 'vip'`).length,
    ).toBe(before.length + 1);
    await sql`delete from control_idempotency_keys where key = ${`agent:${runB}:0:create_task:c1`}`;
  });

  test('a read_pages result with fetch failures stays retryable — errors[] is not clean', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Failed Fetch Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // mixed batch: a fetchable url + an unfetchable private host —
          // the result carries errors[], which must not count as a clean
          // prior result
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['https://shop.example/catalog', 'http://192.168.10.9/x'] },
              },
            ],
          },
          // identical retry — executes: the failed url re-validates, the
          // good page comes back from the run cache for free
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['https://shop.example/catalog', 'http://192.168.10.9/x'] },
              },
            ],
          },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: number;
      out?: { error?: string; errors?: unknown[]; pages?: { cached?: boolean }[] };
    }[];
    expect(reads).toHaveLength(2);
    // the retry was NOT suppressed — it reported the failure again
    expect(reads[0]!.out?.error).toBeUndefined();
    expect(reads[0]!.out?.errors).toHaveLength(1);
    expect(reads[1]!.out?.error).toBeUndefined();
    expect(reads[1]!.out?.errors).toHaveLength(1);
    // the successful page stayed cached — the retry spent nothing on it
    expect(reads[1]!.out?.pages?.[0]?.cached).toBe(true);
    expect(reads[1]!.readSpent).toBe(0);
  });

  test('a cached re-read does not spend the reply page budget', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Cached Page Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          {
            toolCalls: [
              { name: 'read_pages', args: { urls: ['https://shop.example/catalog'] } },
              { name: 'update_lead', args: { id: leadId, city: 'Recife' } },
            ],
          },
          // same url again — served from pageCache, spends nothing
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/catalog'] } }] },
          // a new url still fits the cap; the one after hits it
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/prices'] } }] },
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/about'] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: number;
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(4);
    // every call executed — no REPEAT — but only the fetches spent; a
    // refusal issues no fetch and charges nothing
    expect(reads[0]!.readSpent).toBe(1);
    expect(reads[1]!.readSpent).toBe(0);
    expect(reads[2]!.readSpent).toBe(1);
    expect(reads[3]!.readSpent).toBe(0);
    expect(reads[3]!.out?.error ?? '').toMatch(/^read_pages: limite/);
  });

  test('the reply page budget prices fetches, not calls', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Budget Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // a 3-url batch exceeds the 2-fetch cap outright — refused whole,
          // nothing fetched, nothing charged
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: {
                  urls: ['https://a.example/1', 'https://a.example/2', 'https://a.example/3'],
                },
              },
            ],
          },
          // 2 urls fit exactly — both fetches issued and charged
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['https://a.example/1', 'https://a.example/2'] },
              },
            ],
          },
          // the same pair again — suppressed as a REPEAT (result still
          // current); spends nothing either way
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['https://a.example/1', 'https://a.example/2'] },
              },
            ],
          },
          // any new url is over budget now
          { toolCalls: [{ name: 'read_pages', args: { urls: ['https://a.example/3'] } }] },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: number;
      out?: { error?: string };
    }[];
    expect(reads).toHaveLength(4);
    expect(reads[0]!.readSpent).toBe(0);
    expect(reads[0]!.out?.error ?? '').toMatch(/^read_pages: limite/);
    expect(reads[1]!.readSpent).toBe(2);
    expect(reads[1]!.out?.error ?? '').toBe('');
    expect(reads[2]!.readSpent).toBe(0);
    expect(reads[2]!.out?.error ?? '').toMatch(/^REPEAT/);
    expect(reads[3]!.readSpent).toBe(0);
    expect(reads[3]!.out?.error ?? '').toMatch(/^read_pages: limite/);
  });

  test('unfetchable urls never spend the reply page budget', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Bad Url Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // urls no provider could issue — rejected before the batch,
          // spending nothing
          {
            toolCalls: [{ name: 'read_pages', args: { urls: ['not-a-url', 'also-garbage'] } }],
          },
          // the valid pair still fits the untouched budget
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['https://a.example/1', 'https://a.example/2'] },
              },
            ],
          },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: number;
      out?: { error?: string; errors?: { url: string; error: string }[] };
    }[];
    expect(reads).toHaveLength(2);
    expect(reads[0]!.readSpent).toBe(0);
    // both rejections reported through the normal per-url errors channel
    expect(reads[0]!.out?.errors?.map((e) => e.url)).toEqual(['not-a-url', 'also-garbage']);
    expect(reads[1]!.readSpent).toBe(2);
  });

  test('a rejected url cannot mask the fetchable page behind its pageKey', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Scheme Mask Lead' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId })!)!;
    await sql`update agent_runs set
      params = ${sql.json({
        script: [
          // ftp:// is rejected pre-validation — its error must not occupy
          // the scheme-free pageKey slot 'shop.example/menu'
          { toolCalls: [{ name: 'read_pages', args: { urls: ['ftp://shop.example/menu'] } }] },
          // the https twin still fetches — the rejection never masked it
          {
            toolCalls: [{ name: 'read_pages', args: { urls: ['https://shop.example/menu'] } }],
          },
          // same-call twin: the ftp url must NOT inherit the https page
          // behind its scheme-free pageKey — it reports its own rejection
          {
            toolCalls: [
              {
                name: 'read_pages',
                args: { urls: ['ftp://shop.example/menu', 'https://shop.example/menu'] },
              },
            ],
          },
          { toolCalls: [{ name: 'request_human', args: { leadId, reason: 'travou' } }] },
          { text: 'fim' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const reads = r.steps.filter((s) => (s as { name?: string }).name === 'read_pages') as {
      readSpent?: number;
      out?: { error?: string; errors?: { url: string }[]; pages?: unknown[] };
    }[];
    expect(reads).toHaveLength(3);
    expect(reads[0]!.readSpent).toBe(0);
    expect(reads[0]!.out?.errors?.[0]?.url).toBe('ftp://shop.example/menu');
    expect(reads[1]!.readSpent).toBe(1);
    expect(reads[1]!.out?.pages?.length).toBeGreaterThan(0);
    // the ftp url reports its rejection even behind a cached pageKey —
    // the https twin still serves the cached page, free
    expect(reads[2]!.readSpent).toBe(0);
    expect(reads[2]!.out?.pages?.length).toBe(1);
    expect(reads[2]!.out?.errors?.map((e) => e.url)).toEqual(['ftp://shop.example/menu']);
  });

  test('a mid-run inbound mails into the running outreach between steps', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Replied Mid-Run' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact', script: [{ text: 'oi', delayMs: 1500 }, { text: 'outra' }] } as never)}
      where id = ${runId}`;
    // The item must land mid-flight: fire the run, let claim+turn-1 start,
    // then enqueue — the kernel drains it at the next step boundary and
    // renders it to the model instead of cancelling the run.
    const running = runOnce(sql);
    await new Promise((r) => setTimeout(r, 150));
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', {
        text: 'sim, quero',
        threadId: thread!.id,
        requestedKind: 'reply',
      }),
    );
    expect(await running).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    // both scripted turns ran — the drain journal entry sits between them
    const inboxSteps = r.steps.filter((s) => (s as { type?: string }).type === 'inbox');
    expect(inboxSteps).toHaveLength(1);
    expect(r.steps.filter((s) => (s as { type?: string }).type === 'model')).toHaveLength(2);
    const items = await sql<{ consumed_by_run: string | null }[]>`
      select consumed_by_run from agent_inbox where lead_id = ${leadId}
    `;
    expect(items[0]!.consumed_by_run).toBe(runId);
  });

  test('a mid-run opt-out lands — drained reply mail widens the toolset', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'OptOut Mid-Run', whatsapp: '5511910000001' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      params: {
        auto: 'first-contact',
        script: [
          { toolCalls: [{ name: 'unsubscribe', args: { leadId, reason: 'pediu para sair' } }] },
          { text: 'fim' },
        ],
      },
    }))!;
    // 'inbound' mail waits in the mailbox: the outreach toolset has no
    // unsubscribe — draining the item must widen toolKinds or the opt-out
    // bounces off the dispatch gate and the lead stays subscribed.
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', {
        text: 'para de me mandar mensagem',
        requestedKind: 'reply',
      }),
    );
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    expect(r.steps.some((s) => (s as { name?: string }).name === 'unsubscribe')).toBe(true);
    const [l] = await sql<{ unsubscribed_at: string | null }[]>`
      select unsubscribed_at from leads where id = ${leadId}
    `;
    expect(l!.unsubscribed_at).not.toBeNull();
  });

  test('draft-only mail waits for its own run — it never ships through a send-capable one', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Draft Mail', whatsapp: '5511910000002' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // A parked send-capable run owns the lead for the next hour.
    const outreach = (await enqueueRun(sql, {
      kind: 'outreach',
      leadId,
      runAt: new Date(Date.now() + 3600e3),
    }))!;
    // Staff draft request — draining it into the outreach run would let the
    // reaction send unreviewed, so it must wait pending for its own
    // draftOnly run (params carry the script the spawned run replays).
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'staff', {
        text: 'rascunho sugerido pela equipe',
        requestedKind: 'reply',
        params: {
          draftOnly: true,
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'oi, rascunho' } }] },
            { text: 'ok' },
          ],
        },
      }),
    );
    await drain(sql);
    // Parked phase: item unconsumed, the outreach run untouched.
    expect(
      (await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`)
        .length,
    ).toBe(1);
    // Once the lead frees, the orphan sweep spawns the draftOnly run that
    // serves the request — send_message degrades to an approval draft.
    await sql`update agent_runs set status = 'done', finished_at = now() where id = ${outreach}`;
    await drain(sql);
    const [item] = await sql<{ consumed_by_run: string | null }[]>`
      select consumed_by_run from agent_inbox where lead_id = ${leadId}
    `;
    expect(item!.consumed_by_run).not.toBeNull();
    expect(item!.consumed_by_run).not.toBe(outreach);
    const [spawned] = await sql<{ params: { draftOnly?: boolean } }[]>`
      select params from agent_runs where id = ${item!.consumed_by_run!}
    `;
    expect(spawned!.params.draftOnly).toBe(true);
    const [msg] = await sql<{ status: string }[]>`
      select m.status from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and m.direction = 'out' and m.author = 'agent'
    `;
    expect(msg!.status).toBe('draft');
  });

  test('mail on another channel waits for its own bound run — never drains mid-flight cross-thread', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Cross Channel', whatsapp: '5511910000006', email: 'x@y.br' }),
    );
    const leadId = lead.body.lead.id;
    const [waThread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    const [emThread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'email') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    // A whatsapp-bound reply run owns the lead for the next hour — ctx's
    // threadId/channelOverride are fixed at claim, so an email item that
    // drained into it would reply on whatsapp. It must stay pending for a
    // run pinned to ITS channel + thread.
    const waRun = (await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      threadId: waThread!.id,
      runAt: new Date(Date.now() + 3600e3),
      params: { origin: 'inbound', channel: 'whatsapp' },
    }))!;
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', {
        text: 'mensagem do lead [email]: ainda tem?',
        threadId: emThread!.id,
        requestedKind: 'reply',
        params: { origin: 'inbound', channel: 'email' },
      }),
    );
    await drain(sql);
    expect(
      (await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`)
        .length,
    ).toBe(1);
    // Freed, the orphan sweep spawns a run pinned to the mail's own
    // channel + thread — the reply rides the right conversation.
    await sql`update agent_runs set status = 'done', finished_at = now() where id = ${waRun}`;
    await drain(sql);
    const [item] = await sql<{ consumed_by_run: string | null }[]>`
      select consumed_by_run from agent_inbox where lead_id = ${leadId}
    `;
    expect(item!.consumed_by_run).not.toBeNull();
    const [spawned] = await sql<
      { kind: string; thread_id: string; params: { channel?: string } }[]
    >`select kind, thread_id, params from agent_runs where id = ${item!.consumed_by_run!}`;
    expect(spawned!.kind).toBe('reply');
    expect(spawned!.thread_id).toBe(emThread!.id);
    expect(spawned!.params.channel).toBe('email');
  });

  test('mail arriving during a draft-only run waits — a reply never strands as a draft', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Draft Window', whatsapp: '5511910000007' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const draft = (await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      runAt: new Date(Date.now() + 3600e3),
      params: { draftOnly: true, script: [{ text: 'pensando', delayMs: 1500 }, { text: 'fim' }] },
    }))!;
    // Send-capable mail mid-flight in a draftOnly run must defer: draining
    // it would render the reaction inside a run whose send_message only
    // composes drafts — the reply would wait for approval it never asked for.
    await sql`update agent_runs set run_at = now() where id = ${draft}`;
    const running = runOnce(sql);
    await new Promise((r) => setTimeout(r, 150));
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', {
        text: 'sim, quero',
        requestedKind: 'reply',
        params: { origin: 'inbound' },
      }),
    );
    await running;
    expect(
      (await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`)
        .length,
    ).toBe(1);
    // After it finishes, the sweep spawns a normal send-capable reply run.
    await drain(sql);
    const [item] = await sql<{ consumed_by_run: string | null }[]>`
      select consumed_by_run from agent_inbox where lead_id = ${leadId}
    `;
    expect(item!.consumed_by_run).not.toBeNull();
    const [spawned] = await sql<{ params: { draftOnly?: boolean } }[]>`
      select params from agent_runs where id = ${item!.consumed_by_run!}
    `;
    expect(spawned!.params.draftOnly ?? false).toBe(false);
  });

  test('a blocked oldest item never starves later servable mail on the same lead', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Blocked First', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    await sql`update agent_inbox set consumed_at = now() where consumed_at is null`;
    // The oldest pending item asks for a switched-off playbook — it parks
    // until triage is re-enabled, but it must NOT park the lead's newer mail.
    await sql`
      insert into control_settings (key, value)
      values ('agent_playbooks', ${sql.json({ triage: { enabled: false } } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      await controlTx(sql, (tx) =>
        enqueueInboxTx(tx, leadId, 'event', {
          text: 'triage pendente',
          requestedKind: 'triage',
          params: { auto: 'cadence' },
        }),
      );
      await controlTx(sql, (tx) =>
        enqueueInboxTx(tx, leadId, 'staff', {
          text: 'a equipe pediu um contato',
          requestedKind: 'outreach',
          params: { script: [{ text: 'ok' }] },
        }),
      );
      await drain(sql);
      const runs = await sql<{ id: string; kind: string }[]>`
        select id, kind from agent_runs where lead_id = ${leadId} order by created_at
      `;
      expect(runs).toHaveLength(1);
      expect(runs[0]!.kind).toBe('outreach');
      // Draining carries no gates — the spawned run absorbs the parked
      // triage item into context too; both end up consumed by it.
      const items = await sql<{ consumed_by_run: string | null }[]>`
        select consumed_by_run from agent_inbox where lead_id = ${leadId} order by created_at
      `;
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.consumed_by_run === runs[0]!.id)).toBe(true);
    } finally {
      await sql`delete from control_settings where key = 'agent_playbooks'`;
    }
  });

  test('the orphan sweep window reaches younger leads past parked mail', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`delete from agent_runs where status = 'queued'`;
    const paused = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Parked Mail', whatsapp: '5511910000003' }),
    );
    const pausedId = paused.body.lead.id;
    const fresh = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Fresh Mail', whatsapp: '5511910000004' }),
    );
    const freshId = fresh.body.lead.id;
    // Older pending mail on a paused lead must not occupy the sweep's
    // bounded window — it parks forever and would starve anyone younger.
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, pausedId, 'staff', { text: 'antigo', requestedKind: 'reply' }),
    );
    await sql`update leads set agent_paused_at = now() where id = ${pausedId}`;
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, freshId, 'staff', {
        text: 'novo',
        requestedKind: 'reply',
        params: { script: [{ text: 'ok' }] },
      }),
    );
    await drain(sql);
    const [run] = await sql<{ id: string }[]>`
      select id from agent_runs where lead_id = ${freshId} order by created_at limit 1
    `;
    expect(run).toBeTruthy();
    // The paused lead's mail is untouched — parked, not dropped.
    expect(
      (await sql`select 1 from agent_inbox where lead_id = ${pausedId} and consumed_at is null`)
        .length,
    ).toBe(1);
  });

  test('an active run keeps owning the mail after the lead crosses its cap', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`delete from agent_runs where status = 'queued'`;
    await sql`
      insert into control_settings (key, value)
      values ('guardrails', ${sql.json({ leadLifetimeCostCapUsd: 0.004 } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    try {
      const lead = await controlTx(sql, (tx) =>
        insertLeadTx(tx, { name: 'Capped Owner', whatsapp: '5511910000005' }),
      );
      const leadId = lead.body.lead.id;
      const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
      // Spent 1¢ ≥ the ceiled 1¢ cap — but the active run still exists, and
      // delivery into it is free: insertRun returns it before the cap check.
      await sql`
        insert into agent_runs (kind, lead_id, status, cost_cents, finished_at)
        values ('reply', ${leadId}, 'done', 1, now())
      `;
      expect(await controlTx(sql, (tx) => insertRun(tx, { kind: 'reply', leadId }))).toBe(runId);
    } finally {
      await sql`delete from control_settings where key = 'guardrails'`;
    }
  });

  test('a historical import does not self-cancel auto outreach', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'History Sync' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact', script: [{ text: 'oi' }] } as never)}
      where id = ${runId}`;
    // Re-imported context message stamped AFTER the claim — a provider
    // clock ahead would land here too. historical=true means "context
    // only": it never asked for a reply, so it must not cancel.
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at, historical)
      values (${thread!.id}, 'in', 'lead', 'contexto antigo', 'received',
              now() + interval '1 minute', true)`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
  });

  test('a pre-upgrade row with a skewed provider stamp does not self-cancel', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Legacy Import' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact', script: [{ text: 'oi' }] } as never)}
      where id = ${runId}`;
    // Post-0034 legacy shape: received_at NULL marks a row no server ingested
    // (0030's backfill is erased to NULL; historical = false). A provider
    // clock ahead lands created_at past the claim — without the real-ingest
    // discriminator this cancels outreach on a message that isn't a live
    // reply.
    await sql`insert into lead_messages (thread_id, direction, author, body, status, created_at, received_at)
      values (${thread!.id}, 'in', 'lead', 'contexto antigo', 'received',
              now() + interval '1 hour', null)`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
  });

  test('a second mid-run item drains at the next boundary — mail is not one-shot', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Lag Inbound' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact', script: [{ text: 'oi', delayMs: 1500 }, { text: 'outra' }] } as never)}
      where id = ${runId}`;
    const running = runOnce(sql);
    await new Promise((r) => setTimeout(r, 150));
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'staff', { text: 'a equipe pediu atenção' }),
    );
    expect(await running).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const inboxSteps = r.steps.filter((s) => (s as { type?: string }).type === 'inbox') as {
      items?: { kind: string }[];
    }[];
    expect(inboxSteps).toHaveLength(1);
    expect(inboxSteps[0]!.items![0]!.kind).toBe('staff');
  });

  test('an auto send refused at dispatch — the inbound beat the probe window', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('whatsapp', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    // The default first-contact draft-only gate would park the send in the
    // approval queue before it ever reaches dispatch.
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ firstContactDraftOnly: false, quietStart: '00:00', quietEnd: '00:00' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Send Boundary', whatsapp: '5511955550001', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact' } as never)}
      where id = ${runId}`;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // Live inbound committed AFTER the claim but before any step boundary —
    // the probe hasn't run yet; the send-claim tx must refuse on its own.
    await sql`insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread!.id}, 'in', 'lead', 'oi, quero', 'received')`;
    const out = (await executeTool(
      mkCtx(runId, claimed!.claim_token, leadId, 'outreach'),
      's1',
      'send_message',
      { leadId, body: 'não deve enviar' },
    )) as { error?: string };
    expect(out.error).toBe('lead respondeu');
    const msgs = await sql<{ status: string }[]>`
      select status from lead_messages where thread_id = ${thread!.id} and direction = 'out'
    `;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).toBe('failed');
  });

  test('mail the run already drained does not refuse its answer', async () => {
    await migrate(sql, MIGRATIONS);
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('whatsapp', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    await sql`
      insert into control_settings (key, value) values ('guardrails', ${sql.json({ firstContactDraftOnly: false, quietStart: '00:00', quietEnd: '00:00' } as never)})
      on conflict (key) do update set value = excluded.value
    `;
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Mail Answer', whatsapp: '5511955550002', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'outreach', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({ auto: 'first-contact' } as never)}
      where id = ${runId}`;
    const claimed = await claimRun(sql);
    expect(claimed?.id).toBe(runId);
    // Same shape as the refusal test above — inbound committed after the
    // claim — except its inbox item was already consumed INTO this run.
    const [msg] = await sql<{ id: string }[]>`
      insert into lead_messages (thread_id, direction, author, body, status)
      values (${thread!.id}, 'in', 'lead', 'oi, quero', 'received') returning id
    `;
    const itemId = await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', {
        text: 'oi, quero',
        requestedKind: 'reply',
        messageId: msg!.id,
      }),
    );
    await sql`
      update agent_inbox set consumed_by_run = ${runId}, consumed_at = now() where id = ${itemId}
    `;
    const out = (await executeTool(
      mkCtx(runId, claimed!.claim_token, leadId, 'outreach'),
      's1',
      'send_message',
      { leadId, body: 'aqui vai a resposta' },
    )) as { error?: string };
    expect(out.error).toBeUndefined();
    const msgs = await sql<{ status: string }[]>`
      select status from lead_messages where thread_id = ${thread!.id} and direction = 'out'
    `;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.status).not.toBe('failed');
  });

  test('received_at is wall-clock — an open inbound tx stamps insert time, not tx start', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Tx Clock' }));
    const leadId = lead.body.lead.id;
    const [thread] = await sql<{ id: string }[]>`
      insert into lead_threads (lead_id, channel) values (${leadId}, 'whatsapp') returning id
    `;
    // now() freezes at tx start — a row inserted 50ms later must carry the
    // wall-clock instant, or a started-before-claim tx would hide its
    // inbound from every probe that compares on started_at.
    await sql.begin(async (tx) => {
      const [t0] = await tx<{ t0: string }[]>`select now() as t0`;
      await tx`select pg_sleep(0.05)`;
      const [m] = await tx<{ received_at: string }[]>`
        insert into lead_messages (thread_id, direction, author, body, status)
        values (${thread!.id}, 'in', 'lead', 'oi', 'received') returning received_at
      `;
      const [t1] = await tx<{ t1: string }[]>`select now() as t1`;
      expect(new Date(t1!.t1).getTime()).toBe(new Date(t0!.t0).getTime());
      expect(new Date(m!.received_at).getTime()).toBeGreaterThan(new Date(t0!.t0).getTime());
    });
  });

  test('journal dual-writes into agent_run_steps — rows mirror the committed journal', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) => insertLeadTx(tx, { name: 'Journal Table' }));
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const runId = (await enqueueRun(sql, { kind: 'reply', leadId }))!;
    await sql`update agent_runs set run_at = now(),
      params = ${sql.json({
        script: [
          { toolCalls: [{ name: 'add_note', args: { leadId, body: 'oi' } }] },
          { text: 'pronto' },
        ],
      } as never)}
      where id = ${runId}`;
    expect(await runOnce(sql)).toBe(true);
    const r = await getRun(runId);
    expect(r.status).toBe('done');
    const rows = await sql<
      {
        seq: number;
        kind: string;
        name: string | null;
        call_id: string | null;
        step: number | null;
        out: { ok?: boolean } | null;
      }[]
    >`
      select seq, kind, name, call_id, step, out
      from agent_run_steps where run_id = ${runId} order by seq
    `;
    // One row per journal entry, in journal order — replay still reads
    // agent_runs.steps, so equality is the dual-write contract.
    expect(rows.length).toBe(r.steps.length);
    expect(rows.map((x) => x.seq)).toEqual(r.steps.map((_, i) => i));
    expect(rows.map((x) => x.kind)).toEqual(r.steps.map((s) => (s as { type: string }).type));
    const tool = rows.find((x) => x.name === 'add_note');
    expect(tool?.call_id).toBeTruthy();
    expect(tool?.step).toBe(0);
    // The row was upserted to its resolved result, not left pending.
    expect(tool?.out).toBeTruthy();
  });

  test('a send lands once per mail batch — new mail re-arms the run exactly once', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Batch Sends', email: 'batch@example.com', agent_mode: 'auto' }),
    );
    const leadId = lead.body.lead.id;
    await controlTx(sql, (tx) => ensureThread(tx, leadId, 'email', {}));
    // Real dispatches need a live channel — without one every send lands
    // 'draft' and the run-scoped guard never sees it. The 'log' email
    // driver is the seam the neighboring send tests use.
    const priorLog = (
      await sql<{ enabled: boolean; config: unknown; secret_ref: string | null }[]>`
        select enabled, config, secret_ref from control_integrations
        where kind = 'email' and driver = 'log'
      `
    )[0];
    await sql`
      insert into control_integrations (kind, driver, enabled)
      values ('email', 'log', true)
      on conflict (kind, driver) do update set enabled = true
    `;
    try {
      await sql`delete from agent_runs where status = 'queued'`;
      const runId = (await enqueueRun(sql, {
        kind: 'reply',
        leadId,
        params: {
          script: [
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'primeira' } }] },
            // The delay rides the tool step — a delay-only turn returns
            // nothing and ends the run.
            {
              delayMs: 120,
              toolCalls: [{ name: 'send_message', args: { leadId, body: 'bloqueada um' } }],
            },
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'segunda' } }] },
            { toolCalls: [{ name: 'send_message', args: { leadId, body: 'bloqueada dois' } }] },
            { text: 'fim' },
          ],
        },
      }))!;
      // Deliver mail once the first send has landed — the duplicate-send
      // guard is scoped to the latest consumed batch, so the drained item
      // re-arms the run for exactly one more send.
      const deliver = setInterval(() => {
        void controlTx(
          sql,
          (tx) =>
            tx`
            select 1 from lead_messages m join lead_threads t on t.id = m.thread_id
            where t.lead_id = ${leadId} and m.agent_run_id = ${runId}
              and m.status in ('queued', 'sending', 'sent', 'delivered') limit 1
          `,
        ).then(async (rows) => {
          if (!rows.length) return;
          clearInterval(deliver);
          await controlTx(sql, (tx) =>
            enqueueInboxTx(tx, leadId, 'inbound', { text: 'e o frete?', requestedKind: 'reply' }),
          );
        });
      }, 5);
      try {
        expect(await runOnce(sql)).toBe(true);
      } finally {
        clearInterval(deliver);
      }
      const r = await getRun(runId);
      expect(r.status).toBe('done');
      // The mail was drained and rendered.
      expect(r.steps.some((s) => (s as { type?: string }).type === 'inbox')).toBe(true);
      // Exactly one send landed after the batch — whichever call followed
      // the drain — and every further attempt stayed blocked.
      const msgs = await sql<{ body: string }[]>`
        select m.body from lead_messages m join lead_threads t on t.id = m.thread_id
        where t.lead_id = ${leadId} and m.direction = 'out' and m.author = 'agent'
        order by m.created_at
      `;
      expect(msgs.length).toBe(2);
      expect(msgs[0]!.body).toBe('primeira');
      const blocked = r.steps.filter(
        (s) =>
          (s as { name?: string }).name === 'send_message' &&
          (s as { out?: { blocked?: boolean } }).out?.blocked === true,
      );
      expect(blocked.length).toBe(2);
    } finally {
      if (priorLog) {
        await sql`
          update control_integrations
          set enabled = ${priorLog.enabled}, config = ${sql.json(priorLog.config as never)},
              secret_ref = ${priorLog.secret_ref}
          where kind = 'email' and driver = 'log'
        `;
      } else {
        await sql`delete from control_integrations where kind = 'email' and driver = 'log'`;
      }
    }
  });

  test('channel-pinned staff mail waits for a same-channel run', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Channel Mail', whatsapp: '5511910000007' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    // An active whatsapp run owns the lead — mail asking for email can't
    // re-point ctx.channelOverride mid-flight, so it waits for its own.
    const runId = (await enqueueRun(sql, {
      kind: 'reply',
      leadId,
      params: { channel: 'whatsapp', script: [{ text: 'ok' }] },
    }))!;
    await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'staff', {
        text: 'responde por email',
        requestedKind: 'reply',
        params: { channel: 'email', script: [{ text: 'ok' }] },
      }),
    );
    expect(await runOnce(sql)).toBe(true);
    expect((await getRun(runId)).status).toBe('done');
    expect(
      (await sql`select 1 from agent_inbox where lead_id = ${leadId} and consumed_at is null`)
        .length,
    ).toBe(1);
    // Freed: the sweep spawns the email-pinned run the item asked for and
    // the mail drains into it.
    await drain(sql);
    const [item] = await sql<{ consumed_by_run: string | null }[]>`
      select consumed_by_run from agent_inbox where lead_id = ${leadId}
    `;
    expect(item!.consumed_by_run).not.toBeNull();
    expect(item!.consumed_by_run).not.toBe(runId);
    const [spawned] = await sql<{ params: { channel?: string } }[]>`
      select params from agent_runs where id = ${item!.consumed_by_run!}
    `;
    expect(spawned!.params.channel).toBe('email');
  });

  test('failed-run mail release is bounded — the third death keeps the mail', async () => {
    await migrate(sql, MIGRATIONS);
    const lead = await controlTx(sql, (tx) =>
      insertLeadTx(tx, { name: 'Dead Mail', whatsapp: '5511910000008' }),
    );
    const leadId = lead.body.lead.id;
    await sql`delete from agent_runs where status = 'queued'`;
    const itemId = await controlTx(sql, (tx) =>
      enqueueInboxTx(tx, leadId, 'inbound', { text: 'oi', requestedKind: 'reply' }),
    );
    const stale = new Date(Date.now() - 11 * 60_000);
    const mail = () =>
      sql<{ consumed_at: string | null; consumed_by_run: string | null; deliveries: number }[]>`
        select consumed_at, consumed_by_run,
               coalesce((payload->>'deliveries')::int, 0) as deliveries
        from agent_inbox where id = ${itemId}
      `;
    const killConsumed = async () => {
      // A stale 'running' run holding the item — reconcile fails it through
      // finishRun, whose release path decides the mail's fate.
      const [r] = await sql<{ id: string }[]>`
        insert into agent_runs (kind, lead_id, status, claim_token, attempts, max_attempts, started_at, alive_at)
        values ('reply', ${leadId}, 'running', 'stale', 1, 1, ${stale}, ${stale})
        returning id
      `;
      await sql`update agent_inbox set consumed_by_run = ${r!.id}, consumed_at = now()
        where id = ${itemId}`;
      await drain(sql, 0);
      // The release re-pends the item, and the same drain's orphan sweep
      // respawns a 'queued' run for it — remove that spawn so the next
      // dead-run stamp keeps the lead's single active-run slot free.
      await sql`delete from agent_runs where status = 'queued'`;
      return r!.id;
    };
    await killConsumed();
    let it = (await mail())[0]!;
    expect(it.consumed_at).toBeNull(); // first death releases
    expect(it.deliveries).toBe(1);
    await killConsumed();
    it = (await mail())[0]!;
    expect(it.consumed_at).toBeNull(); // second release — still under the bound
    expect(it.deliveries).toBe(2);
    const dead3 = await killConsumed();
    it = (await mail())[0]!;
    // Third death: the bound holds — released mail would respawn a doomed
    // run every tick otherwise, and the failure task is the human path.
    expect(it.consumed_at).not.toBeNull();
    expect(it.consumed_by_run).toBe(dead3);
    expect(it.deliveries).toBe(2);
  });
});

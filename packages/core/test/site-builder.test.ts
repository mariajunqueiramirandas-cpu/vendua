import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { migrate, withTenant, type Sql } from '../src/platform/db.ts';
import { fleetDeps } from '../src/modules/fleet/deps.ts';
import { siteDeps } from '../src/modules/site-builder/deps.ts';
import {
  deadlines,
  deliverMerged,
  fetchDesigns,
  fireQueued,
  mergeApproved,
} from '../src/modules/site-builder/jobs.ts';

// The site builder end to end on Postgres, as vendua_app under RLS: the owner's build and
// revision routes, the routine's fire, GitHub's webhook, staff approval, the merge, the design
// read at the merge sha and the delivery once the store's new build is live.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const SPEC = {
  version: 1,
  summary: 'Um site afetivo de doceria, com cara de caderno de receitas da vó.',
  brand: {
    personality: ['afetiva', 'artesanal'],
    palette: { primary: '#C2410C', accents: ['#FDE68A'], notes: null },
    typography: 'serifada calorosa nos títulos',
    references: [],
  },
  experience: { mustHave: ['história da loja'], differentials: [], motion: 'subtle', avoid: [] },
  copy: { tone: 'carinhoso e direto', language: 'pt-BR' },
};

describe.skipIf(!OWNER_URL)('site builder (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const tenants: string[] = [];
  const releases: string[] = [];

  // ── the network: the routine's /fire and GitHub's API ──────────────────────
  const fires: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  let fireStatus = 200;
  const merges: { path: string; body: Record<string, unknown> }[] = [];
  const files = new Map<string, string>();
  const checks = new Map<
    string,
    { id: number; name: string; status: string; conclusion: string | null }[]
  >();
  const green = (sha: string) =>
    checks.set(sha, [
      { id: 1, name: 'check', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'conformance', status: 'completed', conclusion: 'success' },
      { id: 3, name: 'storefront-isolation', status: 'completed', conclusion: 'success' },
    ]);
  const dirs = new Map<string, string[]>();
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.host === 'routine.test') {
      fires.push({ url: String(url), headers, body: JSON.parse(String(init?.body)) });
      if (fireStatus !== 200) return new Response('nope', { status: fireStatus });
      return Response.json({
        claude_code_session_id: `sess_${fires.length}`,
        claude_code_session_url: `https://claude.ai/code/sess_${fires.length}`,
      });
    }
    if (url.host === 'api.github.com') {
      if (init?.method === 'PUT' && /\/pulls\/\d+\/merge$/.test(url.pathname)) {
        merges.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
        return Response.json({ sha: 'f'.repeat(40), merged: true });
      }
      const cr = /^\/repos\/acme\/stores\/commits\/([0-9a-f]+)\/check-runs$/.exec(url.pathname);
      if (cr) return Response.json({ check_runs: checks.get(cr[1]!) ?? [] });
      const m = /^\/repos\/acme\/stores\/contents\/(.+)$/.exec(url.pathname);
      if (m) {
        const key = `${decodeURIComponent(m[1]!)}@${url.searchParams.get('ref')}`;
        if (headers.get('accept')?.includes('raw')) {
          const f = files.get(key);
          return f === undefined ? new Response('{}', { status: 404 }) : new Response(f);
        }
        const d = dirs.get(key);
        return d === undefined
          ? new Response('{}', { status: 404 })
          : Response.json(d.map((name) => ({ name, type: 'file' })));
      }
    }
    return new Response('unexpected', { status: 599 });
  }) as typeof fetch;

  const notify: MerchantNotify = { whatsapp: async () => {}, email: async () => {} };
  const site = siteDeps({
    routineUrl: 'https://routine.test/fire',
    routineToken: 'rt-token',
    repo: 'acme/stores',
    githubToken: 'gh-token',
    webhookSecret: 'wh-secret',
    fetch: fakeFetch,
  });
  const d = fleetDeps(appSql, {
    storeDomain: 'vendua.test',
    probes: false,
    fetch: fakeFetch,
    notify,
    staff: async () => {},
    site,
  });
  d.only = [];
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    storeDomain: 'vendua.test',
    notify,
    fleet: d,
  });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  afterAll(async () => {
    if (tenants.length) await sql`delete from tenants where id in ${sql(tenants)}`;
    if (releases.length) await sql`delete from releases where id in ${sql(releases)}`;
    await sql.end();
    await (appSql as unknown as { end: () => Promise<void> }).end();
  });

  let idem = 0;
  const admin = async (
    method: string,
    path: string,
    cookie: string | null,
    body?: unknown,
    key?: string,
  ) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': key ?? `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      replay: res.headers.get('x-idempotent-replay'),
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const ctl = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': 'ctl',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-c${++idem}` }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const hook = async (
    event: string,
    payload: unknown,
    o: { delivery?: string; secret?: string } = {},
  ) => {
    const raw = JSON.stringify(payload);
    const sig = createHmac('sha256', o.secret ?? 'wh-secret')
      .update(raw)
      .digest('hex');
    const res = await app.request('/control/v1/github/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-github-event': event,
        'x-github-delivery': o.delivery ?? crypto.randomUUID(),
        'x-hub-signature-256': `sha256=${sig}`,
      },
      body: raw,
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  let phones = 0;
  const phone = () => `31${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);

  async function signIn(p: string, tenantId: string) {
    const m = (await membershipsFor(appSql, p)).find((x) => x.tenant_id === tenantId)!;
    return `vendua_admin=${await createSession(appSql, m, 'test')}`;
  }

  interface Store {
    id: string;
    slug: string;
    owner: string;
    requestId: string | null;
  }

  async function store(
    o: { plan?: string; request?: boolean; slug?: string } = {},
  ): Promise<Store> {
    const slug = o.slug ?? `sb-${nonce}-${tenants.length}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${slug}, ${`Doce ${tenants.length}`},
        ${o.plan ?? 'pangolim'}) returning id`;
    const id = t!.id;
    tenants.push(id);
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
        vocabulary, pickup_enabled, logo_url)
      values (${id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 25, 0, 'BRL',
              ${sql.json({})}, true, 'https://cdn.test/logo.png')`;
    const p = phone();
    await sql`
      insert into merchant_users (tenant_id, name, phone, role)
      values (${id}, 'Rita Souza', ${p}, 'owner')`;
    let requestId: string | null = null;
    if (o.request !== false)
      requestId = (
        await sql<{ id: string }[]>`
          insert into site_requests (tenant_id) values (${id}) returning id`
      )[0]!.id;
    return { id, slug, owner: await signIn(p, id), requestId };
  }

  const taskOf = async (tenantId: string) =>
    (
      await sql<any[]>`
        select * from site_tasks where tenant_id = ${tenantId} order by created_at desc limit 1`
    )[0];
  const staffEvents = async (kind: string, taskId: string) =>
    sql<{ id: number }[]>`
      select id from staff_events where kind = ${kind} and data->>'taskId' = ${taskId}`;

  /** a store whose build was applied, with its task fired and running */
  async function running(): Promise<{ s: Store; task: any }> {
    const s = await store();
    expect(
      (await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC })).status,
    ).toBe(201);
    d.only = [s.id];
    fireStatus = 200;
    await fireQueued(d);
    return { s, task: await taskOf(s.id) };
  }

  const prPayload = (task: any, action: string, extra: Record<string, unknown> = {}) => ({
    action,
    repository: { full_name: 'acme/stores' },
    pull_request: {
      number: 42,
      html_url: 'https://github.com/acme/stores/pull/42',
      head: {
        ref: task.branch,
        sha: extra.sha ?? 'a'.repeat(40),
        repo: { full_name: extra.fork ?? 'acme/stores' },
      },
      merged: extra.merged ?? false,
      merge_commit_sha: extra.mergeSha ?? null,
    },
  });
  let runIds = 1000;
  const runPayload = (
    task: any,
    sha: string,
    conclusion: string,
    o: { id?: number; attempt?: number; fork?: string } = {},
  ) => ({
    action: 'completed',
    repository: { full_name: 'acme/stores' },
    workflow_run: {
      id: o.id ?? ++runIds,
      run_attempt: o.attempt ?? 1,
      path: '.github/workflows/ci.yml',
      head_branch: task.branch,
      head_sha: sha,
      head_repository: { full_name: o.fork ?? 'acme/stores' },
      conclusion,
    },
  });
  const id8 = (id: string) => id.slice(0, 8);

  // ── the owner's doors ─────────────────────────────────────────────────────

  test('build creates exactly one task; a second build is 409; a replay returns the same', async () => {
    const s = await store();
    const key = `${nonce}-build-once`;
    const first = await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC }, key);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      id: s.requestId,
      status: 'in_progress',
      // the request had no brief: the spec's summary became it
      brief: SPEC.summary,
      revisionsUsed: 0,
      revisionsIncluded: 1,
      deliveredAt: null,
      building: { kind: 'generate', stage: 'fila' },
    });
    expect(first.body.spec.summary).toBe(SPEC.summary);
    expect(new Date(first.body.dueAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3600_000);

    const replay = await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC }, key);
    expect(replay.status).toBe(201);
    expect(replay.replay).toBe('true');
    expect(replay.body).toEqual(first.body);

    const again = await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC });
    expect(again.status).toBe(409);
    expect(again.body.error?.code ?? again.body.code).toBe('SITE_ALREADY_BUILDING');

    const rows = await sql<any[]>`select * from site_tasks where tenant_id = ${s.id}`;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      kind: 'generate',
      source: 'owner',
      status: 'queued',
      branch: `claude/site-${s.slug}--${id8(rows[0].id)}`,
    });
    expect((await staffEvents('site.task_queued', rows[0].id)).length).toBe(1);

    const account = await admin('GET', '/account', s.owner);
    expect(account.body.siteRequest).toMatchObject({ building: { stage: 'fila' } });
    expect(JSON.stringify(account.body.siteRequest)).not.toContain('claude/site');
  });

  test('an invalid spec is 422 INVALID_SPEC; a plan without the site is 403', async () => {
    const s = await store();
    const bad = await admin('POST', '/account/site-request/build', s.owner, {
      spec: { ...SPEC, version: 2, brand: { ...SPEC.brand, personality: [] } },
    });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('INVALID_SPEC');
    expect(JSON.stringify(bad.body)).toContain('spec.version must be 1');
    expect((await sql`select 1 from site_tasks where tenant_id = ${s.id}`).length).toBe(0);

    const mirim = await store({ plan: 'mirim' });
    const no = await admin('POST', '/account/site-request/build', mirim.owner, { spec: SPEC });
    expect(no.status).toBe(403);
    expect(JSON.stringify(no.body)).toContain('PLAN_REQUIRED');
  });

  // ── the routine ───────────────────────────────────────────────────────────

  test('fire: 2xx → running with the session; 500 → escalated and never fired again', async () => {
    const { s, task } = await running();
    expect(task).toMatchObject({ status: 'running', session_id: 'sess_' + fires.length });
    expect(task.session_url).toBe(`https://claude.ai/code/sess_${fires.length}`);
    const call = fires.at(-1)!;
    expect(call.headers.get('authorization')).toBe('Bearer rt-token');
    expect(call.headers.get('anthropic-beta')).toBe('experimental-cc-routine-2026-04-01');
    const env = JSON.parse(call.body.text as string);
    expect(env).toMatchObject({
      taskId: task.id,
      kind: 'generate',
      slug: s.slug,
      branch: `claude/site-${s.slug}--${id8(task.id)}`,
      base: 'main',
      label: `storefront:${s.slug}`,
      marker: `vendua-task:${task.id}`,
      maxFixPushes: 4,
      assets: { logo: 'https://cdn.test/logo.png', photos: [] },
    });
    expect(env.spec.summary).toBe(SPEC.summary);

    const b = await store();
    await admin('POST', '/account/site-request/build', b.owner, { spec: SPEC });
    d.only = [b.id];
    fireStatus = 500;
    const before = fires.length;
    await fireQueued(d);
    expect(fires.length).toBe(before + 1);
    const t = await taskOf(b.id);
    expect(t.status).toBe('escalated');
    expect(t.escalated_reason).toContain('disparo incerto');
    expect((await staffEvents('site.escalated', t.id)).length).toBe(1);
    await fireQueued(d);
    await fireQueued(d);
    expect(fires.length).toBe(before + 1);
    // the owner still sees it being built
    const acc = await admin('GET', '/account', b.owner);
    expect(acc.body.siteRequest.building).toEqual({ kind: 'generate', stage: 'construindo' });
    fireStatus = 200;
  });

  test('without the routine configured a task waits, noted once', async () => {
    const s = await store();
    await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC });
    const parked = fleetDeps(appSql, {
      notify,
      fetch: fakeFetch,
      site: { runner: null, github: null, webhookSecret: null },
    });
    parked.only = [s.id];
    await fireQueued(parked);
    await sql`update site_tasks set next_attempt_at = now() where tenant_id = ${s.id}`;
    await fireQueued(parked);
    const t = await taskOf(s.id);
    expect(t).toMatchObject({ status: 'queued', last_error: 'routine não configurada' });
    const ev =
      await sql`select 1 from site_task_events where task_id = ${t.id} and kind = 'parked'`;
    expect(ev.length).toBe(1);
  });

  // ── GitHub ────────────────────────────────────────────────────────────────

  test('webhook: bad signature 401, PR opened → pr_open, a duplicate delivery is ignored', async () => {
    const { task } = await running();
    const forged = await hook('pull_request', prPayload(task, 'opened'), { secret: 'wrong' });
    expect(forged.status).toBe(401);
    expect((await taskOf(task.tenant_id)).status).toBe('running');

    const delivery = crypto.randomUUID();
    const opened = await hook('pull_request', prPayload(task, 'opened'), { delivery });
    expect(opened.status).toBe(200);
    expect(await taskOf(task.tenant_id)).toMatchObject({
      status: 'pr_open',
      pr_number: 42,
      pr_url: 'https://github.com/acme/stores/pull/42',
      head_sha: 'a'.repeat(40),
      ci: 'pending',
    });
    // the same delivery again (GitHub retries) changes nothing
    await sql`update site_tasks set ci = 'success' where id = ${task.id}`;
    const dup = await hook('pull_request', prPayload(task, 'opened'), { delivery });
    expect(dup.status).toBe(204);
    expect((await taskOf(task.tenant_id)).ci).toBe('success');
    // an event we don't follow, and a branch no task has
    expect((await hook('push', { ref: 'x' })).status).toBe(204);
    expect((await hook('pull_request', prPayload({ branch: 'other' }, 'opened'))).status).toBe(204);
  });

  test('five red CI runs on distinct shas escalate; a stale sha is ignored', async () => {
    const { task } = await running();
    await hook('pull_request', prPayload(task, 'opened', { sha: '1'.repeat(40) }));
    for (let i = 1; i <= 5; i++) {
      const sha = String(i).repeat(40);
      if (i > 1) await hook('pull_request', prPayload(task, 'synchronize', { sha }));
      const r = await hook('workflow_run', runPayload(task, sha, 'failure'));
      expect(r.status).toBe(200);
      // a rerun of the same red sha doesn't count twice
      if (i === 2) await hook('workflow_run', runPayload(task, sha, 'failure'));
      const t = await taskOf(task.tenant_id);
      expect(t.iterations).toBe(i);
      expect(t.status).toBe(i < 5 ? 'pr_open' : 'escalated');
    }
    const t = await taskOf(task.tenant_id);
    expect(t.escalated_reason).toBe('não ficou verde em 4 tentativas');
    expect((await staffEvents('site.escalated', t.id)).length).toBe(1);
  });

  test('green CI → ready; approve only when green; the merge job merges at the head sha', async () => {
    const { s, task } = await running();
    const sha = 'b'.repeat(40);
    await hook('pull_request', prPayload(task, 'opened', { sha }));

    const early = await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`);
    expect(early.status).toBe(409);
    expect(JSON.stringify(early.body)).toContain('SITE_TASK_NOT_GREEN');

    // CI for an older sha says nothing about this head
    expect((await hook('workflow_run', runPayload(task, 'c'.repeat(40), 'success'))).status).toBe(
      204,
    );
    expect((await hook('workflow_run', runPayload(task, sha, 'success'))).status).toBe(200);
    expect((await taskOf(s.id)).ci).toBe('success');
    expect((await staffEvents('site.ready', task.id)).length).toBe(1);

    const ok = await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`, { by: 'Vini' });
    expect(ok.status).toBe(200);
    expect(ok.body.task).toMatchObject({ status: 'approved', approvedBy: 'Vini', ci: 'success' });
    expect((await admin('GET', '/account', s.owner)).body.siteRequest.building.stage).toBe(
      'revisao',
    );

    // GitHub's check runs are asked first: none reported yet → back to the PR, nothing merged
    const before = merges.length;
    await mergeApproved(d);
    expect(merges.length).toBe(before);
    expect(await taskOf(s.id)).toMatchObject({
      status: 'pr_open',
      ci: 'failure',
      approved_by: null,
    });
    await sql`update site_tasks set ci = 'success' where id = ${task.id}`;
    green(sha);
    await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`, { by: 'Vini' });
    await mergeApproved(d);
    expect(merges.at(-1)).toEqual({
      path: '/repos/acme/stores/pulls/42/merge',
      body: { merge_method: 'squash', sha },
    });
    const t = await taskOf(s.id);
    expect(t).toMatchObject({ status: 'merged', merge_sha: 'f'.repeat(40) });
    // GitHub's closed event arriving after finds it merged already
    const late = await hook(
      'pull_request',
      prPayload(task, 'closed', { merged: true, mergeSha: 'f'.repeat(40), sha }),
    );
    expect(late.status).toBe(204);
  });

  test('merged → design read at the merge sha → applied on deploy → delivered when live; one revision', async () => {
    const { s, task } = await running();
    const sha = 'd'.repeat(40);
    await hook('pull_request', prPayload(task, 'opened', { sha }));
    await hook('workflow_run', runPayload(task, sha, 'success'));
    await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`);
    // merged by GitHub's webhook this time (staff merged by hand)
    const mergeSha = 'e'.repeat(40);
    expect(
      (await hook('pull_request', prPayload(task, 'closed', { merged: true, mergeSha, sha })))
        .status,
    ).toBe(200);
    expect((await taskOf(s.id)).status).toBe('merged');

    const home = JSON.parse(
      readFileSync(
        join(import.meta.dir, '../../../storefronts/_template/templates/home.json'),
        'utf8',
      ),
    );
    home.sections = [{ id: 'story', type: 'store:story' }, ...home.sections];
    dirs.set(`storefronts/${s.slug}/templates@${mergeSha}`, ['home.json', 'README.md']);
    files.set(`storefronts/${s.slug}/templates/home.json@${mergeSha}`, JSON.stringify(home));
    await fetchDesigns(d);
    const withDesign = await taskOf(s.id);
    expect(Object.keys(withDesign.design.templates)).toEqual(['home']);
    expect(withDesign.design.tokens).toBeNull();

    // no build of the store's own bundle yet: nothing lands
    expect(await deliverMerged(d)).toBe(0);
    expect((await taskOf(s.id)).design_applied_at).toBeNull();

    const rid = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    releases.push(rid);
    await sql`
      insert into releases (id, bundle, tenant_slug, kernel_version, contract, commit, artifact_uri,
                            manifest, qa_status, built_at)
      values (${rid}, ${s.slug}, ${s.slug}, '1.12.0', 2, ${mergeSha.slice(0, 12)},
              ${`file:///r/${rid}`}, ${sql.json({})}, 'passed', now())`;
    await sql`
      insert into storefront_ops (tenant_id, bundle) values (${s.id}, ${s.slug})
      on conflict (tenant_id) do update set bundle = excluded.bundle`;
    const [dep] = await sql<{ id: string }[]>`
      insert into deployments (tenant_id, release_id, kind, actor, status)
      values (${s.id}, ${rid}, 'auto', 'control-plane', 'pending') returning id`;

    expect(await deliverMerged(d)).toBe(0);
    const applied = await taskOf(s.id);
    expect(applied.status).toBe('merged');
    expect(applied.design_applied_at).not.toBeNull();
    const tpl = await sql<{ version: number; source: string; template: any }[]>`
      select version, source, template from storefront_templates
      where tenant_id = ${s.id} and page = 'home' order by version desc limit 1`;
    expect(tpl[0]!.source).toBe('site sob medida');
    expect(tpl[0]!.template.sections[0].type).toBe('store:story');
    const versions = tpl[0]!.version;

    await sql`update deployments set status = 'live', finished_at = now() where id = ${dep!.id}`;
    expect(await deliverMerged(d)).toBe(1);
    expect((await taskOf(s.id)).status).toBe('delivered');
    // applied once: delivery doesn't write the template again
    const after = await sql`
      select 1 from storefront_templates where tenant_id = ${s.id} and page = 'home'`;
    expect(after.length).toBe(versions);
    expect((await staffEvents('site.delivered', task.id)).length).toBe(1);
    const acc = await admin('GET', '/account', s.owner);
    expect(acc.body.siteRequest).toMatchObject({
      status: 'delivered',
      building: null,
      dueAt: null,
      revisionsUsed: 0,
    });
    expect(acc.body.siteRequest.deliveredAt).toBeTruthy();

    // the one included revision
    const tooShort = await admin('POST', '/account/site-request/revision', s.owner, {
      note: 'x',
      spec: SPEC,
    });
    expect(tooShort.status).toBe(422);
    const rev = await admin('POST', '/account/site-request/revision', s.owner, {
      note: 'Troque a foto do topo por uma do bolo de cenoura',
      spec: SPEC,
    });
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({
      status: 'in_progress',
      revisionsUsed: 1,
      building: { kind: 'revision', stage: 'fila' },
    });
    const revTask = await taskOf(s.id);
    expect(revTask.id).not.toBe(task.id);
    expect(revTask).toMatchObject({
      kind: 'revision',
      branch: `claude/site-${s.slug}-ajuste--${id8(revTask.id)}`,
      note: 'Troque a foto do topo por uma do bolo de cenoura',
    });
    const twice = await admin('POST', '/account/site-request/revision', s.owner, {
      note: 'Mais uma coisinha, por favor',
      spec: SPEC,
    });
    expect(twice.status).toBe(409);
    expect(JSON.stringify(twice.body)).toContain('REVISION_USED');
  });

  test('a revision before delivery is 409', async () => {
    const s = await store();
    const r = await admin('POST', '/account/site-request/revision', s.owner, {
      note: 'Mude a cor do botão',
      spec: SPEC,
    });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('SITE_NOT_DELIVERED');
  });

  // ── staff ─────────────────────────────────────────────────────────────────

  test('staff list, read, retry with a new branch, take over by hand and cancel', async () => {
    const s = await store();
    await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC });
    const t = await taskOf(s.id);

    const list = await ctl('GET', '/control/v1/site-tasks?status=open');
    const row = list.body.tasks.find((x: any) => x.id === t.id);
    expect(row).toMatchObject({ tenantId: s.id, slug: s.slug, status: 'queued', kind: 'generate' });
    expect((await ctl('GET', '/control/v1/site-tasks?status=nope')).status).toBe(422);
    expect((await ctl('GET', '/control/v1/site-tasks/not-a-uuid')).status).toBe(400);
    expect((await ctl('GET', `/control/v1/site-tasks/${crypto.randomUUID()}`)).status).toBe(404);
    const billing = await ctl('GET', `/control/v1/billing/stores?tenant=${s.id}`);
    expect(billing.body.stores[0].siteTask).toMatchObject({ id: t.id, status: 'queued' });
    const detail = await ctl('GET', `/control/v1/site-tasks/${t.id}`);
    expect(detail.body.events.map((e: any) => e.kind)).toEqual(['queued']);

    expect((await ctl('POST', `/control/v1/site-tasks/${t.id}/retry`)).status).toBe(409);
    for (const busy of ['firing', 'approved']) {
      await sql`update site_tasks set status = ${busy} where id = ${t.id}`;
      const r = await ctl('POST', `/control/v1/site-tasks/${t.id}/cancel`, { reason: 'desistiu' });
      expect(r.status).toBe(409);
      expect(JSON.stringify(r.body)).toContain('SITE_TASK_BUSY');
    }
    await sql`update site_tasks set status = 'escalated' where id = ${t.id}`;
    const retried = await ctl('POST', `/control/v1/site-tasks/${t.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body.task).toMatchObject({
      status: 'queued',
      attempt: 2,
      branch: `claude/site-${s.slug}--${id8(t.id)}-2`,
    });

    const human = await ctl('POST', `/control/v1/site-tasks/${t.id}/human`);
    expect(human.body.task).toMatchObject({ status: 'running', runner: 'human' });

    expect((await ctl('POST', `/control/v1/site-tasks/${t.id}/cancel`, {})).status).toBe(422);
    const cancel = await ctl('POST', `/control/v1/site-tasks/${t.id}/cancel`, {
      reason: 'a loja desistiu',
    });
    expect(cancel.body.task.status).toBe('cancelled');
    const req = await sql<
      { status: string }[]
    >`select status from site_requests where id = ${s.requestId}`;
    expect(req[0]!.status).toBe('requested');
    // the owner can build again, on a branch no earlier task used
    expect(
      (await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC })).status,
    ).toBe(201);
    const again = await taskOf(s.id);
    expect(again.id).not.toBe(t.id);
    expect(again.branch).toBe(`claude/site-${s.slug}--${id8(again.id)}`);
  });

  test('due soon and overdue each tell staff once', async () => {
    const s = await store();
    await admin('POST', '/account/site-request/build', s.owner, { spec: SPEC });
    const t = await taskOf(s.id);
    d.only = [s.id];
    await deadlines(d);
    expect((await staffEvents('site.due_soon', t.id)).length).toBe(0);
    await sql`update site_tasks set due_at = now() + interval '2 hours' where id = ${t.id}`;
    await deadlines(d);
    await deadlines(d);
    expect((await staffEvents('site.due_soon', t.id)).length).toBe(1);
    await sql`update site_tasks set due_at = now() - interval '1 minute' where id = ${t.id}`;
    await deadlines(d);
    await deadlines(d);
    expect((await staffEvents('site.overdue', t.id)).length).toBe(1);
    expect((await staffEvents('site.due_soon', t.id)).length).toBe(1);
  });

  test('a labeled re-run that skipped the failed jobs never turns a red sha green', async () => {
    const { task } = await running();
    const sha = '7'.repeat(40);
    await hook('pull_request', prPayload(task, 'opened', { sha }));
    await hook('workflow_run', runPayload(task, sha, 'failure', { id: 77 }));
    // another run of ci.yml on the same sha (a label added): everything skipped but isolation
    expect((await hook('workflow_run', runPayload(task, sha, 'success', { id: 78 }))).status).toBe(
      204,
    );
    // a first attempt of the failed run id can't be a re-run either
    expect(
      (await hook('workflow_run', runPayload(task, sha, 'success', { id: 77, attempt: 1 }))).status,
    ).toBe(204);
    expect((await taskOf(task.tenant_id)).ci).toBe('failure');
    expect((await staffEvents('site.ready', task.id)).length).toBe(0);
    // re-running the failed run itself can
    expect(
      (await hook('workflow_run', runPayload(task, sha, 'success', { id: 77, attempt: 2 }))).status,
    ).toBe(200);
    expect((await taskOf(task.tenant_id)).ci).toBe('success');
  });

  test('the merge gate refuses a head GitHub reports red or still running', async () => {
    const { s, task } = await running();
    const sha = '8'.repeat(40);
    await hook('pull_request', prPayload(task, 'opened', { sha }));
    await hook('workflow_run', runPayload(task, sha, 'success'));
    const before = merges.length;

    // an older red run of check, superseded by a green one, doesn't count; isolation red does
    checks.set(sha, [
      { id: 1, name: 'check', status: 'completed', conclusion: 'failure' },
      { id: 4, name: 'check', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'conformance', status: 'completed', conclusion: 'success' },
      { id: 3, name: 'storefront-isolation', status: 'completed', conclusion: 'failure' },
    ]);
    expect((await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`)).status).toBe(200);
    await mergeApproved(d);
    let t = await taskOf(s.id);
    expect(t).toMatchObject({ status: 'pr_open', ci: 'failure' });
    expect(t.last_error).toContain('storefront-isolation');

    await sql`update site_tasks set ci = 'success' where id = ${task.id}`;
    checks.set(sha, [
      { id: 1, name: 'check', status: 'completed', conclusion: 'success' },
      { id: 2, name: 'conformance', status: 'in_progress', conclusion: null },
    ]);
    expect((await ctl('POST', `/control/v1/site-tasks/${task.id}/approve`)).status).toBe(200);
    await mergeApproved(d);
    t = await taskOf(s.id);
    expect(t).toMatchObject({ status: 'pr_open', ci: 'pending' });
    expect(merges.length).toBe(before);
    const ev =
      await sql`select 1 from site_task_events where task_id = ${task.id} and kind = 'merge_gate'`;
    expect(ev.length).toBe(2);

    // an approved row whose ci isn't green is never claimed
    await sql`update site_tasks set status = 'approved', ci = 'pending' where id = ${task.id}`;
    green(sha);
    await mergeApproved(d);
    expect(merges.length).toBe(before);
    expect((await taskOf(s.id)).status).toBe('approved');
  });

  test('slugs that look like suffixes get distinct branches', async () => {
    const a = await store({ slug: `sbx-${nonce}` });
    const b = await store({ slug: `sbx-${nonce}-ajuste` });
    const c = await store({ slug: `sbx-${nonce}-2` });
    for (const x of [a, b, c])
      expect(
        (await admin('POST', '/account/site-request/build', x.owner, { spec: SPEC })).status,
      ).toBe(201);
    const branches = await sql<{ branch: string }[]>`
      select branch from site_tasks where tenant_id in ${sql([a.id, b.id, c.id])}`;
    expect(new Set(branches.map((r) => r.branch)).size).toBe(3);
    // a revision of a and a build of b can't share one either
    for (const r of branches) expect(r.branch).toMatch(/--[0-9a-f]{8}$/);
  });

  test('events from a fork are ignored', async () => {
    const { task } = await running();
    const fork = await hook('pull_request', prPayload(task, 'opened', { fork: 'evil/stores' }));
    expect(fork.status).toBe(204);
    expect((await taskOf(task.tenant_id)).status).toBe('running');
    await hook('pull_request', prPayload(task, 'opened', { sha: '9'.repeat(40) }));
    const run = await hook(
      'workflow_run',
      runPayload(task, '9'.repeat(40), 'success', { fork: 'evil/stores' }),
    );
    expect(run.status).toBe(204);
    expect((await taskOf(task.tenant_id)).ci).toBe('pending');
  });

  test('a revision needs the plan', async () => {
    const s = await store({ plan: 'mirim', request: false });
    await sql`insert into site_requests (tenant_id, status, brief) values (${s.id}, 'delivered', 'x')`;
    const r = await admin('POST', '/account/site-request/revision', s.owner, {
      note: 'Mude a cor do botão',
      spec: SPEC,
    });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain('PLAN_REQUIRED');
  });

  test('RLS: one store cannot read another store’s site tasks', async () => {
    const a = await store();
    const b = await store();
    await admin('POST', '/account/site-request/build', a.owner, { spec: SPEC });
    await admin('POST', '/account/site-request/build', b.owner, { spec: SPEC });
    const seen = await withTenant(
      appSql,
      a.id,
      (tx) => tx<{ tenant_id: string }[]>`select tenant_id from site_tasks`,
    );
    expect(seen.length).toBe(1);
    expect(seen[0]!.tenant_id).toBe(a.id);
    const other = await withTenant(
      appSql,
      a.id,
      (tx) => tx`select 1 from site_task_events where tenant_id = ${b.id}`,
    );
    expect(other.length).toBe(0);
    const deliveries = await withTenant(appSql, a.id, (tx) => tx`select 1 from github_deliveries`);
    expect(deliveries.length).toBe(0);
  });
});

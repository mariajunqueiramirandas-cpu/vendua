import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { planPromote, planRollback, resolveRelease, type StoreDetail } from '../src/fleet-ops.ts';
import { bundleOf } from '../src/release.ts';

const R2 = 'b'.repeat(20);
const R1 = 'a1'.repeat(10);
const R0 = 'c'.repeat(20);
const rel = (id: string, qaStatus = 'passed') => ({
  id,
  bundle: 'quero-pudim',
  kernelVersion: '1.3.0',
  qaStatus,
  publishedAt: '2026-10-01T00:00:00Z',
  commit: 'abc1234',
});

function detail(over: Partial<StoreDetail> = {}): StoreDetail {
  return {
    slug: 'quero-pudim',
    name: 'Quero Pudim',
    bundle: 'quero-pudim',
    policy: 'auto',
    pinnedReason: null,
    host: null,
    live: { release: R2, kernelVersion: '1.3.0', since: '2026-10-02T00:00:00Z' },
    behind: false,
    probe: null,
    deployment: { status: 'live', kind: 'promote', release: R2 },
    provisioning: null,
    openIncidents: 0,
    latestRelease: R2,
    releases: [rel(R2), rel(R1), rel(R0, 'failed')],
    deployments: [
      { release: R2, status: 'live', kind: 'promote' },
      { release: R1, status: 'live', kind: 'promote' },
    ],
    ...over,
  };
}

describe('fleet dry-run plans mirror Core', () => {
  test('promoting an older release pins the store there', () => {
    const p = planPromote(detail(), R1, false);
    expect(p).toMatchObject({
      refused: null,
      from: R2,
      to: R1,
      policy: { from: 'auto', to: 'pinned' },
    });
  });

  test('promoting the newest keeps the store following its bundle', () => {
    const p = planPromote(detail({ live: null, deployment: null }), R2, false);
    expect(p).toMatchObject({ refused: null, to: R2, policy: { to: 'auto' } });
  });

  test('a release that failed its checks is refused unless forced', () => {
    expect(planPromote(detail(), R0, false).refused).toContain('RELEASE_QA_FAILED');
    const forced = planPromote(detail(), R0, true);
    expect(forced.refused).toBeNull();
    expect(forced.notes.join(' ')).toContain('--force');
  });

  test('the release that is already live changes nothing but the policy', () => {
    const p = planPromote(detail({ policy: 'pinned' }), R2, false);
    expect(p).toMatchObject({ refused: null, to: null, policy: { from: 'pinned', to: 'auto' } });
  });

  test('a pending deployment is superseded', () => {
    const p = planPromote(
      detail({ deployment: { status: 'pending', kind: 'auto', release: R1 } }),
      R2,
      false,
    );
    expect(p.supersedes).toBe(R1);
    expect(p.to).toBe(R2);
  });

  test('rollback goes to the newest earlier release that was live', () => {
    expect(planRollback(detail())).toMatchObject({
      refused: null,
      from: R2,
      to: R1,
      policy: { to: 'pinned' },
    });
  });

  test('rollback with nothing to go back to is refused with the same codes as Core', () => {
    expect(planRollback(detail({ live: null })).refused).toContain('NOTHING_TO_ROLL_BACK');
    const only = detail({ deployments: [{ release: R2, status: 'live', kind: 'promote' }] });
    expect(planRollback(only).refused).toContain('NO_PREVIOUS_RELEASE');
  });

  test('rollback stays on the bundle the store runs now', () => {
    const other = 'd'.repeat(20); // a release of the bundle it left: not among its releases
    const live = (release: string) => ({ release, status: 'live', kind: 'promote' });
    const moved = detail({ deployments: [live(R2), live(other), live(R1)] });
    expect(planRollback(moved).to).toBe(R1);
    const first = detail({ deployments: [live(R2), live(other)] });
    expect(planRollback(first).refused).toContain('NO_PREVIOUS_RELEASE');
  });

  test('a release prefix resolves among the store releases', () => {
    expect(resolveRelease(detail().releases, R1.slice(0, 6))).toBe(R1);
    expect(resolveRelease(detail().releases, 'f'.repeat(20))).toBe('f'.repeat(20));
  });
});

// ── the CLI against a fake Core: flags are checked before any call, a dry run never writes ──

const writes: string[] = [];
const templateCalls: string[] = [];
let reads = 0;
let listFails = false;
let server: ReturnType<typeof Bun.serve>;
let origin = '';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const notFound = (code: string) => json(404, { error: { code, message: 'nope' } });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path.startsWith('/control/v1/template-migrations/')) {
        const body = (await req.json()) as { dry?: boolean };
        const key = req.headers.get('idempotency-key');
        templateCalls.push(`${path} dry=${body.dry} key=${key ? 'yes' : 'no'}`);
        return json(200, { report: [] });
      }
      if (req.method !== 'GET') {
        writes.push(`${req.method} ${path}`);
        return json(201, { deployment: { id: 'd1' } });
      }
      reads++;
      let m: RegExpMatchArray | null;
      if ((m = path.match(/^\/control\/v1\/storefronts\/([^/]+)\/ops$/)))
        return m[1] === 'quero-pudim'
          ? json(200, { ring: 'stable' })
          : notFound('TENANT_NOT_FOUND');
      if (path === '/control/v1/fleet/storefronts')
        return listFails
          ? json(500, { error: { code: 'INTERNAL', message: 'down' } })
          : json(200, { storefronts: [{ slug: 'quero-pudim' }, { slug: 'brigadeiros-bia' }] });
      if ((m = path.match(/^\/control\/v1\/fleet\/storefronts\/([^/]+)$/)))
        return m[1] === 'quero-pudim'
          ? json(200, { storefront: detail() })
          : notFound('STORE_NOT_FOUND');
      return json(404, { error: { code: 'NOT_FOUND', message: path } });
    },
  });
  origin = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));

async function cli(...args: string[]) {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, '../src/main.ts'), ...args], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, VENDUA_CORE_ORIGIN: origin, CONTROL_SECRET: 'test' },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
}

describe('vendua <command> --help', () => {
  test('prints that command only', async () => {
    const r = await cli('ops', '--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('vendua ops <tenant>');
    expect(r.stdout).toContain('--maintenance');
    expect(r.stdout).not.toContain('vendua train');
    expect(reads).toBe(0);
  });

  test('works for every command, and as `help <command>`', async () => {
    for (const c of [
      'scaffold',
      'dev',
      'check',
      'build',
      'qa',
      'train',
      'codemod',
      'templates',
      'release',
      'fleet',
    ]) {
      const r = await cli(c, '-h');
      expect(r.code).toBe(0);
      expect(r.stdout.trimStart().startsWith(`vendua ${c}`)).toBe(true);
    }
    const viaHelp = await cli('help', 'fleet', 'rollback');
    expect(viaHelp.stdout).toContain('vendua fleet rollback');
    expect(viaHelp.stdout).not.toContain('vendua fleet status');
  });

  test('an unknown command suggests the nearest one', async () => {
    const r = await cli('opz');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown command 'opz' (did you mean 'ops'?)");
  });
});

describe('vendua ops', () => {
  test('a misspelled flag is an error, not a read of the store', async () => {
    const before = reads + writes.length;
    const r = await cli('ops', 'quero-pudim', '--maintanence', 'x');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("unknown flag '--maintanence' (did you mean '--maintenance'?)");
    expect(reads + writes.length).toBe(before);
  });

  test('a flag without its value, or contradicting another, is refused', async () => {
    expect((await cli('ops', 'quero-pudim', '--ring')).stderr).toContain('--ring needs a value');
    expect((await cli('ops', 'quero-pudim', '--normal', '--maintenance', 'x')).stderr).toContain(
      'pick one',
    );
    expect((await cli('ops', 'quero-pudim', '--href', '/x')).stderr).toContain('--maintenance');
  });

  test('reads a known store', async () => {
    const r = await cli('ops', 'quero-pudim');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ring: 'stable' });
  });

  test('an unknown store gets the names Core knows, not the raw API error', async () => {
    const r = await cli('ops', 'quero-pudm');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no store 'quero-pudm' — did you mean 'quero-pudim'?");
    expect(r.stderr).toContain('vendua fleet stores');
    expect(r.stderr).not.toContain('TENANT_NOT_FOUND');
  });

  test('the hint survives Core failing to list stores', async () => {
    listFails = true;
    try {
      const r = await cli('ops', 'nobody');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("no store 'nobody'");
      expect(r.stderr).toContain('vendua fleet stores');
    } finally {
      listFails = false;
    }
  });
});

describe('vendua fleet', () => {
  test('an unknown store on any store command gets the hint', async () => {
    for (const args of [
      ['store', 'quero-pudm'],
      ['promote', 'quero-pudm', 'abcdef'],
      ['rollback', 'quero-pudm', '--dry-run'],
    ]) {
      const r = await cli('fleet', ...args);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("did you mean 'quero-pudim'?");
    }
  });

  test('a misspelled subcommand or flag is refused', async () => {
    expect((await cli('fleet', 'stauts')).stderr).toContain("did you mean 'status'?");
    const r = await cli('fleet', 'promote', 'quero-pudim', R1, '--dryrun');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("did you mean '--dry-run'?");
    expect(writes).toEqual([]);
  });

  test('promote --dry-run says what would change and writes nothing', async () => {
    const r = await cli('fleet', 'promote', 'quero-pudim', R1.slice(0, 7), '--dry-run');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[simulação] promover quero-pudim — nada foi gravado');
    expect(r.stdout).toContain(`no ar agora:  ${R2.slice(0, 7)}`);
    expect(r.stdout).toContain(`depois:       ${R1.slice(0, 7)}`);
    expect(r.stdout).toContain('auto → fixada');
    expect(writes).toEqual([]);
  });

  test('flags may come before the arguments', async () => {
    const r = await cli('fleet', 'promote', '--dry-run', '--reason', 'teste', 'quero-pudim', R1);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[simulação] promover quero-pudim');
    expect(writes).toEqual([]);
  });

  test('promote --dry-run on a failed release exits 1 and names the refusal', async () => {
    const r = await cli('fleet', 'promote', 'quero-pudim', R0, '--dry-run');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('RELEASE_QA_FAILED');
    expect((await cli('fleet', 'promote', 'quero-pudim', R0, '--dry-run', '--force')).code).toBe(0);
    expect(writes).toEqual([]);
  });

  test('--json prints the plan as data', async () => {
    const r = await cli('fleet', 'rollback', 'quero-pudim', '--dry-run', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      dryRun: true,
      action: 'rollback',
      from: R2,
      to: R1,
    });
    expect(writes).toEqual([]);
  });

  test('rollback --dry-run names the release it would go back to', async () => {
    const r = await cli('fleet', 'rollback', 'quero-pudim', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('[simulação] voltar quero-pudim');
    expect(r.stdout).toContain(`depois:       ${R1.slice(0, 7)}`);
    expect(writes).toEqual([]);
  });

  test('without --dry-run the same command does write', async () => {
    const r = await cli('fleet', 'rollback', 'quero-pudim');
    expect(r.code).toBe(0);
    expect(writes).toEqual(['POST /control/v1/fleet/storefronts/quero-pudim/rollback']);
    writes.length = 0;
    await cli('fleet', 'promote', 'quero-pudim', R1);
    expect(writes).toEqual(['POST /control/v1/fleet/storefronts/quero-pudim/promote']);
    writes.length = 0;
  });
});

describe('templates rollback', () => {
  test('needs a scope, previews by default and writes only with --apply', async () => {
    const bare = await cli('templates', 'rollback', 'm1');
    expect(bare.code).toBe(2);
    expect(bare.stderr).toContain('--all');
    expect(templateCalls).toEqual([]);

    const dry = await cli('templates', 'rollback', 'm1', '--ring', 'canary');
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain('dry run');
    expect(await cli('templates', 'rollback', 'm1', '--all', '--apply')).toMatchObject({ code: 0 });
    expect(templateCalls).toEqual([
      '/control/v1/template-migrations/m1/rollback dry=true key=no',
      '/control/v1/template-migrations/m1/rollback dry=false key=yes',
    ]);
  });
});

describe('release bundles', () => {
  const store = (dir: string, tenant: string) => ({
    dir: `/repo/storefronts/${dir}`,
    rel: `storefronts/${dir}`,
    slug: dir,
    tenant,
  });

  test("a store's bundle builds for the tenant it is named after", () => {
    expect(bundleOf('/repo', store('quero-pudim', 'quero-pudim'))).toBe('quero-pudim');
    expect(() => bundleOf('/repo', store('quero-pudim', 'brasa'))).toThrow("must be 'quero-pudim'");
    // platform-owned dirs build for their demo store
    expect(bundleOf('/repo', store('_template', 'loja-modelo'))).toBe('_template');
  });
});

describe('other commands reject misspelled flags too', () => {
  test.each([
    [['train', '--cor'], "unknown flag '--cor'"],
    [['templates', 'migrate', 'x', '--aply'], "did you mean '--apply'?"],
    [['codemod', 'run', 'x', '--dyr'], "unknown flag '--dyr'"],
    [['codemod', 'runn'], "did you mean 'run'?"],
    [['dev', '--watch'], "unknown flag '--watch'"],
  ])('%j', async (args, message) => {
    const r = await cli(...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
  });
});

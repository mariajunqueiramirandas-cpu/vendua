import { didYouMean, parseArgs, parseOrDie, type FlagSpec } from './args.ts';
import { control, explainError } from './core.ts';
import { FLEET_USAGE } from './help.ts';
import { die } from './paths.ts';

// `vendua fleet …` — the Control Plane from the terminal (docs/architecture/08 "Fleet operations
// API"): the same /control/v1/fleet routes the CRM's Lojas → frota uses.

interface Storefront {
  slug: string;
  bundle: string;
  policy: 'auto' | 'pinned';
  pinnedReason: string | null;
  host: string | null;
  live: { release: string; kernelVersion: string | null; since: string } | null;
  behind: boolean;
  probe: { status: string; latencyMs: number | null; error: string | null } | null;
  deployment: { status: string; kind: string; release: string } | null;
  provisioning: { state: string; lastError: string | null } | null;
  openIncidents: number;
}

interface Release {
  id: string;
  bundle: string;
  kernelVersion: string;
  qaStatus: string;
  publishedAt: string;
  commit: string;
}

/** what `GET /control/v1/fleet/storefronts/:slug` returns, as far as a dry run reads it */
export interface StoreDetail extends Storefront {
  name: string;
  latestRelease: string | null;
  releases: Release[];
  deployments: { release: string; status: string; kind: string }[];
}

/** The most recent deployments Core sends with a store; a rollback target older than that is not seen. */
const DEPLOYMENT_WINDOW = 30;
/** …and the newest releases of its bundle */
const RELEASE_WINDOW = 20;

export interface DryRun {
  tenant: string;
  action: 'promote' | 'rollback';
  /** set when Core would refuse; it names the error Core would answer with */
  refused: string | null;
  from: string | null;
  to: string | null;
  policy: { from: 'auto' | 'pinned'; to: 'auto' | 'pinned' };
  /** a pending deployment this one would supersede */
  supersedes: string | null;
  notes: string[];
}

/** full release id from a prefix (as `status` and `stores` print them) among the store's bundle's releases */
export function resolveRelease(releases: Release[], prefix: string): string {
  if (/^[0-9a-f]{20}$/.test(prefix)) return prefix;
  if (!/^[0-9a-f]{4,19}$/.test(prefix)) die(`'${prefix}' is not a release id`, 2);
  const hits = releases.filter((r) => r.id.startsWith(prefix));
  if (hits.length !== 1)
    die(hits.length ? `'${prefix}' matches ${hits.length} releases` : `no release '${prefix}'`);
  return hits[0]!.id;
}

/** Mirrors Core's promote (modules/fleet/deploy.ts promoteTx + the route's policy rule), read-only. */
export function planPromote(d: StoreDetail, release: string, force: boolean): DryRun {
  const plan: DryRun = {
    tenant: d.slug,
    action: 'promote',
    refused: null,
    from: d.live?.release ?? null,
    to: release,
    policy: { from: d.policy, to: d.latestRelease === release ? 'auto' : 'pinned' },
    supersedes: null,
    notes: [],
  };
  const known = d.releases.find((r) => r.id === release);
  if (!known)
    plan.notes.push(
      `a versão não está entre as ${d.releases.length} mais recentes do pacote ${d.bundle}: o Core confere ao aplicar`,
    );
  else if (known.qaStatus !== 'passed' && !force)
    plan.refused =
      'RELEASE_QA_FAILED: esta versão falhou nas verificações (--force promove assim mesmo)';
  else if (known.qaStatus !== 'passed')
    plan.notes.push('versão reprovada nas verificações, promovida por --force');
  const pending = d.deployment?.status === 'pending' ? d.deployment : null;
  if (!plan.refused && plan.from === release && !pending) {
    plan.to = null;
    plan.notes.push('já está no ar: nada é implantado, só a política muda');
  }
  if (pending) plan.supersedes = pending.release;
  return plan;
}

/** Mirrors Core's rollback (rollbackTx): the newest earlier release of the store's bundle that
 *  was ever live. */
export function planRollback(d: StoreDetail): DryRun {
  const plan: DryRun = {
    tenant: d.slug,
    action: 'rollback',
    refused: null,
    from: d.live?.release ?? null,
    to: null,
    policy: { from: d.policy, to: 'pinned' },
    supersedes: null,
    notes: [],
  };
  if (!plan.from) {
    plan.refused = 'NOTHING_TO_ROLL_BACK: esta loja não tem versão no ar';
    return plan;
  }
  const onBundle = new Set(d.releases.map((r) => r.id));
  const earlier = d.deployments.filter((x) => x.status === 'live' && x.release !== plan.from);
  plan.to = earlier.find((x) => onBundle.has(x.release))?.release ?? null;
  if (!plan.to) {
    plan.refused = `NO_PREVIOUS_RELEASE: nenhuma versão anterior do pacote ${d.bundle} esteve no ar aqui`;
    if (d.deployments.length >= DEPLOYMENT_WINDOW)
      plan.notes.push(`só as últimas ${DEPLOYMENT_WINDOW} implantações foram conferidas`);
    if (earlier.length && d.releases.length >= RELEASE_WINDOW)
      plan.notes.push(
        `só as ${RELEASE_WINDOW} versões mais recentes do pacote ${d.bundle} foram conferidas`,
      );
  }
  return plan;
}

function printDryRun(d: DryRun, kernel: (id: string) => string | undefined) {
  const label = (id: string | null) => {
    const k = id ? kernel(id) : undefined;
    return `${short(id)}${k ? ` (kernel ${k})` : ''}`;
  };
  const policy = (v: string) => (v === 'pinned' ? 'fixada' : 'auto');
  console.log(
    `[simulação] ${d.action === 'promote' ? 'promover' : 'voltar'} ${d.tenant} — nada foi gravado`,
  );
  console.log(`  no ar agora:  ${label(d.from)}`);
  if (d.refused) console.log(`  o Core recusaria: ${d.refused}`);
  else {
    console.log(`  depois:       ${d.to ? label(d.to) : 'sem mudança'}`);
    console.log(
      `  política:     ${policy(d.policy.from)}${d.policy.to === d.policy.from ? ' (continua)' : ` → ${policy(d.policy.to)}`}`,
    );
    if (d.supersedes) console.log(`  substitui:    implantação pendente de ${short(d.supersedes)}`);
  }
  for (const n of d.notes) console.log(`  aviso: ${n}`);
}

const SPECS: Record<string, FlagSpec> = {
  status: { bool: ['--json'] },
  stores: { bool: ['--json'] },
  store: { bool: ['--json'] },
  releases: { bool: ['--json'] },
  promote: { bool: ['--force', '--dry-run', '--json'], value: ['--reason'] },
  rollback: { bool: ['--dry-run', '--json'], value: ['--reason'] },
  pin: { value: ['--reason'] },
  unpin: { value: ['--reason'] },
  bundle: {},
  probe: {},
  provision: {
    value: ['--slug', '--name', '--plan', '--owner', '--phone', '--email', '--lead'],
  },
  provisions: { bool: ['--json'] },
  retry: {},
  incidents: { bool: ['--all', '--json'] },
};

/** the subcommands whose first argument is a store, for the "no such store" hint */
const TAKES_TENANT = new Set(['store', 'promote', 'rollback', 'pin', 'unpin', 'bundle', 'probe']);

const short = (id: string | null | undefined) => (id ? id.slice(0, 7) : '—');
const idem = (scope: string) => `cli:${scope}:${crypto.randomUUID()}`;

function table(rows: string[][]) {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  for (const r of rows)
    console.log(
      r
        .map((c, i) => c.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    );
}

function dryRun(plan: DryRun, d: StoreDetail, json: boolean) {
  if (json) console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
  else
    printDryRun(
      plan,
      (id) =>
        d.releases.find((r) => r.id === id)?.kernelVersion ??
        (d.live?.release === id ? (d.live.kernelVersion ?? undefined) : undefined),
    );
  if (plan.refused) process.exitCode = 1;
}

async function detailOf(tenant: string): Promise<StoreDetail> {
  const { storefront } = await control<{ storefront: StoreDetail | null }>(
    'GET',
    `/control/v1/fleet/storefronts/${tenant}`,
  );
  if (!storefront) die(`no store '${tenant}'`);
  return storefront;
}

/** a full id needs no lookup; a prefix is resolved among the store's bundle's releases */
async function releaseFor(tenant: string, prefix: string): Promise<string> {
  if (/^[0-9a-f]{20}$/.test(prefix)) return prefix;
  if (!/^[0-9a-f]{4,19}$/.test(prefix)) die(`'${prefix}' is not a release id`, 2);
  return resolveRelease((await detailOf(tenant)).releases, prefix);
}

async function run(args: string[]): Promise<void> {
  const sub = args[0];
  const spec = sub ? SPECS[sub] : undefined;
  if (!sub || !spec)
    die(
      `${sub ? `unknown fleet command '${sub}'${didYouMean(sub, Object.keys(SPECS))}\n\n` : ''}${FLEET_USAGE}`,
      2,
    );
  const p = parseOrDie(args.slice(1), spec, `fleet ${sub}`);
  const [a1, a2] = p.positionals;
  const json = p.has('--json');
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  switch (sub) {
    case 'status': {
      const s = await control<{
        probes: boolean;
        stores: number;
        live: number;
        pinned: number;
        pendingDeployments: number;
        failingHosts: number;
        probedHosts: number;
        provisioning: number;
        kernels: { version: string; stores: number }[];
        bundles: {
          bundle: string;
          latestRelease: string | null;
          kernelVersion: string | null;
          stores: number;
          behind: number;
        }[];
        openIncidents: { warning: number; critical: number };
      }>('GET', '/control/v1/fleet/status');
      if (json) return out(s);
      console.log(
        `${s.live}/${s.stores} lojas no ar · ${s.pinned} fixadas · ${s.pendingDeployments} implantações pendentes · ${s.provisioning} provisionando`,
      );
      console.log(
        s.probes
          ? `sondas: ${s.failingHosts} de ${s.probedHosts} endereços falhando`
          : 'sondas: desligadas neste ambiente',
      );
      console.log(
        `alertas abertos: ${s.openIncidents.critical} críticos, ${s.openIncidents.warning} de atenção`,
      );
      console.log(
        `kernel: ${s.kernels.map((k) => `${k.version} (${k.stores})`).join(', ') || '—'}\n`,
      );
      table([
        ['pacote', 'última', 'kernel', 'lojas', 'atrás'],
        ...s.bundles.map((b) => [
          b.bundle,
          short(b.latestRelease),
          b.kernelVersion ?? '—',
          String(b.stores),
          String(b.behind),
        ]),
      ]);
      return;
    }
    case 'stores': {
      const { storefronts } = await control<{ storefronts: Storefront[] }>(
        'GET',
        '/control/v1/fleet/storefronts',
      );
      if (json) return out(storefronts);
      table([
        ['loja', 'pacote', 'no ar', 'kernel', 'política', 'sonda', 'implantação', 'alertas'],
        ...storefronts.map((s) => [
          s.slug,
          s.bundle,
          `${short(s.live?.release)}${s.behind ? ' (atrás)' : ''}`,
          s.live?.kernelVersion ?? '—',
          s.policy === 'pinned' ? 'fixada' : 'auto',
          s.probe ? `${s.probe.status}${s.probe.latencyMs ? ` ${s.probe.latencyMs}ms` : ''}` : '—',
          s.deployment ? `${s.deployment.status} ${short(s.deployment.release)}` : '—',
          String(s.openIncidents),
        ]),
      ]);
      return;
    }
    case 'store': {
      if (!a1) die('usage: vendua fleet store <tenant>', 2);
      return out(await control('GET', `/control/v1/fleet/storefronts/${a1}`));
    }
    case 'releases': {
      const bundle = a1;
      const { releases } = await control<{ releases: Release[] }>(
        'GET',
        `/control/v1/fleet/releases${bundle ? `?bundle=${encodeURIComponent(bundle)}` : ''}`,
      );
      if (json) return out(releases);
      table([
        ['release', 'pacote', 'kernel', 'qa', 'commit', 'publicada'],
        ...releases.map((r) => [
          r.id,
          r.bundle,
          r.kernelVersion,
          r.qaStatus,
          short(r.commit),
          r.publishedAt,
        ]),
      ]);
      return;
    }
    case 'promote': {
      if (!a1 || !a2) die('usage: vendua fleet promote <tenant> <release>', 2);
      const reason = p.get('--reason');
      if (p.has('--dry-run')) {
        const d = await detailOf(a1);
        const plan = planPromote(d, resolveRelease(d.releases, a2), p.has('--force'));
        return dryRun(plan, d, json);
      }
      const release = await releaseFor(a1, a2);
      return out(
        await control(
          'POST',
          `/control/v1/fleet/storefronts/${a1}/promote`,
          {
            release,
            ...(reason ? { reason } : {}),
            ...(p.has('--force') ? { force: true } : {}),
          },
          idem(`promote:${a1}`),
        ),
      );
    }
    case 'rollback': {
      if (!a1) die('usage: vendua fleet rollback <tenant>', 2);
      const reason = p.get('--reason');
      if (p.has('--dry-run')) {
        const d = await detailOf(a1);
        return dryRun(planRollback(d), d, json);
      }
      return out(
        await control(
          'POST',
          `/control/v1/fleet/storefronts/${a1}/rollback`,
          reason ? { reason } : {},
          idem(`rollback:${a1}`),
        ),
      );
    }
    case 'pin':
    case 'unpin': {
      if (!a1) die(`usage: vendua fleet ${sub} <tenant>`, 2);
      const reason = p.get('--reason');
      const r = await control<{ storefront: Storefront }>(
        'PATCH',
        `/control/v1/fleet/storefronts/${a1}`,
        { policy: sub === 'pin' ? 'pinned' : 'auto', ...(reason ? { reason } : {}) },
        idem(`${sub}:${a1}`),
      );
      console.log(
        `${a1}: ${r.storefront.policy === 'pinned' ? 'fixada' : 'auto'} em ${short(r.storefront.live?.release)}`,
      );
      return;
    }
    case 'bundle': {
      if (!a1 || !a2) die('usage: vendua fleet bundle <tenant> <bundle>', 2);
      return out(
        await control(
          'PATCH',
          `/control/v1/fleet/storefronts/${a1}`,
          { bundle: a2 },
          idem(`bundle:${a1}`),
        ),
      );
    }
    case 'probe': {
      if (!a1) die('usage: vendua fleet probe <tenant>', 2);
      const { results } = await control<{
        results: {
          host: string;
          result: {
            ok: boolean;
            latencyMs: number;
            release: string | null;
            checks: { id: string; ok: boolean; detail?: string }[];
          };
        }[];
      }>('POST', `/control/v1/fleet/storefronts/${a1}/probe`, {}, idem(`probe:${a1}`));
      if (!results.length) console.log('nenhum endereço para sondar (a loja tem versão no ar?)');
      for (const { host, result } of results) {
        console.log(
          `${result.ok ? '✓' : '✗'} ${host}  ${result.latencyMs}ms  versão ${short(result.release)}`,
        );
        for (const c of result.checks)
          console.log(`    ${c.ok ? '✓' : '✗'} ${c.id}${c.detail ? `: ${c.detail}` : ''}`);
      }
      if (results.some((r) => !r.result.ok)) process.exitCode = 1;
      return;
    }
    case 'provision': {
      const need = (name: string) => p.get(name) ?? die(`missing ${name}\n\n${FLEET_USAGE}`, 2);
      const lead = p.get('--lead');
      return out(
        await control(
          'POST',
          '/control/v1/fleet/provisionings',
          {
            slug: need('--slug'),
            storeName: need('--name'),
            planId: need('--plan'),
            ownerName: need('--owner'),
            ownerPhone: need('--phone'),
            ownerEmail: need('--email'),
            ...(lead ? { leadId: lead } : {}),
          },
          idem('provision'),
        ),
      );
    }
    case 'provisions': {
      const { provisionings } = await control<{
        provisionings: {
          id: string;
          tenant: string;
          source: string;
          state: string;
          attempts: number;
          lastError: string | null;
        }[];
      }>('GET', '/control/v1/fleet/provisionings');
      if (json) return out(provisionings);
      table([
        ['id', 'loja', 'origem', 'etapa', 'tentativas', 'erro'],
        ...provisionings.map((p) => [
          p.id,
          p.tenant,
          p.source === 'invite' ? 'convite' : 'cadastro',
          p.state,
          String(p.attempts),
          p.lastError ?? '',
        ]),
      ]);
      return;
    }
    case 'retry': {
      if (!a1) die('usage: vendua fleet retry <provisioning id>', 2);
      return out(
        await control(
          'POST',
          `/control/v1/fleet/provisionings/${a1}/retry`,
          {},
          idem(`retry:${a1}`),
        ),
      );
    }
    case 'incidents': {
      if (a1 === 'ack' || a1 === 'resolve') {
        if (!a2) die(`usage: vendua fleet incidents ${a1} <id>`, 2);
        return out(
          await control(
            'PATCH',
            `/control/v1/fleet/incidents/${a2}`,
            a1 === 'ack' ? { ack: true } : { resolved: true },
            idem(`incident:${a2}`),
          ),
        );
      }
      const { incidents } = await control<{
        incidents: {
          id: string;
          tenant: string | null;
          severity: string;
          kind: string;
          summary: string;
          openedAt: string;
          ackedAt: string | null;
          resolvedAt: string | null;
        }[];
      }>('GET', `/control/v1/fleet/incidents${p.has('--all') ? '?all=1' : ''}`);
      if (json) return out(incidents);
      if (!incidents.length) return console.log('nenhum alerta aberto');
      table([
        ['id', 'gravidade', 'tipo', 'loja', 'aberto', 'estado', 'resumo'],
        ...incidents.map((i) => [
          i.id,
          i.severity,
          i.kind,
          i.tenant ?? 'frota',
          i.openedAt,
          i.resolvedAt ? 'resolvido' : i.ackedAt ? 'reconhecido' : 'aberto',
          i.summary,
        ]),
      ]);
      return;
    }
    default:
      die(FLEET_USAGE, 2);
  }
}

export async function cmdFleet(args: string[]): Promise<never> {
  try {
    await run(args);
    process.exit(process.exitCode ?? 0);
  } catch (e) {
    const sub = args[0];
    const tenant =
      sub && TAKES_TENANT.has(sub)
        ? parseArgs(args.slice(1), SPECS[sub]!).positionals[0]
        : undefined;
    die(await explainError(e, tenant));
  }
}

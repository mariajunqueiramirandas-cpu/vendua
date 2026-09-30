import { control } from './core.ts';
import { die } from './paths.ts';

// `vendua fleet …` — the Control Plane from the terminal (docs/architecture/08 "Fleet operations
// API"): the same /control/v1/fleet routes the CRM's Lojas → frota uses.

export const FLEET_USAGE = `vendua fleet status [--json]
vendua fleet stores [--json]
vendua fleet store <tenant> [--json]
vendua fleet releases [bundle] [--json]
vendua fleet promote <tenant> <release> [--reason "…"] [--force]
vendua fleet rollback <tenant> [--reason "…"]
vendua fleet pin <tenant> [--reason "…"] | unpin <tenant>
vendua fleet bundle <tenant> <bundle>
vendua fleet probe <tenant>
vendua fleet provision --slug s --name "Loja" --plan basic --owner "Nome" --phone 11999990000
                       --email dono@x.com [--lead <lead id>]
vendua fleet provisions [--json]
vendua fleet retry <provisioning id>
vendua fleet incidents [--all] [--json] | ack <id> | resolve <id>`;

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

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`, 2);
  return v;
}

/** full release id from a prefix (as `status` and `stores` print them) within the store's bundle */
async function releaseFor(tenant: string, prefix: string): Promise<string> {
  if (/^[0-9a-f]{20}$/.test(prefix)) return prefix;
  if (!/^[0-9a-f]{4,19}$/.test(prefix)) die(`'${prefix}' is not a release id`, 2);
  const { storefront } = await control<{ storefront: { releases: Release[] } | null }>(
    'GET',
    `/control/v1/fleet/storefronts/${tenant}`,
  );
  const hits = (storefront?.releases ?? []).filter((r) => r.id.startsWith(prefix));
  if (hits.length !== 1)
    die(hits.length ? `'${prefix}' matches ${hits.length} releases` : `no release '${prefix}'`);
  return hits[0]!.id;
}

async function run(args: string[]): Promise<void> {
  const [sub, a1, a2] = args;
  const json = args.includes('--json');
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
      const bundle = a1 && !a1.startsWith('--') ? a1 : undefined;
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
      const release = await releaseFor(a1, a2);
      const reason = flag(args, '--reason');
      return out(
        await control(
          'POST',
          `/control/v1/fleet/storefronts/${a1}/promote`,
          {
            release,
            ...(reason ? { reason } : {}),
            ...(args.includes('--force') ? { force: true } : {}),
          },
          idem(`promote:${a1}`),
        ),
      );
    }
    case 'rollback': {
      if (!a1) die('usage: vendua fleet rollback <tenant>', 2);
      const reason = flag(args, '--reason');
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
      const reason = flag(args, '--reason');
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
      const need = (name: string) =>
        flag(args, name) ?? die(`missing ${name}\n\n${FLEET_USAGE}`, 2);
      const lead = flag(args, '--lead');
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
      }>('GET', `/control/v1/fleet/incidents${args.includes('--all') ? '?all=1' : ''}`);
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
    die((e as Error).message);
  }
}

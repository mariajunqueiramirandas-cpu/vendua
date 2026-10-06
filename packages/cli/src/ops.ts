import { parseOrDie, type FlagSpec } from './args.ts';
import { control, explainError } from './core.ts';
import { die } from './paths.ts';

// `vendua ops <tenant>` — show a store's ring + v.js kill switch
// `vendua ops <tenant> --maintenance "<message>" [--href <url>]` — kill switch on
// `vendua ops <tenant> --normal` — kill switch off
// `vendua ops <tenant> --ring canary|early|stable` / `--demand high|normal`

export const OPS_FLAGS: FlagSpec = {
  bool: ['--normal'],
  value: ['--maintenance', '--href', '--ring', '--demand'],
};

/** The PATCH body the flags ask for; empty when they only ask to read. Dies on a contradiction. */
export function opsBody(args: string[]): { tenant: string; body: Record<string, unknown> } {
  const p = parseOrDie(args, OPS_FLAGS, 'ops');
  const [tenant, extra] = p.positionals;
  if (!tenant) die("usage: vendua ops <tenant> [flags]\nrun 'vendua ops --help' for the flags", 2);
  if (extra !== undefined) die(`unexpected argument '${extra}': ops takes one tenant`, 2);
  const msg = p.get('--maintenance');
  if (msg !== undefined && p.has('--normal'))
    die('--maintenance and --normal contradict each other: pick one', 2);
  if (p.has('--href') && msg === undefined)
    die('--href goes with --maintenance (it is the link on the notice)', 2);
  const body: Record<string, unknown> = {};
  if (msg !== undefined)
    body.loader = {
      state: 'maintenance',
      message: msg,
      ...(p.get('--href') ? { href: p.get('--href') } : {}),
    };
  if (p.has('--normal')) body.loader = { state: 'normal' };
  if (p.get('--ring')) body.ring = p.get('--ring');
  if (p.get('--demand')) body.demand = p.get('--demand');
  return { tenant, body };
}

export async function cmdOps(args: string[]): Promise<never> {
  const { tenant, body } = opsBody(args);
  try {
    const r =
      Object.keys(body).length === 0
        ? await control('GET', `/control/v1/storefronts/${encodeURIComponent(tenant)}/ops`)
        : await control(
            'PATCH',
            `/control/v1/storefronts/${encodeURIComponent(tenant)}/ops`,
            body,
            `ops:${tenant}:${Date.now()}`,
          );
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  } catch (e) {
    die(await explainError(e, tenant));
  }
}

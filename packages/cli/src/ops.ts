import { control } from './core.ts';
import { die } from './paths.ts';

// `vendua ops <tenant>` — show a store's ring + v.js kill switch
// `vendua ops <tenant> --maintenance "<message>" [--href <url>]` — kill switch on
// `vendua ops <tenant> --normal` — kill switch off
// `vendua ops <tenant> --ring canary|early|stable` / `--demand high|normal`

export async function cmdOps(args: string[]): Promise<never> {
  const [tenant] = args;
  if (!tenant || tenant.startsWith('--'))
    die(
      'usage: vendua ops <tenant> [--maintenance "msg" | --normal] [--ring r] [--demand high|normal]',
      2,
    );
  const val = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const body: Record<string, unknown> = {};
  const msg = val('--maintenance');
  if (msg !== undefined)
    body.loader = {
      state: 'maintenance',
      message: msg,
      ...(val('--href') ? { href: val('--href') } : {}),
    };
  if (args.includes('--normal')) body.loader = { state: 'normal' };
  if (val('--ring')) body.ring = val('--ring');
  if (val('--demand')) body.demand = val('--demand');
  try {
    const r =
      Object.keys(body).length === 0
        ? await control('GET', `/control/v1/storefronts/${tenant}/ops`)
        : await control(
            'PATCH',
            `/control/v1/storefronts/${tenant}/ops`,
            body,
            `ops:${tenant}:${Date.now()}`,
          );
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  } catch (e) {
    die((e as Error).message);
  }
}

import type { Runtime } from '../engine/runtime.ts';
import { LANES, type Lane } from '../types.ts';
import type { FakeClock } from './clock.ts';

export interface DriveOpts {
  lanes?: readonly Lane[];
  /** Jump the fake clock to due timers up to this far ahead. Default 0: only what's due now. */
  horizonMs?: number;
  maxPumps?: number;
}

/** Runs every due actor until nothing is due within the horizon, moving the fake clock. */
export async function drive(
  runtime: Runtime<any>,
  clock: FakeClock,
  opts: DriveOpts = {},
): Promise<number> {
  const lanes = opts.lanes ?? LANES;
  const end = clock.now().getTime() + (opts.horizonMs ?? 0);
  let ran = 0;
  for (let i = 0; i < (opts.maxPumps ?? 200); i++) {
    let n = 0;
    for (const lane of lanes) n += await runtime.pump(lane, { limit: 16, perTenantCap: 16 });
    ran += n;
    if (n > 0) continue;
    const next = await runtime.nextDue(lanes);
    if (!next || next.getTime() > end) break;
    clock.set(next);
  }
  return ran;
}

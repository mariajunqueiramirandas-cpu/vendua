import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Slot } from './cache.ts';
import type { Route } from './core.ts';
import { log } from './log.ts';

// What a restart needs to keep serving through a Core outage: host routes, injected states and
// the last-known-good API bodies. Bodies are base64 so the file stays plain JSON.
export interface Snapshot {
  version: 1;
  savedAt: string;
  routes: [string, Slot<Route>][];
  states: [string, Slot<unknown>][];
  api: [string, { body: string; type: string; at: number }][];
}

export function readSnapshot(file: string): Snapshot | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const s = JSON.parse(raw) as Snapshot;
    if (
      s.version !== 1 ||
      !Array.isArray(s.routes) ||
      !Array.isArray(s.states) ||
      !Array.isArray(s.api)
    )
      throw new Error('unexpected shape');
    return s;
  } catch (e) {
    log('warn', 'snapshot ignored', { file, error: (e as Error).message });
    return null;
  }
}

export async function writeSnapshot(file: string, s: Snapshot): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(s));
  await rename(tmp, file);
}

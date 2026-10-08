import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { log } from './log.ts';
import { renderConfig, validateHosts, type RenderOptions } from './render.ts';

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface SyncOptions extends RenderOptions {
  coreUrl: string;
  secret: string;
  /** the Traefik dynamic file this process owns */
  out: string;
  timeoutMs?: number;
  fetchImpl?: FetchImpl;
}

export type TickResult =
  { status: 'written' | 'unchanged'; hosts: number } | { status: 'failed'; error: string };

const MAX_BODY = 4 * 1024 * 1024;

export class SyncError extends Error {}

/** Core's list, or a SyncError: anything short of a whole, well-formed answer counts as a failure,
 *  so a bad fetch never shrinks the file. */
export async function fetchHosts(o: SyncOptions): Promise<unknown[]> {
  const url = `${o.coreUrl.replace(/\/+$/, '')}/sync/v1/custom-hosts`;
  let res: Response;
  let text: string;
  try {
    res = await (o.fetchImpl ?? fetch)(url, {
      headers: { 'x-vendua-sync': o.secret, accept: 'application/json' },
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      redirect: 'manual',
    });
    if (res.status !== 200) throw new SyncError(`core answered ${res.status}`);
    text = await res.text();
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError(`core unreachable: ${(e as Error).message}`);
  }
  if (text.length > MAX_BODY) throw new SyncError('core body too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SyncError('core body is not JSON');
  }
  const b = body as { hosts?: unknown; generatedAt?: unknown } | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.hosts) || typeof b.generatedAt !== 'string')
    throw new SyncError('malformed core body');
  return b.hosts;
}

async function current(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Writes `content` to `file` through `<file>.tmp` + rename, so Traefik never reads half a file
 *  (it only loads .yml/.yaml/.toml, so the .tmp is never picked up). */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, { mode: 0o644 });
  await rename(tmp, file);
}

/** True when Traefik loads `content` and it routes something, or it is comments only. A file
 *  Traefik rejects (an older image wrote `routers: {}`) takes the whole file provider down with
 *  it, Dokploy's redirect-to-https@file included. */
export function isSound(content: string): boolean {
  let doc: unknown;
  try {
    doc = Bun.YAML.parse(content);
  } catch {
    return false;
  }
  if (doc == null) return true;
  const routers = (doc as { http?: { routers?: unknown } }).http?.routers;
  return !!routers && typeof routers === 'object' && Object.keys(routers).length > 0;
}

/** Replaces an unsound file with the empty one. Needs no Core: such a file serves no routes
 *  already, so this loses none, and it runs while Core is down or the secret is unset. */
export async function repair(o: Pick<SyncOptions, 'out'> & RenderOptions): Promise<boolean> {
  const content = await current(o.out);
  if (content === null || isSound(content)) return false;
  try {
    await writeAtomic(o.out, renderConfig([], o));
  } catch (e) {
    log('error', `repair failed: ${(e as Error).message}`, { file: o.out });
    return false;
  }
  log('warn', 'replaced a file Traefik rejects with the empty one', { file: o.out });
  return true;
}

export function createSync(o: SyncOptions) {
  let lastDropped = '';

  return async function tick(): Promise<TickResult> {
    let input: unknown[];
    try {
      input = await fetchHosts(o);
    } catch (e) {
      const error = (e as Error).message;
      log('warn', 'sync failed; keeping the current file', { error });
      await repair(o);
      return { status: 'failed', error };
    }
    const { hosts, dropped } = validateHosts(input, o);
    const key = JSON.stringify(dropped);
    if (key !== lastDropped) {
      lastDropped = key;
      if (dropped.length)
        log('warn', 'hosts dropped', { count: dropped.length, dropped: dropped.slice(0, 50) });
    }
    const content = renderConfig(hosts, o);
    if ((await current(o.out)) === content) return { status: 'unchanged', hosts: hosts.length };
    try {
      await writeAtomic(o.out, content);
    } catch (e) {
      const error = `write failed: ${(e as Error).message}`;
      log('error', error, { file: o.out });
      return { status: 'failed', error };
    }
    log('info', 'routes written', { file: o.out, hosts: hosts.length });
    return { status: 'written', hosts: hosts.length };
  };
}

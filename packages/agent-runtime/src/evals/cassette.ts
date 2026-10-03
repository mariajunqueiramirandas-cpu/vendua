import { createHash } from 'node:crypto';
import { canonical } from '../define/agent.ts';
import type { GenerateOpts, ModelGateway } from '../model/types.ts';
import type { ModelRequest, ModelResponse } from '../types.ts';

/** Model outputs keyed by request hash; a hash seen twice keeps both answers, in order. */
export interface Cassette {
  version: 1;
  entries: Record<string, ModelResponse[]>;
}

export class CassetteMissError extends Error {
  constructor(readonly hash: string) {
    super(`cassette miss: ${hash} (the prompt, tools or transcript changed; record a live run)`);
    this.name = 'CassetteMissError';
  }
}

/** What the model saw, without routing metadata, so ids and turn uuids don't break replays. */
export function requestHash(req: ModelRequest): string {
  return createHash('sha256')
    .update(
      canonical({
        tier: req.tier,
        system: req.system.map((b) => b.text),
        messages: req.messages,
        tools: req.tools,
        volatile: req.volatile,
      }),
    )
    .digest('hex');
}

export function emptyCassette(): Cassette {
  return { version: 1, entries: {} };
}

export interface RecordingGateway extends ModelGateway {
  readonly cassette: Cassette;
}

/** Passes through to `inner` and records every answer (errors aren't recorded). */
export function recordingGateway(
  inner: ModelGateway,
  cassette: Cassette = emptyCassette(),
): RecordingGateway {
  return {
    cassette,
    async generate(req, opts) {
      const res = await inner.generate(req, opts);
      const h = requestHash(req);
      (cassette.entries[h] ??= []).push(structuredClone(res));
      return res;
    },
  };
}

/** Replays a cassette deterministically; a request it never saw throws `CassetteMissError`. */
export function cassetteGateway(cassette: Cassette): ModelGateway {
  const cursor = new Map<string, number>();
  return {
    async generate(req: ModelRequest, opts?: GenerateOpts) {
      const h = requestHash(req);
      const list = cassette.entries[h];
      if (!list?.length) throw new CassetteMissError(h);
      const i = cursor.get(h) ?? 0;
      cursor.set(h, i + 1);
      // past the end, the last answer: a retried identical request gets what it got before
      const res = structuredClone(list[Math.min(i, list.length - 1)]!);
      await opts?.meter?.after(res.usage);
      return res;
    },
  };
}

export async function saveCassette(path: string, cassette: Cassette): Promise<void> {
  await Bun.write(path, JSON.stringify(cassette, null, 2) + '\n');
}

export async function loadCassette(path: string): Promise<Cassette> {
  const c = (await Bun.file(path).json()) as Cassette;
  if (c?.version !== 1 || typeof c.entries !== 'object' || c.entries === null)
    throw new Error(`not a cassette: ${path}`);
  return c;
}

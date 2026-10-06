// Staff calls to Core's control API (the Control Plane stand-in until Phase 4).
//   VENDUA_CORE_ORIGIN (default http://localhost:8787), CONTROL_SECRET (required)

import { suggest } from './args.ts';

export const coreOrigin = () => process.env.VENDUA_CORE_ORIGIN || 'http://localhost:8787';

/** Core answered with a non-2xx; the message keeps the `METHOD /path → status CODE text` shape. */
export class ControlError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function control<T>(
  method: string,
  path: string,
  body?: unknown,
  idemKey?: string,
): Promise<T> {
  const secret = process.env.CONTROL_SECRET;
  if (!secret) throw new Error('CONTROL_SECRET is not set — staff calls to Core need it');
  let res: Response;
  try {
    res = await fetch(`${coreOrigin()}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-vendua-control': secret,
        ...(idemKey ? { 'idempotency-key': idemKey } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(`could not reach Core at ${coreOrigin()}`);
  }
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { code: string; message: string };
  };
  if (!res.ok)
    throw new ControlError(
      `${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim(),
      res.status,
      json.error?.code ?? '',
    );
  return json;
}

const NO_SUCH_STORE = new Set(['TENANT_NOT_FOUND', 'STORE_NOT_FOUND']);

/**
 * What to print for a failed call. A store Core does not know gets the nearest names it does,
 * instead of the bare API error; anything else keeps its own message.
 */
export async function explainError(e: unknown, tenant?: string): Promise<string> {
  if (!(e instanceof ControlError) || !tenant || e.status !== 404 || !NO_SUCH_STORE.has(e.code))
    return (e as Error).message;
  const known = await control<{ storefronts: { slug: string }[] }>(
    'GET',
    '/control/v1/fleet/storefronts',
  )
    .then((r) => r.storefronts.map((s) => s.slug))
    .catch(() => []);
  const near = suggest(tenant, known);
  const maybe = near.length ? ` — did you mean ${near.map((n) => `'${n}'`).join(' or ')}?` : '';
  return `no store '${tenant}'${maybe}\n\`vendua fleet stores\` lists every store Core knows`;
}

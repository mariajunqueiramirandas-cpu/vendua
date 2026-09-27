// Staff calls to Core's control API (the Control Plane stand-in until Phase 4).
//   VENDUA_CORE_ORIGIN (default http://localhost:8787), CONTROL_SECRET (required)

export const coreOrigin = () => process.env.VENDUA_CORE_ORIGIN || 'http://localhost:8787';

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
    throw new Error(
      `${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? ''}`.trim(),
    );
  return json;
}

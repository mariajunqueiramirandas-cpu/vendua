import { isTextType } from './manifest.ts';

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
} as const;

export function acceptsGzip(req: Request): boolean {
  return (req.headers.get('accept-encoding') ?? '').split(',').some((part) => {
    const [name, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith('q='));
    return (name === 'gzip' || name === '*') && (!q || Number(q.slice(2)) > 0);
  });
}

export function shouldGzip(type: string, size: number): boolean {
  return size > 256 && isTextType(type);
}

/** A 200 with `body`, gzipped when the client accepts it and the type is worth compressing. */
export function withGzip(
  body: Uint8Array,
  headers: Headers,
  gzipOk: boolean,
  gzipped?: () => Uint8Array,
): Response {
  const type = headers.get('content-type') ?? '';
  if (isTextType(type)) headers.set('vary', 'accept-encoding');
  const raw = body as Uint8Array<ArrayBuffer>;
  if (gzipOk && shouldGzip(type, body.length)) {
    headers.set('content-encoding', 'gzip');
    return new Response((gzipped ? gzipped() : Bun.gzipSync(raw)) as Uint8Array<ArrayBuffer>, {
      headers,
    });
  }
  return new Response(raw, { headers });
}

/** If-None-Match against a strong ETag (the gzip variant `"<tag>-gz"` counts as the same entity). */
export function etagMatches(req: Request, tag: string): boolean {
  const inm = req.headers.get('if-none-match');
  if (!inm) return false;
  return inm.split(',').some((t) => {
    const v = t.trim().replace(/^W\//, '');
    return v === '*' || v === `"${tag}"` || v === `"${tag}-gz"`;
  });
}

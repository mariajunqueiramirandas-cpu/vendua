// The TLS probe: a fetch only resolves once the TLS handshake succeeded, so any HTTP answer at all
// means the host serves a certificate the runtime trusts.

export function httpsProbe(
  o: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): (host: string) => Promise<boolean> {
  const doFetch = o.fetchImpl ?? fetch;
  const timeoutMs = o.timeoutMs ?? 10_000;
  return async (host) => {
    try {
      const res = await doFetch(`https://${host}/_edge/healthz`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body?.cancel().catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
}

// JSON lines on stdout, like the edge. `info` only for writes, which are rare.
export function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> = {},
) {
  if (process.env.DOMAINS_SYNC_QUIET === '1') return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}

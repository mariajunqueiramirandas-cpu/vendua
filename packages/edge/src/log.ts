// JSON lines on stdout; the edge logs only warnings and errors (access logs would drown them).
export function log(level: 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.VENDUA_EDGE_QUIET === '1') return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
}

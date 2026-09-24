// PR112 T2 probe — fires the same ingestInbound the whatsapp socket callback
// invokes, so the queued-auto-cancel path executes for real.
import { createSql } from './src/platform/db.ts';
import { ingestInbound } from './src/agent/inbound.ts';

const sql = createSql('postgres://vendua_app:vendua_app@localhost:5433/vendua');
const res = await ingestInbound(sql, {
  channel: 'whatsapp',
  from: '+5511988776655',
  body: 'oi, quero saber mais sobre o produto',
  providerMessageId: 'pr112-in-1',
});
console.log(JSON.stringify(res, null, 2));
await sql.end();

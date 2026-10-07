import { controlTx } from '../modules/control.ts';
import { getIntegration } from '../modules/integrations.ts';
import { createSql, type Sql } from '../platform/db.ts';
import { sealAuthValue, type BufferCodec } from '../store-whatsapp/auth-store.ts';
import { VENDUA_SESSION } from './transport.ts';

// One-off, on cutover day (docs/features/dua-no-whatsapp.md §4.4): Venduá's number moves from
// Core's socket to the wa-gateway with the same linked device, no re-pair. Copies the socket's
// login (wa_auth_state, plain jsonb) into platform_wa_auth, sealed as the gateway reads it, and
// asks the gateway to bring the session up.
//
//   bun src/platform-whatsapp/cutover-cli.ts [--force] [--account <id>] [--session <name>]

export interface CrmAuthRow {
  category: string;
  name: string;
  /** jsonb as Core's socket wrote it: the value through baileys' BufferJSON.replacer */
  data: unknown;
}

/** The socket's rows as platform_wa_auth rows (sealed). Throws on a row the table can't hold. */
export function crmAuthRows(
  rows: CrmAuthRow[],
  codec: BufferCodec,
  sealSecret: string,
): { category: string; name: string; data: string }[] {
  return rows.map((r) => {
    if (r.category.length > 40 || r.name.length > 200)
      throw new Error(`auth row too long to copy: ${r.category}/${r.name.slice(0, 40)}`);
    const value = JSON.parse(JSON.stringify(r.data), codec.reviver);
    const data = sealAuthValue(value, codec, sealSecret);
    if (Buffer.byteLength(data) > 256 * 1024)
      throw new Error(`auth row too big to copy: ${r.category}/${r.name.slice(0, 40)}`);
    return { category: r.category, name: r.name, data };
  });
}

export async function cutover(
  sql: Sql,
  o: { accountId: string; session: string; codec: BufferCodec; sealSecret: string; force: boolean },
): Promise<{ copied: number }> {
  const rows = await controlTx(
    sql,
    (tx) => tx<CrmAuthRow[]>`
      select category, name, data from wa_auth_state where account_id = ${o.accountId}`,
  );
  const creds = rows.find((r) => r.category === 'creds' && r.name === 'main')?.data as
    { registered?: boolean; account?: unknown } | undefined;
  if (!creds) throw new Error(`no login in wa_auth_state for account '${o.accountId}'`);
  if (!creds.registered && !creds.account)
    throw new Error('the socket login was never confirmed — pair on the gateway instead');
  const sealed = crmAuthRows(rows, o.codec, o.sealSecret);
  await controlTx(sql, async (tx) => {
    const s = (
      await tx<{ held: boolean }[]>`
        select owner is not null and lease_until > now() as held
        from platform_wa_sessions where name = ${o.session} for update`
    )[0];
    if (!s) throw new Error(`no platform_wa_sessions row '${o.session}'`);
    if (s.held)
      throw new Error(
        'a gateway holds this session — set wanted = false and wait for its lease to go',
      );
    const has = await tx`
      select 1 from platform_wa_auth where session = ${o.session} and category = 'creds' and name = 'main'`;
    if (has.length && !o.force)
      throw new Error(
        'platform_wa_auth already has a login for this session (--force replaces it)',
      );
    await tx`delete from platform_wa_auth where session = ${o.session}`;
    for (let i = 0; i < sealed.length; i += 500) {
      const batch = sealed.slice(i, i + 500).map((r) => ({ session: o.session, ...r }));
      await tx`insert into platform_wa_auth ${tx(batch as never, 'session', 'category', 'name', 'data')}`;
    }
    await tx`
      update platform_wa_sessions set wanted = true, state = 'connecting', detail = null,
        pair_code = null, pair_code_expires_at = null, pair_requested_at = null,
        wipe_requested_at = null, state_changed_at = now(), updated_at = now()
      where name = ${o.session}`;
  });
  return { copied: sealed.length };
}

const CHECKLIST = `
Cutover checklist:
  1. Core's socket must already be stopped (whatsapp integration driver off, or Core down) —
     two devices on one login knock each other off.
  2. Set WA_PLATFORM_TRANSPORT=gateway on Core and restart it.
  3. Watch platform_wa_sessions: owner/lease_until set by a gateway, state 'open'.
  4. Send yourself a sign-in code and check it arrives (platform_wa_outbox status 'sent').
  Rollback is a re-pair, not a flag flip: once the gateway writes new keys the old rows are stale.
`;

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const sealSecret = process.env.SESSION_SECRET;
  if (!sealSecret) {
    console.error('SESSION_SECRET unset — the gateway could not open what this writes');
    process.exit(1);
  }
  const sql = createSql(
    process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua',
  );
  try {
    const integration = await getIntegration(sql, 'whatsapp');
    const accountId =
      arg('--account') ?? (integration?.config.accountId as string | undefined) ?? 'default';
    const { BufferJSON } = (await import('baileys')) as unknown as { BufferJSON: BufferCodec };
    const r = await cutover(sql, {
      accountId,
      session: arg('--session') ?? VENDUA_SESSION,
      codec: BufferJSON,
      sealSecret,
      force: args.includes('--force'),
    });
    console.log(`copied ${r.copied} auth rows from account '${accountId}'; session wanted.`);
    console.log(CHECKLIST);
  } catch (e) {
    console.error(`cutover refused: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

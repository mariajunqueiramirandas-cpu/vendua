import { withTenant, type Sql } from '../platform/db.ts';
import { seal, unseal } from '../platform/secrets.ts';

// A store's WhatsApp login (Signal creds, pre-keys, sessions) — as strong as the merchant's own
// phone, so every row is sealed. Writes are fenced on the lease: only the gateway holding this
// store's current lease epoch may change them, so a process that lost the lease mid-flight can't
// corrupt the session the new owner is running.

export class LeaseLost extends Error {
  constructor(tenantId: string) {
    super(`whatsapp lease lost for ${tenantId}`);
  }
}

export interface BufferCodec {
  replacer(k: string, v: unknown): unknown;
  reviver(k: string, v: unknown): unknown;
}

export interface Fence {
  owner: string;
  epoch: number;
}

export interface AuthStore {
  read(category: string, name: string): Promise<unknown>;
  readMany(category: string, names: string[]): Promise<Record<string, unknown>>;
  /** null values delete; one transaction, fenced */
  writeMany(entries: { category: string; name: string; value: unknown }[]): Promise<void>;
  hasCreds(): Promise<boolean>;
}

export function authStore(
  sql: Sql,
  tenantId: string,
  fence: Fence,
  codec: BufferCodec,
  sealSecret: string,
): AuthStore {
  const decode = (box: unknown) => {
    let parsed: unknown = null;
    try {
      parsed = typeof box === 'string' ? JSON.parse(box) : null;
    } catch {
      return null;
    }
    const plain = unseal(parsed, sealSecret);
    // a box we can't open (rotated key) reads as missing: the session re-pairs instead of crashing
    return plain == null ? null : JSON.parse(plain, codec.reviver);
  };
  const readMany = async (category: string, names: string[]) => {
    const out: Record<string, unknown> = {};
    if (names.length === 0) return out;
    const rows = await withTenant(
      sql,
      tenantId,
      (tx) => tx<{ name: string; data: unknown }[]>`
        select name, data from store_wa_auth
        where tenant_id = ${tenantId} and category = ${category} and name = any(${names})`,
    );
    for (const r of rows) {
      const v = decode(r.data);
      if (v != null) out[r.name] = v;
    }
    return out;
  };
  return {
    read: async (category, name) => (await readMany(category, [name]))[name] ?? null,
    readMany,
    writeMany: async (entries) => {
      if (entries.length === 0) return;
      await withTenant(sql, tenantId, async (tx) => {
        // FOR SHARE holds off a lease steal (an UPDATE of this row) until this commits
        const held = await tx`
          select 1 from store_whatsapp
          where tenant_id = ${tenantId} and owner = ${fence.owner} and lease_epoch = ${fence.epoch}
            and lease_until > now()
          for share`;
        if (held.length === 0) throw new LeaseLost(tenantId);
        const dels = entries.filter((e) => e.value == null);
        const puts = entries.filter((e) => e.value != null);
        for (const d of dels)
          await tx`delete from store_wa_auth
            where tenant_id = ${tenantId} and category = ${d.category} and name = ${d.name}`;
        if (puts.length) {
          const rows = puts.map((p) => ({
            tenant_id: tenantId,
            category: p.category,
            name: p.name,
            data: JSON.stringify(seal(JSON.stringify(p.value, codec.replacer), sealSecret)),
          }));
          await tx`
            insert into store_wa_auth ${tx(rows as never, 'tenant_id', 'category', 'name', 'data')}
            on conflict (tenant_id, category, name) do update set data = excluded.data, updated_at = now()`;
        }
      });
    },
    hasCreds: async () => {
      const rows = await withTenant(
        sql,
        tenantId,
        (tx) => tx`select 1 from store_wa_auth
          where tenant_id = ${tenantId} and category = 'creds' and name = 'main'`,
      );
      return rows.length > 0;
    },
  };
}

/** Forget a store's WhatsApp login entirely (logout, re-pair from scratch). Not fenced: it is
 *  only called by the lease holder or by Core when no gateway is alive to do it. */
export async function wipeAuth(tx: Sql, tenantId: string): Promise<void> {
  await tx`delete from store_wa_auth where tenant_id = ${tenantId}`;
}

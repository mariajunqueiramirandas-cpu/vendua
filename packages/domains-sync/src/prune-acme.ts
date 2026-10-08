// One-off, run by hand: drops the per-host certificates of `<slug>.<VENDUA_STORE_DOMAIN>` that a
// resolver other than the wildcard's still keeps in Dokploy's acme.json. Traefik serves an exact
// SNI match before a wildcard and loads every stored certificate whether or not a router still
// asks for it, so those leftovers hide the `*.<store domain>` certificate until removed.
//
//   docker exec <domains-sync container> bun src/prune-acme.ts            # dry run
//   docker exec <domains-sync container> bun src/prune-acme.ts --write    # then restart Traefik
import { chmod, readFile, rename, writeFile } from 'node:fs/promises';

interface AcmeCert {
  domain?: { main?: string; sans?: string[] };
  [k: string]: unknown;
}
type Acme = Record<string, { Certificates?: AcmeCert[] | null; [k: string]: unknown } | null>;

export interface PruneOptions {
  storeDomain: string;
  /** platform hosts under the store domain (painel., crm.): their routers ask for them again */
  deny: readonly string[];
  /** resolvers left alone: the wildcard's own */
  keepResolvers: readonly string[];
}

/** `acme` without the certificates whose every name is one label under the store domain, plus
 *  those names. Certificate and key fields are passed through untouched, never read. */
export function pruneAcme(acme: Acme, o: PruneOptions): { next: Acme; removed: string[] } {
  const store = o.storeDomain.trim().toLowerCase();
  const deny = new Set(o.deny.map((h) => h.trim().toLowerCase()).filter(Boolean));
  const under = new RegExp(`^[a-z0-9-]+\\.${store.replaceAll('.', '\\.')}$`);
  const covered = (name: string) => under.test(name) && !deny.has(name);
  const next: Acme = {};
  const removed: string[] = [];
  for (const [resolver, data] of Object.entries(acme)) {
    if (!data || !Array.isArray(data.Certificates) || o.keepResolvers.includes(resolver)) {
      next[resolver] = data;
      continue;
    }
    const kept = data.Certificates.filter((c) => {
      const names = [c.domain?.main ?? '', ...(c.domain?.sans ?? [])].map((n) => n.toLowerCase());
      if (!names.every(covered)) return true;
      removed.push(`${resolver}: ${names.join(', ')}`);
      return false;
    });
    next[resolver] = { ...data, Certificates: kept };
  }
  return { next, removed };
}

if (import.meta.main) {
  const env = process.env;
  const file = env.ACME_FILE || '/traefik-dynamic/acme.json';
  const write = process.argv.includes('--write');
  const raw = await readFile(file, 'utf8');
  const { next, removed } = pruneAcme(JSON.parse(raw) as Acme, {
    storeDomain: env.VENDUA_STORE_DOMAIN || 'vendua.com.br',
    deny: (env.DOMAINS_SYNC_DENY ?? '').split(','),
    keepResolvers: (env.ACME_KEEP_RESOLVERS || 'cloudflare').split(','),
  });
  for (const r of removed) console.log(`${write ? 'removed' : 'would remove'} ${r}`);
  if (!removed.length) console.log(`nothing to remove in ${file}`);
  else if (!write) console.log('dry run: pass --write to apply');
  else {
    // Traefik refuses an acme.json readable by others: keep 0600 on the backup and the new file
    const backup = `${file}.bak-${new Date().toISOString().replaceAll(':', '-')}`;
    await writeFile(backup, raw, { mode: 0o600 });
    await writeFile(`${file}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await chmod(`${file}.tmp`, 0o600);
    await rename(`${file}.tmp`, file);
    console.log(`backup at ${backup}; restart Traefik now so it reloads ${file}`);
  }
}

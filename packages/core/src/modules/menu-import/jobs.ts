// The import loop (docs/menu-import.md §4.4 steps 2, 5, 6), shaped like startFleetJobs: claims
// work across stores under vendua.control with leases (replica-safe, crash-safe), does each piece
// under the row's tenant. The raw platform payload never leaves `readImport`.

import { withTenant, type Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { emitAdminTx } from '../../admin/live.ts';
import { controlTx } from '../control.ts';
import { ADAPTERS, adapterFor } from './adapters/index.ts';
import { TooLarge, validateDoc } from './doc.ts';
import { createImportHttp, ImportFailure, LIMITS, type FailCode } from './http.ts';
import { IMAGE_ATTEMPTS, runImageJob, type ImageJob } from './images.ts';

const importLog = log.child({ mod: 'menu-import' });

const TICK_MS = 3_000;
// a read must end before its lease does, or a second worker reclaims the row mid-read
const READ_LEASE = `${Math.max(LIMITS.importMs, ...ADAPTERS.map((a) => a.limits?.importMs ?? 0)) / 1000 + 30} seconds`;
const IMAGE_LEASE = '2 minutes';
const READ_ATTEMPTS = 3;
const PER_PLATFORM = 2;
const IMAGES_AT_ONCE = 4;

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ImportJobDeps {
  sql: Sql;
  /** tests point this at a fixture server */
  fetch?: Fetch;
}

interface Claimed {
  id: string;
  tenant_id: string;
  platform: string;
  source_url: string;
  source_ref: string;
  attempts: number;
}

/** One `reading` row, leased; at most PER_PLATFORM leases per platform at a time. */
async function claimRead(sql: Sql): Promise<Claimed | null> {
  return controlTx(sql, async (tx) => {
    const rows = await tx<Claimed[]>`
      update menu_imports set lease_until = now() + ${READ_LEASE}::interval, attempts = attempts + 1
      where id = (
        select m.id from menu_imports m
        where m.status = 'reading' and (m.lease_until is null or m.lease_until < now())
          and (
            select count(*) from menu_imports o
            where o.platform = m.platform and o.status = 'reading' and o.lease_until > now()
          ) < ${PER_PLATFORM}
        order by m.created_at
        limit 1
        for update skip locked
      )
      returning id, tenant_id, platform, source_url, source_ref, attempts
    `;
    return rows[0] ?? null;
  });
}

async function fail(sql: Sql, row: Claimed, code: FailCode) {
  await withTenant(sql, row.tenant_id, async (tx) => {
    await tx`
      update menu_imports set status = 'failed', error_code = ${code}, lease_until = null, read_at = now()
      where id = ${row.id} and tenant_id = ${row.tenant_id} and status = 'reading'
    `;
    await emitAdminTx(tx, row.tenant_id, 'import', row.id);
  });
}

/** read → map → validateDoc; stores only the validated document. */
export async function readImport(d: ImportJobDeps, row: Claimed): Promise<void> {
  const adapter = adapterFor(row.platform);
  if (!adapter) return fail(d.sql, row, 'UNREADABLE');
  const started = Date.now();
  try {
    const http = createImportHttp({
      hosts: adapter.hosts.api,
      ...(adapter.limits ? { limits: adapter.limits } : {}),
      ...(d.fetch ? { fetch: d.fetch } : {}),
    });
    const raw = await adapter.read(row.source_ref, http);
    const { doc, counts } = validateDoc(
      adapter.map(raw, {
        platform: adapter.platform,
        url: row.source_url,
        ref: row.source_ref,
        readAt: new Date().toISOString(),
      }),
    );
    await withTenant(d.sql, row.tenant_id, async (tx) => {
      await tx`
        update menu_imports set status = 'ready', doc = ${tx.json(doc as never)}, counts = ${tx.json(counts as never)},
          lease_until = null, read_at = now()
        where id = ${row.id} and tenant_id = ${row.tenant_id} and status = 'reading'
      `;
      await emitAdminTx(tx, row.tenant_id, 'import', row.id);
    });
    importLog.info(
      {
        import: row.id,
        platform: row.platform,
        ms: Date.now() - started,
        products: counts.products,
        requests: http.used,
      },
      'menu read',
    );
  } catch (err) {
    if (err instanceof ImportFailure || err instanceof TooLarge) {
      const code: FailCode = err instanceof TooLarge ? 'TOO_LARGE' : err.code;
      importLog.warn(
        { import: row.id, platform: row.platform, code, reason: err.message },
        'menu read failed',
      );
      return fail(d.sql, row, code);
    }
    // a bug or a platform shape we don't know: never log the payload, only the error
    importLog.error({ err, import: row.id, platform: row.platform }, 'menu read crashed');
    if (row.attempts >= READ_ATTEMPTS) await fail(d.sql, row, 'UNREADABLE');
  }
}

async function claimImages(sql: Sql, n: number): Promise<ImageJob[]> {
  return controlTx(
    sql,
    (tx) => tx<ImageJob[]>`
      update menu_import_images set lease_until = now() + ${IMAGE_LEASE}::interval, attempts = attempts + 1
      where id in (
        select id from menu_import_images
        where status = 'pending' and (lease_until is null or lease_until < now())
        -- the store's face first: a logo behind 200 photos would land minutes late
        order by (kind in ('logo', 'cover')) desc, created_at, sort
        limit ${n}
        for update skip locked
      )
      returning id, tenant_id, import_id, kind, product_id, modifier_id, sort, subject, source_url,
        replaces, attempts
    `,
  );
}

/** Ready imports older than a day lose their (stale-priced) document; stuck reads give up. */
export async function sweepImports(sql: Sql): Promise<void> {
  const touched = await controlTx(sql, async (tx) => {
    const expired = await tx<{ id: string; tenant_id: string }[]>`
      update menu_imports set status = 'expired', doc = null
      where status = 'ready' and read_at < now() - interval '24 hours'
      returning id, tenant_id
    `;
    const stuck = await tx<{ id: string; tenant_id: string }[]>`
      update menu_imports set status = 'failed', error_code = 'TIMEOUT', lease_until = null
      where status = 'reading' and attempts >= ${READ_ATTEMPTS} and lease_until < now()
      returning id, tenant_id
    `;
    // images that kept failing transiently: give up so the import can finish
    await tx`
      update menu_import_images set status = 'failed', error = 'gave up after retries', lease_until = null
      where status = 'pending' and attempts >= ${IMAGE_ATTEMPTS} and lease_until < now()
    `;
    const finished = await tx<{ id: string; tenant_id: string }[]>`
      update menu_imports m set
        images_done = (select count(*) from menu_import_images i where i.import_id = m.id and i.status <> 'pending'),
        finished_at = now()
      where m.status = 'applied' and m.finished_at is null and m.images_total > 0
        and not exists (select 1 from menu_import_images i where i.import_id = m.id and i.status = 'pending')
      returning id, tenant_id
    `;
    return [...expired, ...stuck, ...finished];
  });
  for (const r of touched)
    await withTenant(sql, r.tenant_id, (tx) => emitAdminTx(tx, r.tenant_id, 'import', r.id));
}

/** Reads waiting imports, one at a time. */
const MAX_READS = PER_PLATFORM * 4;

/** Claims what it can and runs those reads side by side; resolves when they have all ended. */
export async function runReads(d: ImportJobDeps): Promise<void> {
  const reads: Promise<void>[] = [];
  for (let i = 0; i < MAX_READS; i++) {
    const row = await claimRead(d.sql);
    if (!row) break;
    reads.push(readImport(d, row));
  }
  await Promise.all(reads);
}

/** Drains the image queue, IMAGES_AT_ONCE at a time (http.ts paces each host). */
export async function runImages(d: ImportJobDeps): Promise<void> {
  for (;;) {
    const jobs = await claimImages(d.sql, IMAGES_AT_ONCE);
    if (!jobs.length) break;
    await Promise.all(
      jobs.map((j) =>
        runImageJob(d.sql, j, d.fetch).catch((err) =>
          importLog.warn({ err, image: j.id }, 'import image failed'),
        ),
      ),
    );
  }
}

export async function runImportTick(d: ImportJobDeps): Promise<void> {
  await runReads(d);
  await runImages(d);
}

let wake: (() => void) | null = null;

/** After a POST commits: start the read (or the photos) now instead of on the next tick. */
export function kickImports() {
  wake?.();
}

/** A loop that never overlaps itself; a kick while it runs makes it go round once more. */
function loop(name: string, work: () => Promise<void>) {
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await work();
      } while (again);
    } catch (err) {
      importLog.error({ err }, `import ${name} loop failed`);
    } finally {
      running = false;
    }
  };
  return run;
}

export function startMenuImportJobs(d: ImportJobDeps): () => void {
  let lastSweep = 0;
  let reading = 0;
  let stopped = false;
  // reads never wait behind a long photo queue, nor behind each other: a Goomer read asks
  // for every product and can take minutes
  const reads = loop('read', async () => {
    if (Date.now() - lastSweep > 60_000) {
      lastSweep = Date.now();
      await sweepImports(d.sql);
    }
    while (!stopped && reading < MAX_READS) {
      const row = await claimRead(d.sql);
      if (!row) break;
      reading++;
      void readImport(d, row)
        .catch((err) => importLog.error({ err, import: row.id }, 'menu read failed to settle'))
        .finally(() => {
          reading--;
          // after shutdown a read that ends claims nothing more
          if (!stopped) tick();
        });
    }
  });
  const images = loop('images', () => runImages(d));
  const tick = () => {
    void reads();
    void images();
  };
  wake = tick;
  const first = setTimeout(tick, 4_000);
  const every = setInterval(tick, TICK_MS);
  return () => {
    stopped = true;
    wake = null;
    clearTimeout(first);
    clearInterval(every);
  };
}

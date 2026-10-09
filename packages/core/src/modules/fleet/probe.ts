import { controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { scoped, type FleetDeps } from './deps.ts';
import {
  failDeploymentTx,
  lockOpsTx,
  markVerifiedTx,
  pendingTx,
  VERIFY_FAILURES,
  VERIFY_TIMEOUT_MS,
  type DeploymentRow,
} from './deploy.ts';
import { fleetLog, openIncidentTx, resolveIncidentTx } from './incidents.ts';

// Synthetic probes per live hostname (docs/architecture/16 "Health model"): the page with its
// injected state, the loader, the state API and a checkout session. The page's
// x-vendua-release header is how a pending deployment is verified.

export interface ProbeCheck {
  id: 'page' | 'loader' | 'state' | 'checkout';
  ok: boolean;
  detail?: string;
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  release: string | null;
  checks: ProbeCheck[];
  checkoutToken: string | null;
}

export interface ProbeRow {
  host: string;
  tenant_id: string;
  status: 'unknown' | 'ok' | 'failing';
  failures: number;
  failing_since: Date | null;
  last_checked_at: Date | null;
  last_ok_at: Date | null;
  last_error: string | null;
  last_release_id: string | null;
  latency_ms: number | null;
  checkout_token: string | null;
}

const TIMEOUT_MS = 10_000;
const INTERVAL_MS = 60_000;
/** a store whose deployment waits on verification is probed this often */
const PENDING_INTERVAL_MS = 15_000;
/** failures in a row that open an incident — one blip is not an incident */
const INCIDENT_AFTER = 3;
/** a probe failing this long is critical */
const CRITICAL_AFTER_MS = 10 * 60_000;
const BATCH = 50;
const CONCURRENCY = 8;

const short = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);

export async function probeHost(
  d: FleetDeps,
  host: string,
  checkoutToken: string | null,
): Promise<ProbeResult> {
  const base = d.probeOrigin ?? `https://${host}`;
  const req = (path: string, init: RequestInit = {}) =>
    d.fetch(`${base}${path}`, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'vendua-probe/1',
        ...(d.probeOrigin ? { host } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  const fail = (id: ProbeCheck['id'], e: unknown): ProbeCheck => ({
    id,
    ok: false,
    detail: short(e instanceof Error ? e.message : String(e)),
  });

  const started = performance.now();
  let release: string | null = null;
  let latencyMs = 0;
  const page = req('/')
    .then(async (res): Promise<ProbeCheck> => {
      latencyMs = Math.round(performance.now() - started);
      release = res.headers.get('x-vendua-release');
      const html = await res.text();
      if (res.status !== 200) return { id: 'page', ok: false, detail: `HTTP ${res.status}` };
      if (!html.includes('id="vendua-state"'))
        return { id: 'page', ok: false, detail: 'a página veio sem o vendua-state' };
      if (!release) return { id: 'page', ok: false, detail: 'sem o cabeçalho x-vendua-release' };
      return { id: 'page', ok: true };
    })
    .catch((e) => fail('page', e));
  const loader = req('/v1/v.js')
    .then(async (res): Promise<ProbeCheck> => {
      const js = await res.text();
      if (res.status !== 200) return { id: 'loader', ok: false, detail: `HTTP ${res.status}` };
      return js.includes('__VENDUA_LOADER__')
        ? { id: 'loader', ok: true }
        : { id: 'loader', ok: false, detail: 'o v.js não expõe __VENDUA_LOADER__' };
    })
    .catch((e) => fail('loader', e));
  const state = req('/storefront/v1/state')
    .then(async (res): Promise<ProbeCheck> => {
      if (res.status !== 200) return { id: 'state', ok: false, detail: `HTTP ${res.status}` };
      const j = (await res.json()) as { store?: { status?: unknown } };
      return typeof j.store?.status === 'string'
        ? { id: 'state', ok: true }
        : { id: 'state', ok: false, detail: 'estado sem store.status' };
    })
    .catch((e) => fail('state', e));
  let token = checkoutToken;
  // re-attaching the probe's own cart reads the checkout path without writing a new cart
  const checkout = req('/checkout/v1/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': `probe-${crypto.randomUUID()}`,
      ...(checkoutToken ? { authorization: `Bearer ${checkoutToken}` } : {}),
    },
    body: '{}',
  })
    .then(async (res): Promise<ProbeCheck> => {
      if (res.status !== 200 && res.status !== 201)
        return { id: 'checkout', ok: false, detail: `HTTP ${res.status}` };
      const j = (await res.json()) as { sessionToken?: unknown };
      if (typeof j.sessionToken !== 'string' || j.sessionToken.length > 600)
        return { id: 'checkout', ok: false, detail: 'sessão sem token' };
      token = j.sessionToken;
      return { id: 'checkout', ok: true };
    })
    .catch((e) => fail('checkout', e));

  const checks = await Promise.all([page, loader, state, checkout]);
  return {
    ok: checks.every((c) => c.ok),
    latencyMs,
    release,
    checks,
    checkoutToken: token,
  };
}

/** Hosts worth probing: every domain of an active store with a release live. Without a probe
 *  origin only public hosts (dev pins like localhost:5174 have no https). A suspended store
 *  answers 423 by design, so it leaves the rotation instead of paging anyone. */
async function syncTargets(d: FleetDeps) {
  await controlTx(d.sql, async (tx) => {
    await tx`
      delete from fleet_probes p using storefront_ops o, tenants t
      where o.tenant_id = p.tenant_id and t.id = p.tenant_id
        and (o.live_release_id is null or t.status <> 'active') ${scoped(tx, d, 'p.tenant_id')}
    `;
    await tx`
      insert into fleet_probes (host, tenant_id)
      select dm.host, dm.tenant_id from domains dm
        join storefront_ops o on o.tenant_id = dm.tenant_id
        join tenants t on t.id = dm.tenant_id
      where o.live_release_id is not null and t.status = 'active'
        and (${d.probeOrigin !== null}
             or (dm.host !~ '(^|\\.)localhost(:|$)' and dm.host !~ '^127\\.'
                 and position(':' in dm.host) = 0))
        ${scoped(tx, d, 'dm.tenant_id')}
      on conflict (host) do nothing
    `;
  });
}

/** One probe's outcome: the probe row, history on failures and recoveries, verification of a
 *  pending deployment, incidents (each records its own staff event). */
async function recordTx(
  d: FleetDeps,
  row: ProbeRow,
  r: ProbeResult,
  degraded: boolean,
): Promise<{ changed: boolean }> {
  return controlTx(d.sql, async (tx) => {
    const now = d.now();
    const failures = r.ok ? 0 : row.failures + 1;
    const failingSince = r.ok ? null : (row.failing_since ?? now);
    const status = r.ok ? 'ok' : failures >= INCIDENT_AFTER ? 'failing' : row.status;
    const error = r.ok
      ? null
      : r.checks
          .filter((c) => !c.ok)
          .map((c) => `${c.id}: ${c.detail ?? 'falhou'}`)
          .join('; ')
          .slice(0, 300);
    const recovered = r.ok && row.status === 'failing';
    if (!r.ok || recovered)
      await tx`
        insert into health_checks (tenant_id, host, at, ok, latency_ms, release_id, checks)
        values (${row.tenant_id}, ${row.host}, ${now}, ${r.ok}, ${r.latencyMs}, ${r.release},
                ${tx.json(r.checks as never)})
      `;
    // A deployment is judged only on its own release's page: the loader, state and checkout
    // checks are Core's, and a probe of the old release (the edge's cache) says nothing about it.
    let pending: DeploymentRow | null = await pendingTx(tx, row.tenant_id);
    const page = r.checks.find((c) => c.id === 'page');
    if (pending && r.release === pending.release_id && page?.ok) {
      await markVerifiedTx(tx, row.tenant_id, r.release);
      pending = null;
    } else if (pending && r.release === pending.release_id && !page?.ok && !degraded) {
      const pageFailures = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from health_checks
          where host = ${row.host} and release_id = ${pending.release_id}
            and at >= ${pending.started_at}
            and checks @> ${tx.json([{ id: 'page', ok: false }] as never)}
        `
      )[0]!.n;
      if (pageFailures >= VERIFY_FAILURES) {
        await failDeploymentTx(tx, d, pending, error ?? 'a página falhou');
        pending = await pendingTx(tx, row.tenant_id);
      }
    }
    // a pending store is probed every tick, so a faster loop verifies faster
    const pendingEvery = Math.min(PENDING_INTERVAL_MS, d.tickMs ?? PENDING_INTERVAL_MS);
    await tx`
      update fleet_probes set status = ${status}, failures = ${failures},
        failing_since = ${failingSince}, last_checked_at = ${now},
        last_ok_at = ${r.ok ? now : row.last_ok_at}, last_error = ${error},
        last_release_id = ${r.release}, latency_ms = ${r.latencyMs},
        checkout_token = ${r.checkoutToken},
        next_check_at = ${new Date(now.getTime() + (pending ? pendingEvery : INTERVAL_MS))},
        lease_until = null
      where host = ${row.host}
    `;
    if (!r.ok && failures >= INCIDENT_AFTER) {
      const critical = now.getTime() - failingSince!.getTime() >= CRITICAL_AFTER_MS;
      await openIncidentTx(tx, {
        tenantId: row.tenant_id,
        kind: 'probe_failing',
        subject: row.host,
        severity: critical ? 'critical' : 'warning',
        summary: `${row.host} não passa na sonda (${error})`,
        detail: { checks: r.checks },
      });
    }
    if (recovered)
      await resolveIncidentTx(tx, 'probe_failing', row.host, 'a sonda voltou a passar');
    return {
      changed: status !== row.status || r.release !== row.last_release_id || !r.ok,
    };
  });
}

/** Half the fleet failing at once is the edge or Core, not N stores: one fleet incident, and
 *  per-store alerts and automatic rollbacks hold off until it clears. Only hosts probed in the
 *  last few minutes count — a row nobody probes anymore says nothing about now. */
async function fleetDegraded(d: FleetDeps): Promise<{ degraded: boolean; changed: boolean }> {
  return controlTx(d.sql, async (tx) => {
    const { total, failing } = (
      await tx<{ total: number; failing: number }[]>`
        select count(*)::int as total, count(*) filter (where status = 'failing')::int as failing
        from fleet_probes where last_checked_at > now() - interval '3 minutes'
          ${scoped(tx, d, 'tenant_id')}
      `
    )[0]!;
    const degraded = total >= 3 && failing * 2 >= total;
    if (degraded) {
      const row = await openIncidentTx(tx, {
        tenantId: null,
        kind: 'fleet_degraded',
        subject: 'fleet',
        severity: 'critical',
        summary: `${failing} de ${total} endereços falhando na sonda — edge ou Core fora?`,
      });
      return { degraded, changed: row !== null };
    }
    const row = await resolveIncidentTx(tx, 'fleet_degraded', 'fleet', 'a frota voltou');
    return { degraded, changed: row !== null };
  });
}

async function pool<T>(items: T[], n: number, work: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await work(items[i++]!);
    }),
  );
}

async function probeRows(d: FleetDeps, rows: ProbeRow[], degraded: boolean) {
  let changed = false;
  await pool(rows, CONCURRENCY, async (row) => {
    try {
      const r = await probeHost(d, row.host, row.checkout_token);
      changed = (await recordTx(d, row, r, degraded)).changed || changed;
    } catch (err) {
      fleetLog.warn({ err, host: row.host }, 'probe record failed');
    }
  });
  return changed;
}

/** Pending deployments nobody verified in time fail (and roll back) — each in its own
 *  transaction, so one that can't be settled never holds up the rest. */
async function expirePending(d: FleetDeps, degraded: boolean): Promise<boolean> {
  if (degraded) return false;
  const cutoff = new Date(d.now().getTime() - VERIFY_TIMEOUT_MS);
  const stale = await controlTx(
    d.sql,
    (tx) => tx<{ id: string; tenant_id: string }[]>`
      select id, tenant_id from deployments where status = 'pending' and started_at < ${cutoff}
        ${scoped(tx, d, 'tenant_id')}
      order by started_at limit 20
    `,
  );
  for (const { id, tenant_id } of stale) {
    try {
      await controlTx(d.sql, async (tx) => {
        await lockOpsTx(tx, tenant_id);
        const dep = (
          await tx<DeploymentRow[]>`
            select * from deployments where id = ${id} and status = 'pending'
          `
        )[0];
        if (dep)
          await failDeploymentTx(tx, d, dep, 'nenhuma sonda viu esta versão no ar em 5 minutos');
      });
    } catch (err) {
      fleetLog.warn({ err, deployment: id }, 'expiring a deployment failed');
    }
  }
  return stale.length > 0;
}

/** One pass of the probe loop: sync targets, probe what's due, expire unverified deployments. */
export async function runProbes(d: FleetDeps): Promise<{ probed: number }> {
  if (!d.probes) return { probed: 0 };
  await syncTargets(d);
  const rows = await controlTx(
    d.sql,
    (tx) => tx<ProbeRow[]>`
      update fleet_probes set lease_until = now() + interval '90 seconds'
      where host in (
        select host from fleet_probes
        where next_check_at <= now() and (lease_until is null or lease_until < now())
          ${scoped(d.sql, d, 'tenant_id')}
        order by next_check_at limit ${BATCH}
        for update skip locked
      )
      returning *
    `,
  );
  const before = await fleetDegraded(d);
  let changed = await probeRows(d, rows, before.degraded);
  const after = await fleetDegraded(d);
  changed = (await expirePending(d, after.degraded)) || changed;
  if (changed || before.changed || after.changed) emitControlEvent('fleet.change');
  return { probed: rows.length };
}

/** "verificar agora": probes every host of one store right away. */
export async function probeStoreNow(d: FleetDeps, tenantId: string) {
  await syncTargets(d);
  const rows = await controlTx(
    d.sql,
    (tx) => tx<ProbeRow[]>`select * from fleet_probes where tenant_id = ${tenantId} order by host`,
  );
  const { degraded } = await fleetDegraded(d);
  const results: { host: string; result: ProbeResult }[] = [];
  for (const row of rows) {
    const result = await probeHost(d, row.host, row.checkout_token);
    await recordTx(d, row, result, degraded);
    results.push({ host: row.host, result });
  }
  emitControlEvent('fleet.change', tenantId);
  return results;
}

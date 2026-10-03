import type { Context, Hono } from 'hono';
import { claimControl, controlTx } from '../modules/control.ts';
import { HttpError } from '../platform/http.ts';
import type { Sql } from '../platform/db.ts';
import { setStage, STAGES, type Stage } from './versions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^v_[0-9a-f]{20}$/;
const AGENT = /^[a-z][a-z0-9_-]{0,40}$/;

function uuid(v: string | undefined, what: string): string {
  if (!v || !UUID.test(v)) throw new HttpError(400, 'BAD_ID', `${what} must be a uuid`);
  return v.toLowerCase();
}

function idemKey(c: Context): string {
  const key = c.req.header('idempotency-key');
  if (!key || key.length > 200)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  return key;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  // under the 200 kB the evals_report column allows once Postgres re-renders the JSON
  if (Buffer.byteLength(raw) > 150_000) throw new HttpError(413, 'TOO_LARGE', 'body too large');
  try {
    const v = JSON.parse(raw || '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'body must be a JSON object');
  }
}

/**
 * Staff surface for Agent Runtime v3: versions and their ring stage, eval reports from CI,
 * store pins, and the turn inspector (§11), straight from the log.
 */
export function mountAgentRuntimeControl(o: {
  app: Hono<any>;
  sql: Sql;
  controlGate: (c: Context) => void;
}) {
  const { app, sql, controlGate } = o;

  app.get('/control/v1/agent-runtime/versions', async (c) => {
    controlGate(c);
    const agent = c.req.query('agent');
    if (agent !== undefined && !AGENT.test(agent))
      throw new HttpError(400, 'BAD_AGENT', 'bad agent id');
    const rows = await controlTx(
      sql,
      (tx) => tx`
      select version, agent_id, stage, share_pct, evals_passed_at, stage_since, rollback_reason, created_at
      from agent_versions
      where ${agent ?? null}::text is null or agent_id = ${agent ?? null}
      order by created_at desc limit 50`,
    );
    return c.json({ versions: rows });
  });

  app.post('/control/v1/agent-runtime/versions/:version/stage', async (c) => {
    controlGate(c);
    const version = c.req.param('version');
    if (!VERSION.test(version)) throw new HttpError(400, 'BAD_VERSION', 'bad version');
    const b = await body(c);
    const stage = b.stage as Stage;
    if (!STAGES.includes(stage))
      throw new HttpError(400, 'BAD_STAGE', `stage is one of ${STAGES.join(', ')}`);
    const sharePct = b.sharePct === undefined ? null : Number(b.sharePct);
    if (sharePct !== null && !(Number.isInteger(sharePct) && sharePct >= 0 && sharePct <= 100))
      throw new HttpError(400, 'BAD_SHARE', 'sharePct is 0–100');
    const reason = typeof b.reason === 'string' ? b.reason.slice(0, 1000) : null;
    const res = await claimControl<Record<string, unknown>>(
      sql,
      `agent-runtime:stage:${idemKey(c)}`,
      async (tx) => {
        const ok = await setStage(tx, version, stage, { sharePct, reason, by: 'staff' });
        if (!ok) return { status: 404, body: { error: 'NOT_FOUND' } };
        return { status: 200, body: { version, stage } };
      },
    );
    return c.json(res.body, res.status as 200);
  });

  // CI posts the eval suite's result for a version; a candidate leaves for canary only after it
  app.post('/control/v1/agent-runtime/versions/:version/evals', async (c) => {
    controlGate(c);
    const version = c.req.param('version');
    if (!VERSION.test(version)) throw new HttpError(400, 'BAD_VERSION', 'bad version');
    const b = await body(c);
    if (typeof b.passed !== 'boolean') throw new HttpError(400, 'BAD_REPORT', 'passed is required');
    const res = await claimControl<Record<string, unknown>>(
      sql,
      `agent-runtime:evals:${idemKey(c)}`,
      async (tx) => {
        const passed = b.passed === true;
        const rows = await tx`
        update agent_versions set
          evals_passed_at = case when ${passed} then now() else null end,
          evals_report = ${tx.json(b as never)}
        where version = ${version} returning version`;
        return rows[0]
          ? { status: 200, body: { version, passed } }
          : { status: 404, body: { error: 'NOT_FOUND' } };
      },
    );
    return c.json(res.body, res.status as 200);
  });

  app.put('/control/v1/agent-runtime/stores/:tenantId/pins/:agentId', async (c) => {
    controlGate(c);
    const tenantId = uuid(c.req.param('tenantId'), 'tenantId');
    const agentId = c.req.param('agentId');
    if (!AGENT.test(agentId)) throw new HttpError(400, 'BAD_AGENT', 'bad agent id');
    const b = await body(c);
    const version = b.version;
    if (version !== null && (typeof version !== 'string' || !VERSION.test(version)))
      throw new HttpError(400, 'BAD_VERSION', 'version is a version id or null');
    const res = await claimControl<Record<string, unknown>>(
      sql,
      `agent-runtime:pin:${idemKey(c)}`,
      async (tx) => {
        const [store] = await tx`select 1 from tenants where id = ${tenantId}`;
        if (!store) return { status: 404, body: { error: 'NOT_FOUND', message: 'no such store' } };
        if (version === null) {
          await tx`delete from agent_version_pins where tenant_id = ${tenantId} and agent_id = ${agentId}`;
          return { status: 200, body: { tenantId, agentId, version } };
        }
        const known =
          await tx`select 1 from agent_versions where version = ${version} and agent_id = ${agentId}`;
        if (!known[0])
          return {
            status: 404,
            body: { error: 'NOT_FOUND', message: 'unknown version for this agent' },
          };
        await tx`
          insert into agent_version_pins (tenant_id, agent_id, version) values (${tenantId}, ${agentId}, ${version})
          on conflict (tenant_id, agent_id) do update set version = excluded.version, pinned_at = now()`;
        return { status: 200, body: { tenantId, agentId, version } };
      },
    );
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/agent-runtime/actors', async (c) => {
    controlGate(c);
    const tenantId = c.req.query('tenantId');
    const tenant = tenantId === undefined ? null : uuid(tenantId, 'tenantId');
    const rows = await controlTx(
      sql,
      (tx) => tx`
      select a.id, a.tenant_id, t.name as store_name, a.agent_id, a.subject_kind, a.subject_id, a.lane,
             a.seq::int as seq, a.attempts, a.next_wake_at, a.lease_until, a.updated_at
      from agent_actors a join tenants t on t.id = a.tenant_id
      where ${tenant}::uuid is null or a.tenant_id = ${tenant}
      order by a.updated_at desc limit 100`,
    );
    return c.json({ actors: rows });
  });

  // the turn inspector: the compiled-context summary, model output, every guard decision and
  // every effect of a turn, from the log
  app.get('/control/v1/agent-runtime/actors/:id', async (c) => {
    controlGate(c);
    const id = uuid(c.req.param('id'), 'id');
    const turn = c.req.query('turn');
    const turnId = turn === undefined ? null : uuid(turn, 'turn');
    const before = Number(c.req.query('before') ?? 0);
    if (!Number.isSafeInteger(before) || before < 0)
      throw new HttpError(400, 'BAD_CURSOR', 'before is a seq');
    const out = await controlTx(sql, async (tx) => {
      const [actor] = await tx`
        select a.id, a.tenant_id, t.name as store_name, a.agent_id, a.subject_kind, a.subject_id, a.lane,
               a.version_pin, a.seq::int as seq, a.attempts, a.next_wake_at, a.owner, a.lease_until,
               a.projection -> 'state' -> 'chart' as chart, a.projection -> 'version' as projection_version
        from agent_actors a join tenants t on t.id = a.tenant_id where a.id = ${id}`;
      if (!actor) return null;
      const events = await tx`
        select seq::int as seq, turn_id, step, type, payload, version, at from agent_events
        where actor_id = ${id}
          and (${turnId}::uuid is null or turn_id = ${turnId})
          and (${before} = 0 or seq < ${before})
        order by seq desc limit 300`;
      const mailbox = await tx`
        select id, kind, source, deliver_at, consumed_by_turn, created_at from agent_mailbox
        where actor_id = ${id} order by created_at desc limit 50`;
      return { actor, events: events.reverse(), mailbox };
    });
    if (!out) throw new HttpError(404, 'NOT_FOUND', 'no such actor');
    return c.json(out);
  });
}

import type { Sql } from '../platform/db.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  DEFAULT_GUARDRAILS,
  getIntegrationTx,
  getSettingTx,
  type Guardrails,
  type IntegrationRow,
} from '../modules/integrations.ts';
import { instagramHandle } from '../modules/threads.ts';
import { ownsJob } from '../platform/job-lease.ts';
import { log } from '../platform/log.ts';
import { followInstagram, igState, SidecarError, type IgFollow } from './channels/instagram.ts';

// The CRM's Instagram account follows every lead it finds there and everyone it DMs: the follow
// notification gets a cold DM opened, and DMing accounts you don't follow reads as spam. A write
// that gives a lead a handle queues it (queueIgFollowTx, inside that write's tx); one Core works
// the queue under the daily cap (startInstagramFollows); a DM follows inline first
// (followBeforeDm). The sidecar skips accounts already followed and paces the follows.

const followLog = log.child({ mod: 'ig-follows' });
const SWEEP_MS = 30_000;
const LEASE_MS = 180_000;
/** the loop's call can wait out the sidecar's follow gap (60s + jitter) */
const LOOP_TIMEOUT_MS = 150_000;
/** before a DM: the check plus an unqueued follow, never a wait behind the loop */
const INLINE_TIMEOUT_MS = 15_000;
const LOOP_GAP_MS = 5_000;
/** a claimed row the loop never finished is due again after this */
const CLAIM_MIN = 10;
const MAX_ATTEMPTS = 6;
/** Action Blocked stops every follow this long: retrying early makes Instagram's block longer */
export const BLOCKED_PAUSE_H = 6;
/** the target can't be followed (gone, renamed, ours, blocked): no retry */
const PERMANENT = new Set(['user_not_found', 'bad_username', 'bad_fbid', 'self', 'blocking']);
/** the sidecar or session wasn't there: not the target's fault, so no attempt is spent */
const TRANSPORT = new Set(['sidecar_unreachable', 'not_connected', 'no_secret', 'timeout']);

const FBID_RE = /^\d{1,40}$/;

/** Queues a follow of a lead's Instagram handle, in the tx that gave the lead it. A handle
 *  already queued or done is left alone; sim, archived, unsubscribed and low-fit (<= 3) leads are skipped. */
export async function queueIgFollowTx(tx: Sql, leadId: string, raw: unknown): Promise<void> {
  const handle = typeof raw === 'string' ? instagramHandle(raw) : null;
  if (!handle) return;
  await tx`
    insert into ig_follows (handle, lead_id)
    select ${handle}, l.id from leads l
    where l.id = ${leadId} and l.source is distinct from 'sim'
      and l.archived_at is null and l.unsubscribed_at is null
      and (l.fit_score is null or l.fit_score > 3)
    on conflict (handle) do nothing`;
}

/** The integration a follow can go out on now: the sidecar's session open, or the log driver. */
async function liveIgTx(tx: Sql): Promise<IntegrationRow | null> {
  const ig = await getIntegrationTx(tx, 'instagram');
  if (!ig || (ig.driver === 'sidecar' && igState() !== 'open')) return null;
  return ig;
}

/** Follows left in the rolling 24h: 0 when the cap is 0 or Instagram blocked a recent follow. */
export async function followBudgetTx(tx: Sql): Promise<number> {
  const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const cap = g.instagramFollowsPerDay ?? DEFAULT_GUARDRAILS.instagramFollowsPerDay;
  if (cap <= 0) return 0;
  const r = (
    await tx<{ used: number; blocked: boolean }[]>`
      select
        (select count(*)::int from ig_follows where followed_at > now() - interval '1 day') as used,
        exists (
          select 1 from ig_follows where error_code = 'action_blocked'
            and updated_at > now() - make_interval(hours => ${BLOCKED_PAUSE_H})
        ) as blocked`
  )[0]!;
  return r.blocked ? 0 : Math.max(0, cap - r.used);
}

function asSidecarError(e: unknown): SidecarError {
  if (e instanceof SidecarError) return e;
  return new SidecarError(502, 'follow_failed', e instanceof Error ? e.message : String(e));
}

/** Records one follow outcome; a success learned from an fbid-only call files under its handle. */
async function recordTx(
  tx: Sql,
  target: { handle: string | null; leadId: string | null },
  res: IgFollow | null,
  err: SidecarError | null,
): Promise<string | null> {
  if (res) {
    const handle = target.handle ?? instagramHandle(res.username);
    if (!handle) return null;
    const status = res.following ? 'following' : 'requested';
    const fbid = FBID_RE.test(res.fbid) ? res.fbid : null;
    const row = (
      await tx<{ lead_id: string | null }[]>`
        insert into ig_follows as f (handle, lead_id, status, fbid, followed_at)
        values (${handle}, ${target.leadId}, ${status}, ${fbid},
                case when ${res.already} then null else now() end)
        on conflict (handle) do update set
          status = excluded.status,
          lead_id = coalesce(f.lead_id, excluded.lead_id),
          fbid = coalesce(excluded.fbid, f.fbid),
          followed_at = coalesce(excluded.followed_at, f.followed_at),
          next_at = now(), error_code = null, error = null, updated_at = now()
        returning lead_id`
    )[0];
    const leadId = row?.lead_id ?? target.leadId;
    if (!res.already && leadId) {
      await tx`
        insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${leadId}, 'system',
                ${status === 'following' ? `Seguindo @${handle} no Instagram` : `Pedido pra seguir @${handle} no Instagram enviado (perfil privado)`},
                ${tx.json({ igFollow: status, handle })}, 'system')`;
    }
    return leadId;
  }
  if (!err || !target.handle) return null;
  const transport = TRANSPORT.has(err.code);
  const permanent = PERMANENT.has(err.code);
  const blocked = err.code === 'action_blocked';
  await tx`
    update ig_follows set
      attempts = attempts + ${transport ? 0 : 1},
      status = case
        when ${permanent} or (not ${transport} and attempts + 1 >= ${MAX_ATTEMPTS}) then 'failed'
        else 'pending' end,
      next_at = now() + case
        when ${blocked} then make_interval(hours => ${BLOCKED_PAUSE_H})
        when ${transport} then interval '1 minute'
        else make_interval(mins => least(10 * power(2, attempts)::int, 720)) end,
      error_code = ${err.code.slice(0, 60)}, error = ${err.message.slice(0, 500)}, updated_at = now()
    where handle = ${target.handle} and status = 'pending'`;
  return null;
}

async function attempt(
  sql: Sql,
  ig: IntegrationRow,
  target: { handle: string | null; fbid: string | null; leadId: string | null },
  timeoutMs: number,
): Promise<void> {
  let res: IgFollow | null = null;
  let err: SidecarError | null = null;
  try {
    res = await followInstagram(ig, target, timeoutMs);
  } catch (e) {
    err = asSidecarError(e);
  }
  if (err?.code === 'action_blocked') {
    followLog.warn({ handle: target.handle }, 'instagram blocked a follow — follows pause');
  } else if (err && !TRANSPORT.has(err.code)) {
    followLog.warn({ handle: target.handle, code: err.code, err: err.message }, 'follow failed');
  }
  const leadId = await controlTx(sql, (tx) => recordTx(tx, target, res, err));
  if (leadId) emitControlEvent('lead.change', leadId);
}

/** Before an Instagram DM: follow the recipient unless that's done or Instagram refused it for
 *  good. Bounded and never throws — the DM doesn't wait on a backlog or fail over a follow; one
 *  that doesn't land here stays queued for the loop. */
export async function followBeforeDm(
  sql: Sql,
  ig: IntegrationRow,
  to: { leadId: string; handle: string | null; fbid: string | null },
): Promise<void> {
  try {
    const handle = instagramHandle(to.handle);
    const fbid = to.fbid && FBID_RE.test(to.fbid) ? to.fbid : null;
    if (!handle && !fbid) return;
    const go = await controlTx(sql, async (tx) => {
      if (handle) {
        await queueIgFollowTx(tx, to.leadId, handle);
        // no pending row: done before, refused for good, or a lead that isn't followed
        const pending = await tx`
          select 1 from ig_follows where handle = ${handle} and status = 'pending'`;
        if (!pending.length) return false;
      } else {
        const known = await tx`select 1 from ig_follows where fbid = ${fbid}`;
        const eligible = await tx`
          select 1 from leads where id = ${to.leadId} and source is distinct from 'sim'
            and archived_at is null and unsubscribed_at is null`;
        if (known.length || !eligible.length) return false;
      }
      return (await followBudgetTx(tx)) > 0;
    });
    if (go) await attempt(sql, ig, { handle, fbid, leadId: to.leadId }, INLINE_TIMEOUT_MS);
  } catch (e) {
    followLog.warn({ err: e, leadId: to.leadId }, 'follow before DM failed');
  }
}

/** The loop's step: claims the next due follow and makes it. False when there's nothing to do
 *  now (queue empty, session down, cap spent or a block pause). */
export async function followNext(sql: Sql): Promise<boolean> {
  const job = await controlTx(sql, async (tx) => {
    const ig = await liveIgTx(tx);
    if (!ig || (await followBudgetTx(tx)) <= 0) return null;
    const row = (
      await tx<{ handle: string; fbid: string | null; lead_id: string | null }[]>`
        select f.handle, f.fbid, f.lead_id from ig_follows f
        join leads l on l.id = f.lead_id
        -- archived or unsubscribed since it was queued: held, in case that's undone
        where f.status = 'pending' and f.next_at <= now()
          and l.archived_at is null and l.unsubscribed_at is null
        order by f.next_at, f.created_at
        limit 1 for update of f skip locked`
    )[0];
    if (!row) return null;
    // a Core that dies mid-call leaves the row due again, not stuck
    await tx`
      update ig_follows set next_at = now() + make_interval(mins => ${CLAIM_MIN})
      where handle = ${row.handle}`;
    return { ig, row };
  });
  if (!job) return false;
  await attempt(
    sql,
    job.ig,
    { handle: job.row.handle, fbid: job.row.fbid, leadId: job.row.lead_id },
    LOOP_TIMEOUT_MS,
  );
  return true;
}

/** Works the follow queue on whichever Core holds the lease, one follow at a time. */
export function startInstagramFollows(
  sql: Sql,
  opts: { sweepMs?: number; gapMs?: number } = {},
): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> | null = null;
  const tick = () => {
    if (running || stopped) return;
    running = (async () => {
      // the lease is renewed per follow: one call can outlast a few ticks
      while (!stopped && (await ownsJob(sql, 'instagram.follows', LEASE_MS))) {
        if (!(await followNext(sql))) break;
        // already-followed accounts skip the sidecar's gap; their lookups still get spaced
        await new Promise((r) => setTimeout(r, opts.gapMs ?? LOOP_GAP_MS));
      }
    })()
      .catch((err) => followLog.error({ err }, 'instagram follow pass failed'))
      .finally(() => {
        running = null;
      });
  };
  tick();
  const timer = setInterval(tick, opts.sweepMs ?? SWEEP_MS);
  timer.unref?.();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await running;
  };
}

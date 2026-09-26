import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { controlTx } from '../../modules/control.ts';
import { emitControlEvent } from '../../modules/control-events.ts';
import { DEFAULT_SECRET, getIntegration, type IntegrationRow } from '../../modules/integrations.ts';
import { instagramHandle } from '../../modules/threads.ts';
import { log } from '../../platform/log.ts';

// Instagram DMs ride the ig-sidecar (services/ig-sidecar, Go + mautrix-meta):
// the sidecar holds the live session, Core owns the stored credential
// (ig_auth_state) and pushes it back whenever the sidecar comes up empty.
// 'log' is the zero-credential dev driver.

const igLog = log.child({ mod: 'instagram' });
const ACCOUNT = 'default';
const MAX_SESSION_BYTES = 16_384;
// sends queue behind the sidecar's account-wide pacing gap
const SEND_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 30_000;
// a signed event older than this is a replay
const EVENT_SKEW_S = 300;

export type IgState = 'off' | 'connecting' | 'open' | 'error';
export interface IgAccount {
  username: string;
  name?: string;
  igid?: string;
  fbid?: string;
}
export interface IgField {
  id: string;
  name: string;
  type: string;
  options?: string[];
}
export interface IgStep {
  type: 'input' | 'wait' | 'complete';
  stepId: string;
  instructions: string;
  fields?: IgField[];
  account?: IgAccount;
}
export interface IgStatus {
  state: IgState;
  error?: { code: string; message: string } | null;
  account?: IgAccount | null;
  login?: IgStep | null;
}
interface IgSession {
  cookies: Record<string, string>;
  device?: Record<string, unknown> | null;
}

// last state the sidecar reported (events or reconcile polls)
let last: IgStatus = { state: 'off' };

export function igStatus(): IgStatus {
  return last;
}
export function igState(): IgState {
  return last.state;
}

function setStatus(next: IgStatus) {
  const changed =
    next.state !== last.state ||
    next.error?.code !== last.error?.code ||
    next.account?.username !== last.account?.username ||
    next.login?.stepId !== last.login?.stepId;
  last = next;
  if (changed) emitControlEvent('channel.health', 'instagram');
}

function sidecarUrl(): string {
  return (process.env.IG_SIDECAR_URL || 'http://ig-sidecar:8790').replace(/\/+$/, '');
}

function sidecarSecret(integration: IntegrationRow | null): string | null {
  const ref = integration?.secret_ref;
  return (ref && process.env[ref]) || process.env[DEFAULT_SECRET.sidecar!] || null;
}

export class SidecarError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Sidecar failure → stable Core error (4xx pass through, else 502). */
export function sidecarHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof SidecarError) {
    const status = e.status >= 400 && e.status < 500 ? e.status : 502;
    return new HttpError(status as 400, `IG_${e.code.toUpperCase()}`, e.message);
  }
  return new HttpError(502, 'IG_SIDECAR_UNREACHABLE', 'ig-sidecar não respondeu');
}

async function call<T>(
  integration: IntegrationRow | null,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
  const secret = sidecarSecret(integration);
  if (!secret) throw new SidecarError(503, 'no_secret', 'IG_SIDECAR_SECRET ausente');
  let res: Response;
  try {
    res = await fetch(`${sidecarUrl()}${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new SidecarError(
      502,
      'sidecar_unreachable',
      `ig-sidecar inacessível: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) {
    throw new SidecarError(
      res.status,
      json?.error?.code ?? 'sidecar_error',
      json?.error?.message ?? `ig-sidecar respondeu ${res.status}`,
    );
  }
  return json as T;
}

function sidecarActive(i: IntegrationRow | null): boolean {
  return !!i && i.enabled && i.driver === 'sidecar';
}

async function requireSidecar(sql: Sql): Promise<IntegrationRow> {
  const i = await getIntegration(sql, 'instagram');
  if (!i || !sidecarActive(i)) {
    throw new HttpError(409, 'IG_DRIVER_INACTIVE', 'ative o driver sidecar do instagram primeiro');
  }
  return i;
}

function validSession(v: unknown): IgSession | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const s = v as { cookies?: unknown; device?: unknown };
  if (!s.cookies || typeof s.cookies !== 'object' || Array.isArray(s.cookies)) return null;
  const cookies: Record<string, string> = {};
  for (const [k, val] of Object.entries(s.cookies as Record<string, unknown>)) {
    if (typeof val !== 'string' || k.length > 64) return null;
    cookies[k] = val;
  }
  if (!cookies.sessionid || !cookies.csrftoken || !cookies.ds_user_id) return null;
  const device =
    s.device && typeof s.device === 'object' && !Array.isArray(s.device)
      ? (s.device as Record<string, unknown>)
      : null;
  const out = { cookies, device };
  return JSON.stringify(out).length <= MAX_SESSION_BYTES ? out : null;
}

async function loadAuth(
  sql: Sql,
): Promise<{ session: IgSession | null; device: Record<string, unknown> | null }> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ session: unknown; device: unknown }[]>`
      select session, device from ig_auth_state where account_id = ${ACCOUNT}`,
  );
  const r = rows[0];
  return {
    session: validSession(r?.session),
    device: (r?.device as Record<string, unknown> | null) ?? null,
  };
}

async function saveSession(sql: Sql, session: IgSession) {
  await controlTx(
    sql,
    (tx) => tx`
      insert into ig_auth_state (account_id, session, device, updated_at)
      values (${ACCOUNT}, ${tx.json(session as never)}, ${session.device ? tx.json(session.device as never) : null}, now())
      on conflict (account_id) do update set
        session = excluded.session,
        device = coalesce(excluded.device, ig_auth_state.device),
        updated_at = now()`,
  );
}

async function clearSession(sql: Sql) {
  await controlTx(
    sql,
    (tx) => tx`
      update ig_auth_state set session = null, updated_at = now() where account_id = ${ACCOUNT}`,
  );
}

// newest recorded instagram inbound — the sidecar's catch-up floor after a restart
async function lastInboundMs(sql: Sql): Promise<number> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ ms: string | null }[]>`
      select (extract(epoch from max(m.created_at)) * 1000)::bigint as ms
      from lead_messages m join lead_threads t on t.id = m.thread_id
      where t.channel = 'instagram' and m.direction = 'in'`,
  );
  return Number(rows[0]?.ms ?? 0);
}

// one reconcile at a time — overlapping ones could push the session twice
let reconcileTail: Promise<void> = Promise.resolve();
// a disabled driver stops the sidecar once per process — it may still hold a
// session from before a Core restart or a switch to 'log'
let stopSent = false;

/** Aligns the sidecar with config: pushes the stored session when it runs
 *  empty (restart/redeploy), stops it when the driver is off. Never throws. */
export function reconcileInstagram(sql: Sql, integration: IntegrationRow | null): Promise<void> {
  const run = reconcileTail.then(() => reconcileOnce(sql, integration));
  reconcileTail = run.catch(() => undefined);
  return run;
}

async function reconcileOnce(sql: Sql, integration: IntegrationRow | null): Promise<void> {
  if (!sidecarActive(integration)) {
    if (!stopSent || last.state !== 'off') {
      // the sidecar must stop answering as the account; best-effort — dev runs without one
      await call(integration, 'DELETE', '/v1/session').catch(() => undefined);
      stopSent = true;
    }
    setStatus({ state: 'off' });
    return;
  }
  stopSent = false;
  try {
    let st = await call<IgStatus>(integration, 'GET', '/v1/status');
    // 'off' with no login in progress = the sidecar lost its memory; 'error' waits for staff
    if (st.state === 'off' && !st.login) {
      const { session } = await loadAuth(sql);
      if (session) {
        st = await call<IgStatus>(integration, 'PUT', '/v1/session', {
          session,
          sinceMs: await lastInboundMs(sql),
        });
        igLog.info('stored session pushed to sidecar');
      }
    }
    setStatus(st);
  } catch (e) {
    const err = e instanceof SidecarError ? e : sidecarHttpErrorish(e);
    igLog.warn({ err: err.message }, 'sidecar reconcile failed');
    setStatus({ state: 'error', error: { code: err.code, message: err.message } });
  }
}

function sidecarHttpErrorish(e: unknown): SidecarError {
  return new SidecarError(502, 'sidecar_error', e instanceof Error ? e.message : String(e));
}

let reconcileTimer: ReturnType<typeof setInterval> | null = null;

/** Boot + every minute: a sidecar restart is noticed within a minute. */
export function startInstagramReconcile(sql: Sql) {
  const tick = () =>
    void getIntegration(sql, 'instagram')
      .then((i) => reconcileInstagram(sql, i))
      .catch((e) => igLog.error({ err: e }, 'instagram reconcile failed'));
  tick();
  reconcileTimer ??= setInterval(tick, 60_000);
  reconcileTimer.unref?.();
}

function stripSession(step: IgStep & { session?: unknown }): IgStep {
  const { session: _s, ...rest } = step;
  return rest;
}

async function afterLoginStep(
  sql: Sql,
  integration: IntegrationRow,
  step: IgStep & { session?: unknown },
): Promise<IgStep> {
  if (step.type === 'complete') {
    const session = validSession(step.session);
    if (!session)
      throw new HttpError(502, 'IG_BAD_SESSION', 'ig-sidecar devolveu uma sessão inválida');
    await saveSession(sql, session);
    igLog.info({ username: step.account?.username }, 'instagram account connected');
  }
  // refresh the cached status so the CRM sees the live login/connection at once
  await reconcileInstagram(sql, integration);
  return stripSession(step);
}

export async function igLoginStart(sql: Sql): Promise<IgStep> {
  const i = await requireSidecar(sql);
  const { device } = await loadAuth(sql);
  try {
    const step = await call<IgStep>(i, 'POST', '/v1/login/start', { device });
    return await afterLoginStep(sql, i, step);
  } catch (e) {
    throw sidecarHttpError(e);
  }
}

export async function igLoginSubmit(sql: Sql, input: Record<string, string>): Promise<IgStep> {
  const i = await requireSidecar(sql);
  try {
    const step = await call<IgStep & { session?: unknown }>(i, 'POST', '/v1/login/submit', {
      input,
    });
    return await afterLoginStep(sql, i, step);
  } catch (e) {
    throw sidecarHttpError(e);
  }
}

export async function igLoginCookies(sql: Sql, cookies: string): Promise<IgStep> {
  const i = await requireSidecar(sql);
  const { device } = await loadAuth(sql);
  try {
    const step = await call<IgStep & { session?: unknown }>(i, 'POST', '/v1/login/cookies', {
      cookies,
      device,
    });
    return await afterLoginStep(sql, i, step);
  } catch (e) {
    throw sidecarHttpError(e);
  }
}

export async function igLoginCancel(sql: Sql): Promise<void> {
  const i = await requireSidecar(sql);
  await call(i, 'POST', '/v1/login/cancel').catch((e) => {
    throw sidecarHttpError(e);
  });
  await reconcileInstagram(sql, i);
}

/** Forget the session everywhere; the device identity stays for the next login. */
export async function igLogout(sql: Sql): Promise<void> {
  const i = await getIntegration(sql, 'instagram');
  await clearSession(sql);
  if (sidecarActive(i)) {
    await call(i, 'DELETE', '/v1/session').catch((e) => {
      throw sidecarHttpError(e);
    });
  }
  setStatus({ state: 'off' });
  igLog.info('instagram logged out — session wiped');
}

export async function testInstagram(integration: IntegrationRow) {
  if (integration.driver === 'log') {
    return { ok: true, detail: 'driver log — imprime no console' };
  }
  const st = await call<IgStatus>(integration, 'GET', '/v1/status');
  const who = st.account?.username ? ` como @${st.account.username}` : '';
  if (st.state === 'open') return { ok: true, detail: `sidecar conectado${who}` };
  if (st.state === 'error') {
    return { ok: false, detail: st.error?.message ?? 'sidecar em erro' };
  }
  return { ok: true, detail: `sidecar ${st.state}${who}` };
}

/** Send one DM. `fbid` (the account id from an inbound or an earlier send)
 *  wins; else the handle is resolved by the sidecar. */
export async function sendInstagram(
  integration: IntegrationRow,
  to: { fbid?: string | null; handle?: string | null },
  text: string,
): Promise<{ messageId: string; fbid: string }> {
  if (integration.driver === 'log') {
    igLog.info({ to: to.handle ?? to.fbid, text }, 'log-driver send');
    return { messageId: `log:${crypto.randomUUID()}`, fbid: to.fbid ?? 'log' };
  }
  if (integration.driver !== 'sidecar') {
    throw new Error(`unknown instagram driver: ${integration.driver}`);
  }
  const username = instagramHandle(to.handle);
  if (!to.fbid && !username) throw new Error('lead has no instagram');
  try {
    const res = await call<{ messageId: string; fbid: string }>(
      integration,
      'POST',
      '/v1/send',
      { fbid: to.fbid ?? '', username: username ?? '', text },
      SEND_TIMEOUT_MS,
    );
    igLog.info({ to: username ?? to.fbid, id: res.messageId }, 'message sent');
    return res;
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'instagram send failed');
  }
}

/** Constant-time check of the sidecar's HMAC over "<ts>.<body>". */
export function igEventSignatureOk(
  secret: string,
  ts: string | undefined,
  signature: string | undefined,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): boolean {
  if (!ts || !signature || !/^\d{9,11}$/.test(ts) || !/^[0-9a-f]{64}$/.test(signature)) {
    return false;
  }
  if (Math.abs(nowS - Number(ts)) > EVENT_SKEW_S) return false;
  const want = createHmac('sha256', secret).update(`${ts}.${body}`).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), want);
}

export interface IgInbound {
  id: string;
  fromFbid: string;
  username: string | null;
  name: string | null;
  text: string;
  sentAt: Date | null;
}

type IgEvent =
  | { type: 'state'; status: IgStatus }
  | { type: 'session'; session: IgSession }
  | { type: 'message'; message: IgInbound };

/** Shape-check a signed sidecar event; bad shapes are a stable 422, never a 500. */
export function parseIgEvent(raw: unknown): IgEvent {
  const bad = (why: string) => new HttpError(422, 'BAD_REQUEST', `instagram event: ${why}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('not an object');
  const e = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max ? v : undefined;
  if (e.type === 'state') {
    const state = e.state;
    if (state !== 'off' && state !== 'connecting' && state !== 'open' && state !== 'error') {
      throw bad('state');
    }
    const err = e.error as { code?: unknown; message?: unknown } | undefined;
    const acct = e.account as Record<string, unknown> | undefined;
    return {
      type: 'state',
      status: {
        state,
        error:
          err && str(err.code, 100) !== undefined
            ? { code: str(err.code, 100)!, message: str(err.message, 1000) ?? '' }
            : null,
        account:
          acct && str(acct.username, 60)
            ? {
                username: str(acct.username, 60)!,
                ...(str(acct.name, 200) ? { name: str(acct.name, 200)! } : {}),
                ...(str(acct.igid, 40) ? { igid: str(acct.igid, 40)! } : {}),
                ...(str(acct.fbid, 40) ? { fbid: str(acct.fbid, 40)! } : {}),
              }
            : null,
      },
    };
  }
  if (e.type === 'session') {
    const session = validSession(e.session);
    if (!session) throw bad('session');
    return { type: 'session', session };
  }
  if (e.type === 'message') {
    const m = e.message as Record<string, unknown> | undefined;
    const id = str(m?.id, 200);
    const fromFbid = str(m?.fromFbid, 40);
    const text = str(m?.text, 8000);
    if (!id || !fromFbid || !/^\d+$/.test(fromFbid) || !text?.trim()) throw bad('message');
    const ms = typeof m?.sentAtMs === 'number' && Number.isFinite(m.sentAtMs) ? m.sentAtMs : 0;
    // a timestamp from the future or before instagram DMs existed is noise
    const sentAt = ms > 1_262_304_000_000 && ms < Date.now() + 86_400_000 ? new Date(ms) : null;
    return {
      type: 'message',
      message: {
        id,
        fromFbid,
        username: instagramHandle(str(m?.username, 60)),
        name: str(m?.name, 200)?.trim() || null,
        text,
        sentAt,
      },
    };
  }
  throw bad('type');
}

/** Applies a verified event; messages are handed back for the inbound pipeline. */
// Instagram killed these sessions for good; challenge/checkpoint ones can
// revive once staff clear the check in the app, so they're kept
const DEAD_SESSION = new Set(['logged_out', 'unauthorized']);

export async function applyIgEvent(sql: Sql, evt: IgEvent): Promise<IgInbound | null> {
  if (evt.type === 'state') {
    if (evt.status.state === 'error' && DEAD_SESSION.has(evt.status.error?.code ?? '')) {
      await clearSession(sql);
    }
    setStatus({ ...evt.status, login: last.login ?? null });
    return null;
  }
  if (evt.type === 'session') {
    // rotation only refreshes a live credential — racing a logout must not resurrect it
    await controlTx(
      sql,
      (tx) => tx`
        update ig_auth_state set session = ${tx.json(evt.session as never)}, updated_at = now()
        where account_id = ${ACCOUNT} and session is not null`,
    );
    return null;
  }
  return evt.message;
}

export function igSecretFor(integration: IntegrationRow | null): string | null {
  return sidecarSecret(integration);
}

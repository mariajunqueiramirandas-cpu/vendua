/**
 * modules/gcal — Google Calendar sync for CRM meetings.
 *
 * Auth is OAuth2 JWT-bearer directly (no googleapis client): an RS256 JWT
 * signed with the service account's private_key is exchanged at its
 * token_uri for a ~1h access token, cached in-process for ~55min.
 *
 * Meet links are intentionally NOT created here — service accounts can't
 * provision conferenceData on consumer calendars (verified: the API rejects
 * `conferenceData.createRequest` with `Invalid conference type value`). The
 * video room is a configured static URL (settings `meeting.roomUrl`).
 *
 * If GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON or GOOGLE_CALENDAR_ID are unset
 * the module is disabled: warn-log once, booking keeps working with rules
 * as the only availability source, and insertEvent() returns null.
 */
import { createSign } from 'node:crypto';
import { log } from '../platform/log.ts';

const gcalLog = log.child({ mod: 'gcal' });
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_TTL_MS = 55 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

interface SaKey {
  client_email: string;
  private_key: string;
  token_uri: string;
}

interface GcalEnv {
  key: SaKey | null;
  keyError: string | null;
  calendarId: string | null;
}

let envCache: GcalEnv | null = null;
let tokenCache: { token: string; expiresAt: number } | null = null;
let lastError: string | null = null;
let warnedDisabled = false;

function gcalEnv(): GcalEnv {
  if (envCache) return envCache;
  const raw = process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON;
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim() || null;
  let key: SaKey | null = null;
  let keyError: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SaKey>;
      if (parsed.client_email && parsed.private_key && parsed.token_uri) {
        key = {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          token_uri: parsed.token_uri,
        };
      } else {
        keyError = 'service account json missing client_email/private_key/token_uri';
      }
    } catch (e) {
      keyError = `service account json parse failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  envCache = { key, keyError, calendarId };
  return envCache;
}

export function gcalConfigured(): boolean {
  const env = gcalEnv();
  return Boolean(env.key && env.calendarId);
}

/** Snapshot for GET /control/v1/meetings/status — never throws. */
export function gcalStatus(): {
  configured: boolean;
  calendarId: string | null;
  clientEmail: string | null;
  lastError: string | null;
} {
  const env = gcalEnv();
  return {
    configured: gcalConfigured(),
    calendarId: env.calendarId,
    clientEmail: env.key?.client_email ?? null,
    lastError: env.keyError ?? lastError,
  };
}

/** Test hook — clears memoized env/token so tests can flip env vars. */
export function gcalResetForTest(): void {
  envCache = null;
  tokenCache = null;
  lastError = null;
  warnedDisabled = false;
}

function disabled(): boolean {
  const env = gcalEnv();
  if (env.keyError) {
    if (!warnedDisabled) gcalLog.warn({ err: env.keyError }, 'gcal: bad service account env');
    warnedDisabled = true;
    lastError = env.keyError;
    return true;
  }
  if (!env.key || !env.calendarId) {
    if (!warnedDisabled)
      gcalLog.warn('gcal: GOOGLE_CALENDAR_* envs unset — calendar sync disabled');
    warnedDisabled = true;
    return true;
  }
  return false;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function assertionJwt(key: SaKey, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: CAL_SCOPE,
      aud: key.token_uri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(key.private_key, 'base64url');
  return `${header}.${claims}.${sig}`;
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const env = gcalEnv();
  if (!env.key) throw new Error('gcal not configured');
  const res = await fetch(env.key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertionJwt(env.key, new Date()),
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    error_description?: string;
  } | null;
  if (!res.ok || !body?.access_token) {
    const msg = body?.error_description ?? `token exchange http ${res.status}`;
    lastError = msg;
    throw new Error(`gcal token: ${msg}`);
  }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return body.access_token;
}

async function calFetch(path: string, init: RequestInit): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(`${CAL_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res;
}

export interface GcalEventInput {
  summary: string;
  description?: string;
  /** ISO-8601 instants */
  start: string;
  end: string;
  tz: string;
  /** lead id lands in extendedProperties.private.leadId for reconciliation */
  leadId: string | null;
}

/** Returns the created event id, or null when the module is disabled. */
export async function insertEvent(input: GcalEventInput): Promise<string | null> {
  if (disabled()) return null;
  const { calendarId } = gcalEnv();
  try {
    const res = await calFetch(`/calendars/${encodeURIComponent(calendarId!)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: input.summary,
        ...(input.description ? { description: input.description } : {}),
        start: { dateTime: input.start, timeZone: input.tz },
        end: { dateTime: input.end, timeZone: input.tz },
        ...(input.leadId
          ? { extendedProperties: { private: { leadId: input.leadId } } }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      lastError = `events.insert http ${res.status}: ${text}`;
      gcalLog.warn({ status: res.status, err: lastError }, 'gcal insert failed');
      return null;
    }
    const event = (await res.json()) as { id?: string };
    lastError = null;
    return event.id ?? null;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    gcalLog.warn({ err: lastError }, 'gcal insert failed');
    return null;
  }
}

/** Best-effort delete — 404/410 (already gone) is treated as success. */
export async function deleteEvent(gcalEventId: string): Promise<boolean> {
  if (disabled()) return false;
  const { calendarId } = gcalEnv();
  try {
    const res = await calFetch(
      `/calendars/${encodeURIComponent(calendarId!)}/events/${encodeURIComponent(gcalEventId)}`,
      { method: 'DELETE' },
    );
    if (res.ok || res.status === 404 || res.status === 410) {
      lastError = null;
      return true;
    }
    lastError = `events.delete http ${res.status}`;
    gcalLog.warn({ status: res.status }, 'gcal delete failed');
    return false;
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    gcalLog.warn({ err: lastError }, 'gcal delete failed');
    return false;
  }
}

/**
 * Busy windows from freebusy.query — returns [{start,end}] instants of
 * events on the shared calendar between the two bounds. Empty array when the
 * module is disabled or the query fails (availability falls back to rules).
 */
export async function busyWindows(
  timeMin: Date,
  timeMax: Date,
): Promise<{ start: Date; end: Date }[]> {
  if (disabled()) return [];
  const { calendarId } = gcalEnv();
  try {
    const res = await calFetch('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      }),
    });
    if (!res.ok) {
      lastError = `freebusy http ${res.status}`;
      gcalLog.warn({ status: res.status }, 'gcal freebusy failed');
      return [];
    }
    const body = (await res.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    lastError = null;
    const busy = body.calendars?.[calendarId!]?.busy ?? [];
    return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    gcalLog.warn({ err: lastError }, 'gcal freebusy failed');
    return [];
  }
}

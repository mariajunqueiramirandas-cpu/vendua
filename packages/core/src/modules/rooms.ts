/**
 * modules/rooms — video room provisioning for meetings.
 *
 * Two providers, chosen by env:
 *  - daily.co when DAILY_API_KEY is set: each booking gets its own
 *    `vendua-<meetingId>` room (unguessable name ⇒ 'public' privacy is fine —
 *    the lead joins without a token). exp = meeting end + 30min so the room
 *    dies shortly after the call.
 *  - static fallback otherwise (or on any Daily failure): the configured
 *    `meeting.roomUrl` — booking must never fail over a room, so a Daily
 *    error logs and degrades to the static URL.
 */
import { log } from '../platform/log.ts';

const rlog = log.child({ mod: 'rooms' });
const DAILY_API = 'https://api.daily.co/v1';
const FETCH_TIMEOUT_MS = 10_000;

export function dailyConfigured(): boolean {
  return Boolean(process.env.DAILY_API_KEY?.trim());
}

/** For /control/v1/meetings/status — which provider is active. */
export function roomProvider(): 'daily' | 'static' | 'none' {
  return dailyConfigured() ? 'daily' : 'static';
}

export interface RoomResult {
  url: string | null;
  /** 'daily' when a per-meeting room was created, 'static' on fallback */
  provider: 'daily' | 'static';
  error?: string;
}

/** Last provisioning failure — lets meetingsStatus tell "Daily configured"
 *  from "Daily actually working". Cleared on the next successful create. */
let lastRoomError: string | null = null;

export function roomLastError(): string | null {
  return lastRoomError;
}

/**
 * Provision a room for a freshly booked meeting. `fallback` is the static
 * meeting.roomUrl — returned whenever Daily is unset or errors.
 */
export async function createRoom(
  meetingId: string,
  endsAt: Date,
  fallback: string | null,
): Promise<RoomResult> {
  if (!dailyConfigured()) return { url: fallback, provider: 'static' };
  try {
    const res = await fetch(`${DAILY_API}/rooms`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.DAILY_API_KEY!.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: `vendua-${meetingId}`,
        privacy: 'public',
        properties: {
          exp: Math.floor(endsAt.getTime() / 1000) + 30 * 60,
          enable_knocking: false,
          lang: 'pt',
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      // Retry path: the room can already exist if an earlier attempt created
      // it but failed before the URL reached the meeting row — recover it.
      if (res.status === 400) {
        const existing = await fetchRoom(`vendua-${meetingId}`);
        if (existing) {
          lastRoomError = null;
          return { url: existing, provider: 'daily' };
        }
      }
      rlog.warn({ status: res.status, err: text }, 'daily room create failed');
      lastRoomError = `daily ${res.status}`;
      return { url: fallback, provider: 'static', error: lastRoomError };
    }
    const room = (await res.json()) as { url?: string };
    if (!room.url) {
      rlog.warn('daily room create: no url in response');
      lastRoomError = 'daily: no url';
      return { url: fallback, provider: 'static', error: lastRoomError };
    }
    lastRoomError = null;
    return { url: room.url, provider: 'daily' };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    rlog.warn({ err }, 'daily room create failed');
    lastRoomError = err;
    return { url: fallback, provider: 'static', error: err };
  }
}

/** Fetch an existing room's URL by name — recovery for create-collision. */
async function fetchRoom(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${DAILY_API}/rooms/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${process.env.DAILY_API_KEY!.trim()}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const room = (await res.json()) as { url?: string };
    return room.url ?? null;
  } catch {
    return null;
  }
}

/** Keep a rescheduled meeting's room alive to the new end + 30min. No-op
 *  when the room isn't a Daily room or the key is gone. */
export async function bumpRoomExpiry(roomUrl: string | null, endsAt: Date): Promise<void> {
  if (!roomUrl || !dailyConfigured()) return;
  let name: string | undefined;
  try {
    name = /\/([a-z0-9-]+)$/i.exec(new URL(roomUrl).pathname)?.[1];
  } catch {
    return; // not a parseable URL — certainly not a Daily room
  }
  if (!name || !name.startsWith('vendua-')) return;
  try {
    const res = await fetch(`${DAILY_API}/rooms/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.DAILY_API_KEY!.trim()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        properties: { exp: Math.floor(endsAt.getTime() / 1000) + 30 * 60 },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      rlog.warn({ status: res.status, room: name }, 'daily room update failed');
    }
  } catch (e) {
    rlog.warn({ err: e instanceof Error ? e.message : String(e) }, 'daily room update failed');
  }
}

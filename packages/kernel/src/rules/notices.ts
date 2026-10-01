import type { Notice, NoticeAction } from '../api.ts';

// Server-driven notices (05 — forward-compatibility): unknown severities read as info,
// unknown actions degrade to a link or drop, and a notice shows only inside its window.

const SEVERITIES = new Set(['info', 'warning', 'blocking']);

export function noticeSeverity(n: Notice): 'info' | 'warning' | 'blocking' {
  if (n.kind === 'emergency') return 'blocking';
  const s = String(n.severity);
  return SEVERITIES.has(s) ? (s as 'info' | 'warning' | 'blocking') : 'info';
}

/** Unknown action types degrade to a link when they carry an href, else are omitted. */
export function noticeLinks(n: Notice): { label: string; href: string; action: NoticeAction }[] {
  return (n.actions ?? []).slice(0, 2).flatMap((a) => {
    const href = (a as Record<string, unknown>).href;
    return typeof href === 'string' && typeof a.label === 'string'
      ? [{ label: a.label, href, action: a }]
      : [];
  });
}

export function isBlocking(n: Notice): boolean {
  return noticeSeverity(n) === 'blocking';
}

/** Notices inside their `startsAt`/`endsAt` window at `now` (ms). */
export function visibleNotices<N extends Pick<Notice, 'startsAt' | 'endsAt'>>(
  notices: readonly N[],
  now: number = Date.now(),
): N[] {
  return notices.filter(
    (n) =>
      (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || Date.parse(n.endsAt) > now),
  );
}

// Deterministic liveness and activity checks for discovered prospects: prevents filing or
// cold-contacting businesses that permanently closed, paused indefinitely, or went dark long ago.

export type LivenessStatus =
  'active' | 'quiet' | 'stale' | 'paused' | 'closed' | 'private' | 'unknown';

/** An Instagram profile with a post in this window is clearly active. */
export const ACTIVE_POST_DAYS = 60;
/** Past this many days with zero posts (and no other live proof), treat as stale/dormant. */
export const STALE_POST_DAYS = 180;

export interface LivenessSignal {
  /** normalized lookup key: '@handle' or 'name:<lower>' */
  key: string;
  source: 'maps' | 'instagram' | 'serp' | 'page';
  status: Exclude<LivenessStatus, 'unknown' | 'private'>;
  reason: string;
  /** YYYY-MM-DD of the newest observed public activity, if known */
  lastAt?: string;
}

export interface RecentPostSummary {
  date: string | null;
  caption: string;
}

export interface InstagramActivity {
  status: LivenessStatus;
  lastPostAt: string | null;
  daysSinceLastPost: number | null;
  postsCount: number | null;
  postsLast30d: number;
  postsLast90d: number;
  closedSignal: string | null;
  pausedSignal: string | null;
  recentPosts: RecentPostSummary[];
}

export interface MapsActivity {
  status: LivenessStatus;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  reviewsCount: number | null;
  hasOpeningHours: boolean;
  lastReviewAt: string | null;
  daysSinceLastReview: number | null;
  closedSignal: string | null;
}

const DAY_MS = 86_400_000;

// High-precision patterns: never match normal weekly schedules ("fechado às segundas", "fechado hoje").
const CLOSED_PATTERNS: readonly RegExp[] = [
  /\b(?:fechad[oa]s?\s+permanentemente|permanently\s+closed)\b/i,
  /\b(?:encerramos\s+(?:as\s+|nossas\s+)?atividades|atividades\s+encerradas|encerrando\s+(?:as\s+|nossas\s+)?atividades|encerrou\s+(?:as\s+)?atividades)\b/i,
  /\b(?:fechamos\s+(?:as\s+)?portas|fechou\s+as\s+portas)\b/i,
  /\b(?:n[aã]o\s+estamos\s+mais\s+(?:atendendo|funcionando|operando|vendendo|abertos))\b/i,
  /\b(?:perfil|conta|p[aá]gina|loja)\s+(?:desativad[oa]|inativ[oa]|encerrad[oa])\b/i,
  /\b(?:pausa\s+por\s+tempo\s+indeterminado|em\s+pausa\s+indeterminada)\b/i,
  /\b(?:encerramos\s+por\s+aqui|encerramento\s+das\s+atividades)\b/i,
];

const PAUSED_PATTERNS: readonly RegExp[] = [
  /\b(?:temporariamente\s+fechad[oa]|fechad[oa]\s+temporariamente|temporarily\s+closed)\b/i,
  /\b(?:em\s+pausa\s+tempor[aá]ria|pausamos\s+os\s+pedidos|pedidos\s+pausados)\b/i,
];

export function detectClosedPhrase(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of CLOSED_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

export function detectPausedPhrase(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const re of PAUSED_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** Parses ISO strings or Unix timestamps (seconds or ms) returned by Apify scrapers. */
export function parsePostTimestamp(raw: unknown, now: Date = new Date()): Date | null {
  if (raw == null || raw === '') return null;
  let ms: number;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 1e11 separates seconds (~1.7e9) from milliseconds (~1.7e12)
    ms = raw < 1e11 ? raw * 1000 : raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d{9,13}$/.test(trimmed)) {
      const n = Number(trimmed);
      ms = n < 1e11 ? n * 1000 : n;
    } else {
      ms = Date.parse(trimmed);
    }
  } else {
    return null;
  }
  if (!Number.isFinite(ms)) return null;
  // Sanity-check bounds: Instagram launched 2010; reject future noise beyond 2 days.
  const minMs = Date.UTC(2010, 0, 1);
  const maxMs = now.getTime() + 2 * DAY_MS;
  if (ms < minMs || ms > maxMs) return null;
  return new Date(ms);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysBetween = (earlier: Date, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - earlier.getTime()) / DAY_MS));

const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

/** Evaluates an Instagram profile payload (apify/instagram-profile-scraper shape) for recency and liveness. */
export function assessInstagramActivity(
  profile: Record<string, unknown>,
  now: Date = new Date(),
): InstagramActivity {
  const bio = typeof profile.biography === 'string' ? profile.biography : '';
  const isPrivate = profile.private === true || profile.isPrivate === true;
  const postsCount = numOrNull(profile.postsCount ?? profile.mediaCount ?? profile.posts_count);

  const rawPosts = [
    ...(Array.isArray(profile.latestPosts) ? profile.latestPosts : []),
    ...(Array.isArray(profile.posts) ? profile.posts : []),
    ...(Array.isArray(profile.latestIgtvVideos) ? profile.latestIgtvVideos : []),
  ].filter((x): x is Record<string, unknown> => Boolean(x && typeof x === 'object'));

  const parsed: { at: Date; caption: string }[] = [];
  for (const post of rawPosts) {
    const at = parsePostTimestamp(
      post.timestamp ??
        post.takenAtTimestamp ??
        post.taken_at_timestamp ??
        post.createdAt ??
        post.date,
      now,
    );
    const caption =
      typeof post.caption === 'string'
        ? post.caption.trim()
        : typeof post.text === 'string'
          ? post.text.trim()
          : '';
    if (at) parsed.push({ at, caption });
  }
  // Sort newest first so pinned old posts never hide recent activity.
  parsed.sort((a, b) => b.at.getTime() - a.at.getTime());

  const newest = parsed[0]?.at ?? null;
  const daysSinceLastPost = newest ? daysBetween(newest, now) : null;
  const postsLast30d = parsed.filter((p) => daysBetween(p.at, now) <= 30).length;
  const postsLast90d = parsed.filter((p) => daysBetween(p.at, now) <= 90).length;

  const recentPosts: RecentPostSummary[] = parsed
    .filter((p) => p.caption.length > 0)
    .slice(0, 2)
    .map((p) => ({
      date: isoDay(p.at),
      caption: p.caption.replace(/\s+/g, ' ').slice(0, 160),
    }));

  // Check bio first, then the newest 2 captions (an older post from years ago is ignored).
  const closedSignal =
    detectClosedPhrase(bio) ??
    parsed
      .slice(0, 2)
      .map((p) => detectClosedPhrase(p.caption))
      .find((s): s is string => Boolean(s)) ??
    null;
  const pausedSignal =
    detectPausedPhrase(bio) ??
    parsed
      .slice(0, 1)
      .map((p) => detectPausedPhrase(p.caption))
      .find((s): s is string => Boolean(s)) ??
    null;

  let status: LivenessStatus = 'unknown';
  if (closedSignal) status = 'closed';
  else if (pausedSignal) status = 'paused';
  else if (isPrivate && parsed.length === 0) status = 'private';
  else if (daysSinceLastPost !== null) {
    status =
      daysSinceLastPost <= ACTIVE_POST_DAYS
        ? 'active'
        : daysSinceLastPost <= STALE_POST_DAYS
          ? 'quiet'
          : 'stale';
  } else if (postsCount === 0) {
    status = 'stale';
  }

  return {
    status,
    lastPostAt: newest ? isoDay(newest) : null,
    daysSinceLastPost,
    postsCount,
    postsLast30d,
    postsLast90d,
    closedSignal,
    pausedSignal,
    recentPosts,
  };
}

function hasHoursValue(v: unknown): boolean {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

/** Evaluates a Google Maps candidate payload for operational status and recent activity. */
export function assessMapsActivity(
  place: Record<string, unknown>,
  now: Date = new Date(),
): MapsActivity {
  const rawStatus = String(
    place.businessStatus ?? place.business_status ?? place.status ?? '',
  ).toUpperCase();
  const title = String(place.name ?? place.title ?? '');
  const desc = String(place.description ?? '');
  const closedSignal = detectClosedPhrase(`${title} ${desc}`);
  const permanentlyClosed =
    place.permanentlyClosed === true ||
    place.permanently_closed === true ||
    rawStatus === 'CLOSED_PERMANENTLY' ||
    Boolean(closedSignal);
  const temporarilyClosed =
    !permanentlyClosed &&
    (place.temporarilyClosed === true ||
      place.temporarily_closed === true ||
      rawStatus === 'CLOSED_TEMPORARILY' ||
      Boolean(detectPausedPhrase(`${title} ${desc}`)));

  const reviewsCount = numOrNull(
    place.reviewsCount ??
      place.reviews_count ??
      place.reviewCount ??
      place.totalReviews ??
      place.user_ratings_total ??
      place.reviews,
  );
  const hasOpeningHours = hasHoursValue(
    place.openingHours ?? place.opening_hours ?? place.working_hours ?? place.hours,
  );

  // Check review dates if the scraper included recent reviews.
  const reviewDates: Date[] = [];
  const directDate = parsePostTimestamp(
    place.lastReviewDate ?? place.latestReviewDate ?? place.last_review_date,
    now,
  );
  if (directDate) reviewDates.push(directDate);
  if (Array.isArray(place.reviews)) {
    for (const rev of place.reviews) {
      if (!rev || typeof rev !== 'object') continue;
      const r = rev as Record<string, unknown>;
      const d = parsePostTimestamp(
        r.publishedAtDate ?? r.publishAt ?? r.date ?? r.timestamp ?? r.createdAt,
        now,
      );
      if (d) reviewDates.push(d);
    }
  }
  reviewDates.sort((a, b) => b.getTime() - a.getTime());
  const newestReview = reviewDates[0] ?? null;
  const daysSinceLastReview = newestReview ? daysBetween(newestReview, now) : null;

  let status: LivenessStatus = 'unknown';
  if (permanentlyClosed) status = 'closed';
  else if (temporarilyClosed) status = 'paused';
  else if (
    rawStatus === 'OPERATIONAL' ||
    (daysSinceLastReview !== null && daysSinceLastReview <= STALE_POST_DAYS) ||
    hasOpeningHours ||
    (reviewsCount !== null && reviewsCount >= 5)
  ) {
    status = 'active';
  }

  return {
    status,
    permanentlyClosed,
    temporarilyClosed,
    reviewsCount,
    hasOpeningHours,
    lastReviewAt: newestReview ? isoDay(newestReview) : null,
    daysSinceLastReview,
    closedSignal,
  };
}

export const normNameKey = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const cleaned = v
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return cleaned.length >= 3 ? `name:${cleaned}` : null;
};

export const normIgKey = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const h = v.trim().replace(/^@/, '').toLowerCase();
  return h ? `@${h}` : null;
};

/** Keys a lead matches in the turn's liveness ledger. */
export function livenessKeys(lead: {
  instagram?: unknown;
  businessName?: unknown;
  name?: unknown;
}): string[] {
  const keys = [
    normIgKey(lead.instagram),
    normNameKey(lead.businessName),
    normNameKey(lead.name),
  ].filter((k): k is string => Boolean(k));
  return [...new Set(keys)];
}

/** Resolves all liveness signals recorded for a lead across sources in the current turn. */
export function resolveLeadLiveness(
  ledger: readonly LivenessSignal[],
  lead: { instagram?: unknown; businessName?: unknown; name?: unknown },
): {
  status: LivenessStatus;
  reason: string | null;
  lastAt: string | null;
  hasActiveProof: boolean;
  closedSignal: LivenessSignal | null;
  pausedSignal: LivenessSignal | null;
  staleSignal: LivenessSignal | null;
} {
  const keys = new Set(livenessKeys(lead));
  const hits = ledger.filter((s) => keys.has(s.key));
  const closedSignal = hits.find((h) => h.status === 'closed') ?? null;
  const activeSignal = hits.find((h) => h.status === 'active') ?? null;
  const quietSignal = hits.find((h) => h.status === 'quiet') ?? null;
  const pausedSignal = hits.find((h) => h.status === 'paused') ?? null;
  const staleSignal = hits.find((h) => h.status === 'stale') ?? null;

  const dates = hits
    .map((h) => h.lastAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();
  const lastAt = dates[0] ?? null;

  // Permanently closed always wins — a dead business is never filed.
  if (closedSignal) {
    return {
      status: 'closed',
      reason: closedSignal.reason,
      lastAt,
      hasActiveProof: Boolean(activeSignal),
      closedSignal,
      pausedSignal,
      staleSignal,
    };
  }
  // An active signal from another source (e.g., active Google Maps hours/reviews) overrides a
  // quiet/stale Instagram profile, because many real food shops don't post regularly on IG.
  if (activeSignal) {
    return {
      status: 'active',
      reason: activeSignal.reason,
      lastAt,
      hasActiveProof: true,
      closedSignal: null,
      pausedSignal,
      staleSignal,
    };
  }
  if (pausedSignal) {
    return {
      status: 'paused',
      reason: pausedSignal.reason,
      lastAt,
      hasActiveProof: false,
      closedSignal: null,
      pausedSignal,
      staleSignal,
    };
  }
  if (staleSignal) {
    return {
      status: 'stale',
      reason: staleSignal.reason,
      lastAt,
      hasActiveProof: false,
      closedSignal: null,
      pausedSignal: null,
      staleSignal,
    };
  }
  if (quietSignal) {
    return {
      status: 'quiet',
      reason: quietSignal.reason,
      lastAt,
      hasActiveProof: false,
      closedSignal: null,
      pausedSignal: null,
      staleSignal: null,
    };
  }
  return {
    status: 'unknown',
    reason: null,
    lastAt,
    hasActiveProof: false,
    closedSignal: null,
    pausedSignal: null,
    staleSignal: null,
  };
}

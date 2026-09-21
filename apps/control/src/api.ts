/**
 * api — typed client for /control/v1. Cookie session (vendua_control) +
 * the x-vendua-staff CSRF marker on mutations. Every mutation mints an
 * Idempotency-Key — claimControl makes retries safe.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/control/v1${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-vendua-staff': '1',
      ...(init.method && init.method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}),
      ...init.headers,
    },
  });
  if (res.status === 404) {
    let code = 'NOT_FOUND';
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      /* gate 404s are json too */
    }
    throw new ApiError(404, code, 'not found');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    throw new ApiError(
      res.status,
      data.error?.code ?? 'ERROR',
      data.error?.message ?? res.statusText,
    );
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

// ---------- types ----------
export interface Lead {
  id: string;
  name: string;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  website: string | null;
  city: string | null;
  segment: string | null;
  source: string | null;
  owner: string | null;
  tags: string[];
  dealValueCents: number | null;
  state: 'lead' | 'contacted' | 'invited' | 'live';
  agentMode: 'off' | 'draft' | 'auto';
  agentGoal: 'negotiation' | 'meeting';
  fitScore: number | null;
  fitReason: string | null;
  emailBouncedAt: string | null;
  nextActionAt: string | null;
  lostReason: string | null;
  archivedAt: string | null;
  unsubscribedAt: string | null;
  discoveredVia: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface LeadListItem extends Lead {
  score: number;
  openTasks: number;
  pendingDrafts: number;
  lastActivityAt: string | null;
}
export interface Activity {
  id: string;
  leadId: string;
  kind: string;
  body: string | null;
  meta: Record<string, unknown>;
  createdBy: string;
  at: string;
}
export interface Task {
  id: string;
  leadId: string;
  title: string;
  dueAt: string | null;
  doneAt: string | null;
  createdBy: string;
  createdAt: string;
  leadName?: string;
  businessName?: string | null;
}
export interface ThreadItem {
  id: string;
  leadId: string;
  leadName: string;
  businessName: string | null;
  leadState: string;
  channel: 'email' | 'whatsapp' | 'manual';
  subject: string | null;
  agentEnabled: boolean;
  lastMessageAt: string | null;
  messageCount: number;
  lastBody: string | null;
  lastDirection: 'in' | 'out' | null;
  pendingDrafts: number;
  needsReply: boolean;
}
export interface Message {
  id: string;
  threadId: string;
  direction: 'in' | 'out';
  author: string;
  body: string;
  status: string;
  providerMessageId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}
export interface ThreadView {
  thread: {
    id: string;
    leadId: string;
    channel: string;
    subject: string | null;
    agentEnabled: boolean;
    externalId: string | null;
    lastMessageAt: string | null;
    createdAt: string;
  };
  lead: Lead;
  messages: Message[];
}
export interface Draft {
  id: string;
  threadId: string;
  leadId: string;
  leadName: string;
  businessName: string | null;
  leadState: string;
  channel: string;
  body: string;
  author: string;
  createdAt: string;
}
export interface Integration {
  id: string;
  kind: string;
  driver: string;
  enabled: boolean;
  config: Record<string, unknown>;
  secretRef: string | null;
  /** effective env var the driver reads — secretRef or its built-in default */
  secretName: string | null;
  secretPresent: boolean | null;
  createdAt: string;
  updatedAt: string;
}
export interface AgentRun {
  id: string;
  kind: string;
  status: string;
  lead_id: string | null;
  thread_id: string | null;
  tokens_in: number;
  tokens_out: number;
  cost_cents: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** queued rows only — the earliest-start the run is waiting on */
  run_at?: string | null;
  lead_name?: string | null;
  steps?: unknown[];
  params?: Record<string, unknown>;
}
export interface Stats {
  total: number;
  byState: Record<string, { count: number; valueCents: number }>;
  bySource: { key: string; count: number; valueCents: number }[];
  bySegment: { key: string; count: number; valueCents: number }[];
  everReached: Record<string, number>;
  medianDaysInState: Record<string, number>;
  /** leads that entered 'live' in the last 30d — the "won" read. */
  won30d: { count: number; valueCents: number };
  openTasks: number;
  overdueTasks: number;
  pendingDrafts: number;
  discoveredThisWeek: number;
  agent30d: { runs: number; tokens: number; costCents: number };
  forecast: {
    weightedCents: number;
    byState: Record<
      string,
      { count: number; valueCents: number; probability: number; weightedCents: number }
    >;
    trend: { takenOn: string; weightedCents: number; valueCents: number }[];
  };
}
export interface Snapshot {
  id: string;
  takenOn: string;
  byState: Record<string, { count: number; valueCents: number }>;
  weightedCents: number;
  agentCostCents: number;
  createdAt: string;
}
export interface DupeGroup {
  field: string;
  value: string;
  leads: { id: string; name: string; businessName: string | null; state: string }[];
}
export interface Brief {
  id: string;
  name: string;
  query: string;
  segment: string | null;
  city: string | null;
  target: number | null;
  enabled: boolean;
  last_run_at: string | null;
  created_at: string;
}
export interface SegmentStat {
  segment: string;
  leads: number;
  contacted: number;
  replied: number;
  live: number;
  costCents: number;
}
export interface Meeting {
  id: string;
  leadId: string | null;
  leadName: string | null;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'cancelled' | 'done' | 'no_show';
  roomUrl: string | null;
  bookerName: string | null;
  bookerContact: string | null;
  source: 'link' | 'staff' | 'agent';
  gcalEventId: string | null;
  reminder24hAt: string | null;
  reminder1hAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MeetingStatus {
  cfg: {
    roomUrl: string | null;
    publicBaseUrl: string;
    tz: string;
    slotMinutes: number;
    bufferMinutes: number;
    horizonDays: number;
    weekly: Record<string, [string, string][]>;
    bookingUrl: string | null;
  };
  room: { provider: 'daily' | 'static' };
  gcal: {
    configured: boolean;
    calendarId: string | null;
    clientEmail: string | null;
    lastError: string | null;
  };
}

// ---------- calls ----------
export const api = {
  login: (key: string) =>
    req<{ ok: true }>('/login', { method: 'POST', body: JSON.stringify({ key }) }),
  logout: () => req<{ ok: true }>('/logout', { method: 'POST' }),
  session: () => req<{ ok: true }>('/session'),

  leads: (q: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ leads: LeadListItem[]; nextCursor: string | null }>(
      `/leads${params.size ? `?${params}` : ''}`,
    );
  },
  createLead: (fields: Record<string, unknown>) =>
    req<{ lead: Lead; runId?: string }>('/leads', { method: 'POST', body: JSON.stringify(fields) }),
  lead: (id: string) => req<{ lead: LeadListItem }>(`/leads/${id}`),
  patchLead: (id: string, patch: Record<string, unknown>) =>
    req<{ lead: Lead }>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteLead: (id: string) => req<{ ok: true }>(`/leads/${id}`, { method: 'DELETE' }),
  unsubscribe: (id: string) => req<{ ok: true }>(`/leads/${id}/unsubscribe`, { method: 'POST' }),
  runOnLead: (id: string, kind: string, params?: Record<string, unknown>, threadId?: string) =>
    req<{ runId: string }>(`/leads/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({
        kind,
        ...(threadId ? { threadId } : {}),
        ...(params ? { params } : {}),
      }),
    }),
  stats: () => req<Stats>('/stats'),
  snapshotNow: () => req<{ snapshot: Snapshot }>('/stats/snapshot', { method: 'POST' }),
  duplicates: () => req<{ groups: DupeGroup[] }>('/leads/duplicates'),
  importCsv: (csv: string) =>
    req<{ created: number; skipped: { reason: string; name?: string }[] }>('/leads/import', {
      method: 'POST',
      headers: { 'content-type': 'text/csv' },
      body: csv,
    }),

  activities: (leadId: string) => req<{ activities: Activity[] }>(`/leads/${leadId}/activities`),
  addActivity: (leadId: string, kind: string, body: string) =>
    req<{ activity: Activity }>(`/leads/${leadId}/activities`, {
      method: 'POST',
      body: JSON.stringify({ kind, body }),
    }),
  leadThreads: (leadId: string) =>
    req<{ threads: { id: string; channel: string; agentEnabled: boolean }[] }>(
      `/leads/${leadId}/threads`,
    ),
  newThread: (leadId: string, channel: string) =>
    req<{ thread: { id: string; channel: string; agentEnabled: boolean } }>(
      `/leads/${leadId}/threads`,
      { method: 'POST', body: JSON.stringify({ channel }) },
    ),
  tasks: (q: { leadId?: string; done?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ tasks: Task[] }>(`/tasks${params.size ? `?${params}` : ''}`);
  },
  createTask: (leadId: string, title: string, dueAt?: string | null) =>
    req<{ task: Task }>(`/leads/${leadId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, dueAt: dueAt ?? null }),
    }),
  setTaskDone: (id: string, done: boolean) =>
    req<{ task: Task }>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),

  threads: (q: { channel?: string; q?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ threads: ThreadItem[] }>(`/threads${params.size ? `?${params}` : ''}`);
  },
  thread: (id: string) => req<ThreadView>(`/threads/${id}`),
  setThreadAgent: (id: string, enabled: boolean) =>
    req(`/threads/${id}/agent`, { method: 'POST', body: JSON.stringify({ enabled }) }),
  sendThreadMessage: (id: string, body: string, send: boolean) =>
    req<{ message: Message; sent?: { ok: boolean; reason?: string } }>(`/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, send }),
    }),

  approvals: () => req<{ drafts: Draft[] }>('/approvals'),
  approve: (id: string) =>
    req<{ message: Message; sent: { ok: boolean; reason?: string } }>(`/messages/${id}/approve`, {
      method: 'POST',
    }),
  reject: (id: string) => req<{ message: Message }>(`/messages/${id}/reject`, { method: 'POST' }),

  integrations: () => req<{ integrations: Integration[] }>('/integrations'),
  putIntegration: (kind: string, body: Record<string, unknown>) =>
    req<{ integration: Integration }>(`/integrations/${kind}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  settings: () => req<{ settings: { key: string; value: unknown }[] }>('/settings'),
  putSetting: (key: string, value: unknown) =>
    req<{ key: string; value: unknown }>(`/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  waQr: () =>
    req<{
      qr: string | null;
      status: string;
      /** the paired account, once the socket is open — null while unpaired */
      me: { phone: string | null; name: string | null } | null;
    }>('/wa/qr'),
  waPairCode: (phone: string) =>
    req<{ code: string }>('/wa/pair-code', { method: 'POST', body: JSON.stringify({ phone }) }),
  waLogout: () => req<{ ok: true }>('/wa/logout', { method: 'POST' }),
  testIntegration: (kind: string) =>
    req<{ ok: boolean; detail: string }>(`/integrations/${kind}/test`, { method: 'POST' }),

  runs: (q: { kind?: string; status?: string; lead_id?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ runs: AgentRun[] }>(`/agent/runs${params.size ? `?${params}` : ''}`);
  },
  run: (id: string) => req<{ run: AgentRun }>(`/agent/runs/${id}`),
  startRun: (kind: string, params: Record<string, unknown> = {}) =>
    req<{ runId: string }>('/agent/runs', {
      method: 'POST',
      body: JSON.stringify({ kind, params }),
    }),
  cancelRun: (id: string) =>
    req<{ ok: true; status?: string }>(`/agent/runs/${id}/cancel`, { method: 'POST' }),

  dispatch: (
    leadIds: string[],
    goal: 'negotiation' | 'meeting',
    channel?: 'auto' | 'whatsapp' | 'email',
  ) =>
    req<{ enqueued: number; skipped: { id: string; reason: string }[] }>('/agent/dispatch', {
      method: 'POST',
      body: JSON.stringify({ leadIds, goal, ...(channel ? { channel } : {}) }),
    }),
  briefs: () => req<{ briefs: Brief[] }>('/agent/briefs'),
  createBrief: (b: {
    name: string;
    query: string;
    segment?: string | null;
    city?: string | null;
    target?: number | null;
  }) => req<{ brief: Brief }>('/agent/briefs', { method: 'POST', body: JSON.stringify(b) }),
  patchBrief: (id: string, patch: Record<string, unknown>) =>
    req<{ brief: Brief }>(`/agent/briefs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteBrief: (id: string) => req<{ ok: true }>(`/agent/briefs/${id}`, { method: 'DELETE' }),
  segments: () => req<{ segments: SegmentStat[] }>('/agent/segments'),

  meetings: (q: { scope?: string; leadId?: string; from?: string; to?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries({ ...q, ...(q.leadId ? { lead_id: q.leadId } : {}) }).filter(
        ([k, v]) => v && k !== 'leadId',
      ) as [string, string][],
    );
    return req<{ meetings: Meeting[] }>(`/meetings${params.size ? `?${params}` : ''}`);
  },
  meetingsStatus: () => req<MeetingStatus>('/meetings/status'),
  bookingLink: (leadId: string) =>
    req<{ url: string }>(`/meetings/link?lead_id=${encodeURIComponent(leadId)}`),
  createMeeting: (body: { leadId: string; start: string; durationMin?: number }) =>
    req<{ meeting: Meeting }>('/meetings', { method: 'POST', body: JSON.stringify(body) }),
  patchMeeting: (id: string, patch: { status?: string; startsAt?: string; endsAt?: string }) =>
    req<{ meeting: Meeting }>(`/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

// typed /control/v1 client — cookie session, x-vendua-staff CSRF marker, per-mutation Idempotency-Key

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Core's `error.details` (e.g. `{ field }` on a 422) */
    public details?: Record<string, unknown> | undefined,
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
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    };
    throw new ApiError(
      res.status,
      data.error?.code ?? 'ERROR',
      data.error?.message ?? res.statusText,
      data.error?.details,
    );
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('json') ? res.json() : res.text()) as Promise<T>;
}

export interface AgentPlanStep {
  step: string;
  status: 'todo' | 'done' | 'skip';
  note: string | null;
}
export interface Lead {
  id: string;
  name: string;
  /** the store this lead became (Control Plane provisioning) */
  tenantId: string | null;
  businessName: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** proven evidence the number carries whatsapp (inbound/explicit write);
   *  false = discovery-derived from `phone` — send may not reach. */
  whatsappVerified: boolean;
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
  agentPlan: AgentPlanStep[];
  fitScore: number | null;
  fitReason: string | null;
  intentScore: number | null;
  intentReason: string | null;
  emailBouncedAt: string | null;
  nextActionAt: string | null;
  lostReason: string | null;
  archivedAt: string | null;
  unsubscribedAt: string | null;
  agentPausedAt: string | null;
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
  channel: 'email' | 'whatsapp' | 'instagram' | 'manual';
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
  agentRunId: string | null;
  /** compose-time subject snapshot — what actually dispatches (email) */
  subject: string | null;
  /** failure/rejection reason — 'falhou'/'rejeitado' rows carry it */
  error: string | null;
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
  /** compose-time subject snapshot — editing keeps the reviewed subject */
  subject: string | null;
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
export type DiscordLevel = 'off' | 'silent' | 'normal' | 'ping';
export interface DiscordKind {
  kind: string;
  category: string;
  level: DiscordLevel;
  label: string;
  hint: string | null;
  /** edits an earlier card; its level only governs the extra reply */
  follows: boolean;
}
export interface DiscordSetting {
  channels: Record<string, string>;
  levels: Record<string, DiscordLevel>;
  staffRoleId: string | null;
  digest: { enabled: boolean; hour: number };
  excerpts: boolean;
}
export interface DiscordOverview {
  catalog: {
    levels: DiscordLevel[];
    categories: { key: string; emoji: string; label: string; hint: string }[];
    kinds: DiscordKind[];
    channelKeys: string[];
  };
  app: {
    ok: boolean;
    reason: string | null;
    enabled: boolean;
    applicationId: string | null;
    guildId: string | null;
    publicKey: string | null;
    tokenEnv: string;
    tokenPresent: boolean;
    invite: string | null;
    endpointPath: string;
  };
  setting: DiscordSetting;
  state: {
    mutes: Record<string, string>;
    commands: { hash: string; at: string } | null;
    commandsCurrent: boolean;
    commandsError: { at: string; message: string } | null;
    lastError: { at: string; message: string } | null;
  };
  queue: {
    pending: number;
    failed: number;
    skipped: number;
    sent: number;
    last: string | null;
    oldest: string | null;
  };
  failures: { kind: string; error: string | null; at: string }[];
  team: { members: number; linked: number };
}
export interface DiscordGuild {
  guild: { id: string; name: string };
  channels: { id: string; name: string; category: string | null }[];
  roles: { id: string; name: string; color: number }[];
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
  /** why the run exists (ADR 0016) */
  source?: TriggerSource;
  /** a promise to the lead or staff — the preset never parks it */
  promised?: boolean;
  lead_name?: string | null;
  /** thread-bound runs only — staff pause holds the run queued */
  thread_agent_enabled?: boolean | null;
  steps?: unknown[];
  params?: Record<string, unknown>;
}
/** Privacy-first page views on the site or the admin: visitors are unique per day (a daily hash). */
export type WebProperty = 'site' | 'admin';
export type AnalyticsDays = 7 | 30 | 90;
export interface WebReport {
  property: WebProperty;
  days: AnalyticsDays;
  totals: { visitors: number; pageviews: number; prevVisitors: number; prevPageviews: number };
  series: { day: string; visitors: number; pageviews: number }[];
  pages: { path: string; visitors: number; pageviews: number }[];
  referrers: { referrer: string; visitors: number }[];
  campaigns: { source: string; medium: string; campaign: string; visitors: number }[];
  devices: { device: 'mobile' | 'tablet' | 'desktop'; visitors: number }[];
}
export interface StoreFunnel {
  sessions: number;
  pageviews: number;
  carts: number;
  checkouts: number;
  /** storefront checkouts that placed an order (the funnel's last step) */
  ordered: number;
  /** every channel's orders, cancelled and refunded left out */
  orders: number;
  revenueCents: number;
}
/** The storefront funnel across every store (Kernel beacon + Core's order_placed). */
export interface StorefrontReport {
  days: AnalyticsDays;
  totals: StoreFunnel & { stores: number; avgTicketCents: number | null };
  series: { day: string; sessions: number; orders: number }[];
  stores: (StoreFunnel & { tenantId: string; slug: string; name: string })[];
}

export interface AgentMetrics {
  window: { from: string; to: string };
  byKind: {
    kind: string;
    runs: number;
    done: number;
    failed: number;
    canceled: number;
    /** share of done runs whose journal holds a clean action tool result */
    actedRate: number;
    avgSteps: number;
    costUsd: number;
    avgCostUsd: number;
  }[];
  outbound: { sent: number; drafted: number; approved: number; rejected: number };
  replies: { leadsContacted: number; leadsReplied: number; replyRate: number };
  /** null until the agent_wakeups migration deploys */
  wakeups: { pending: number; fired: number } | null;
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
  /** Auto-pause reason or a strategist proposal's rationale — system-written. */
  note: string | null;
  /** 'strategist' = a proposed draft (starts disabled, staff approves). */
  created_by: 'staff' | 'strategist';
}
export interface SegmentStat {
  segment: string;
  leads: number;
  leads30d: number;
  contacted: number;
  replied: number;
  live: number;
  costCents: number;
  cplCents: number | null;
}
export interface IgAccount {
  username: string;
  name?: string;
  igid?: string;
  fbid?: string;
}
/** one screen of the instagram login wizard; 'wait' = approve elsewhere, then submit {} */
export interface IgStep {
  type: 'input' | 'wait' | 'complete';
  stepId: string;
  instructions: string;
  fields?: { id: string; name: string; type: string; options?: string[] }[];
  account?: IgAccount;
}
export interface IgStatus {
  state: 'off' | 'connecting' | 'open' | 'error';
  error?: { code: string; message: string } | null;
  account?: IgAccount | null;
  /** a login the sidecar still holds open — the card resumes it */
  login?: IgStep | null;
}
export interface ChannelHealth {
  channel: 'whatsapp' | 'instagram' | 'email';
  sent: number;
  failed: number;
  blocked: number;
  blockedByReason: Record<string, number>;
  bounced: number;
  failureRate: number | null;
  alert: boolean;
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
  room: { provider: 'daily' | 'static'; lastError: string | null };
  gcal: {
    configured: boolean;
    calendarId: string | null;
    clientEmail: string | null;
    lastError: string | null;
  };
}

export type AutonomyLevel = 'off' | 'copilot' | 'supervised' | 'autopilot';
export interface AutonomyReason {
  code: string;
  message: string;
}
export interface AutonomyExplanation {
  level: AutonomyLevel;
  canRun: boolean;
  sendMode: 'auto' | 'draft' | 'blocked';
  /** ordered — the first reason is the decisive one */
  reasons: AutonomyReason[];
}
export type RunKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
export interface Wakeup {
  id: string;
  leadId: string | null;
  leadName: string | null;
  kind: RunKind;
  at: string;
  focus: string;
  status: 'pending' | 'fired' | 'canceled';
  requested: boolean;
  createdBy: 'agent' | 'staff';
  createdByRunId: string | null;
  firedRunId: string | null;
  cancelReason: string | null;
  createdAt: string;
}
export interface LeadFact {
  key: string;
  value: string;
  confidence: number;
  source: 'agent' | 'staff';
  sourceRunId: string | null;
  updatedAt: string;
}

const apiBase = {
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
  /** The one way to ask the agent for work (ADR 0016): the board (no leads), one lead, or many. */
  requestAgent: (r: AgentRequest) =>
    req<AgentRequestResult>('/agent/requests', {
      method: 'POST',
      body: JSON.stringify(r),
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
  sendThreadMessage: (id: string, body: string, send: boolean, subject?: string) =>
    req<{ message: Message; sent?: { ok: boolean; reason?: string } }>(`/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body, send, ...(subject ? { subject } : {}) }),
    }),

  approvals: () => req<{ drafts: Draft[] }>('/approvals'),
  approve: (id: string) =>
    req<{
      message: Message;
      /** set when the draft was stale — superseded + a regen run queued */
      stale?: boolean;
      runId?: string;
      sent?: { ok: boolean; reason?: string };
    }>(`/messages/${id}/approve`, { method: 'POST' }),
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
  igStatus: () => req<IgStatus>('/ig/status'),
  igLoginStart: () => req<{ step: IgStep }>('/ig/login/start', { method: 'POST' }),
  igLoginSubmit: (input: Record<string, string>) =>
    req<{ step: IgStep }>('/ig/login/submit', { method: 'POST', body: JSON.stringify({ input }) }),
  igLoginCookies: (cookies: string) =>
    req<{ step: IgStep }>('/ig/login/cookies', {
      method: 'POST',
      body: JSON.stringify({ cookies }),
    }),
  igLoginCancel: () => req<{ ok: true }>('/ig/login/cancel', { method: 'POST' }),
  igLogout: () => req<{ ok: true }>('/ig/logout', { method: 'POST' }),
  testStaff: () =>
    req<{
      deliveries: {
        name: string;
        channel: 'email' | 'whatsapp';
        to: string;
        ok: boolean;
        error?: string;
      }[];
    }>('/staff/test', { method: 'POST' }),
  testIntegration: (kind: string) =>
    req<{ ok: boolean; detail: string }>(`/integrations/${kind}/test`, { method: 'POST' }),

  discord: () => req<DiscordOverview>('/discord'),
  discordGuild: () => req<DiscordGuild>('/discord/guild'),
  discordSetup: (staffRoleId: string) =>
    req<{ channels: Record<string, string>; created: string[] }>('/discord/setup', {
      method: 'POST',
      body: JSON.stringify({ staffRoleId }),
    }),
  discordTest: () =>
    req<{
      results: { channelId: string; categories: string[]; ok: boolean; error?: string }[];
    }>('/discord/test', { method: 'POST' }),
  discordCommands: () =>
    req<{ ok: boolean; error: string | null; commands: number }>('/discord/commands', {
      method: 'POST',
    }),
  discordMute: (category: string, minutes: number) =>
    req<{ mutes: Record<string, string> }>(`/discord/mutes/${category}`, {
      method: 'PUT',
      body: JSON.stringify({ minutes }),
    }),

  runs: (
    q: {
      kind?: string;
      status?: string;
      lead_id?: string;
      limit?: string;
      scheduled?: string;
      cursor?: string;
    } = {},
  ) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ runs: AgentRun[]; nextCursor?: string }>(
      `/agent/runs${params.size ? `?${params}` : ''}`,
    );
  },
  run: (id: string) => req<{ run: AgentRun }>(`/agent/runs/${id}`),
  cancelRun: (id: string) =>
    req<{ ok: true; status?: string }>(`/agent/runs/${id}/cancel`, { method: 'POST' }),

  agentMetrics: (days: 7 | 30 = 7) => req<AgentMetrics>(`/agent/metrics?days=${days}`),

  webAnalytics: (property: WebProperty, days: AnalyticsDays) =>
    req<WebReport>(`/analytics/web?property=${property}&days=${days}`),
  storefrontAnalytics: (days: AnalyticsDays) =>
    req<StorefrontReport>(`/analytics/storefronts?days=${days}`),

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
  channelHealth: () => req<{ channels: ChannelHealth[] }>('/channels/health'),

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
  patchMeeting: (id: string, patch: { status?: string; startsAt?: string; endsAt?: string }) =>
    req<{ meeting: Meeting }>(`/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  leadAutonomy: (id: string) => req<AutonomyExplanation>(`/leads/${id}/autonomy`),
  leadFacts: (id: string) => req<{ facts: LeadFact[] }>(`/leads/${id}/facts`),
  putLeadFact: (id: string, key: string, body: { value: string; confidence?: number }) =>
    req<{ fact: LeadFact }>(`/leads/${id}/facts/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteLeadFact: (id: string, key: string) =>
    req<{ ok: true }>(`/leads/${id}/facts/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  wakeups: (q: { lead_id?: string; status?: string; limit?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ wakeups: Wakeup[] }>(`/agent/wakeups${params.size ? `?${params}` : ''}`);
  },
  cancelWakeup: (id: string) =>
    req<{ wakeup: Wakeup }>(`/agent/wakeups/${id}/cancel`, { method: 'POST' }),
};

export const AUTONOMY_LEVELS = ['off', 'copilot', 'supervised', 'autopilot'] as const;

/** Jobs automation can start (triage is staff-only). */
export const AGENT_JOBS = ['reply', 'outreach', 'discovery', 'strategist'] as const;
export type AgentJob = (typeof AGENT_JOBS)[number];

/** Why a run exists (ADR 0016). */
export type TriggerSource =
  | 'inbound'
  | 'callback'
  | 'staff'
  | 'regenerate'
  | 'first_contact'
  | 'followup'
  | 'brief'
  | 'weekly';

export interface AgentRequest {
  kind: RunKind;
  /** none = a board-level run (discovery hunt, weekly review) */
  leadIds?: string[];
  threadId?: string;
  focus?: string;
  channel?: 'auto' | 'whatsapp' | 'instagram' | 'email';
  draftOnly?: boolean;
  goal?: 'negotiation' | 'meeting';
  params?: Record<string, unknown>;
}
export interface AgentRequestResult {
  runId?: string;
  runs: { leadId: string | null; runId: string; startAt: string | null }[];
  skipped: { leadId: string; code: string; reason: string }[];
}

/** One scheduler routine — GET /agent/routines. */
export interface Routine {
  name: string;
  label: string;
  cadence: string;
  enabled: boolean;
  nextAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastResult: number | null;
  lastWorkAt: string | null;
  failingSince: string | null;
  runs: number;
  failures: number;
}

/** when the recurring jobs run, in the workspace timezone */
export interface AgentSchedule {
  discoveryHour: number;
  /** 0 = Sunday … 6 = Saturday */
  weeklyDay: number;
  weeklyHour: number;
}

/** The `agent` setting — the one agent config policy.ts reads (ADR 0015). */
export interface AgentConfig {
  level: AutonomyLevel;
  /** false = that job's automation parks; staff runs and lead-asked callbacks still run */
  jobs: Record<AgentJob, boolean>;
  /** ≤8000 chars — standing rules every run carries in its system prompt */
  instructions: string;
  /** strategist self-approves proposed briefs while trailing-7d discovery spend stays under this. 0 = never. */
  weeklyDiscoveryUsd: number;
  schedule: AgentSchedule;
  /** mode a lead starts in when staff didn't pick one: 'auto' follows the level, 'draft' holds every message */
  newLeadMode: { inbound: 'draft' | 'auto'; discovery: 'draft' | 'auto' };
}

export type MemoryScope = 'workspace' | 'segment' | 'debrief';
export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  segment: string | null;
  /** ≤500 */
  content: string;
  pinned: boolean;
  source: 'agent' | 'staff' | 'debrief';
  sourceRunId: string | null;
  uses: number;
  createdAt: string;
  updatedAt: string;
}

const agentV2 = {
  /** the `agent` setting with defaults applied; the Studio writes via putSetting. */
  agentConfig: () => req<AgentConfig>('/agent/config'),
  routines: () => req<{ routines: Routine[] }>('/agent/routines'),

  memory: (q: { scope?: MemoryScope; segment?: string } = {}) => {
    const params = new URLSearchParams(
      Object.entries(q).filter(([, v]) => v) as [string, string][],
    );
    return req<{ items: MemoryItem[] }>(`/agent/memory${params.size ? `?${params}` : ''}`);
  },
  createMemory: (b: { scope: MemoryScope; segment?: string; content: string }) =>
    req<{ item: MemoryItem }>('/agent/memory', { method: 'POST', body: JSON.stringify(b) }),
  patchMemory: (id: string, patch: { content?: string; pinned?: boolean }) =>
    req<{ item: MemoryItem }>(`/agent/memory/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteMemory: (id: string) => req<{ ok: true }>(`/agent/memory/${id}`, { method: 'DELETE' }),
};

// ── self-serve fleet: billing, plans, custom domains, site requests, incidents ──

export type SubscriptionStatus = 'pending' | 'trialing' | 'active' | 'past_due' | 'cancelled';
export type MpStatus = 'connected' | 'expiring' | 'disconnected' | 'restricted';
export type CustomDomainStatus = 'pending_dns' | 'dns_ok' | 'active' | 'failed';
export type SiteRequestStatus = 'requested' | 'in_progress' | 'delivered' | 'cancelled';
export type IncidentSeverity = 'info' | 'degraded' | 'outage';

export interface BillingStore {
  tenantId: string;
  slug: string;
  name: string;
  createdAt: string;
  /** the store's public origin (primary domain first), Core's */
  url: string;
  plan: { id: string; name: string };
  subscription: {
    status: SubscriptionStatus;
    method: 'card' | 'pix';
    currentPeriodEnd: string | null;
    /** set while trialing, kept after it converts (marks the trial used) */
    trialEndsAt: string | null;
  } | null;
  mercadoPago: MpStatus | null;
  customDomain: { id: string; host: string; status: CustomDomainStatus } | null;
  siteRequest: {
    id: string;
    status: SiteRequestStatus;
    brief: string | null;
    staffNote?: string | null | undefined;
  } | null;
  /** the oldest plan invoice still to pay — "marcar como pago" settles it */
  openInvoice?: {
    id: string;
    number: number;
    amountCents: number;
    kind: 'period' | 'upgrade';
    periodStart: string;
    dueAt: string;
  } | null;
}
export interface ControlPlan {
  id: string;
  name: string;
  priceCents: number | null;
  feeBps: number;
  features: { customDomain: boolean; customSite: boolean };
  public: boolean;
  sort: number;
  /** free days before the first charge for new stores; 0 = no trial */
  trialDays: number;
}
export interface Incident {
  id: string;
  title: string;
  body: string | null;
  severity: IncidentSeverity;
  startedAt: string;
  resolvedAt: string | null;
}

const fleet = {
  billingStores: () => req<{ stores: BillingStore[] }>('/billing/stores'),
  controlPlans: () => req<{ plans: ControlPlan[] }>('/plans'),
  patchPlan: (
    id: string,
    patch: { name?: string; priceCents?: number; public?: boolean; trialDays?: number },
  ) =>
    req<unknown>(`/plans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  markInvoicePaid: (id: string) =>
    req<{ ok: boolean }>(`/billing/invoices/${id}/mark-paid`, { method: 'POST' }),
  activateDomain: (id: string) =>
    req<{ ok: boolean }>(`/custom-domains/${id}/activate`, { method: 'POST' }),
  patchSiteRequest: (id: string, patch: { status: SiteRequestStatus; staffNote?: string }) =>
    req<{ ok: boolean }>(`/site-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  incidents: () => req<{ incidents: Incident[] }>('/incidents'),
  createIncident: (b: { title: string; body?: string; severity: IncidentSeverity }) =>
    req<unknown>('/incidents', { method: 'POST', body: JSON.stringify(b) }),
  patchIncident: (
    id: string,
    patch: { title?: string; body?: string; severity?: IncidentSeverity; resolved?: true },
  ) => req<unknown>(`/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

// ── control plane (/fleet): releases on the pointer, probes, provisioner, ops incidents ──

export type ReleasePolicy = 'auto' | 'pinned';
export type ProbeStatus = 'unknown' | 'ok' | 'failing';
export type DeploymentKind = 'promote' | 'rollback' | 'auto' | 'provision';
export type DeploymentStatus = 'pending' | 'live' | 'failed' | 'rolled_back' | 'superseded';
export type ProvisionState = 'release' | 'verify' | 'invite' | 'live';
export type FleetSeverity = 'warning' | 'critical';

export interface FleetStatus {
  /** false = the prober is off in this environment */
  probes: boolean;
  stores: number;
  live: number;
  pinned: number;
  maintenance: number;
  pendingDeployments: number;
  probedHosts: number;
  failingHosts: number;
  provisioning: number;
  kernels: { version: string; stores: number }[];
  bundles: {
    bundle: string;
    latestRelease: string | null;
    kernelVersion: string | null;
    publishedAt: string | null;
    stores: number;
    behind: number;
  }[];
  openIncidents: { warning: number; critical: number };
}

export interface FleetStorefront {
  tenantId: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  createdAt: string;
  bundle: string;
  bundleLocked: boolean;
  ring: string;
  policy: ReleasePolicy;
  pinnedReason: string | null;
  maintenance: boolean;
  host: string | null;
  hosts: string[];
  live: { release: string; kernelVersion: string | null; since: string | null } | null;
  latestRelease: string | null;
  behind: boolean;
  probe: {
    status: ProbeStatus;
    checkedAt: string | null;
    error: string | null;
    latencyMs: number | null;
    release: string | null;
  } | null;
  deployment: {
    id: string;
    status: DeploymentStatus;
    kind: DeploymentKind;
    release: string;
    startedAt: string;
  } | null;
  provisioning: { id: string; state: ProvisionState; lastError: string | null } | null;
  openIncidents: number;
}

export interface FleetDeployment {
  id: string;
  tenantId: string;
  release: string;
  previousRelease: string | null;
  kind: DeploymentKind;
  status: DeploymentStatus;
  actor: string;
  reason: string | null;
  detail: string | null;
  startedAt: string;
  finishedAt: string | null;
  kernelVersion?: string | undefined;
}

export interface FleetRelease {
  id: string;
  bundle: string;
  kernelVersion: string;
  contract: string | null;
  commit: string | null;
  qaStatus: 'passed' | 'failed';
  qa: { id: string; ok: boolean; detail?: string }[] | null;
  budgets: Record<string, number> | null;
  fileCount: number | null;
  builtAt: string;
  publishedAt: string;
}

export interface ProbeCheck {
  id: 'page' | 'loader' | 'state' | 'checkout';
  ok: boolean;
  detail?: string | undefined;
}

export interface FleetIncident {
  id: string;
  tenantId: string | null;
  /** store slug */
  tenant: string | null;
  kind: string;
  severity: FleetSeverity;
  subject: string;
  summary: string;
  openedAt: string;
  ackedAt: string | null;
  resolvedAt: string | null;
}

export interface Provisioning {
  id: string;
  tenantId: string;
  /** store slug */
  tenant: string | null;
  /** the store's primary host */
  host: string | null;
  storeName: string | null;
  source: 'signup' | 'invite';
  leadId: string | null;
  leadName: string | null;
  state: ProvisionState;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  log: { at: string; state: string; note: string }[];
  createdBy: string | null;
  createdAt: string;
  liveAt: string | null;
}

export interface FleetStorefrontDetail extends FleetStorefront {
  deployments: FleetDeployment[];
  releases: FleetRelease[];
  probes: {
    host: string;
    status: ProbeStatus;
    failures: number;
    failingSince: string | null;
    checkedAt: string | null;
    okAt: string | null;
    error: string | null;
    release: string | null;
    latencyMs: number | null;
  }[];
  healthChecks: {
    id: string;
    host: string;
    at: string;
    ok: boolean;
    latencyMs: number | null;
    release: string | null;
    checks: ProbeCheck[] | null;
  }[];
  incidents: FleetIncident[];
  provisioningDetail: Provisioning | null;
}

export interface ProvisionInput {
  leadId?: string | undefined;
  slug: string;
  storeName: string;
  planId: string;
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
}

const enc = encodeURIComponent;
const controlPlane = {
  fleetStatus: () => req<FleetStatus>('/fleet/status'),
  fleetStorefronts: () => req<{ storefronts: FleetStorefront[] }>('/fleet/storefronts'),
  fleetStorefront: (slug: string) =>
    req<{ storefront: FleetStorefrontDetail | null }>(`/fleet/storefronts/${enc(slug)}`),
  patchStorefront: (
    slug: string,
    patch: { policy?: ReleasePolicy; bundle?: string; reason?: string },
  ) =>
    req<{ deployment: FleetDeployment | null }>(`/fleet/storefronts/${enc(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  promote: (slug: string, b: { release: string; reason?: string }) =>
    req<{ deployment: FleetDeployment | null; policy: ReleasePolicy }>(
      `/fleet/storefronts/${enc(slug)}/promote`,
      { method: 'POST', body: JSON.stringify(b) },
    ),
  rollback: (slug: string, b: { reason?: string }) =>
    req<{ deployment: FleetDeployment }>(`/fleet/storefronts/${enc(slug)}/rollback`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  probe: (slug: string) =>
    req<{
      results: {
        host: string;
        result: { ok: boolean; latencyMs: number; release: string | null; checks: ProbeCheck[] };
      }[];
    }>(`/fleet/storefronts/${enc(slug)}/probe`, { method: 'POST' }),
  provisionings: (leadId?: string) =>
    req<{ provisionings: Provisioning[] }>(
      `/fleet/provisionings${leadId ? `?leadId=${enc(leadId)}` : ''}`,
    ),
  createProvisioning: (b: ProvisionInput) =>
    req<{ provisioning: Provisioning }>('/fleet/provisionings', {
      method: 'POST',
      body: JSON.stringify(b),
    }),
  retryProvisioning: (id: string) =>
    req<{ provisioning: Provisioning }>(`/fleet/provisionings/${id}/retry`, { method: 'POST' }),
  slugStatus: (slug: string) =>
    req<{
      slug: string;
      available: boolean;
      reason?: 'taken' | 'reserved' | 'invalid';
      suggestion?: string;
    }>(`/fleet/slug?slug=${enc(slug)}`),
  fleetIncidents: () => req<{ incidents: FleetIncident[] }>('/fleet/incidents'),
  patchFleetIncident: (id: string, patch: { ack: true } | { resolved: true }) =>
    req<{ incident: FleetIncident }>(`/fleet/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};

// one client — the v2 section merges in so callers keep a single import

/** A menu import (docs/menu-import.md) — the subset the CRM shows. */
export interface MenuImport {
  id: string;
  platform: string;
  sourceUrl: string;
  status: 'reading' | 'ready' | 'failed' | 'applying' | 'applied' | 'expired';
  errorCode: 'NOT_FOUND' | 'BLOCKED' | 'UNREADABLE' | 'TOO_LARGE' | 'TIMEOUT' | null;
  createdAt: string;
  counts: {
    categories: number;
    products: number;
    hidden: number;
    photos: number;
    optionGroups: number;
    hours: number;
    zones: number;
    paymentMethods: number;
    pix: boolean;
    logo: boolean;
    cover: boolean;
    lost: number;
  } | null;
  preview: {
    store: { name?: string | undefined };
    categories: {
      name: string;
      products: { name: string; priceCents: number; status: string }[];
    }[];
  } | null;
  lost: {
    scope: 'store' | 'category' | 'product';
    subject?: string;
    code: string;
    detail?: string;
  }[];
  result: { products: number; hidden: number; archived: number; images: number } | null;
  images: { total: number; done: number; failed: number; finished: boolean };
}
export type ImportSection = 'profile' | 'hours' | 'delivery';

const menuImports = {
  storeImports: (slug: string) =>
    req<{ imports: MenuImport[] }>(`/stores/${encodeURIComponent(slug)}/imports`),
  startStoreImport: (slug: string, url: string) =>
    req<{ id: string; platform: string }>(`/stores/${encodeURIComponent(slug)}/imports`, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  menuImport: (id: string) => req<MenuImport>(`/imports/${encodeURIComponent(id)}`),
  applyMenuImport: (id: string, body: { mode: 'add' | 'replace'; sections: ImportSection[] }) =>
    req<MenuImport>(`/imports/${encodeURIComponent(id)}/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  discardMenuImport: (id: string) =>
    req<MenuImport>(`/imports/${encodeURIComponent(id)}/discard`, { method: 'POST' }),
};

export const api = Object.assign(apiBase, agentV2, fleet, { ...controlPlane, ...menuImports });

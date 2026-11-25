/** Reads a discovery run's journal into what the live stage shows: tool lines and found leads. */

export interface Step {
  type: string;
  name?: string;
  args?: Record<string, unknown>;
  out?: Record<string, unknown> | null;
  content?: unknown;
  /** journal holds {name,args,id} objects; older rows may hold bare names */
  toolCalls?: unknown[];
  pending?: boolean;
}

export interface FoundLead {
  key: string;
  id: string | null;
  name: string;
  city: string | null;
  segment: string | null;
  fitScore: number | null;
  intentScore: number | null;
  intentReason: string | null;
  contact: string[];
  duplicate: boolean;
}

/** "book ×5, read_pages" from a model step's tool calls: a parallel burst reads as one line. */
export const callNames = (calls: unknown[]) => {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const name = typeof c === 'string' ? c : String((c as { name?: unknown } | null)?.name ?? '?');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
};

export const TARGETS = [3, 5, 10, 15] as const;

export const TOOL_LABEL: Record<string, string> = {
  web_search: 'buscando na web',
  serp: 'buscando no Google',
  extract_page: 'lendo página',
  read_pages: 'lendo páginas',
  maps_lookup: 'olhando o Maps',
  instagram_profile: 'abrindo Instagram',
  plan: 'traçando o plano',
  book: 'anotando prospect',
  create_lead: 'criando lead',
  search_leads: 'olhando o CRM',
  get_lead: 'abrindo lead',
  update_lead: 'atualizando lead',
  add_note: 'anotando',
  remember: 'memorizando',
  draft_message: 'redigindo',
  send_message: 'enviando',
};

const BOOK_STATUS: Record<string, string> = {
  open: 'pesquisando',
  resolved: 'resolvido',
  dead: 'descartado',
};

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const argHint = (s: Step): string => {
  const a = s.args ?? {};
  switch (s.name) {
    case 'web_search':
    case 'serp':
      return String(a.query ?? '');
    case 'maps_lookup':
      return [a.query, a.city].filter(Boolean).join(' · ');
    case 'instagram_profile': {
      const h = String(a.handle ?? '').replace(/^@/, '');
      return h ? `@${h}` : '';
    }
    case 'book':
      if (a.action === 'list') return 'relendo o caderno';
      return [a.name, typeof a.status === 'string' ? BOOK_STATUS[a.status] : null]
        .filter(Boolean)
        .join(' · ');
    case 'extract_page':
      return String(a.url ?? '')
        .replace(/^https?:\/\//, '')
        .slice(0, 60);
    case 'read_pages': {
      const urls = (Array.isArray(a.urls) ? a.urls : [a.url])
        .map((u) => String(u ?? '').replace(/^https?:\/\//, ''))
        .filter(Boolean);
      const head = urls
        .slice(0, 2)
        .map((u) => u.slice(0, 40))
        .join(' · ');
      return urls.length > 2 ? `${head} +${urls.length - 2}` : head;
    }
    case 'create_lead':
      return [a.name, a.city].filter(Boolean).join(' · ');
    default:
      return '';
  }
};

export const outHint = (s: Step): string => {
  const o = s.out;
  if (o == null) return '';
  if (o.error) return String(o.error).slice(0, 60);
  if (o.duplicate) {
    const merged = o.merged;
    const base =
      Array.isArray(merged) && merged.length
        ? `somou ${merged.length} campo${merged.length === 1 ? '' : 's'} no existente`
        : 'já estava no CRM';
    return `${base}${o.contactRun ? ' · contato auto' : ''}`;
  }
  if (s.name === 'create_lead' && createdLeadId(o)) {
    if (o.lowFit === true) return '+ registro (fit baixo)';
    return `+ lead${o.contactRun || o.firstContactQueued ? ' · contato auto' : ''}`;
  }
  if (s.name === 'web_search' || s.name === 'serp') {
    const results = o.results;
    if (Array.isArray(results)) return plural(results.length, 'resultado', 'resultados');
  }
  if (s.name === 'read_pages') {
    const pages = o.pages;
    if (Array.isArray(pages)) return plural(pages.length, 'página', 'páginas');
  }
  if (s.name === 'maps_lookup' && Array.isArray(o.candidates))
    return plural(o.candidates.length, 'lugar', 'lugares');
  if (s.name === 'instagram_profile') {
    const followers = rec(o.profile).followers;
    const days = rec(o.activity).daysSinceLastPost;
    const bits = [
      typeof followers === 'number' ? `${followers.toLocaleString('pt-BR')} seguidores` : null,
      typeof days === 'number' ? `post há ${days}d` : null,
    ].filter(Boolean);
    if (bits.length) return bits.join(' · ');
  }
  if (s.name === 'book') {
    const e = rec(o.entry);
    const channels = Object.keys(rec(e.channels));
    if (e.status === 'dead') return 'descartado';
    if (e.status === 'resolved') return channels.length ? `✓ ${channels.join(' + ')}` : 'resolvido';
    if (channels.length) return channels.join(' + ');
  }
  if (o.blocked) return `bloqueado: ${String(o.reason ?? '').slice(0, 60)}`;
  return 'ok';
};

export const isToolError = (s: Step) => !!s.out && (!!s.out.error || !!s.out.blocked);

/** The lead a create_lead step filed. The tool hands the model only an alias (`lead.ref`, "l1")
 *  and keeps the real id beside it in `leadId`; older journals carried it as `lead.id`. */
function createdLeadId(o: Record<string, unknown>): string | null {
  if (o.duplicate === true) return null;
  if (typeof o.leadId === 'string' && o.created !== false) return o.leadId;
  const id = rec(o.lead).id;
  return typeof id === 'string' ? id : null;
}

export const fmtClock = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
};

export function foundLeads(steps: Step[]): FoundLead[] {
  const out: FoundLead[] = [];
  for (const s of steps) {
    if (s.type !== 'tool' || s.name !== 'create_lead' || s.pending) continue;
    const a = s.args ?? {};
    const o = s.out ?? {};
    const dup = o.duplicate === true;
    const id = dup ? (typeof o.leadId === 'string' ? o.leadId : null) : createdLeadId(o);
    if (!id && !dup) continue;
    const contact = [
      a.whatsapp || a.phone ? 'whatsapp' : '',
      a.email ? 'email' : '',
      a.instagram ? 'instagram' : '',
      a.website ? 'site' : '',
    ].filter(Boolean);
    out.push({
      key: `${out.length}`,
      id,
      name: String(a.name ?? '—'),
      city: typeof a.city === 'string' ? a.city : null,
      segment: typeof a.segment === 'string' ? a.segment : null,
      fitScore: typeof a.fitScore === 'number' ? a.fitScore : null,
      intentScore: typeof a.intentScore === 'number' ? a.intentScore : null,
      intentReason: typeof a.intentReason === 'string' ? a.intentReason : null,
      contact,
      duplicate: dup,
    });
  }
  return out;
}

export const STAGE_TITLE: Record<string, string> = {
  done: 'a caçada terminou.',
  failed: 'a caçada tropeçou.',
  canceled: 'caçada cancelada.',
  queued: 'acordando o agente…',
  running: 'a máquina está caçando.',
};

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

/** "web_search, create_lead" from a model step's tool calls. */
export const callNames = (calls: unknown[]) =>
  calls
    .map((c) => (typeof c === 'string' ? c : String((c as { name?: unknown } | null)?.name ?? '?')))
    .join(', ');

export const TARGETS = [3, 5, 10, 15] as const;

export const TOOL_LABEL: Record<string, string> = {
  web_search: 'buscando na web',
  extract_page: 'lendo página',
  read_pages: 'lendo páginas',
  create_lead: 'criando lead',
  search_leads: 'olhando o CRM',
  get_lead: 'abrindo lead',
  update_lead: 'atualizando lead',
  add_note: 'anotando',
  remember: 'memorizando',
  draft_message: 'redigindo',
  send_message: 'enviando',
};

export const argHint = (s: Step): string => {
  const a = s.args ?? {};
  switch (s.name) {
    case 'web_search':
      return String(a.query ?? '');
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
  const lead = o.lead as { id?: string } | undefined;
  if (s.name === 'create_lead' && lead?.id) {
    return `+ lead${o.contactRun ? ' · contato auto' : ''}`;
  }
  if (s.name === 'web_search') {
    const results = o.results;
    if (Array.isArray(results))
      return `${results.length} resultado${results.length === 1 ? '' : 's'}`;
  }
  if (s.name === 'read_pages') {
    const pages = o.pages;
    if (Array.isArray(pages)) return `${pages.length} página${pages.length === 1 ? '' : 's'}`;
  }
  if (o.blocked) return `bloqueado: ${String(o.reason ?? '').slice(0, 60)}`;
  return 'ok';
};

export const isToolError = (s: Step) => !!s.out && (!!s.out.error || !!s.out.blocked);

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
    const created = s.out?.lead as { id?: string } | undefined;
    const dup = s.out?.duplicate === true;
    if (!created?.id && !dup) continue;
    const contact = [
      a.whatsapp || a.phone ? 'whatsapp' : '',
      a.email ? 'email' : '',
      a.instagram ? 'instagram' : '',
      a.website ? 'site' : '',
    ].filter(Boolean);
    out.push({
      key: `${out.length}`,
      id: created?.id ?? null,
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

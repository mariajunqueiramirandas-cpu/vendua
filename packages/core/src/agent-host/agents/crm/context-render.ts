// Pure renderers for the run context: the model reads a dated transcript and a trimmed
// lead card, not raw rows — a JSON dump buries "what did she just say" under ids and nulls.

const safeTz = (tz: string): string => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'America/Sao_Paulo';
  }
};

/** "AGORA: sexta-feira, 26/09/2026 19:07 (America/Sao_Paulo)" — anchors greetings and relative dates. */
export function nowLine(now: Date, tz: string): string {
  const zone = safeTz(tz);
  const s = new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  return `AGORA: ${s.replace(' às ', ' ')} (${zone})`;
}

function stamp(at: string | Date, tz: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '?';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: safeTz(tz),
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${(p.weekday ?? '').replace('.', '')} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

// agent_plan renders as PLANO; the rest is bookkeeping the model never acts on
const CARD_SKIP = new Set(['agent_plan', 'updated_at', 'next_action_source']);

export function leadCard(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([k, v]) =>
        !CARD_SKIP.has(k) &&
        v !== null &&
        v !== undefined &&
        v !== '' &&
        !(Array.isArray(v) && v.length === 0),
    ),
  );
}

/** true when the lead's name is still just its contact (inbound from an unnamed number/email) */
export function nameIsContact(name: unknown): boolean {
  const n = typeof name === 'string' ? name.trim() : '';
  return !n || n.includes('@') || !/\p{L}/u.test(n);
}

export interface TranscriptMessage {
  direction: 'in' | 'out';
  body: string | null;
  status: string;
  author: string;
  created_at: string | Date;
  channel?: string;
}

const STATUS_NOTE: Record<string, string> = {
  draft: 'rascunho aguardando aprovação, ela ainda não viu',
  rejected: 'rascunho descartado pela equipe, não saiu',
  failed: 'falhou, não chegou',
  queued: 'na fila de envio',
  sending: 'na fila de envio',
};

/** One line per message, oldest first: `[sex 26/09 19:07] LEAD: Ola`. */
export function renderTranscript(
  msgs: readonly TranscriptMessage[],
  tz: string,
  opts: { tagChannel?: boolean } = {},
): string {
  return msgs.length ? transcriptEntries(msgs, tz, opts).join('\n') : '(nenhuma mensagem ainda)';
}

// one entry per message — a body may span several lines, so budgeting works on entries
function transcriptEntries(
  msgs: readonly TranscriptMessage[],
  tz: string,
  opts: { tagChannel?: boolean },
): string[] {
  return msgs.map((m) => {
    const who =
      m.direction === 'in'
        ? 'LEAD'
        : m.author === 'staff'
          ? 'VENDUÁ (equipe)'
          : m.author === 'system'
            ? 'SISTEMA'
            : 'VENDUÁ (agente)';
    const notes = [opts.tagChannel && m.channel, STATUS_NOTE[m.status]].filter(Boolean);
    const body = (m.body ?? '').trim() || '(vazio)';
    return `[${stamp(m.created_at, tz)}] ${who}${notes.length ? ` (${notes.join(', ')})` : ''}: ${body}`;
  });
}

/** Fits a conversation into a character budget: the opening (how it started, who reached
 *  out) plus as much of the recent tail as fits, with a marker where the middle was cut.
 *  A frontier model reads 60k characters of transcript easily; the cut only bites on
 *  months-long threads, and PLANO/FATOS/DOSSIÊ carry what the middle established. */
export function fitTranscript(
  msgs: readonly TranscriptMessage[],
  tz: string,
  opts: { budget: number; head?: number; tagChannel?: boolean },
): string {
  if (!msgs.length) return renderTranscript(msgs, tz, opts);
  const lines = transcriptEntries(msgs, tz, opts);
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= opts.budget) return lines.join('\n');
  const head = lines.slice(0, Math.min(opts.head ?? 4, lines.length));
  let room = opts.budget - head.reduce((n, l) => n + l.length + 1, 0);
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= head.length; i--) {
    const l = lines[i]!;
    if (room - l.length - 1 < 0 && tail.length) break;
    tail.unshift(l);
    room -= l.length + 1;
  }
  const cut = lines.length - head.length - tail.length;
  return [
    ...head,
    ...(cut > 0
      ? [
          `[… ${cut} mensagens do meio fora do contexto; o que elas estabeleceram está em PLANO, FATOS e DOSSIÊ …]`,
        ]
      : []),
    ...tail,
  ].join('\n');
}

// Telegram HTML message shapes and the pt-BR formatting every card shares.
// HTML parse_mode only requires escaping &, <, > (unlike MarkdownV2), never fails on user
// punctuation, and supports <b>, <i>, <s>, <code>, <pre>, <blockquote>, <blockquote expandable>,
// and <a href="…">. Telegram limits: 4096 chars text, 64 UTF-8 bytes callback_data.

export type ButtonStyle = 'primary' | 'success' | 'danger';

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  /** Bot API 9.4 button color: primary (blue), success (green), danger (red) */
  style?: ButtonStyle;
}

export interface TelegramMessage {
  /** HTML-formatted message body (clamped to 4096 chars by fitMessage) */
  text: string;
  /** Inline keyboard rows (each row is an array of buttons) */
  buttons?: InlineButton[][];
  /** Send as a Telegram ForceReply prompt with this placeholder (≤64 chars) */
  forceReply?: string;
  /** Disable URL link previews (default true so cards stay compact) */
  disablePreview?: boolean;
}

export interface TelegramReplyMarkup {
  inline_keyboard: InlineButton[][];
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const USD = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const INT = new Intl.NumberFormat('pt-BR');
const DEFAULT_TZ = 'America/Sao_Paulo';

export const brl = (cents: number) => BRL.format(cents / 100);
/** crm_turns.cost_cents is metered in USD (model/tool pricing) — never BRL */
export const usd = (cents: number) => USD.format(cents / 100);
export const int = (n: number) => INT.format(n);

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** Escapes HTML special characters for Telegram's HTML parse_mode. */
export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const b = (s: string) => `<b>${s}</b>`;
export const i = (s: string) => `<i>${s}</i>`;
export const strike = (s: string) => `<s>${s}</s>`;
export const mono = (s: string) => `<code>${esc(s)}</code>`;

export function link(labelText: string, url: string | null | undefined): string {
  if (!url || !/^https?:\/\//.test(url)) return labelText;
  return `<a href="${esc(url)}">${labelText}</a>`;
}

/** Formats an instant in pt-BR Brasília (or caller timezone). */
export function ts(
  at: string | Date | null | undefined,
  style: 'R' | 'f' | 'F' | 't' | 'd' = 'f',
  tz = DEFAULT_TZ,
  now = new Date(),
): string {
  if (!at) return '—';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '—';
  if (style === 't') {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  }
  if (style === 'd') {
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
  }
  if (style === 'F') {
    const day = d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tz,
    });
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    return `${day} às ${hm}`;
  }
  if (style === 'R') {
    const diffMin = Math.round((d.getTime() - now.getTime()) / 60_000);
    const abs = Math.abs(diffMin);
    if (abs < 1) return 'agora';
    const unit =
      abs < 60
        ? `${abs} min`
        : abs < 48 * 60
          ? `${Math.floor(abs / 60)}h${abs % 60 ? `${abs % 60}m` : ''}`
          : `${Math.round(abs / (24 * 60))}d`;
    return diffMin < 0 ? `há ${unit}` : `em ${unit}`;
  }
  const day = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return `${day} ${hm}`;
}

/** A quoted block of user text: escaped, line-capped, length-capped. Long quotes collapse. */
export function quote(s: string | null | undefined, max = 900, maxLines = 12): string {
  if (!s?.trim()) return '';
  const raw = s.trim().split('\n').slice(0, maxLines).join('\n');
  const trimmed = clip(raw, max);
  const expandable = trimmed.length > 260 || trimmed.split('\n').length > 5;
  return expandable
    ? `<blockquote expandable>${esc(trimmed)}</blockquote>`
    : `<blockquote>${esc(trimmed)}</blockquote>`;
}

/** Error text in a preformatted code block. */
export function code(s: string, max = 700): string {
  return `<pre>${esc(clip(s, max))}</pre>`;
}

export function duration(fromIso: string | null | undefined, to: Date = new Date()): string {
  if (!fromIso) return '';
  const min = Math.max(0, Math.round((to.getTime() - new Date(fromIso).getTime()) / 60_000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

const LABELS: Record<string, Record<string, string>> = {
  channel: {
    whatsapp: 'WhatsApp',
    whatsapp_lojas: 'WhatsApp das lojas',
    email: 'email',
    instagram: 'Instagram',
    manual: 'manual',
  },
  method: {
    pix: 'Pix',
    card_online: 'cartão online',
    card_on_delivery: 'cartão na entrega',
    cash: 'dinheiro',
    meal_voucher: 'vale-refeição',
    card: 'cartão',
    manual: 'baixa manual',
  },
  fulfillment: { delivery: 'entrega', pickup: 'retirada', dine_in: 'no local' },
  leadState: { lead: 'lead', contacted: 'contatado', invited: 'convidado', live: 'no ar' },
  orderStep: {
    placed: 'recebido',
    paid: 'pago',
    confirmed: 'confirmado',
    preparing: 'em preparo',
    ready: 'pronto',
    out_for_delivery: 'saiu para entrega',
    delivered: 'entregue',
    cancelled: 'cancelado',
    refunded: 'reembolsado',
  },
  incident: {
    probe_failing: 'sonda falhando',
    deployment_failed: 'implantação falhou',
    provisioning_stuck: 'provisionamento travado',
    fleet_degraded: 'frota degradada',
  },
  payment: {
    charged_back: 'contestado (chargeback)',
    in_mediation: 'em mediação',
    refunded: 'estornado',
    rejected: 'recusado',
    cancelled: 'cancelado',
    expired: 'expirou',
  },
  statusSeverity: { info: 'informativo', degraded: 'instabilidade', outage: 'fora do ar' },
  meetingSource: { link: 'pelo link', staff: 'pela equipe', agent: 'pelo agente' },
  autonomy: {
    off: 'desligado',
    copilot: 'copiloto (só rascunho)',
    supervised: 'supervisionado',
    autopilot: 'piloto automático',
  },
  agentJob: {
    reply: 'responder',
    outreach: 'prospecção',
    discovery: 'descoberta',
    strategist: 'estrategista',
  },
};

export function label(group: keyof typeof LABELS | string, key: string | null | undefined): string {
  if (!key) return '—';
  return LABELS[group]?.[key] ?? key.replace(/_/g, ' ');
}

export const linkButton = (
  labelText: string,
  url: string | null | undefined,
): InlineButton | null => (url && /^https?:\/\//.test(url) ? { text: labelText, url } : null);

export const actionButton = (
  labelText: string,
  callbackData: string,
  style?: ButtonStyle,
): InlineButton => ({
  text: labelText,
  callback_data: callbackData,
  ...(style ? { style } : {}),
});

export function row(...buttons: (InlineButton | null | undefined | false)[]): InlineButton[][] {
  const items = buttons.filter((x): x is InlineButton => !!x);
  return items.length ? [items] : [];
}

/** Compact callback_data grammar (≤ 42 bytes, well under Telegram's 64-byte limit):
 *  `d:a:<uuid>` draft approve, `d:r:<uuid>` draft reject,
 *  `h:t:<uuid>` handoff take, `h:d:<uuid>` handoff done,
 *  `i:a:<uuid>` incident ack, `i:r:<uuid>` incident resolve. */
export const cb = (family: 'd' | 'h' | 'i', action: string, id: string) =>
  `${family}:${action}:${id}`;

const MAX_TEXT = 4096;
const MAX_CB_BYTES = 64;

/** Safely clamps HTML text to Telegram's 4096-char limit without leaving unclosed tags. */
function clampHtml(html: string, max = MAX_TEXT): string {
  if (html.length <= max) return html;
  const open: string[] = [];
  let i = 0;
  let cut = 0;
  // leave room for ellipsis + closing tags
  const budget = Math.max(0, max - 40);
  while (i < html.length && i < budget) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      if (end === -1) break;
      const tag = html.slice(i + 1, end);
      if (tag.startsWith('/')) {
        open.pop();
      } else {
        const name = tag.split(/[\s/]/)[0]!;
        open.push(name);
      }
      i = end + 1;
      cut = i;
    } else if (html[i] === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i <= 8) {
        i = semi + 1;
        cut = i;
      } else {
        i++;
        cut = i;
      }
    } else {
      i++;
      cut = i;
    }
  }
  const closing = open
    .reverse()
    .map((t) => `</${t}>`)
    .join('');
  return `${html.slice(0, cut).trimEnd()}…${closing}`;
}

export function fitMessage(m: TelegramMessage): TelegramMessage {
  const text = clampHtml(m.text.trim() || '—', MAX_TEXT);
  const buttons = (m.buttons ?? [])
    .map((r) =>
      r
        .filter((btn) => {
          if (btn.url) return /^https?:\/\//.test(btn.url);
          if (btn.callback_data)
            return (
              btn.callback_data.length > 0 &&
              Buffer.byteLength(btn.callback_data, 'utf8') <= MAX_CB_BYTES
            );
          return false;
        })
        .map((btn) => ({ ...btn, text: clip(btn.text, 64) })),
    )
    .filter((r) => r.length > 0);
  return {
    text,
    ...(buttons.length ? { buttons } : {}),
    ...(m.forceReply ? { forceReply: clip(m.forceReply, 64) } : {}),
    disablePreview: m.disablePreview ?? true,
  };
}

export function toReplyMarkup(buttons: InlineButton[][] | undefined): TelegramReplyMarkup {
  return { inline_keyboard: buttons ?? [] };
}

/** Converts simple LLM markdown (**bold**, *italic*, `code`, [label](url)) into safe Telegram HTML. */
export function markdownToTelegramHtml(md: string): string {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const idx = tokens.length;
    tokens.push(html);
    return `\u0000${idx}\u0000`;
  };
  let s = md.replace(/\r\n/g, '\n');
  // fenced code blocks first so nothing inside is parsed as inline markdown
  s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body: string) =>
    stash(`<pre>${esc(body.trim())}</pre>`),
  );
  // inline code
  s = s.replace(/`([^`\n]{1,200})`/g, (_m, body: string) => stash(`<code>${esc(body)}</code>`));
  // escape remaining raw HTML before applying formatting tags
  s = esc(s);
  // markdown links [text](https://...)
  s = s.replace(/\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/g, (_m, text: string, url: string) =>
    stash(`<a href="${url}">${text}</a>`),
  );
  // **bold** and __bold__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  // *italic* (single asterisk, not bullet lines)
  s = s.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
  // restore stashed HTML fragments
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)] ?? '');
}

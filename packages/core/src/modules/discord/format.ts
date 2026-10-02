import type { Severity } from '../staff-events.ts';

// Discord message shapes and the pt-BR formatting every card shares. Limits are Discord's
// (embeds: title 256, description 4096, 25 fields of 256/1024, footer 2048, 6000 in total).

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; url?: string };
  footer?: { text: string };
  fields?: EmbedField[];
}

export interface Button {
  type: 2;
  style: 1 | 2 | 3 | 4 | 5;
  label: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
}

export interface ActionRow {
  type: 1;
  components: Button[];
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  allowed_mentions?: { parse: string[]; roles?: string[]; replied_user?: boolean };
  flags?: number;
  /** with enforce_nonce, a retried post returns the message Discord already made */
  nonce?: string;
  enforce_nonce?: boolean;
  message_reference?: { message_id: string; channel_id: string; fail_if_not_exists: boolean };
}

export const FLAG_EPHEMERAL = 1 << 6;
export const FLAG_SILENT = 1 << 12;

export const COLORS: Record<Severity, number> = {
  info: 0x64748b,
  success: 0x16a34a,
  warning: 0xd97706,
  critical: 0xdc2626,
};
/** a resolved or closed card: the thing no longer needs anyone */
export const COLOR_DONE = 0x94a3b8;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const USD = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });
const INT = new Intl.NumberFormat('pt-BR');

export const brl = (cents: number) => BRL.format(cents / 100);
/** agent_runs.cost_cents is metered in USD (model/tool pricing) — never BRL */
export const usd = (cents: number) => USD.format(cents / 100);
export const int = (n: number) => INT.format(n);

/** Discord renders `<t:…>` in each viewer's own timezone and language. */
export function ts(at: string | Date | null | undefined, style: 'R' | 'f' | 'F' | 't' | 'd' = 'f') {
  if (!at) return '—';
  const ms = new Date(at).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : '—';
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** User text never formats, links or pings: inline markdown is escaped, masked links and
 *  mention syntax are broken with a zero-width space (allowed_mentions is the real guard). */
export function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/([\\*_~`|])/g, '\\$1')
    .replace(/\]\(/g, ']​(')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<([@#][!&]?\d+)>/g, '<​$1>');
}

/** A quoted block of user text: escaped, line-capped, length-capped. */
export function quote(s: string | null | undefined, max = 900, maxLines = 12): string {
  if (!s?.trim()) return '';
  const lines = esc(s.trim())
    .split('\n')
    .slice(0, maxLines)
    // a leading `# ` or `-# ` would turn the line into a heading or subtext
    .map((l) => l.replace(/^(#{1,3}|-#)(\s)/, '\\$1$2'));
  return clip(lines.map((l) => `> ${l}`).join('\n'), max);
}

/** Error text in a code block — backticks can't close it early. */
export function code(s: string, max = 700): string {
  return `\`\`\`\n${clip(s.replace(/`/g, 'ˋ'), max)}\n\`\`\``;
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
};

export function label(group: keyof typeof LABELS | string, key: string | null | undefined): string {
  if (!key) return '—';
  return LABELS[group]?.[key] ?? key.replace(/_/g, ' ');
}

const LIMITS = { title: 256, description: 4096, fields: 25, name: 256, value: 1024, footer: 2048 };
const TOTAL = 5800;

/** Clamps an embed to Discord's limits; empty field values become '—' (Discord rejects '').
 *  Over the 6000-character total, trailing fields go first, then the description shrinks. */
export function fitEmbed(e: Embed): Embed {
  const out: Embed = { ...e };
  if (out.title !== undefined) out.title = clip(out.title, LIMITS.title);
  if (out.author) out.author = { ...out.author, name: clip(out.author.name, LIMITS.name) };
  if (out.footer) out.footer = { text: clip(out.footer.text, LIMITS.footer) };
  if (out.description !== undefined) out.description = clip(out.description, LIMITS.description);
  if (out.fields)
    out.fields = out.fields.slice(0, LIMITS.fields).map((f) => ({
      ...f,
      name: clip(f.name || '—', LIMITS.name),
      value: clip(f.value || '—', LIMITS.value),
    }));
  const fixed = () =>
    (out.title?.length ?? 0) +
    (out.author?.name.length ?? 0) +
    (out.footer?.text.length ?? 0) +
    (out.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
  while (out.fields?.length && fixed() + (out.description?.length ?? 0) > TOTAL) out.fields.pop();
  if (out.description !== undefined)
    out.description = clip(out.description, Math.max(0, TOTAL - fixed()));
  if (out.url && !/^https?:\/\//.test(out.url)) delete out.url;
  // Discord rejects present-but-empty strings
  if (!out.description?.trim()) delete out.description;
  if (!out.title?.trim()) delete out.title;
  return out;
}

export function fitMessage(m: MessagePayload): MessagePayload {
  const out: MessagePayload = { ...m };
  if (out.content !== undefined) out.content = clip(out.content, 2000);
  if (out.embeds) out.embeds = out.embeds.slice(0, 10).map(fitEmbed);
  if (out.components)
    out.components = out.components.slice(0, 5).map((row) => ({
      type: 1,
      components: row.components
        .slice(0, 5)
        .filter((b) => (b.style === 5 ? /^https?:\/\//.test(b.url ?? '') : !!b.custom_id))
        .map((b) => ({ ...b, label: clip(b.label, 80) })),
    }));
  if (out.components) out.components = out.components.filter((r) => r.components.length > 0);
  return out;
}

export const linkButton = (labelText: string, url: string | null | undefined): Button | null =>
  url ? { type: 2, style: 5, label: labelText, url } : null;

export const actionButton = (
  labelText: string,
  customId: string,
  style: 1 | 2 | 3 | 4 = 2,
  emoji?: string,
): Button => ({
  type: 2,
  style,
  label: labelText,
  custom_id: customId,
  ...(emoji ? { emoji: { name: emoji } } : {}),
});

export function row(...buttons: (Button | null | undefined | false)[]): ActionRow[] {
  const components = buttons.filter((b): b is Button => !!b);
  return components.length ? [{ type: 1, components }] : [];
}

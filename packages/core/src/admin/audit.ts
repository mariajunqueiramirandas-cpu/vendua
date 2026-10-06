import type { Sql } from '../platform/db.ts';
import type { Merchant } from './context.ts';

/** One row per admin mutation, in the mutation's own tx — no change lands unrecorded. */
export async function audit(
  tx: Sql,
  tenantId: string,
  // staff (the CRM's menu import) have no merchant_users row: userId null, a label for the log
  actor: Pick<Merchant, 'name'> & { userId: string | null },
  entry: {
    action: string;
    entity: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
) {
  const clip = (v: unknown) => {
    if (v === undefined || v === null) return null;
    // the log is for "who changed what", not a backup — big payloads keep their shape only
    return JSON.stringify(v).length > 16_000 ? { truncated: true } : v;
  };
  const before = clip(entry.before);
  const after = clip(entry.after);
  await tx`
    insert into audit_log (tenant_id, actor_user_id, actor_label, action, entity, entity_id, summary, before, after)
    values (${tenantId}, ${actor.userId}, ${actor.name}, ${entry.action}, ${entry.entity},
            ${entry.entityId ?? null}, ${entry.summary.slice(0, 300)},
            ${before === null ? null : tx.json(before as never)},
            ${after === null ? null : tx.json(after as never)})
  `;
}

// ── "what changed", for Equipe ──────────────────────────────────────────────
// `before`/`after` are whatever each route logged (some log the raw request body), so the feed
// never returns them: only fields named below, in the store's words, bounded. A field whose name
// or value looks personal or secret says that it changed, never what it holds.

export interface AuditChange {
  label: string;
  from: string | null;
  to: string | null;
  /** changed, but the values aren't shown (personal, secret, or not readable as text) */
  hidden?: true;
}

const LABEL: Record<string, string> = {
  name: 'nome',
  title: 'título',
  description: 'descrição',
  label: 'descrição',
  body: 'texto',
  message: 'mensagem',
  priceCents: 'preço',
  compareAtPriceCents: 'preço riscado',
  status: 'situação',
  state: 'situação',
  stockQuantity: 'estoque',
  categoryId: 'categoria',
  payment: 'pagamento',
  refundedCents: 'reembolsado',
  remainingCents: 'restante',
  rush: 'urgente',
  prepTimeMinutes: 'tempo de preparo',
  acceptTargetMinutes: 'tempo para aceitar',
  minOrderCents: 'pedido mínimo',
  pickupEnabled: 'retirada',
  pickupAddress: 'endereço de retirada',
  pickupInstructions: 'instruções de retirada',
  deliveryEnabled: 'entrega',
  demand: 'movimento',
  pauseMessage: 'aviso de pausa',
  closedMessage: 'aviso de loja fechada',
  timezone: 'fuso horário',
  windows: 'horários',
  specialDays: 'dias especiais',
  location: 'localização',
  latitude: 'localização',
  longitude: 'localização',
  feeCents: 'taxa de entrega',
  etaMinMinutes: 'prazo mínimo',
  etaMaxMinutes: 'prazo máximo',
  neighborhoods: 'bairros',
  baseFeeCents: 'taxa base',
  feePerKmCents: 'taxa por km',
  minFeeCents: 'taxa mínima',
  maxKm: 'distância máxima',
  freeOverCents: 'frete grátis acima de',
  enabled: 'ligado',
  paymentMethods: 'formas de pagamento',
  maxDays: 'antecedência máxima',
  whileClosed: 'encomendas com a loja fechada',
  code: 'código',
  kind: 'tipo',
  value: 'valor',
  minSubtotalCents: 'pedido mínimo',
  maxDiscountCents: 'desconto máximo',
  startsAt: 'começa',
  endsAt: 'termina',
  maxRedemptions: 'limite de usos',
  perPhoneLimit: 'usos por cliente',
  firstOrderOnly: 'só no primeiro pedido',
  active: 'ativo',
  stampsRequired: 'selos',
  rewardLabel: 'prêmio',
  until: 'até',
  printOn: 'imprimir quando',
  stations: 'estações',
  planId: 'plano',
  pendingPlanId: 'próximo plano',
  method: 'forma de pagamento',
  trialEndsAt: 'teste até',
  host: 'domínio',
  amountCents: 'valor',
  percentBps: 'porcentagem',
  fixedCents: 'valor fixo',
  role: 'papel',
  phone: 'telefone',
  email: 'email',
  address: 'endereço',
  accountId: 'conta do Mercado Pago',
  pixKey: 'chave Pix',
  payerDocument: 'CPF/CNPJ',
};

// words (camelCase/snake_case split) that make a field personal or secret, wherever it sits
const SECRET =
  /^(token|tokens|secret|senha|password|key|chave|pix|cpf|cnpj|document|documento|cert|otp|hash|signature|cookie|session|auth|email|phone|telefone|contact|jid|address|endereco|lat|lng|latitude|longitude|location|account|payer|iban|url|ip)$/;
const words = (k: string) =>
  k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/);
const secretKey = (path: string[]) => path.some((k) => words(k).some((w) => SECRET.test(w)));
const secretValue = (s: string) =>
  // opaque credentials and JWTs
  /^(APP_USR|TEST)-|^eyJ[\w-]+\.|^[A-Za-z0-9+/_=-]{32,}$/.test(s) ||
  /[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(s) ||
  // a phone number, however it's written
  /\d{10,}/.test(s.replace(/[\s().+-]/g, ''));

const WORD: Record<string, Record<string, string>> = {
  state: {
    placed: 'novo',
    confirmed: 'aceito',
    preparing: 'em preparo',
    ready: 'pronto',
    out_for_delivery: 'saiu para entrega',
    delivered: 'entregue',
    cancelled: 'cancelado',
    refunded: 'estornado',
  },
  status: {
    active: 'disponível',
    sold_out: 'esgotado',
    archived: 'escondido',
    pending: 'pendente',
    paid: 'pago',
    refunded: 'reembolsado',
    partially_refunded: 'reembolso parcial',
    failed: 'recusado',
    expired: 'expirou',
    connected: 'conectado',
    not_connected: 'desconectado',
  },
  method: {
    pix: 'Pix',
    card_on_delivery: 'cartão na entrega',
    card_online: 'cartão online',
    cash: 'dinheiro',
    meal_voucher: 'vale-refeição',
  },
  kind: { percent: 'porcentagem', fixed: 'valor fixo', free_delivery: 'frete grátis' },
  demand: { normal: 'normal', high: 'movimento alto' },
  role: { owner: 'dono', manager: 'gerente', attendant: 'atendente' },
  printOn: { placed: 'o pedido chega', confirmed: 'o pedido é aceito' },
};
WORD.payment = WORD.status!;
WORD.paymentMethods = WORD.method!;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const whenFmt = new Map<string, Intl.DateTimeFormat>();
const WHEN = (tz: string) => {
  let f = whenFmt.get(tz);
  if (!f)
    whenFmt.set(
      tz,
      (f = new Intl.DateTimeFormat('pt-BR', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })),
    );
  return f;
};
const MAX_TEXT = 60;
const MAX_CHANGES = 6;

type Leaf = { path: string[]; value: unknown };

/** objects become dotted leaves, 3 levels deep; arrays and deeper objects are leaves */
function leaves(v: unknown, path: string[] = [], out: Leaf[] = []): Leaf[] {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && path.length < 3) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) leaves(x, [...path, k], out);
  } else if (path.length) out.push({ path, value: v });
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clipText = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
};

/** a value in words; undefined = not readable as text (shown as "changed" only) */
function show(key: string, v: unknown, tz: string, kind?: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    // a coupon's value is a percentage or cents, by its kind
    const money = /Cents$/.test(key) || (key === 'value' && kind === 'fixed');
    if (money && Number.isInteger(v)) return BRL.format(v / 100);
    if (key === 'value' && kind === 'percent') return `${v}%`;
    if (key === 'percentBps') return `${(v / 100).toLocaleString('pt-BR')}%`;
    if (/Minutes$/.test(key)) return `${v} min`;
    if (key === 'maxKm') return `${v.toLocaleString('pt-BR')} km`;
    if (key === 'maxDays') return `${v} dias`;
    return v.toLocaleString('pt-BR');
  }
  if (typeof v === 'string') {
    const word = WORD[key]?.[v];
    if (word) return word;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && Number.isFinite(Date.parse(v)))
      return WHEN(tz).format(new Date(v));
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('/');
    if (UUID.test(v) || secretValue(v)) return undefined;
    return clipText(v);
  }
  if (Array.isArray(v)) {
    if (!v.length) return null;
    if (v.length > 20 || !v.every((x) => typeof x === 'string' || typeof x === 'number'))
      return undefined;
    const parts = v.map((x) => show(key, x, tz, kind));
    if (parts.some((p) => p === undefined)) return undefined;
    return clipText(parts.filter(Boolean).join(', '));
  }
  return undefined;
}

/**
 * The fields an audit row changed, in the store's words: at most six, plus how many more.
 * A row with only `after` (a create, a settings body) lists what was set; only `before`, what went.
 */
export function auditChanges(
  before: unknown,
  after: unknown,
  tz = 'America/Sao_Paulo',
): { changes: AuditChange[]; more: number } {
  const b = new Map(leaves(before).map((l) => [l.path.join('.'), l]));
  const a = new Map(leaves(after).map((l) => [l.path.join('.'), l]));
  const paths = [...new Set([...b.keys(), ...a.keys()])];
  const seen = new Set<string>();
  const all: AuditChange[] = [];
  const kindOf = (o: unknown) =>
    o && typeof o === 'object' ? (o as Record<string, unknown>).kind : undefined;
  const kind = kindOf(after) ?? kindOf(before);
  for (const p of paths) {
    const path = (b.get(p) ?? a.get(p))!.path;
    const key = path.at(-1)!;
    const label = LABEL[key];
    if (!label || seen.has(label)) continue;
    const was = b.get(p)?.value ?? null;
    const now = a.get(p)?.value ?? null;
    if (before != null && after != null && JSON.stringify(was) === JSON.stringify(now)) continue;
    seen.add(label);
    if (secretKey(path)) {
      all.push({ label, from: null, to: null, hidden: true });
      continue;
    }
    const from = show(key, was, tz, kind);
    const to = show(key, now, tz, kind);
    if (from === undefined || to === undefined)
      all.push({ label, from: null, to: null, hidden: true });
    else if (from !== to || before == null || after == null)
      all.push({ label, from: before == null ? null : from, to: after == null ? null : to });
  }
  // a create lists what it set: an empty field isn't news
  const shown = all.filter((c) => c.hidden || c.from !== null || c.to !== null);
  return { changes: shown.slice(0, MAX_CHANGES), more: Math.max(0, shown.length - MAX_CHANGES) };
}

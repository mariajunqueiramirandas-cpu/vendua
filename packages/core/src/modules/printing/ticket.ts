import { localParts } from '../../platform/tz.ts';
import type { OrderView } from '../orders.ts';
import type { CaixaDetail, CaixaReport, TabDetail } from '../pdv/ledger.ts';
import { Receipt, type CodePage, type Paper } from './escpos.ts';

export interface PrintOptions {
  paper: Paper;
  codepage: CodePage;
  copies: number;
  cut: boolean;
}

const METHOD: Record<string, string> = {
  pix: 'Pix',
  card_online: 'Cartão online',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
  meal_voucher: 'Vale-refeição',
  // the PDV's (ADR 0035)
  credit: 'Crédito',
  debit: 'Débito',
  voucher: 'Vale-refeição',
  mixed: 'Misto',
  tab: 'Comanda',
};

/** a job printed this long after it was queued says so at the top */
export const LATE_AFTER_MS = 10 * 60_000;

const brl = (cents: number) =>
  `R$ ${(cents / 100)
    .toFixed(2)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

function clock(iso: string, tz: string) {
  const p = localParts(new Date(iso), tz);
  const hh = String(p.hour).padStart(2, '0');
  const mm = String(p.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

function dayMonth(iso: string, tz: string) {
  const p = localParts(new Date(iso), tz);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
}

function phone(p: string) {
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `(${p.slice(0, 2)}) ${p.slice(2, 6)}-${p.slice(6)}`;
  return p;
}

function copies(o: PrintOptions, draw: (r: Receipt) => void): Uint8Array {
  const r = new Receipt(o.paper, o.codepage);
  for (let i = 0; i < o.copies; i++) {
    draw(r);
    r.feed(4);
    if (o.cut) r.cut();
  }
  return r.done();
}

/**
 * What the counter does about money. Only an offline method on a live order is collected at the
 * door: an online payment still pending settles with the provider, and telling staff to charge
 * it (or a refunded or cancelled order) would charge twice.
 */
function paymentLine(order: OrderView, pickup: boolean): string {
  const s = order.payment.status;
  // a partial refund leaves the rest captured
  if (s === 'paid' || s === 'partially_refunded') return 'PAGO';
  if (s === 'refunded') return 'ESTORNADO - não cobrar';
  if (order.state === 'cancelled' || order.state === 'refunded') return 'não cobrar';
  if (order.payment.online) return 'aguardando pagamento online - não cobrar';
  if (order.payment.method === 'tab') return 'cobrar na comanda';
  return pickup ? 'cobrar na retirada' : 'cobrar na entrega';
}

/** The kitchen ticket: big number, how it leaves, items with their choices, notes, total. */
export function renderOrderTicket(
  order: OrderView,
  store: { name: string; timezone: string },
  o: PrintOptions,
  queuedAt: Date,
  now = new Date(),
): Uint8Array {
  const tz = store.timezone;
  const late = now.getTime() - queuedAt.getTime() > LATE_AFTER_MS;
  return copies(o, (r) => {
    r.align('center');
    // only a reprint asked for by hand gets here: automatic ones are dropped on cancel
    if (order.state === 'cancelled' || order.state === 'refunded')
      r.size(2).bold(true).text('CANCELADO').bold(false).size(1).feed(1);
    if (late) {
      r.bold(true).text('*** IMPRESSÃO ATRASADA ***').bold(false);
      r.text(`na fila desde ${clock(queuedAt.toISOString(), tz)}`).feed(1);
    }
    r.text(store.name);
    r.size(2).bold(true).text(`#${order.number}`).bold(false).size(1);
    const mode = order.delivery.mode;
    const pickup = mode !== 'delivery';
    r.size(1, 2)
      .bold(true)
      .text(
        mode === 'dine_in'
          ? order.delivery.table
            ? order.delivery.table.toUpperCase()
            : 'NO LOCAL'
          : pickup
            ? 'RETIRADA'
            : 'ENTREGA',
      )
      .bold(false)
      .size(1);
    if (order.scheduledFor) {
      const [y, m, d] = order.scheduledFor.split('-');
      r.bold(true).text(`ENCOMENDA PARA ${d}/${m}/${y}`).bold(false);
    }
    r.align('left').rule();

    r.bold(true).text(order.customer.name).bold(false);
    if (order.customer.phone) r.text(phone(order.customer.phone));
    if (!pickup) {
      const where = [order.delivery.address, order.delivery.neighborhood]
        .filter((s): s is string => !!s)
        .join(' - ');
      if (where) r.text(where);
    }
    r.text(`Pedido ${dayMonth(order.placedAt, tz)} às ${clock(order.placedAt, tz)}`);
    if (order.delivery.promisedTo) {
      const to = clock(order.delivery.promisedTo, tz);
      const from = order.delivery.promisedFrom ? clock(order.delivery.promisedFrom, tz) : to;
      r.text(`Previsão: ${from === to ? to : `${from}–${to}`}`);
    }
    r.rule();

    for (const item of order.items) {
      r.size(1, 2).bold(true).text(`${item.qty}x ${item.name}`).bold(false).size(1);
      for (const c of item.combo) r.text(`${c.qty}x ${c.slotName}: ${c.name}`, 3);
      for (const m of item.modifiers) r.text(`+ ${m.qty > 1 ? `${m.qty}x ` : ''}${m.name}`, 3);
      if (item.note) r.bold(true).text(`OBS: ${item.note}`, 3).bold(false);
    }
    r.rule();

    if (order.notes) {
      r.bold(true).text('OBSERVAÇÃO:').bold(false);
      r.size(1, 2).text(order.notes).size(1);
      r.rule();
    }

    r.bold(true).pair('TOTAL', brl(order.totalCents)).bold(false);
    const method = METHOD[order.payment.method] ?? order.payment.method;
    r.text(`${method} - ${paymentLine(order, pickup)}`);
    const change = order.payment.changeForCents;
    if (order.payment.method === 'cash' && change != null)
      r.bold(true)
        .text(`Troco para ${brl(change)}`)
        .bold(false);
    if (order.payment.instructions) r.text(order.payment.instructions);
  });
}

/** What "imprimir teste" prints: proves the path, the accents and the line width. */
export function renderTestTicket(
  store: { name: string; timezone: string },
  printer: { name: string },
  o: PrintOptions,
  now = new Date(),
): Uint8Array {
  return copies({ ...o, copies: 1 }, (r) => {
    r.align('center').size(2).bold(true).text('Venduá').bold(false).size(1);
    r.text('Teste de impressão').feed(1);
    r.align('left');
    r.text(store.name);
    r.text(printer.name);
    r.text(
      `Papel ${o.paper} mm · ${r.columns} colunas · ${o.codepage.toUpperCase()} · ` +
        `${dayMonth(now.toISOString(), store.timezone)} ${clock(now.toISOString(), store.timezone)}`,
    );
    r.rule();
    r.text('Acentos: ÁÉÍÓÚ áéíóú ÂÊÔ âêô ÃÕ ãõ Çç À à');
    r.pair('Linha cheia', brl(12345));
    r.rule('=');
    r.align('center').text('Se você leu tudo certinho, está pronta.');
  });
}

// ── PDV (ADR 0035) ───────────────────────────────────────────────────────────

const PDV_METHOD: Record<string, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit: 'Crédito',
  debit: 'Débito',
  voucher: 'Vale-refeição',
};
const PDV_ORDER = ['cash', 'pix', 'credit', 'debit', 'voucher'];

/** The bill a comanda asks for ("conferência"): what was consumed, what it comes to, what's left. */
export function renderBillTicket(
  tab: TabDetail,
  store: { name: string; timezone: string },
  o: PrintOptions,
  now = new Date(),
): Uint8Array {
  const tz = store.timezone;
  return copies({ ...o, copies: 1 }, (r) => {
    r.align('center').text(store.name);
    r.size(2).bold(true).text(tab.label.toUpperCase()).bold(false).size(1);
    r.text('CONFERÊNCIA DE CONTA');
    r.align('left').rule();
    if (tab.customerName) r.text(tab.customerName);
    r.text(`Aberta ${dayMonth(tab.openedAt, tz)} às ${clock(tab.openedAt, tz)}`);
    r.text(`Impressa ${dayMonth(now.toISOString(), tz)} às ${clock(now.toISOString(), tz)}`);
    r.rule();
    for (const round of tab.roundsList) {
      if (round.state === 'cancelled' || round.state === 'refunded') continue;
      for (const i of round.items) {
        r.pair(`${i.qty}x ${i.name}`, brl(i.lineTotalCents));
        for (const m of i.modifiers) r.text(`+ ${m.qty > 1 ? `${m.qty}x ` : ''}${m.name}`, 3);
      }
    }
    r.rule();
    r.pair('Consumo', brl(tab.subtotalCents));
    if (tab.discountCents > 0) r.pair('Desconto', `-${brl(tab.discountCents)}`);
    if (tab.serviceCents > 0)
      r.pair(`Serviço (${(tab.serviceBps / 100).toLocaleString('pt-BR')}%)`, brl(tab.serviceCents));
    r.bold(true).size(1, 2).pair('TOTAL', brl(tab.totalCents)).size(1).bold(false);
    if (tab.paidCents > 0) {
      r.pair('Já pago', `-${brl(tab.paidCents)}`);
      r.bold(true)
        .pair('FALTA', brl(Math.max(0, tab.remainingCents)))
        .bold(false);
    }
    if (tab.split) {
      r.rule();
      r.text(`Dividido em ${tab.split.ways}:`);
      tab.split.sharesCents.forEach((c, i) => r.pair(`  Pessoa ${i + 1}`, brl(c)));
    }
    r.rule('=');
    r.align('center').text('Não é documento fiscal');
  });
}

/** The caixa's report: a closed one's count against what Core expected, or an open one's partial. */
export function renderCaixaTicket(
  c: CaixaDetail &
    Partial<Pick<CaixaReport, 'closedAt' | 'closedBy' | 'counted' | 'differences' | 'notes'>>,
  store: { name: string; timezone: string },
  o: PrintOptions,
  now = new Date(),
): Uint8Array {
  const tz = store.timezone;
  const closed = !!c.closedAt && !!c.counted;
  return copies({ ...o, copies: 1 }, (r) => {
    r.align('center').text(store.name);
    r.size(1, 2)
      .bold(true)
      .text(closed ? 'FECHAMENTO DE CAIXA' : 'CAIXA PARCIAL')
      .bold(false)
      .size(1);
    r.align('left').rule();
    r.text(`Aberto ${dayMonth(c.openedAt, tz)} ${clock(c.openedAt, tz)} por ${c.openedBy}`);
    if (closed)
      r.text(`Fechado ${dayMonth(c.closedAt!, tz)} ${clock(c.closedAt!, tz)} por ${c.closedBy}`);
    else r.text(`Impresso ${dayMonth(now.toISOString(), tz)} ${clock(now.toISOString(), tz)}`);
    r.rule();
    r.pair('Troco inicial', brl(c.openingCents));
    r.pair('Vendas', String(c.salesCount));
    for (const m of PDV_ORDER) {
      const v = c.byMethod[m as keyof typeof c.byMethod];
      if (!v || (v.count === 0 && !(c.counted?.[m as keyof typeof c.byMethod] ?? 0))) continue;
      r.pair(`${PDV_METHOD[m]} (${v.count})`, v.cents == null ? '—' : brl(v.cents));
    }
    if (c.changeCents > 0) r.pair('Troco dado', brl(c.changeCents));
    if (c.serviceCents > 0) r.pair('Serviço', brl(c.serviceCents));
    if (c.movements.length) {
      r.rule();
      for (const mv of c.movements)
        r.pair(
          `${mv.kind === 'sangria' ? 'Sangria' : 'Suprimento'} ${clock(mv.at, tz)}`,
          `${mv.kind === 'sangria' ? '-' : '+'}${brl(mv.amountCents)}`,
        );
    }
    if (c.expected) {
      r.rule();
      r.bold(true)
        .text(closed ? 'CONFERÊNCIA' : 'ESPERADO')
        .bold(false);
      for (const m of PDV_ORDER) {
        const key = m as keyof typeof c.expected;
        const exp = c.expected[key] ?? 0;
        const got = c.counted?.[key];
        if (exp === 0 && !got) continue;
        if (!closed) {
          r.pair(PDV_METHOD[m]!, brl(exp));
          continue;
        }
        const diff = c.differences?.[key] ?? 0;
        r.text(PDV_METHOD[m]!);
        r.pair('  esperado', brl(exp));
        r.pair('  contado', brl(got ?? 0));
        if (diff !== 0)
          r.bold(true)
            .pair('  diferença', `${diff > 0 ? '+' : '-'}${brl(Math.abs(diff))}`)
            .bold(false);
      }
    }
    if (closed) {
      const total = Object.values(c.differences ?? {}).reduce((n, v) => n + v, 0);
      r.rule('=');
      r.bold(true)
        .pair(
          'DIFERENÇA',
          total === 0 ? 'sem diferença' : `${total > 0 ? '+' : '-'}${brl(Math.abs(total))}`,
        )
        .bold(false);
      if (c.notes) r.text(`Obs.: ${c.notes}`);
      r.feed(2).text('_____________________________').text('Assinatura');
    }
  });
}

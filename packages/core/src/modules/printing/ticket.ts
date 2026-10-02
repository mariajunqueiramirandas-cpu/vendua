import { localParts } from '../../platform/tz.ts';
import type { OrderView } from '../orders.ts';
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
    const pickup = order.delivery.mode === 'pickup';
    r.size(1, 2)
      .bold(true)
      .text(pickup ? 'RETIRADA' : 'ENTREGA')
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

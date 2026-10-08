import { useQuery, useQueryClient } from '@tanstack/react-query';
import { whatsappUrl } from '@vendua/kernel/rules';
import { api, type Board, type Order, type OrderPayment } from '../../lib/api.ts';
import { clock, money, phone } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useFeature } from '../../lib/session.ts';
import { tableName } from '../../ui/orderMode.ts';
import { PAY_LABEL, payError } from '../../ui/PaymentChip.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { toast } from '../../ui/Toast.tsx';
import { holdAction, transitionOptions } from './transition.ts';
import { useStoreQuery } from '../store/StatusPill.tsx';

type OrderData = { customer: unknown; order: Order };

/** Advance or close an order now (the hold in transition.ts waits before calling it); offline
 *  it queues, the same key on replay. */
export function useTransition() {
  return useMutation(transitionOptions());
}

/**
 * "Atrasou": the promise moves later. Shown now, sent after the undo window (the shopper's
 * WhatsApp can't be taken back); a store whose WhatsApp didn't tell the shopper is offered a
 * message to send by hand.
 */
export function useDelay(storeName: string) {
  const qc = useQueryClient();
  const swap = (o: Order) => {
    qc.setQueryData<Board>(qk.board, (b) =>
      b ? { ...b, orders: b.orders.map((x) => (x.id === o.id ? o : x)) } : b,
    );
    qc.setQueryData<OrderData>(qk.order(o.id), (d) => (d ? { ...d, order: o } : d));
  };
  return (order: Order, minutes: number) => {
    const now = Date.now();
    const to0 = Date.parse(order.delivery.promisedTo ?? '');
    const from0 = Date.parse(order.delivery.promisedFrom ?? '');
    // a guess for the screen until Core answers (Core moves the promise the same way)
    const to = (Number.isFinite(to0) ? Math.max(to0, now) : now) + minutes * 60_000;
    const width = Number.isFinite(to0) && Number.isFinite(from0) ? Math.max(0, to0 - from0) : 0;
    const guess: Order = {
      ...order,
      delivery: {
        ...order.delivery,
        promisedFrom: new Date(to - width).toISOString(),
        promisedTo: new Date(to).toISOString(),
        delayMinutes: (order.delivery.delayMinutes ?? 0) + minutes,
      },
    };
    swap(guess);
    const idem = crypto.randomUUID();
    holdAction(
      `delay-${order.id}`,
      `#${order.number}: novo horário ${clock(guess.delivery.promisedTo!)}`,
      (keepalive) => {
        const sent = api.delay(order.id, minutes, idem, { keepalive });
        if (keepalive) return void sent.catch(() => undefined);
        sent
          .then(({ order: o, notified }) => {
            swap(o);
            if (!notified)
              toast(`O cliente do #${o.number} ainda não sabe do novo horário.`, {
                tone: 'info',
                ms: 8000,
                action: {
                  label: 'avisar',
                  run: () => window.open(delayWhatsappUrl(o, storeName), '_blank', 'noreferrer'),
                },
              });
          })
          .catch((e) => {
            void qc.invalidateQueries({ queryKey: qk.order(order.id) });
            void qc.invalidateQueries({ queryKey: qk.board });
            haptic.error();
            toast.error(messageOf(e));
          });
      },
      () => swap(order),
    );
  };
}

function delayWhatsappUrl(o: Order, storeName: string) {
  const d = o.delivery;
  const when =
    d.mode !== 'delivery'
      ? `fica pronto por volta das ${clock(d.promisedTo!)}`
      : d.promisedFrom && d.promisedFrom !== d.promisedTo
        ? `chega entre ${clock(d.promisedFrom)} e ${clock(d.promisedTo!)}`
        : `chega por volta das ${clock(d.promisedTo!)}`;
  return (
    whatsappUrl(
      o.customer.phone,
      `Oi, ${firstName(o.customer.name)}! Aqui é da ${storeName}. Seu pedido #${o.number} vai atrasar um pouquinho, desculpe. Agora ${when}.`,
    ) ?? undefined
  );
}

/**
 * "Acabou": the product sells out for today (back by itself tomorrow), straight from an order's
 * item. "desfazer" puts back exactly what it was.
 */
export function useSoldOutToday() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['catalog'] });
    void qc.invalidateQueries({ queryKey: qk.home });
  };
  return useMutation({
    mutationFn: (v: { productId: string; name: string }) =>
      api.bulk([v.productId], 'sold_out_today') as Promise<{
        updated: number;
        before?: { id: string; status: string; soldOutUntil: string | null }[];
      }>,
    onMutate: () => haptic.commit(),
    onSuccess: (r, v) => {
      settle();
      if (!r.updated) return toast.error(`${v.name} não está mais no cardápio.`);
      const b = r.before?.[0];
      // the inverse of what it was: on sale, hidden, or sold out with no end
      const back =
        !b || b.status === 'active'
          ? 'available'
          : b.status === 'archived'
            ? 'hidden'
            : b.soldOutUntil
              ? null
              : 'sold_out';
      toast(`${v.name} esgotado hoje. Volta amanhã sozinho.`, {
        ...(back
          ? {
              undo: () =>
                void api
                  .bulk([v.productId], back)
                  .then(settle)
                  .catch((e) => toast.error(messageOf(e))),
            }
          : {}),
      });
    },
    onError: (e) => {
      haptic.error();
      toast.error(messageOf(e));
    },
  });
}

export function useMarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: 'paid' | 'pending' }) => api.markPaid(v.id, v.status),
    onMutate: async (v) => {
      const flip = (o: Order): Order =>
        o.id === v.id ? { ...o, payment: { ...o.payment, status: v.status } } : o;
      const [board, one] = await Promise.all([
        optimistic<Board>(qc, qk.board, (b) => ({ ...b, orders: b.orders.map(flip) })),
        optimistic<{ customer: unknown; order: Order }>(qc, qk.order(v.id), (d) => ({
          ...d,
          order: flip(d.order),
        })),
      ]);
      return {
        restore: () => {
          board.restore();
          one.restore();
        },
      };
    },
    onSuccess: ({ order }, v) => {
      qc.setQueryData(qk.order(order.id), (old: { customer: unknown } | undefined) => ({
        customer: old?.customer ?? null,
        order,
      }));
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: qk.payments });
      void qc.invalidateQueries({ queryKey: qk.home });
      toast(v.status === 'paid' ? `#${order.number} marcado como pago` : 'Pagamento desmarcado', {
        ...(v.status === 'paid'
          ? {
              undo: () =>
                api
                  .markPaid(v.id, 'pending')
                  .then(() => qc.invalidateQueries({ queryKey: ['orders'] })),
            }
          : {}),
      });
    },
    onError: (e, _v, ctx) => {
      ctx?.restore();
      toast.error(payError(e));
    },
  });
}

/**
 * Give money back. Online: Mercado Pago returns it to the shopper (full or part). Core answers
 * with the order and its payments, which replace the cached detail.
 */
export function useRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { order: Order; amountCents: number | null; reason: string; shown: number }) =>
      api.refund(v.order.id, { amountCents: v.amountCents, reason: v.reason }),
    onSuccess: ({ order, payments }, v) => {
      qc.setQueryData<OrderData & { payments?: OrderPayment[] }>(qk.order(order.id), (old) => ({
        customer: old?.customer ?? null,
        order,
        payments,
      }));
      void qc.invalidateQueries({ queryKey: qk.board });
      void qc.invalidateQueries({ queryKey: ['orders', 'list'] });
      void qc.invalidateQueries({ queryKey: ['payments'] });
      void qc.invalidateQueries({ queryKey: qk.home });
      const last = payments
        .flatMap((p) => p.refunds)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (last?.status === 'rejected')
        toast.error('O Mercado Pago recusou a devolução. Veja o motivo no app do Mercado Pago.');
      else if (last?.status === 'pending')
        toast(`Devolução de ${money(v.shown)} pedida. O Mercado Pago está processando.`);
      else toast(`${money(v.shown)} devolvido ao cliente ✓`);
    },
    onError: (e) => {
      haptic.error();
      toast.error(payError(e));
    },
  });
}

export const REFUND_REASONS = [
  'Faltou item',
  'Produto com problema',
  'Pedido atrasou',
  'Cliente desistiu',
];

export const CANCEL_REASONS = [
  'Acabou um item do pedido',
  'Loja fechando agora',
  'Fora da área de entrega',
  'Cliente pediu para cancelar',
  'Não conseguimos falar com o cliente',
];

export const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** The WhatsApp message that fits the order's moment. */
export function whatsappFor(o: Order, storeName: string): string {
  const hi = `Oi, ${firstName(o.customer.name)}! Aqui é da ${storeName}.`;
  const promised = o.delivery.promisedTo ? clock(o.delivery.promisedTo) : null;
  switch (o.state) {
    case 'placed':
      return `${hi} Recebemos seu pedido #${o.number}.`;
    case 'confirmed':
    case 'preparing':
      return `${hi} Seu pedido #${o.number} já está sendo preparado${promised ? ` e fica pronto por volta das ${promised}` : ''}.`;
    case 'ready':
      return o.delivery.mode !== 'delivery'
        ? `${hi} Seu pedido #${o.number} está pronto para retirar. Te esperamos!`
        : `${hi} Seu pedido #${o.number} está pronto e já vai sair.`;
    case 'out_for_delivery':
      return `${hi} Seu pedido #${o.number} saiu para entrega e chega logo.`;
    case 'delivered':
      return `${hi} Obrigado pelo pedido #${o.number}! Esperamos que tenha gostado.`;
    default:
      return `${hi} Sobre o pedido #${o.number}:`;
  }
}

export function orderWhatsappUrl(o: Order, storeName: string) {
  return whatsappUrl(o.customer.phone, whatsappFor(o, storeName)) ?? undefined;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 80 mm kitchen ticket: big number, items, notes; the browser's print dialog. */
export function printTicket(o: Order, storeName: string, tz?: string) {
  const items = o.items
    .map(
      (i) =>
        `<div class="it"><b>${i.qty}×</b> ${esc(i.name)}${
          i.modifiers.length
            ? `<div class="sub">${i.modifiers.map((m) => esc((m.qty ?? 1) > 1 ? `${m.qty}x ${m.name}` : m.name)).join(' · ')}</div>`
            : ''
        }${i.combo.length ? `<div class="sub">${i.combo.map((c) => `${c.qty}× ${esc(c.name)}`).join(' · ')}</div>` : ''}${
          i.note ? `<div class="sub in">OBS: ${esc(i.note)}</div>` : ''
        }</div>`,
    )
    .join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido #${o.number}</title>
<style>@page{size:80mm auto;margin:4mm}body{font:14px/1.35 ui-monospace,Menlo,monospace;color:#000;width:72mm;margin:0}
h1{font-size:34px;margin:0 0 4px}.m{font-size:13px}.it{padding:6px 0;border-bottom:1px dashed #000;font-size:16px}
.sub{font-size:13px;padding-left:22px}.in{font-weight:bold}.n{margin-top:8px;padding:6px;border:2px solid #000;font-size:15px;font-weight:bold}
.t{margin-top:8px;font-size:16px;font-weight:bold;text-align:right}</style></head><body>
<div class="m">${esc(storeName)}</div><h1>#${o.number}</h1>
<div class="m">${esc(o.customer.name)}${o.customer.phone ? ` · ${esc(phone(o.customer.phone))}` : ''}</div>
<div class="m">${o.delivery.mode === 'delivery' ? `ENTREGA: ${esc(o.delivery.address ?? '')} ${esc(o.delivery.neighborhood ?? '')}` : o.delivery.mode === 'dine_in' ? (o.delivery.table ? esc(tableName(o.delivery.table).toUpperCase()) : 'CONSUMO NO LOCAL') : 'RETIRADA'}</div>
${o.scheduledFor ? `<div class="m">ENCOMENDA PARA ${esc(o.scheduledFor)}</div>` : ''}
<div class="m">${new Date(o.placedAt).toLocaleString('pt-BR', { timeZone: tz })}</div>
<div style="margin-top:8px">${items}</div>
${o.notes ? `<div class="n">OBS: ${esc(o.notes)}</div>` : ''}
<div class="t">${esc(money(o.totalCents))} · ${esc(PAY_LABEL[o.payment.method] ?? o.payment.method)}${
    o.payment.status === 'paid' ? ' (pago)' : ''
  }</div>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script></body></html>`;
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) {
    toast.error('O navegador bloqueou a janela de impressão. Permita pop-ups para esta página.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

/** "imprimir comanda": the store's printers when a device holding one is online (ADR 0027),
 *  else this device's print dialog. Decided before the tap: a dialog opened after a request is
 *  blocked. */
export function usePrintOrder(storeName: string) {
  const qc = useQueryClient();
  const open = useFeature('printing');
  const tz = useStoreQuery().data?.hours.timezone;
  const { data } = useQuery({
    queryKey: qk.printers,
    queryFn: api.printers,
    staleTime: 60_000,
    enabled: open,
  });
  // the printers POST /orders/:id/print picks (automatic ones, else any present), and at least
  // one of them on a device that's online now
  const devices = data?.devices ?? [];
  const online = new Set(devices.filter((d) => d.online).map((d) => d.id));
  const present = devices.flatMap((d) => d.printers.filter((p) => p.present));
  const auto = present.filter((p) => p.auto);
  const viaPrinter = (auto.length > 0 ? auto : present).some((p) => online.has(p.deviceId));
  const send = useMutation({
    mutationFn: (v: { order: Order; printerId?: string }) =>
      api.printOrder(v.order.id, v.printerId),
    onSuccess: (r, v) => {
      toast(`Comanda enviada para ${r.printers.join(', ')}`);
      void qc.invalidateQueries({ queryKey: printJobsKey(v.order.id) });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return {
    print: (o: Order) => (viaPrinter ? send.mutate({ order: o }) : printTicket(o, storeName, tz)),
    /** one printer the merchant picked, whatever prints automatically */
    printTo: (o: Order, printerId: string) => send.mutate({ order: o, printerId }),
    /** where a ticket can go now; a choice is offered once there's more than one */
    printers: present.map((p) => ({
      id: p.id,
      name: p.name,
      online: online.has(p.deviceId),
      device: devices.find((d) => d.id === p.deviceId)?.name ?? '',
    })),
    pending: send.isPending,
    viaPrinter,
    /** the plan has printing: without it, there is no "imprimir comanda" at all */
    available: open && data?.included !== false,
  };
}

const printJobsKey = (orderId: string) => ['printers', 'order', orderId] as const;

/** The order's tickets ("impresso às 12:03 na Cozinha"); the `printers` live topic refreshes it. */
export function usePrintJobs(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: printJobsKey(orderId),
    queryFn: () => api.orderPrints(orderId),
    enabled,
    // one still on its way settles soon: look again even if the stream is down
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === 'pending' || j.status === 'sent')
        ? 15_000
        : false,
  });
}

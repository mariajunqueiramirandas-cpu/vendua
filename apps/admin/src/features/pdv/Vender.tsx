import {
  CaretUp,
  ChefHat,
  CheckCircle,
  HandCoins,
  Percent,
  Receipt,
  User,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type PdvDiscountIn,
  type PdvMethod,
  type PdvPaymentIn,
  type PdvSale,
} from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { parsePhone } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { isPlanRequired, useCan, useFeature, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState } from '../../ui/feedback.tsx';
import { Field, PhoneInput, Segmented, TextArea, TextInput } from '../../ui/fields.tsx';
import { ArtTicket } from '../../ui/illustrations.tsx';
import { PDV_METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { PDV_METHOD_ICON } from '../../ui/pdv/methods.ts';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import {
  isCode,
  pdvError,
  toLineIn,
  usePdvState,
  usePutQuote,
  useQuote,
  useTicket,
  type PickedLine,
  type Ticket,
} from './data.ts';
import {
  addressLine,
  addressDone,
  deliveryIn,
  DeliveryCard,
  DeliverySheet,
  fieldError,
  NO_ADDRESS,
  useDeliveryPin,
  whoDone,
  type Address,
} from './Delivery.tsx';
import { PaySheet } from './PaySheet.tsx';
import { DiscountSheet, discountLabel, PdvTop, TicketLines, Totals } from './parts.tsx';
import { Picker } from './Picker.tsx';

// Vender: the counter. Tap products into the ticket, Core prices it, "cobrar" takes the money
// and makes the order. A keyboard works too: typing searches, Enter in the search adds the first
// hit, Enter anywhere else charges. "Entrega" is a phone order: the customer and address first,
// Core's fee in the total, and paid now or charged at the door.

type Mode = 'takeaway' | 'here' | 'delivery';
type PayLater = { method: PdvMethod; changeForCents?: number };
/** what the success sheet says about the sale beyond Core's answer */
interface Done {
  sale: PdvSale;
  delivery: { name: string; address: string; later: PayLater | null } | null;
}
interface Customer {
  name: string;
  phone: string;
  digits: string | null;
  notes: string;
}
const NO_CUSTOMER: Customer = { name: '', phone: '', digits: null, notes: '' };

export default function Vender() {
  return useFeature('pdv') ? <Counter /> : <LockedPage title="PDV" feature="pdv" />;
}

function Counter() {
  const session = useSession();
  const manager = useCan('manager');
  const qc = useQueryClient();
  const state = usePdvState();
  const caixaOpen = !!state.data?.caixa;
  const ticket = useTicket(`vendua-pdv-ticket:${session.store.id}`);
  const [mode, setMode] = useState<Mode>('takeaway');
  const [customer, setCustomer] = useState<Customer>(NO_CUSTOMER);
  const [discount, setDiscount] = useState<PdvDiscountIn | null>(null);
  const [serveNow, setServeNow] = useState(false);
  const [address, setAddress] = useState<Address>(NO_ADDRESS);
  const [feeCents, setFeeCents] = useState<number | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const delivering = mode === 'delivery';
  const pin = useDeliveryPin(address, delivering);
  const delivery = useMemo(
    () => (delivering ? deliveryIn(address, pin.pin, manager ? feeCents : null) : null),
    [delivering, address, pin.pin, manager, feeCents],
  );
  const deliveryReady = addressDone(address) && whoDone(customer);
  const ready = !delivering || deliveryReady;
  const quote = useQuote(ticket.lines, manager ? discount : null, delivery, pin.waiting);
  const putQuote = usePutQuote();
  const [payOpen, setPayOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of ticket.lines) c[l.productId] = (c[l.productId] ?? 0) + l.qty;
    return c;
  }, [ticket.lines]);
  const items = ticket.lines.reduce((n, l) => n + l.qty, 0);

  const sale = useMutation({
    mutationFn: ({ payments, later }: { payments: PdvPaymentIn[]; later?: PayLater }) => {
      const name = customer.name.trim();
      return api.pdv.sale({
        lines: ticket.lines.map(toLineIn),
        ...(manager && discount ? { discount } : {}),
        mode,
        ...(delivering && delivery ? { delivery } : {}),
        ...(later ? { payLater: later } : {}),
        ...(name || customer.digits
          ? {
              customer: {
                ...(name ? { name: name.slice(0, 80) } : {}),
                ...(customer.digits ? { phone: customer.digits } : {}),
              },
            }
          : {}),
        ...(customer.notes.trim() ? { notes: customer.notes.trim().slice(0, 500) } : {}),
        payments,
        quotedTotalCents: quote.quote!.totalCents,
        ...(serveNow && !delivering ? { serveNow: true } : {}),
      });
    },
    onSuccess: (r, v) => {
      const done: Done = {
        sale: r.sale,
        delivery: delivering
          ? {
              name: customer.name.trim(),
              address: addressLine(address),
              later: v.later ?? null,
            }
          : null,
      };
      haptic.commit();
      qc.setQueryData(qk.order(r.order.id), { order: r.order, customer: null });
      void qc.invalidateQueries({ queryKey: ['pdv'] });
      void qc.invalidateQueries({ queryKey: qk.board });
      ticket.clear();
      setCustomer(NO_CUSTOMER);
      setAddress(NO_ADDRESS);
      setFeeCents(null);
      setFieldErrors({});
      setDiscount(null);
      setServeNow(false);
      setPayOpen(false);
      setTicketOpen(false);
      // the pay sheet lets go of its history entry first, or its back() would close this one
      setTimeout(() => setDone(done), 320);
    },
    onError: (e) => {
      haptic.error();
      // who or where is missing or wrong: back to the delivery sheet, on that field
      const field = e instanceof ApiError ? e.details?.field : null;
      if (
        (isCode(e, 'CUSTOMER_REQUIRED') ||
          isCode(e, 'INVALID_DELIVERY') ||
          isCode(e, 'INVALID_PHONE')) &&
        delivering
      ) {
        const f = typeof field === 'string' ? field : 'customer.phone';
        setFieldErrors({ [f]: fieldError(f) ?? pdvError(e) });
        setPayOpen(false);
        setTimeout(() => setDeliveryOpen(true), 320);
        return;
      }
      if (isCode(e, 'OUT_OF_ZONE')) {
        setPayOpen(false);
        void quote.refetch();
        toast.error(pdvError(e));
        return;
      }
      if (isCode(e, 'PRICES_CHANGED') && e.details?.quote) {
        putQuote(quote.body, e.details.quote as Parameters<typeof putQuote>[1]);
        toast.error(pdvError(e));
        return;
      }
      if (isCode(e, 'CAIXA_CLOSED')) void qc.invalidateQueries({ queryKey: ['pdv'] });
      toast.error(pdvError(e));
    },
  });

  const charge = () => {
    if (!ticket.lines.length || sale.isPending) return;
    // a phone order needs who and where before anything is charged
    if (!ready) return setDeliveryOpen(true);
    if (quote.error) return toast.error(pdvError(quote.error));
    if (!quote.fresh) return toast('Calculando o total, um instante.', { tone: 'info' });
    setPayOpen(true);
  };
  const chargeRef = useRef(charge);
  chargeRef.current = charge;
  const sheets = payOpen || ticketOpen || discountOpen || customerOpen || deliveryOpen || !!done;
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (sheetsRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      if (e.key === 'Enter') {
        if (t.closest('button, a')) return;
        e.preventDefault();
        chargeRef.current();
      } else if (e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
        // the key lands in the search, which now has focus
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  if (isPlanRequired(state.error))
    return (
      <div className="mx-auto max-w-[880px] px-4 pt-4 md:px-8 md:pt-8">
        <PlanLocked feature="pdv" reason={reasonOf(state.error)} refresh />
      </div>
    );

  const clear = () => {
    const before: PickedLine[] = ticket.lines;
    ticket.clear();
    setDiscount(null);
    toast('Conta limpa.', { undo: () => ticket.restore(before) });
  };

  // one sheet at a time: from the Conta sheet, the next opens once it has let go of history
  const fromPanel = (inSheet: boolean, open: () => void) => {
    if (!inSheet) return open();
    setTicketOpen(false);
    setTimeout(open, 320);
  };

  const panel = (inSheet: boolean) => (
    <TicketPanel
      ticket={ticket}
      quote={quote}
      mode={mode}
      setMode={(m) => {
        setMode(m);
        if (m === 'delivery' && !deliveryReady) fromPanel(inSheet, () => setDeliveryOpen(true));
      }}
      customer={customer}
      discount={manager ? discount : null}
      manager={manager}
      delivery={
        delivering ? (
          <DeliveryCard
            who={customer}
            address={address}
            quote={quote.quote}
            fresh={quote.fresh}
            outOfZone={quote.outOfZone}
            missedPin={pin.missed}
            manager={manager}
            feeCents={feeCents}
            onFee={setFeeCents}
            onEdit={() => fromPanel(inSheet, () => setDeliveryOpen(true))}
          />
        ) : null
      }
      onCustomer={() => setCustomerOpen(true)}
      onDiscount={() => setDiscountOpen(true)}
      onClear={clear}
      ready={ready}
      onCharge={() => fromPanel(inSheet, charge)}
      busy={sale.isPending}
      inSheet={inSheet}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-48 pt-4 md:px-6 md:pb-10 md:pt-6 lg:px-8">
      <PdvTop title="Vender" />
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_300px] md:items-start md:gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
        <Picker
          ref={search}
          counts={counts}
          onPick={(l) => ticket.add(l)}
          onEmptyEnter={charge}
          className="min-w-0"
        />
        <aside aria-label="conta" className="sticky top-4 hidden md:block">
          {panel(false)}
        </aside>
      </div>

      {/* phones: what's on the ticket, one thumb away from charging */}
      <div
        data-action-bar
        className="glass fixed inset-x-0 bottom-(--tabbar-h) z-30 border-t border-line px-4 py-3 md:hidden"
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button
            type="button"
            onClick={() => setTicketOpen(true)}
            disabled={!items}
            aria-haspopup="dialog"
            className="press -my-1 flex min-h-14 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left disabled:opacity-60"
          >
            <span className="min-w-0 flex-1">
              <span className="t-caption block text-muted">
                {items ? `${items} ${items === 1 ? 'item' : 'itens'} na conta` : 'Conta vazia'}
              </span>
              <span
                className={cn(
                  'tnum block font-display text-xl font-semibold leading-tight',
                  quote.pending && 'opacity-45',
                )}
              >
                {quote.quote ? money(quote.quote.totalCents) : items ? '…' : 'toque nos produtos'}
              </span>
            </span>
            {items ? <CaretUp weight="bold" className="size-5 shrink-0 text-muted" /> : null}
          </button>
          <Button size="lg" disabled={!items} onClick={charge} className="shrink-0">
            cobrar
          </Button>
        </div>
      </div>

      <Sheet open={ticketOpen} onOpenChange={setTicketOpen} title="Conta">
        {panel(true)}
      </Sheet>

      <PaySheet
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Cobrar"
        totalCents={quote.quote?.totalCents ?? 0}
        caixaOpen={caixaOpen}
        busy={sale.isPending}
        paused={sale.isPaused}
        {...(delivering
          ? { later: { onSubmit: (later: PayLater) => sale.mutate({ payments: [], later }) } }
          : { serveNow: { value: serveNow, onChange: setServeNow } })}
        onSubmit={(payments) => sale.mutate({ payments })}
      />

      {manager ? (
        <DiscountSheet
          open={discountOpen}
          onOpenChange={setDiscountOpen}
          value={discount}
          onApply={(d) => {
            setDiscount(d);
            setDiscountOpen(false);
          }}
        />
      ) : null}

      <CustomerSheet
        open={customerOpen}
        onOpenChange={setCustomerOpen}
        value={customer}
        onSave={(c) => {
          setCustomer(c);
          setCustomerOpen(false);
        }}
      />

      <DeliverySheet
        open={deliveryOpen}
        onOpenChange={setDeliveryOpen}
        who={customer}
        address={address}
        errors={fieldErrors}
        onSave={(c, a) => {
          setCustomer(c);
          setAddress(a);
          setFieldErrors({});
          setDeliveryOpen(false);
        }}
      />

      <DoneSheet done={done} onClose={() => setDone(null)} />
    </div>
  );
}

function TicketPanel({
  ticket,
  quote,
  mode,
  setMode,
  customer,
  discount,
  manager,
  delivery,
  onCustomer,
  onDiscount,
  onClear,
  onCharge,
  ready,
  busy,
  inSheet,
}: {
  /** a phone order without who and where: "cobrar" asks for them first */
  ready: boolean;
  ticket: Ticket;
  quote: ReturnType<typeof useQuote>;
  mode: Mode;
  setMode: (m: Mode) => void;
  customer: Customer;
  discount: PdvDiscountIn | null;
  manager: boolean;
  /** a phone order's who and where (and Core's zone, time and fee) */
  delivery: React.ReactNode;
  onCustomer: () => void;
  onDiscount: () => void;
  onClear: () => void;
  onCharge: () => void;
  busy: boolean;
  inSheet: boolean;
}) {
  const empty = !ticket.lines.length;
  const lineError = quote.error && quote.errorLine !== null ? pdvError(quote.error) : null;
  const body = (
    <>
      <Segmented
        label="para levar, comer aqui ou entrega"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'takeaway', label: 'Para levar' },
          { value: 'here', label: 'Comer aqui' },
          { value: 'delivery', label: 'Entrega' },
        ]}
      />
      {delivery}
      {empty ? (
        <EmptyState
          art={<ArtTicket />}
          title="Conta vazia"
          body="Toque nos produtos para pôr na conta."
          className="py-8"
        />
      ) : (
        <div className={cn(!inSheet && 'max-h-[calc(100dvh-26rem)] min-h-24 overflow-y-auto')}>
          <TicketLines
            ticket={ticket}
            quote={quote.quote}
            fresh={quote.fresh}
            errorLine={quote.errorLine}
            errorText={lineError}
          />
        </div>
      )}
      {quote.error && quote.errorLine === null && !quote.outOfZone ? (
        <p className="t-caption font-semibold text-danger" role="alert">
          {pdvError(quote.error)}{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => void quote.refetch()}
          >
            tentar de novo
          </button>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {mode !== 'delivery' ? (
          <ExtraChip
            Icon={User}
            on={!!(customer.name || customer.digits || customer.notes)}
            onClick={onCustomer}
          >
            {customer.name || (customer.digits ? customer.phone : 'cliente')}
          </ExtraChip>
        ) : null}
        {manager ? (
          <ExtraChip Icon={Percent} on={!!discount} onClick={onDiscount} disabled={empty}>
            {discount ? `desconto ${discountLabel(discount)}` : 'desconto'}
          </ExtraChip>
        ) : null}
        {!empty ? (
          <button
            type="button"
            onClick={onClear}
            className="press t-label ml-auto min-h-11 rounded-full px-3 text-muted hover:text-danger"
          >
            limpar
          </button>
        ) : null}
      </div>
      {!empty ? <Totals quote={quote.quote} fresh={quote.fresh} pending={quote.pending} /> : null}
      <Button size="lg" block disabled={empty || !!quote.error} loading={busy} onClick={onCharge}>
        {quote.quote && !empty && ready ? `cobrar ${money(quote.quote.totalCents)}` : 'cobrar'}
        {!inSheet ? (
          <kbd className="t-caption ml-1 hidden rounded bg-[rgb(255_255_255/0.16)] px-1.5 font-sans lg:inline">
            Enter
          </kbd>
        ) : null}
      </Button>
    </>
  );
  if (inSheet) return <div className="space-y-4 pb-2">{body}</div>;
  return (
    <Card className="space-y-4 p-4 lg:p-5">
      <h2 className="t-title-2 flex items-center gap-2">
        <Receipt weight="duotone" className="size-6" aria-hidden />
        Conta
      </h2>
      {body}
    </Card>
  );
}

function ExtraChip({
  Icon,
  on,
  onClick,
  disabled,
  children,
}: {
  Icon: typeof User;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'press t-label inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full px-3.5 ring-1 disabled:opacity-45',
        on ? 'bg-spark-soft text-ink ring-primary' : 'bg-surface text-ink ring-line-strong',
      )}
    >
      <Icon weight={on ? 'fill' : 'regular'} className="size-4.5 shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
    </button>
  );
}

function CustomerSheet({
  open,
  onOpenChange,
  value,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: Customer;
  onSave: (c: Customer) => void;
}) {
  const [c, setC] = useState(value);
  const nameId = useId();
  const phoneId = useId();
  const notesId = useId();
  useEffect(() => {
    if (open) setC(value);
  }, [open, value]);
  const badPhone = c.phone.trim() !== '' && !parsePhone(c.phone);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Cliente"
      description="Opcional. Com o celular, o cliente ganha os selos do cartão fidelidade."
      footer={
        <div className="flex gap-2">
          {value.name || value.digits || value.notes ? (
            <Button variant="ghost" onClick={() => onSave(NO_CUSTOMER)}>
              tirar
            </Button>
          ) : null}
          <Button size="lg" className="flex-1" disabled={badPhone} onClick={() => onSave(c)}>
            pronto
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <Field label="Nome" htmlFor={nameId} optional>
          <TextInput
            id={nameId}
            maxLength={80}
            value={c.name}
            autoComplete="off"
            onChange={(e) => setC({ ...c, name: e.target.value })}
          />
        </Field>
        <Field
          label="Celular"
          htmlFor={phoneId}
          optional
          error={badPhone ? 'Digite o celular com DDD, como (22) 99999-0000.' : null}
        >
          <PhoneInput
            id={phoneId}
            value={c.phone}
            onChange={(v, digits) => setC({ ...c, phone: v, digits })}
          />
        </Field>
        <Field label="Observação do pedido" htmlFor={notesId} optional>
          <TextArea
            id={notesId}
            maxLength={500}
            value={c.notes}
            className="min-h-20"
            onChange={(e) => setC({ ...c, notes: e.target.value })}
          />
        </Field>
      </div>
    </Sheet>
  );
}

/**
 * The sale went through: the order's number and the change, big, then the next customer. A phone
 * order says it went to the kitchen and whether it's paid or charged at the door.
 */
function DoneSheet({ done, onClose }: { done: Done | null; onClose: () => void }) {
  const [shown, setShown] = useState(done);
  useEffect(() => {
    if (done) setShown(done);
  }, [done]);
  const d = done ?? shown;
  const s = d?.sale;
  const dv = d?.delivery ?? null;
  return (
    <Sheet
      open={!!done}
      onOpenChange={(o) => !o && onClose()}
      title={dv ? 'Pedido enviado' : 'Venda feita'}
    >
      {s ? (
        <div className="space-y-5 pb-2">
          <div className="flex items-center gap-4">
            <CheckCircle weight="fill" className="size-12 shrink-0 text-success" aria-hidden />
            <div>
              <p className="t-caption text-muted">Pedido</p>
              <p className="tnum t-display leading-none">#{s.number}</p>
            </div>
            <p className="tnum t-title-2 ml-auto">{money(s.totalCents)}</p>
          </div>
          {dv ? (
            <div className="flex items-start gap-3 rounded-md bg-sunken px-4 py-3" role="status">
              <ChefHat weight="duotone" className="mt-0.5 size-6 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold">Foi para a cozinha</p>
                <p className="t-caption break-words text-muted">
                  Entrega para {dv.name}
                  {dv.address ? ` · ${dv.address}` : ''}
                </p>
              </div>
            </div>
          ) : null}
          {dv?.later ? (
            <div className="flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3">
              <HandCoins
                weight="duotone"
                className="mt-0.5 size-6 shrink-0 text-warning"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-semibold">
                  Não pago: cobrar na entrega, em {PDV_METHOD_LABEL[dv.later.method]}
                </p>
                <p className="t-caption text-ink">
                  {dv.later.changeForCents
                    ? `Levar troco para ${money(dv.later.changeForCents)}. `
                    : ''}
                  Quando o dinheiro voltar, receba pelo pedido no caixa.
                </p>
              </div>
            </div>
          ) : null}
          {s.changeCents > 0 ? (
            <div className="rounded-lg bg-spark-soft px-5 py-4" role="status">
              <p className="t-label">Troco</p>
              <p className="tnum font-display text-[3rem] font-semibold leading-none">
                {money(s.changeCents)}
              </p>
            </div>
          ) : null}
          {s.payments.length ? (
            <div>
              {dv ? (
                <p className="t-label mb-2 flex items-center gap-1.5 text-success">
                  <CheckCircle weight="fill" className="size-4.5" aria-hidden />
                  Pago
                </p>
              ) : null}
              <ul className="divide-y divide-line rounded-md bg-sunken px-4">
                {s.payments.map((p) => {
                  const Icon = PDV_METHOD_ICON[p.method];
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-3">
                      <Icon weight="duotone" className="size-6 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 font-semibold">
                        {PDV_METHOD_LABEL[p.method]}
                        {p.tenderedCents ? (
                          <span className="t-caption block font-medium text-muted">
                            recebido {money(p.tenderedCents)}
                          </span>
                        ) : null}
                      </span>
                      <span className="tnum">{money(p.amountCents)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button size="lg" autoFocus className="sm:flex-1" onClick={onClose}>
              {dv ? 'novo pedido' : 'nova venda'}
            </Button>
            <ButtonLink
              to={`/pedidos/${s.orderId}`}
              variant="secondary"
              size="lg"
              onClick={onClose}
            >
              ver o pedido
            </ButtonLink>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

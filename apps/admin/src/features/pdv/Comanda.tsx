import {
  ArrowsLeftRight,
  ArrowsSplit,
  CheckCircle,
  NotePencil,
  Percent,
  Plus,
  Prohibit,
  X,
  XCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  api,
  type PdvPayment,
  type PdvPaymentIn,
  type TabDetail,
  type TabRound,
} from '../../lib/api.ts';
import { clock, money, when } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { isPlanRequired, useCan, useFeature, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Field, Stepper, TextInput, Toggle } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { tableName } from '../../ui/orderMode.ts';
import { ActionBar } from '../../ui/Page.tsx';
import { PDV_METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { PDV_METHOD_ICON } from '../../ui/pdv/methods.ts';
import { openFor } from '../../ui/pdv/TableTile.tsx';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { StateChip } from '../../ui/StateChip.tsx';
import { toast } from '../../ui/Toast.tsx';
import {
  isCode,
  pdvError,
  putTab,
  toLineIn,
  usePdvState,
  useQuote,
  useTab,
  useTicket,
} from './data.ts';
import { PaySheet } from './PaySheet.tsx';
import {
  DiscountSheet,
  discountLabel,
  PdvTop,
  ReasonField,
  TicketLines,
  Totals,
} from './parts.tsx';
import { Picker } from './Picker.tsx';

// A comanda: its rounds (each an order the kitchen makes), what it adds up to with the service
// charge and any discount (Core's figures), and its payments, taken one at a time until nothing
// remains. Then it closes by itself and the table frees.

type SheetId = 'round' | 'pay' | 'discount' | 'move' | 'cancel' | null;

export default function Comanda() {
  return useFeature('pdv') ? <TabScreen /> : <LockedPage title="Comanda" feature="pdv" />;
}

function TabScreen() {
  const { id = '' } = useParams();
  const [ways, setWays] = useState(0);
  const q = useTab(id, ways);
  const tab = q.data;
  const manager = useCan('manager');
  const state = usePdvState();
  const caixaOpen = !state.data || !!state.data.caixa;
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<SheetId>(null);
  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [cancelRound, setCancelRound] = useState<TabRound | null>(null);
  const [voiding, setVoiding] = useState<PdvPayment | null>(null);
  const [change, setChange] = useState<PdvPayment | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const write = (fn: () => Promise<{ tab: TabDetail }>) => fn();
  const onTab = (t: TabDetail) => putTab(qc, t);
  const onErr = (e: unknown) => {
    haptic.error();
    if (isCode(e, 'TAB_CLOSED')) void qc.invalidateQueries({ queryKey: ['pdv'] });
    toast.error(pdvError(e));
  };

  const patch = useMutation({
    mutationFn: (p: Parameters<typeof api.pdv.updateTab>[1]) =>
      write(() => api.pdv.updateTab(id, p)),
    onSuccess: (r) => {
      onTab(r.tab);
      setSheet(null);
    },
    onError: onErr,
  });
  const pay = useMutation({
    mutationFn: (p: PdvPaymentIn) => api.pdv.payTab(id, p),
    onSuccess: (r) => {
      haptic.commit();
      onTab(r.tab);
      setSheet(null);
      setWays(0);
      setChange(r.payment);
      if (r.tab.status === 'closed') toast('Comanda paga e fechada. A mesa está livre.');
    },
    onError: (e) => {
      if (isCode(e, 'CAIXA_CLOSED')) void qc.invalidateQueries({ queryKey: qk.pdv.state });
      onErr(e);
    },
  });
  const close = useMutation({
    mutationFn: () => api.pdv.closeTab(id),
    onSuccess: (r) => {
      haptic.commit();
      onTab(r.tab);
      toast('Comanda fechada.');
    },
    onError: onErr,
  });

  if (isPlanRequired(q.error))
    return (
      <Body>
        <PlanLocked feature="pdv" reason={reasonOf(q.error)} refresh />
      </Body>
    );
  if (!tab)
    return (
      <Body>
        <PdvTop title="Comanda" />
        {q.error ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : (
          <DetailSkeleton />
        )}
      </Body>
    );

  const isOpen = tab.status === 'open';
  const live = tab.roundsList.filter((r) => r.state !== 'cancelled' && r.state !== 'refunded');
  const activePays = tab.payments.filter((p) => !p.voided);
  const name = tableName(tab.label);

  return (
    <Body>
      <PdvTop title={`Comanda: ${name}`} heading={false} className="max-md:hidden" />
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3" data-vt-dst={`tab:${tab.id}`}>
          <div className="min-w-0">
            <p className="t-caption text-muted">
              aberta {openFor(tab.openedAt, now)} por {tab.openedBy}
            </p>
            <h1 className="t-title-1 break-words">{name}</h1>
            {tab.customerName ? <p className="t-body text-muted">{tab.customerName}</p> : null}
          </div>
          {isOpen ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowsLeftRight />}
              onClick={() => setSheet('move')}
              className="min-h-11 shrink-0"
            >
              mudar
            </Button>
          ) : (
            <span
              className={cn(
                't-caption inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold',
                tab.status === 'closed' ? 'bg-success-soft text-success' : 'bg-sunken text-muted',
              )}
            >
              {tab.status === 'closed' ? (
                <CheckCircle weight="bold" className="size-4" aria-hidden />
              ) : (
                <XCircle weight="bold" className="size-4" aria-hidden />
              )}
              {tab.status === 'closed' ? 'Fechada' : 'Cancelada'}
              {tab.closedAt ? ` às ${clock(tab.closedAt)}` : ''}
            </span>
          )}
        </header>

        {change && change.changeCents > 0 ? (
          <div role="status" className="flex items-center gap-4 rounded-lg bg-spark-soft px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="t-label">Troco do pagamento em dinheiro</p>
              <p className="tnum font-display text-[2.5rem] font-semibold leading-none">
                {money(change.changeCents)}
              </p>
            </div>
            <button
              type="button"
              aria-label="fechar o aviso do troco"
              onClick={() => setChange(null)}
              className="press grid size-11 place-items-center rounded-full hover:bg-press"
            >
              <X className="size-5" />
            </button>
          </div>
        ) : null}

        {!isOpen && tab.status === 'closed' ? (
          <Notice
            tone="success"
            title="Comanda paga e fechada"
            action={
              <ButtonLink to="/pdv/mesas" variant="secondary" replace>
                voltar às mesas
              </ButtonLink>
            }
          >
            As rodadas foram marcadas como pagas e entregues.
          </Notice>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:items-start">
          <div className="order-2 space-y-4 lg:order-1">
            <Rounds
              tab={tab}
              live={live.length}
              onCancel={setCancelRound}
              onAdd={isOpen ? () => setSheet('round') : undefined}
            />
            {tab.payments.length ? (
              <Payments payments={tab.payments} canVoid={manager && isOpen} onVoid={setVoiding} />
            ) : null}
            {isOpen && manager && !activePays.length ? (
              <Button
                variant="ghost"
                className="text-danger!"
                icon={<Prohibit />}
                onClick={() => setSheet('cancel')}
              >
                cancelar comanda
              </Button>
            ) : null}
          </div>

          <Card className="order-1 space-y-4 p-4 lg:sticky lg:top-4 lg:order-2 lg:p-5">
            <dl className="t-body space-y-1.5">
              <div className="flex justify-between text-muted">
                <dt>Consumo</dt>
                <dd className="tnum">{money(tab.subtotalCents)}</dd>
              </div>
              {tab.discountCents ? (
                <div className="flex justify-between text-success">
                  <dt className="min-w-0 truncate">
                    Desconto{tab.discount ? ` (${discountLabel(tab.discount)})` : ''}
                  </dt>
                  <dd className="tnum">−{money(tab.discountCents)}</dd>
                </div>
              ) : null}
              {tab.serviceBps > 0 ? (
                <div className="flex justify-between text-muted">
                  <dt>
                    Serviço ({(tab.serviceBps / 100).toLocaleString('pt-BR')}%)
                    {!tab.serviceFee ? ' · recusado' : ''}
                  </dt>
                  <dd className="tnum">+{money(tab.serviceCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between font-semibold">
                <dt>Total</dt>
                <dd className="tnum">{money(tab.totalCents)}</dd>
              </div>
              {tab.paidCents ? (
                <div className="flex justify-between text-success">
                  <dt>Pago</dt>
                  <dd className="tnum">−{money(tab.paidCents)}</dd>
                </div>
              ) : null}
            </dl>
            <div className="rounded-md bg-sunken px-4 py-3">
              <p className="t-caption text-muted">
                {tab.remainingCents < 0 ? 'Recebido a mais' : 'Falta receber'}
              </p>
              <p
                className={cn(
                  'tnum t-display leading-tight',
                  tab.remainingCents < 0 && 'text-danger',
                )}
              >
                {money(Math.abs(tab.remainingCents))}
              </p>
            </div>

            {isOpen && tab.remainingCents < 0 ? (
              <Notice tone="warning" title="A comanda ficou paga a mais">
                Uma rodada cancelada deixou {money(-tab.remainingCents)} pagos a mais. Quem é
                gerente estorna um pagamento e você recebe de novo o valor certo.
              </Notice>
            ) : null}

            {isOpen && tab.serviceBps > 0 ? (
              <Toggle
                checked={tab.serviceFee}
                disabled={patch.isPending}
                onChange={(v) => patch.mutate({ serviceFee: v })}
                label="Taxa de serviço"
                description="Desligue se o cliente não quiser pagar."
              />
            ) : null}

            {isOpen ? (
              <div className="flex flex-wrap gap-2">
                {manager ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Percent />}
                    onClick={() => setSheet('discount')}
                    className="min-h-11"
                  >
                    {tab.discount ? 'mudar desconto' : 'desconto'}
                  </Button>
                ) : null}
                {tab.remainingCents > 1 ? (
                  <Button
                    variant={ways ? 'primary' : 'secondary'}
                    size="sm"
                    icon={<ArrowsSplit />}
                    aria-pressed={!!ways}
                    onClick={() => setWays((w) => (w ? 0 : 2))}
                    className="min-h-11"
                  >
                    dividir a conta
                  </Button>
                ) : null}
              </div>
            ) : null}

            {isOpen && ways ? (
              <Split
                ways={ways}
                setWays={setWays}
                shares={tab.split?.ways === ways ? tab.split.sharesCents : null}
                onPay={(c) => {
                  setPayAmount(c);
                  setSheet('pay');
                }}
              />
            ) : null}

            {isOpen ? (
              <div className="hidden gap-2 md:flex">
                <Button
                  variant="secondary"
                  size="lg"
                  icon={<Plus />}
                  className="flex-1"
                  onClick={() => setSheet('round')}
                >
                  itens
                </Button>
                <PrimaryAction
                  tab={tab}
                  busy={close.isPending}
                  onPay={() => {
                    setPayAmount(null);
                    setSheet('pay');
                  }}
                  onClose={() => close.mutate()}
                />
              </div>
            ) : null}
          </Card>
        </div>
      </div>

      {isOpen ? (
        <ActionBar>
          <Button
            variant="secondary"
            size="lg"
            icon={<Plus />}
            className="flex-1"
            onClick={() => setSheet('round')}
          >
            itens
          </Button>
          <PrimaryAction
            tab={tab}
            busy={close.isPending}
            onPay={() => {
              setPayAmount(null);
              setSheet('pay');
            }}
            onClose={() => close.mutate()}
          />
        </ActionBar>
      ) : null}

      <RoundSheet
        tabId={tab.id}
        name={name}
        open={sheet === 'round'}
        onOpenChange={(o) => setSheet(o ? 'round' : null)}
        onSent={onTab}
      />
      <PaySheet
        open={sheet === 'pay'}
        onOpenChange={(o) => setSheet(o ? 'pay' : null)}
        title={`Receber: ${name}`}
        totalCents={Math.max(0, tab.remainingCents)}
        single={{
          initialCents: payAmount ?? Math.max(0, tab.remainingCents),
          shares: tab.split?.sharesCents,
        }}
        caixaOpen={caixaOpen}
        busy={pay.isPending}
        paused={pay.isPaused}
        submitLabel="receber"
        onSubmit={(p) => p[0] && pay.mutate(p[0])}
      />
      {manager ? (
        <DiscountSheet
          open={sheet === 'discount'}
          onOpenChange={(o) => setSheet(o ? 'discount' : null)}
          value={tab.discount}
          busy={patch.isPending}
          onApply={(d) => patch.mutate({ discount: d })}
        />
      ) : null}
      <MoveSheet
        tab={tab}
        open={sheet === 'move'}
        onOpenChange={(o) => setSheet(o ? 'move' : null)}
        busy={patch.isPending}
        onSave={(p) => patch.mutate(p)}
      />
      <CancelTabSheet
        tab={tab}
        open={sheet === 'cancel'}
        onOpenChange={(o) => setSheet(o ? 'cancel' : null)}
      />
      <CancelRoundSheet round={cancelRound} tabId={tab.id} onClose={() => setCancelRound(null)} />
      <VoidSheet payment={voiding} onClose={() => setVoiding(null)} />
    </Body>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-36 pt-4 md:px-8 md:pb-16 md:pt-6">
      {children}
    </div>
  );
}

/** "receber" while something remains; "fechar" when nothing does (all rounds cancelled). */
function PrimaryAction({
  tab,
  busy,
  onPay,
  onClose,
}: {
  tab: TabDetail;
  busy: boolean;
  onPay: () => void;
  onClose: () => void;
}) {
  if (tab.remainingCents === 0)
    return (
      <Button size="lg" className="flex-1" loading={busy} onClick={onClose}>
        fechar comanda
      </Button>
    );
  return (
    <Button size="lg" className="flex-1" disabled={tab.remainingCents < 0} onClick={onPay}>
      receber
    </Button>
  );
}

function Split({
  ways,
  setWays,
  shares,
  onPay,
}: {
  ways: number;
  setWays: (n: number) => void;
  shares: number[] | null;
  onPay: (cents: number) => void;
}) {
  return (
    <div className="space-y-3 rounded-md bg-sunken p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="t-label">Dividir por</p>
        <Stepper label="em quantas partes" value={ways} min={2} max={20} onChange={setWays} />
      </div>
      {shares ? (
        <ul className="grid grid-cols-2 gap-2" aria-label="partes da conta">
          {shares.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPay(c)}
                className="press flex min-h-14 w-full flex-col items-start justify-center rounded-md bg-surface px-3 py-2 text-left depth-1 hover:bg-hover"
              >
                <span className="t-caption text-muted">parte {i + 1}</span>
                <span className="tnum font-semibold">{money(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-caption text-muted" role="status">
          Calculando as partes…
        </p>
      )}
      <p className="t-caption text-muted">Toque numa parte para receber esse valor.</p>
    </div>
  );
}

function Rounds({
  tab,
  live,
  onCancel,
  onAdd,
}: {
  tab: TabDetail;
  live: number;
  onCancel: (r: TabRound) => void;
  onAdd: (() => void) | undefined;
}) {
  return (
    <section aria-labelledby="rodadas-t">
      <h3 id="rodadas-t" className="t-title-2 mb-3 px-1">
        Rodadas{' '}
        <span className="t-body font-sans font-medium text-muted">
          {live} {live === 1 ? 'rodada' : 'rodadas'}
        </span>
      </h3>
      {tab.roundsList.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="t-body text-muted">Nada pedido ainda. Cada envio vai para a cozinha.</p>
          {onAdd ? (
            <Button icon={<Plus />} onClick={onAdd}>
              adicionar itens
            </Button>
          ) : null}
        </Card>
      ) : (
        <ol className="space-y-3">
          {tab.roundsList.map((r) => {
            const gone = r.state === 'cancelled' || r.state === 'refunded';
            const cancellable = tab.status === 'open' && !gone && r.state !== 'delivered';
            return (
              <li key={r.orderId}>
                <Card className={cn('p-4', gone && 'opacity-60')}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="tnum font-display text-lg font-semibold">#{r.number}</p>
                    <StateChip state={r.state} mode="dine_in" />
                    <span className="t-caption tnum text-muted">{clock(r.placedAt)}</span>
                    <span className={cn('tnum ml-auto font-semibold', gone && 'line-through')}>
                      {money(r.totalCents)}
                    </span>
                  </div>
                  <ul className="t-body mt-2 space-y-1">
                    {r.items.map((i, k) => (
                      <li key={k} className="flex gap-2">
                        <span className="tnum w-7 shrink-0 font-semibold">{i.qty}×</span>
                        <span className="min-w-0 flex-1">
                          {i.name}
                          {i.modifiers.length ? (
                            <span className="t-caption block text-muted">
                              {i.modifiers
                                .map((m) => (m.qty > 1 ? `${m.qty}× ${m.name}` : m.name))
                                .join(' · ')}
                            </span>
                          ) : null}
                          {i.note ? (
                            <span className="t-caption flex items-start gap-1 font-semibold">
                              <NotePencil
                                weight="bold"
                                className="mt-0.5 size-3.5 shrink-0 text-warning"
                                aria-label="observação"
                              />
                              {i.note}
                            </span>
                          ) : null}
                        </span>
                        <span className="tnum shrink-0 text-muted">{money(i.lineTotalCents)}</span>
                      </li>
                    ))}
                  </ul>
                  {cancellable ? (
                    <button
                      type="button"
                      onClick={() => onCancel(r)}
                      className="t-label -mb-2 -ml-2 mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-muted hover:text-danger"
                    >
                      <XCircle className="size-5" aria-hidden /> cancelar rodada
                    </button>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Payments({
  payments,
  canVoid,
  onVoid,
}: {
  payments: PdvPayment[];
  canVoid: boolean;
  onVoid: (p: PdvPayment) => void;
}) {
  return (
    <section aria-labelledby="pagamentos-t">
      <h3 id="pagamentos-t" className="t-title-2 mb-3 px-1">
        Pagamentos
      </h3>
      <Card className="divide-y divide-line">
        {payments.map((p) => {
          const Icon = PDV_METHOD_ICON[p.method];
          return (
            <div key={p.id} className={cn('flex items-center gap-3 p-4', p.voided && 'opacity-60')}>
              <Icon weight="duotone" className="size-6 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {PDV_METHOD_LABEL[p.method]}
                  {p.voided ? (
                    <span className="ml-2 font-medium text-danger">estornado</span>
                  ) : null}
                </p>
                <p className="t-caption text-muted">
                  {when(p.at)} · {p.by}
                  {p.tenderedCents
                    ? ` · recebido ${money(p.tenderedCents)}, troco ${money(p.changeCents)}`
                    : ''}
                </p>
              </div>
              <span className={cn('tnum font-semibold', p.voided && 'line-through')}>
                {money(p.amountCents)}
              </span>
              {canVoid && !p.voided ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 text-muted!"
                  onClick={() => onVoid(p)}
                >
                  estornar
                </Button>
              ) : null}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

/** "Adicionar itens": the counter's picker, sent to the kitchen as one round of this comanda. */
function RoundSheet({
  tabId,
  name,
  open,
  onOpenChange,
  onSent,
}: {
  tabId: string;
  name: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSent: (t: TabDetail) => void;
}) {
  const ticket = useTicket(`vendua-pdv-round:${tabId}`);
  const quote = useQuote(open ? ticket.lines : [], null);
  const [serveNow, setServeNow] = useState(false);
  const [notes, setNotes] = useState('');
  const notesId = useId();
  const list = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of ticket.lines) c[l.productId] = (c[l.productId] ?? 0) + l.qty;
    return c;
  }, [ticket.lines]);
  const items = ticket.lines.reduce((n, l) => n + l.qty, 0);
  const send = useMutation({
    mutationFn: () =>
      api.pdv.round(tabId, {
        lines: ticket.lines.map(toLineIn),
        ...(notes.trim() ? { notes: notes.trim().slice(0, 500) } : {}),
        ...(serveNow ? { serveNow: true } : {}),
      }),
    onSuccess: (r) => {
      haptic.commit();
      onSent(r.tab);
      ticket.clear();
      setNotes('');
      setServeNow(false);
      onOpenChange(false);
      toast(serveNow ? 'Rodada lançada.' : 'Rodada enviada para a cozinha.');
    },
    onError: (e) => {
      haptic.error();
      toast.error(pdvError(e));
    },
  });
  return (
    <Sheet
      wide
      open={open}
      onOpenChange={onOpenChange}
      title={`Adicionar itens: ${name}`}
      footer={
        <Button
          size="lg"
          block
          disabled={!items || !!quote.error}
          loading={send.isPending && !send.isPaused}
          onClick={() => send.mutate()}
        >
          {send.isPaused
            ? 'esperando a conexão…'
            : items
              ? `enviar ${items} ${items === 1 ? 'item' : 'itens'}${quote.quote && quote.fresh ? ` · ${money(quote.quote.totalCents)}` : ''}`
              : 'escolha os itens'}
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        {items ? (
          <div ref={list} className="rounded-lg bg-sunken px-3">
            <TicketLines
              ticket={ticket}
              quote={quote.quote}
              fresh={quote.fresh}
              errorLine={quote.errorLine}
              errorText={quote.error ? pdvError(quote.error) : null}
            />
            <Totals
              quote={quote.quote}
              fresh={quote.fresh}
              pending={quote.pending}
              className="border-t border-line py-3"
            />
          </div>
        ) : null}
        {open ? <Picker compact counts={counts} onPick={(l) => ticket.add(l)} /> : null}
        {items ? (
          <>
            <Field label="Observação da rodada" htmlFor={notesId} optional>
              <TextInput
                id={notesId}
                maxLength={500}
                value={notes}
                placeholder="sai junto com a anterior, sem pressa…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Toggle
              checked={serveNow}
              onChange={setServeNow}
              label="Entregar agora"
              description="Para o que sai na hora (bebidas do balcão), sem passar pela cozinha."
            />
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

function MoveSheet({
  tab,
  open,
  onOpenChange,
  busy,
  onSave,
}: {
  tab: TabDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  busy: boolean;
  onSave: (p: { tableId?: string; label?: string; customerName?: string }) => void;
}) {
  const { data } = usePdvState();
  const [tableId, setTableId] = useState(tab.tableId);
  const [label, setLabel] = useState(tab.label);
  const [customer, setCustomer] = useState(tab.customerName ?? '');
  const ids = { label: useId(), customer: useId() };
  useEffect(() => {
    if (!open) return;
    setTableId(tab.tableId);
    setLabel(tab.label);
    setCustomer(tab.customerName ?? '');
  }, [open, tab]);
  const busyTables = new Set((data?.tabs ?? []).map((t) => t.tableId).filter(Boolean));
  const free = (data?.tables ?? []).filter((t) => t.id === tab.tableId || !busyTables.has(t.id));
  const p: { tableId?: string; label?: string; customerName?: string } = {};
  if (tableId && tableId !== tab.tableId) p.tableId = tableId;
  if (!tab.tableId && label.trim() && label.trim() !== tab.label)
    p.label = label.trim().slice(0, 40);
  if (customer.trim() !== (tab.customerName ?? '')) p.customerName = customer.trim().slice(0, 80);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Mudar a comanda"
      description="Trocar de mesa, ou o nome e o cliente."
      footer={
        <Button
          size="lg"
          block
          disabled={!Object.keys(p).length}
          loading={busy}
          onClick={() => onSave(p)}
        >
          salvar
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        {free.length ? (
          <div>
            <p className="t-label mb-2">{tab.tableId ? 'Mesa' : 'Pôr numa mesa'}</p>
            <div role="radiogroup" aria-label="mesa" className="flex flex-wrap gap-2">
              {free.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tableId === t.id}
                  onClick={() => setTableId(t.id)}
                  className={cn(
                    'press t-label min-h-12 rounded-full px-4 ring-1',
                    tableId === t.id
                      ? 'bg-primary text-on-primary ring-primary'
                      : 'bg-surface text-ink ring-line-strong hover:bg-hover',
                  )}
                >
                  {tableName(t.label)}
                </button>
              ))}
            </div>
            <p className="t-caption mt-2 text-muted">Só aparecem as mesas livres.</p>
          </div>
        ) : null}
        {!tab.tableId ? (
          <Field label="Nome da comanda" htmlFor={ids.label}>
            <TextInput
              id={ids.label}
              maxLength={40}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Cliente" htmlFor={ids.customer} optional>
          <TextInput
            id={ids.customer}
            maxLength={80}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}

const ROUND_REASONS = ['Pedido errado', 'Cliente desistiu', 'Item acabou', 'Lançado duas vezes'];

function CancelRoundSheet({
  round,
  tabId,
  onClose,
}: {
  round: TabRound | null;
  tabId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (round) setReason('');
  }, [round]);
  const cancel = useMutation({
    mutationFn: () => api.transition(round!.orderId, 'cancelled', { reason: reason.trim() }),
    onSuccess: () => {
      haptic.commit();
      void qc.invalidateQueries({ queryKey: ['pdv', 'tab', tabId] });
      void qc.invalidateQueries({ queryKey: qk.pdv.state });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(`Rodada #${round?.number ?? ''} cancelada.`);
      onClose();
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  return (
    <Sheet
      open={!!round}
      onOpenChange={(o) => !o && onClose()}
      title={round ? `Cancelar a rodada #${round.number}` : 'Cancelar rodada'}
      description="Sai da conta e da cozinha. Não dá para desfazer."
      footer={
        <HoldButton disabled={!reason.trim() || cancel.isPending} onConfirm={() => cancel.mutate()}>
          segure para cancelar a rodada
        </HoldButton>
      }
    >
      <div className="pb-2">
        <ReasonField value={reason} onChange={setReason} reasons={ROUND_REASONS} />
      </div>
    </Sheet>
  );
}

function VoidSheet({ payment, onClose }: { payment: PdvPayment | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (payment) setReason('');
  }, [payment]);
  const voidIt = useMutation({
    mutationFn: () => api.pdv.voidPayment(payment!.id, reason.trim()),
    onSuccess: (r) => {
      haptic.commit();
      putTab(qc, r.tab);
      void qc.invalidateQueries({ queryKey: qk.pdv.caixa });
      toast('Pagamento estornado. Devolva o valor ao cliente.');
      onClose();
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  return (
    <Sheet
      open={!!payment}
      onOpenChange={(o) => !o && onClose()}
      title="Estornar pagamento"
      description={
        payment
          ? `${PDV_METHOD_LABEL[payment.method]} de ${money(payment.amountCents)}. O valor sai do caixa e volta a faltar na comanda.`
          : undefined
      }
      footer={
        <HoldButton disabled={!reason.trim() || voidIt.isPending} onConfirm={() => voidIt.mutate()}>
          segure para estornar
        </HoldButton>
      }
    >
      <div className="pb-2">
        <ReasonField
          value={reason}
          onChange={setReason}
          reasons={['Valor errado', 'Forma errada', 'Cliente vai pagar de outro jeito']}
        />
      </div>
    </Sheet>
  );
}

function CancelTabSheet({
  tab,
  open,
  onOpenChange,
}: {
  tab: TabDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const session = useSession();
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const cancel = useMutation({
    mutationFn: () => api.pdv.cancelTab(tab.id, reason.trim()),
    onSuccess: (r) => {
      haptic.commit();
      putTab(qc, r.tab);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(`${tableName(tab.label)}: comanda cancelada.`);
      onOpenChange(false);
      nav('/pdv/mesas', { replace: true });
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Cancelar a comanda"
      description={`As rodadas abertas são canceladas e a mesa fica livre. Fica registrado que ${session.user.name.split(' ')[0]} cancelou.`}
      footer={
        <HoldButton disabled={!reason.trim() || cancel.isPending} onConfirm={() => cancel.mutate()}>
          segure para cancelar a comanda
        </HoldButton>
      }
    >
      <div className="pb-2">
        <ReasonField
          value={reason}
          onChange={setReason}
          reasons={['Aberta por engano', 'Cliente foi embora', 'Mesa errada']}
        />
      </div>
    </Sheet>
  );
}

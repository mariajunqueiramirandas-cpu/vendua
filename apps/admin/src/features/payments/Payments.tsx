import {
  ArrowRight,
  Check,
  Copy,
  CreditCard,
  ForkKnife,
  Lock,
  Money,
  PixLogo,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  api,
  type HandoverMode,
  type Payments as PaymentsData,
  type PayMethod,
} from '../../lib/api.ts';
import { ago, money, plural } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { RankBars } from '../../ui/charts.tsx';
import { DuaNote, encomendaConflictText, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, TextInput, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { payError, REVIEW } from '../../ui/PaymentChip.tsx';
import { PixQr } from '../../ui/PixCode.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { LinkList, LinkRow } from '../../ui/LinkRow.tsx';
import { toast } from '../../ui/Toast.tsx';
import { useMarkPaid } from '../orders/actions.ts';
import { AdjustmentLine } from './Adjustments.tsx';
import { MercadoPagoCard, mpLive, useMpArrival } from './MercadoPago.tsx';
import { MonthCard, monthName } from './Statement.tsx';

// the order the shopper sees them in
const METHOD: Record<PayMethod, { label: string; Icon: typeof PixLogo; hint: string }> = {
  pix: {
    label: 'Pix',
    Icon: PixLogo,
    hint: 'O cliente paga pela chave da loja e você confere no banco.',
  },
  card_online: {
    label: 'Cartão pelo Mercado Pago',
    Icon: CreditCard,
    hint: 'O cliente paga com cartão no site, na tela do Mercado Pago.',
  },
  card_on_delivery: {
    label: 'Cartão na entrega',
    Icon: CreditCard,
    hint: 'Na maquininha, na entrega ou retirada.',
  },
  meal_voucher: {
    label: 'Vale-refeição',
    Icon: ForkKnife,
    hint: 'O cartão de vale-refeição na maquininha, na entrega ou retirada.',
  },
  cash: { label: 'Dinheiro', Icon: Money, hint: 'Na entrega ou retirada.' },
};

// Pagamentos is the money that came in (what needs a look today, the month); how the store gets
// paid (the methods, the Pix key, Mercado Pago) is a setting, so it lives in Loja › Formas de
// pagamento, a row away from the rest of the store's setup.

function usePayments() {
  return useQuery({ queryKey: qk.payments, queryFn: api.payments });
}

function PaymentsFrame({
  title,
  subtitle,
  back,
  data,
  error,
  retry,
  children,
}: {
  title: string;
  subtitle: string;
  back?: string;
  data: PaymentsData | undefined;
  error: unknown;
  retry: () => void;
  children: (d: PaymentsData) => ReactNode;
}) {
  return (
    <PageBody wide>
      <PageHeader title={title} subtitle={subtitle} {...(back ? { back } : {})} />
      {error && !data ? (
        <ErrorState error={error} retry={retry} />
      ) : !data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        children(data)
      )}
    </PageBody>
  );
}

export default function Payments() {
  const [search] = useSearchParams();
  const { data, error, refetch } = usePayments();
  // Mercado Pago sends the owner back to /pagamentos: the connection lives in Formas
  if (search.get('mp')) return <Navigate to={`/loja/pagamentos?${search}`} replace />;
  return (
    <PaymentsFrame
      title="Pagamentos"
      subtitle="O que já chegou, e o que falta conferir."
      data={data}
      error={error}
      retry={() => void refetch()}
    >
      {(d) => {
        // the month only tells something once money can arrive through Mercado Pago
        const showMonth = d.mercadoPago.status !== 'not_connected' || d.month.count > 0;
        // nothing set to receive with yet: the way there before anything else
        const unset = !d.pix && !mpLive(d.mercadoPago);
        const trouble = MP_TROUBLE[d.mercadoPago.status];
        return (
          <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-8">
              {unset ? (
                <Notice
                  tone="warning"
                  title="Falta dizer como a loja recebe"
                  action={
                    <ButtonLink to="/loja/pagamentos" size="sm">
                      configurar
                    </ButtonLink>
                  }
                >
                  Cadastre a chave Pix ou conecte o Mercado Pago para receber pelo site.
                </Notice>
              ) : trouble ? (
                <Notice
                  tone="warning"
                  title={trouble.title}
                  action={
                    <ButtonLink to="/loja/pagamentos" size="sm">
                      reconectar
                    </ButtonLink>
                  }
                >
                  {trouble.body}
                </Notice>
              ) : null}
              <Review data={d} />
              <Awaiting data={d} />
              <LinkList label="formas de pagamento">
                <LinkRow
                  to="/loja/pagamentos"
                  Icon={Wallet}
                  title="Formas de pagamento"
                  line="O que a loja aceita, a chave Pix e o Mercado Pago"
                />
              </LinkList>
            </div>
            <div className="space-y-8">
              {showMonth ? (
                <Section
                  title="Este mês"
                  hint={`O que chegou pelo Mercado Pago em ${monthName(d.month.month)}.`}
                >
                  <MonthCard data={d} />
                </Section>
              ) : null}
              <Section title="Últimos 30 dias">
                <Card className="p-5">
                  <RankBars
                    title="Vendas por forma de pagamento"
                    summary={summary30(d)}
                    format={money}
                    rows={d.last30ByMethod.map((r) => ({
                      key: r.method,
                      label: METHOD[r.method]?.label ?? r.method,
                      value: r.cents,
                    }))}
                  />
                </Card>
              </Section>
            </div>
          </div>
        );
      }}
    </PaymentsFrame>
  );
}

export function PaymentMethods() {
  const { data, error, refetch } = usePayments();
  const owner = useCan('owner');
  useMpArrival();
  return (
    <PaymentsFrame
      title="Formas de pagamento"
      subtitle="Como o cliente paga, e onde o dinheiro chega."
      back="/loja"
      data={data}
      error={error}
      retry={() => void refetch()}
    >
      {(d) => {
        const pixSection = (
          <Section
            title="Sua chave Pix"
            hint={
              mpLive(d.mercadoPago)
                ? 'Fica de reserva: se o Mercado Pago sair do ar para a sua loja, o Pix volta para esta chave.'
                : 'O Pix que aparece na sua loja, com o valor do pedido já preenchido.'
            }
          >
            <PixCard data={d} canEdit={owner} />
          </Section>
        );
        return (
          <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
            <Section
              title="O que a loja aceita"
              hint={
                owner
                  ? 'Só aparecem na loja as que estão ligadas.'
                  : 'Só quem é dono da loja muda isto.'
              }
            >
              <Methods data={d} canEdit={owner} />
            </Section>
            <div className="space-y-8">
              {/* where the money arrives; Mercado Pago first once it's live, the key then being its backup */}
              {mpLive(d.mercadoPago) ? null : pixSection}
              <MercadoPagoCard data={d} owner={owner} />
              {mpLive(d.mercadoPago) ? pixSection : null}
            </div>
          </div>
        );
      }}
    </PaymentsFrame>
  );
}

// the Mercado Pago notices (payments/jobs.ts) link here: say what happened, a tap from fixing it
const MP_TROUBLE: Partial<
  Record<PaymentsData['mercadoPago']['status'], { title: string; body: string }>
> = {
  expiring: {
    title: 'A conexão com o Mercado Pago vence em breve',
    body: 'Reconecte para continuar recebendo Pix e cartão pelo site.',
  },
  disconnected: {
    title: 'O Mercado Pago desconectou',
    body: 'Os pedidos seguem com o Pix da sua chave e o pagamento na entrega. Reconecte para voltar a receber pelo site.',
  },
  restricted: {
    title: 'O Mercado Pago limitou a conta',
    body: 'Os pagamentos pelo site estão pausados. Veja o aviso no app do Mercado Pago e depois reconecte.',
  },
};

function summary30(d: PaymentsData) {
  return d.last30TotalCents
    ? `${money(d.last30TotalCents)} em ${plural(d.last30Orders, 'pedido', 'pedidos')}`
    : 'Sem vendas nos últimos 30 dias.';
}

/** Money Core couldn't settle by itself: grouped by why, each order one tap away. */
function Review({ data }: { data: PaymentsData }) {
  const items = data.review ?? [];
  if (!items.length) return null;
  const groups = [...new Set(items.map((r) => r.reason))].map((reason) => ({
    reason,
    rows: items.filter((r) => r.reason === reason),
  }));
  return (
    <Section
      title="Precisa de você"
      hint={
        items.length === 1
          ? 'Um pagamento precisa de uma conferida.'
          : `${items.length} pagamentos precisam de uma conferida.`
      }
    >
      <Card className="divide-y divide-line overflow-hidden">
        {groups.map(({ reason, rows }) => {
          const c = REVIEW[reason];
          return (
            <div key={reason} className="flex items-start gap-3 p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warning-soft text-warning">
                <WarningCircle weight="bold" className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{c?.title ?? 'Pagamento para conferir'}</p>
                {c ? <p className="t-body mt-0.5 text-muted">{c.body}</p> : null}
                <ul className="mt-3 flex flex-wrap gap-2">
                  {rows.map((r) => (
                    <li key={r.paymentId}>
                      <Link
                        to={`/pedidos/${r.orderId}`}
                        className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-full bg-sunken px-3.5 hover:bg-press"
                      >
                        #{r.orderNumber}
                        <span className="tnum font-medium text-muted">{money(r.amountCents)}</span>
                        <ArrowRight className="size-4 text-muted" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

function Awaiting({ data }: { data: PaymentsData }) {
  const paid = useMarkPaid();
  if (!data.awaitingPix.length)
    return (
      <DuaNote pose="avatar-feliz" title="Nenhum Pix para conferir">
        Quando chegar um pedido pago com Pix, ele aparece aqui até você confirmar.
      </DuaNote>
    );
  return (
    <Section title="Pix para conferir" hint="Confira no app do seu banco e marque como pago.">
      <Card className="divide-y divide-line">
        {data.awaitingPix.map((o) => (
          <div key={o.id} className="flex min-h-18 items-center gap-3 px-4 py-2">
            <Link to={`/pedidos/${o.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                #{o.number} · {o.name}
              </span>
              <span className="t-caption text-muted">
                {o.part ? (o.part === 'deposit' ? 'sinal ' : 'restante ') : null}
                <span className="tnum font-semibold text-ink">{money(o.dueCents)}</span> ·{' '}
                {ago(o.placedAt)}
              </span>
            </Link>
            <Button
              size="sm"
              variant="secondary"
              loading={paid.isPending && paid.variables?.id === o.id}
              onClick={() =>
                paid.mutate({
                  id: o.id,
                  status: 'paid',
                  ...(o.part ? { charge: o.part === 'deposit' ? 'deposit' : 'all' } : {}),
                })
              }
            >
              recebi
            </Button>
          </div>
        ))}
      </Card>
    </Section>
  );
}

function Methods({ data, canEdit }: { data: PaymentsData; canEdit: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (methods: PayMethod[]) => api.updatePayments({ methods }),
    onMutate: (methods) => optimistic<PaymentsData>(qc, qk.payments, (d) => ({ ...d, methods })),
    onSuccess: (d) => qc.setQueryData(qk.payments, d),
    onError: (e, _m, ctx) => {
      ctx?.restore();
      toast.error(payError(e));
    },
  });
  const saveOff = useMutation({
    mutationFn: (methodsOff: PaymentsData['methodsOff']) => api.updatePayments({ methodsOff }),
    onMutate: (methodsOff) =>
      optimistic<PaymentsData>(qc, qk.payments, (d) => ({ ...d, methodsOff })),
    onSuccess: (d) => qc.setQueryData(qk.payments, d),
    onError: (e, _m, ctx) => {
      ctx?.restore();
      toast.error(payError(e));
    },
  });
  const live = mpLive(data.mercadoPago);
  const on = (m: PayMethod) => data.methods.includes(m) && (m !== 'card_online' || live);
  // a split only means something while the store both delivers and hands over at the counter
  const split = data.modes.delivery && data.modes.pickup;
  const takes = (mode: HandoverMode, methods: PayMethod[]) =>
    methods.filter((x) => !data.methodsOff[mode].includes(x));
  // off everywhere would leave a mode with no way to pay: Core refuses it, so the toggle waits
  const lastFor = (m: PayMethod) =>
    (['delivery', 'pickup'] as const).some(
      (mode) =>
        takes(
          mode,
          data.methods.filter((x) => x !== m),
        ).length === 0,
    );
  // turning `m` off for `mode` would leave encomendas (or their sinal) unpayable there: Core
  // refuses it, so the chip stays on and says why (the same rule as encomendaConflict in Core)
  const enc = data.encomendas;
  const lockFor = (m: PayMethod, mode: HandoverMode): string | null => {
    const after = takes(
      mode,
      data.methods.filter((x) => x !== m),
    );
    const lost = (ms: string[]) =>
      ms.some((x) => (data.methods as string[]).includes(x)) &&
      !ms.some((x) => (after as string[]).includes(x));
    if (lost(enc.methods)) return encomendaConflictText(mode, 'encomenda', enc.methods);
    if (enc.sinal && data.methods.includes('pix') && lost(['pix']))
      return encomendaConflictText(mode, 'sinal', ['pix']);
    return null;
  };
  const hint = (m: PayMethod) => {
    if (m === 'pix') {
      if (live) return 'Pelo Mercado Pago: o pedido chega pago, sem conferir no banco.';
      return data.pix ? METHOD.pix.hint : 'Cadastre a chave Pix para receber.';
    }
    if (m === 'card_online' && !live) {
      if (!data.mercadoPago.available) return 'Ainda não disponível na sua loja.';
      return data.mercadoPago.status === 'not_connected'
        ? 'Conecte o Mercado Pago para oferecer.'
        : 'Fora da loja até o Mercado Pago ser conectado de novo.';
    }
    return METHOD[m].hint;
  };
  return (
    <Card className="divide-y divide-line px-4">
      {(Object.keys(METHOD) as PayMethod[]).map((m) => {
        const M = METHOD[m];
        const locked = m === 'card_online' && !live;
        return (
          <div key={m} className="flex items-start gap-3 py-2">
            <M.Icon
              weight="duotone"
              className={cn('mt-3.5 size-7 shrink-0', locked && 'text-faint')}
            />
            <div className="min-w-0 flex-1">
              <Toggle
                checked={on(m)}
                disabled={!canEdit || locked || (on(m) && lastFor(m))}
                onChange={(v) =>
                  save.mutate(v ? [...data.methods, m] : data.methods.filter((x) => x !== m))
                }
                label={M.label}
                description={hint(m)}
              />
              {on(m) && split ? (
                <ModesLine
                  label={M.label}
                  takes={(mode) => !data.methodsOff[mode].includes(m)}
                  last={(mode) => takes(mode, data.methods).length === 1}
                  lock={(mode) => lockFor(m, mode)}
                  canEdit={canEdit}
                  onToggle={(mode) => {
                    const off = data.methodsOff[mode];
                    saveOff.mutate({
                      ...data.methodsOff,
                      [mode]: off.includes(m) ? off.filter((x) => x !== m) : [...off, m],
                    });
                  }}
                />
              ) : null}
              {on(m) ? (
                <AdjustmentLine method={m} label={M.label} data={data} canEdit={canEdit} />
              ) : null}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

const MODE_WORD: Record<HandoverMode, string> = { delivery: 'Na entrega', pickup: 'Na retirada' };

/** Under a method's toggle: whether delivery and pickup each take it. */
function ModesLine({
  label,
  takes,
  last,
  lock,
  canEdit,
  onToggle,
}: {
  label: string;
  takes: (mode: HandoverMode) => boolean;
  /** the mode's only method left: it can't be turned off there */
  last: (mode: HandoverMode) => boolean;
  /** why it can't be turned off there (encomendas), or null */
  lock: (mode: HandoverMode) => string | null;
  canEdit: boolean;
  onToggle: (mode: HandoverMode) => void;
}) {
  return (
    <div role="group" aria-label={`${label}: onde aceita`} className="-mt-1 flex gap-2 pb-2">
      {(['delivery', 'pickup'] as const).map((mode) => {
        const yes = takes(mode);
        const why = yes ? lock(mode) : null;
        return (
          <button
            key={mode}
            type="button"
            role="checkbox"
            aria-checked={yes}
            // locked by the encomendas: still tappable, to say why instead of switching
            aria-disabled={why ? true : undefined}
            aria-label={
              why ? `${MODE_WORD[mode]}: fica ligado por causa das encomendas` : undefined
            }
            disabled={!canEdit || (yes && last(mode))}
            onClick={() => (why ? toast.error(why) : onToggle(mode))}
            className={cn(
              'press t-caption inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 font-semibold ring-1 transition-[color,background-color] duration-(--duration-quick) disabled:cursor-default',
              yes
                ? 'bg-sunken text-ink ring-line-strong'
                : 'bg-surface text-muted ring-line line-through decoration-1',
              canEdit && !(yes && last(mode)) && 'hover:bg-hover',
            )}
          >
            {why ? (
              <Lock weight="bold" className="size-3.5" aria-hidden />
            ) : yes ? (
              <Check weight="bold" className="size-3.5" aria-hidden />
            ) : null}
            {MODE_WORD[mode]}
          </button>
        );
      })}
    </div>
  );
}

const KEY_TYPES = [
  { value: 'phone', label: 'celular' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'e-mail' },
  { value: 'random', label: 'aleatória' },
] as const;

function PixCard({ data, canEdit }: { data: PaymentsData; canEdit: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(!data.pix);
  const [type, setType] = useState<string>(data.pix?.keyType ?? 'phone');
  const [key, setKey] = useState(data.pix?.key ?? '');
  const [name, setName] = useState(data.pix?.beneficiary ?? '');
  const [city, setCity] = useState(data.pix?.city ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.updatePayments({ pix: { keyType: type, key, beneficiary: name, city: city || null } }),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      void qc.invalidateQueries({ queryKey: qk.home });
      setEditing(false);
      setErr(null);
      toast('Chave Pix salva ✓');
    },
    onError: (e) => setErr(messageOf(e)),
  });
  if (!editing && data.pix)
    return (
      <Card className="flex flex-col gap-5 p-5 sm:flex-row">
        <PixQr
          code={data.pix.sample}
          alt="QR code Pix de exemplo (sem valor)"
          className="size-40 shrink-0 self-center"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="t-caption text-muted">
            {KEY_TYPES.find((k) => k.value === data.pix!.keyType)?.label}
          </p>
          <p className="tnum t-body-lg break-all font-semibold">{data.pix.key}</p>
          <p className="t-body text-muted">
            {data.pix.beneficiary}
            {data.pix.city ? ` · ${data.pix.city}` : ''}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Copy />}
              onClick={() =>
                void navigator.clipboard
                  .writeText(data.pix!.sample)
                  .then(() => toast('Pix copia e cola copiado'))
              }
            >
              copiar Pix
            </Button>
            {canEdit ? (
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                trocar chave
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    );
  if (!canEdit)
    return (
      <DuaNote pose="pagamento" title="Nenhuma chave Pix ainda">
        Peça para quem é dono da loja cadastrar.
      </DuaNote>
    );
  return (
    <Card className="space-y-5 p-5">
      <Field label="Tipo de chave">
        <Chips
          label="tipo de chave"
          value={type}
          onChange={setType}
          options={KEY_TYPES.map((k) => ({ ...k }))}
        />
      </Field>
      <Field label="Chave" htmlFor="pix-key" error={err}>
        <TextInput
          id="pix-key"
          value={key}
          maxLength={100}
          inputMode={type === 'email' ? 'email' : type === 'random' ? 'text' : 'numeric'}
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field
        label="Nome de quem recebe"
        htmlFor="pix-name"
        helper="Como aparece no app do banco do cliente (até 25 letras)."
      >
        <TextInput
          id="pix-name"
          value={name}
          maxLength={25}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Cidade" optional htmlFor="pix-city">
        <TextInput
          id="pix-city"
          value={city}
          maxLength={15}
          onChange={(e) => setCity(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        {data.pix ? (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            voltar
          </Button>
        ) : null}
        <Button
          block
          loading={save.isPending}
          disabled={!key.trim() || name.trim().length < 2}
          onClick={() => save.mutate()}
        >
          salvar chave Pix
        </Button>
      </div>
    </Card>
  );
}

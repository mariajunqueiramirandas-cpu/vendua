import {
  ArrowRight,
  Copy,
  CreditCard,
  ForkKnife,
  Money,
  PixLogo,
  WarningCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Payments as PaymentsData, type PayMethod } from '../../lib/api.ts';
import { ago, money } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { RankBars } from '../../ui/charts.tsx';
import { DuaNote, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, Field, TextInput, Toggle } from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { payError, REVIEW } from '../../ui/PaymentChip.tsx';
import { PixQr } from '../../ui/PixCode.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
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

export default function Payments() {
  const { data, error, refetch } = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  const owner = useCan('owner');
  useMpArrival();
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  // the month only tells something once money can arrive through Mercado Pago
  const showMonth = data && (data.mercadoPago.status !== 'not_connected' || data.month.count > 0);
  return (
    <PageBody wide>
      <PageHeader title="Pagamentos" subtitle="Como sua loja recebe." />
      {!data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-8">
            <Review data={data} />
            <Awaiting data={data} />
            <MercadoPagoCard data={data} owner={owner} />
            <Section
              title="Formas de pagamento"
              hint={owner ? undefined : 'Só quem é dono da loja muda isto.'}
            >
              <Methods data={data} canEdit={owner} />
            </Section>
          </div>
          <div className="space-y-8">
            {showMonth ? (
              <Section
                title="Este mês"
                hint={`O que chegou pelo Mercado Pago em ${monthName(data.month.month)}.`}
              >
                <MonthCard data={data} />
              </Section>
            ) : null}
            <Section
              title="Sua chave Pix"
              hint={
                mpLive(data.mercadoPago)
                  ? 'Fica de reserva: se o Mercado Pago sair do ar para a sua loja, o Pix volta para esta chave.'
                  : 'O Pix que aparece na sua loja, com o valor do pedido já preenchido.'
              }
            >
              <PixCard data={data} canEdit={owner} />
            </Section>
            <Section title="Últimos 30 dias">
              <Card className="p-5">
                <RankBars
                  title="Vendas por forma de pagamento"
                  summary={summary30(data)}
                  format={money}
                  rows={Object.entries(
                    data.last30.reduce<Record<string, number>>(
                      (a, r) => ({ ...a, [r.method]: (a[r.method] ?? 0) + r.cents }),
                      {},
                    ),
                  ).map(([m, cents]) => ({
                    key: m,
                    label: METHOD[m as PayMethod]?.label ?? m,
                    value: cents,
                  }))}
                />
              </Card>
            </Section>
          </div>
        </div>
      )}
    </PageBody>
  );
}

function summary30(d: PaymentsData) {
  const total = d.last30.reduce((a, r) => a + r.cents, 0);
  return total
    ? `${money(total)} em ${d.last30.reduce((a, r) => a + r.orders, 0)} pedidos`
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
                <span className="tnum font-semibold text-ink">{money(o.totalCents)}</span> ·{' '}
                {ago(o.placedAt)}
              </span>
            </Link>
            <Button
              size="sm"
              variant="secondary"
              loading={paid.isPending && paid.variables?.id === o.id}
              onClick={() => paid.mutate({ id: o.id, status: 'paid' })}
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
  const live = mpLive(data.mercadoPago);
  const on = (m: PayMethod) => data.methods.includes(m) && (m !== 'card_online' || live);
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
                disabled={!canEdit || locked || (on(m) && data.methods.length === 1)}
                onChange={(v) =>
                  save.mutate(v ? [...data.methods, m] : data.methods.filter((x) => x !== m))
                }
                label={M.label}
                description={hint(m)}
              />
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

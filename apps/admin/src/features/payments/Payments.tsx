import { CheckCircle, Copy, CreditCard, Money, PixLogo, Sparkle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Payments as PaymentsData, type PayMethod } from '../../lib/api.ts';
import { ago, money } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { RankBars } from '../../ui/charts.tsx';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, TextInput, Toggle } from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { toast } from '../../ui/Toast.tsx';
import { useMarkPaid } from '../orders/actions.ts';

const METHOD: Record<PayMethod, { label: string; Icon: typeof PixLogo; hint: string }> = {
  pix: {
    label: 'Pix',
    Icon: PixLogo,
    hint: 'O cliente paga pela chave da loja e você confere no banco.',
  },
  card_on_delivery: {
    label: 'Cartão na entrega',
    Icon: CreditCard,
    hint: 'Na maquininha, na entrega ou retirada.',
  },
  cash: { label: 'Dinheiro', Icon: Money, hint: 'Na entrega ou retirada.' },
};

export default function Payments() {
  const { data, error, refetch } = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  const owner = useCan('owner');
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody wide>
      <PageHeader title="Pagamentos" subtitle="Como sua loja recebe." />
      {!data ? (
        <Loading />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-8">
            <Awaiting data={data} />
            <Section
              title="Formas de pagamento"
              hint={owner ? undefined : 'Só quem é dono da loja muda isto.'}
            >
              <Methods data={data} canEdit={owner} />
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
          <div className="space-y-8">
            <Section
              title="Sua chave Pix"
              hint="O Pix que aparece na sua loja, com o valor do pedido já preenchido."
            >
              <PixCard data={data} canEdit={owner} />
            </Section>
            <Card className="relative overflow-hidden p-5">
              <div
                aria-hidden
                className="absolute -right-10 -top-10 size-40 rounded-full bg-spark opacity-20 blur-2xl"
              />
              <p className="t-caption inline-flex items-center gap-1.5 rounded-full bg-spark-soft px-2.5 py-1 font-semibold">
                <Sparkle weight="fill" className="size-4" /> em breve
              </p>
              <p className="t-title-2 mt-3">Pagamento online pelo Mercado Pago</p>
              <p className="t-body mt-2 text-muted">
                Cartão de crédito e Pix confirmado sozinho, com o dinheiro direto na sua conta
                Mercado Pago. Estamos preparando e avisamos aqui quando você puder conectar.
              </p>
            </Card>
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

function Awaiting({ data }: { data: PaymentsData }) {
  const paid = useMarkPaid();
  if (!data.awaitingPix.length)
    return (
      <Card className="flex items-center gap-4 p-5">
        <CheckCircle weight="duotone" className="size-10 shrink-0 text-success" />
        <div>
          <p className="font-semibold">Nenhum Pix para conferir</p>
          <p className="t-body text-muted">
            Quando chegar um pedido pago com Pix, ele aparece aqui até você confirmar.
          </p>
        </div>
      </Card>
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
      toast.error(messageOf(e));
    },
  });
  const on = (m: PayMethod) => data.methods.includes(m);
  return (
    <Card className="divide-y divide-line px-4">
      {(Object.keys(METHOD) as PayMethod[]).map((m) => {
        const M = METHOD[m];
        return (
          <div key={m} className="flex items-center gap-3 py-2">
            <M.Icon weight="duotone" className="size-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <Toggle
                checked={on(m)}
                disabled={!canEdit || (on(m) && data.methods.length === 1)}
                onChange={(v) =>
                  save.mutate(v ? [...data.methods, m] : data.methods.filter((x) => x !== m))
                }
                label={M.label}
                description={
                  m === 'pix' && !data.pix ? 'Cadastre a chave ao lado para receber.' : M.hint
                }
              />
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
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!data.pix) return setQr(null);
    void QRCode.toDataURL(data.pix.sample, {
      margin: 1,
      width: 360,
      color: { dark: '#123c32', light: '#fffdf8' },
    }).then(setQr);
  }, [data.pix]);
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
        {qr ? (
          <img
            src={qr}
            alt="QR code Pix de exemplo (sem valor)"
            className="size-40 shrink-0 self-center rounded-md"
          />
        ) : null}
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
      <Card className="p-5">
        <p className="t-body text-muted">
          Nenhuma chave cadastrada. Peça para quem é dono da loja cadastrar.
        </p>
      </Card>
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

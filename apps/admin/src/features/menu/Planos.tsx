import {
  ArrowSquareOut,
  Basket,
  CalendarCheck,
  ChatCircleText,
  Pause,
  Play,
  Plus,
  QrCode,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type PlanSubscription,
  type PlanSubscriptionState,
  type ShopperPlan,
  type ShopperPlanIn,
} from '../../lib/api.ts';
import { money, num, phone, plural, WEEKDAYS, WEEKDAYS_LONG } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button, ButtonLink, IconButton } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { CopyValue } from '../../ui/CopyValue.tsx';
import { DuaNote, ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Field, Select, Stepper, TextArea, TextInput, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { MenuTabs } from './MenuTabs.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

// Cardápio › Planos (0127): weekly baskets the shopper gets on the same day every week. Core
// places each week's order by itself, the store's WhatsApp tells the shopper, and the shopper
// pays it like any encomenda. A subscriber is the shopper's: here it's paused, resumed or ended.

const every = (w: number) => `${w === 0 || w === 6 ? 'todo' : 'toda'} ${WEEKDAYS_LONG[w]}`;
const ddmm = (d: string) =>
  `${WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;

const STATE: Record<PlanSubscriptionState, { label: string; tone: string }> = {
  pending: { label: 'esperando o ASSINAR', tone: 'bg-warning-soft text-warning' },
  active: { label: 'ativo', tone: 'bg-success-soft text-success' },
  paused: { label: 'pausado', tone: 'bg-sunken text-muted' },
  cancelled: { label: 'encerrado', tone: 'bg-sunken text-muted' },
};

/** why the last week didn't go out, in the merchant's words */
const ERROR_WORDS: Record<string, string> = {
  missed: 'uma semana passou sem a loja abrir antes da data',
  opted_out: 'o cliente respondeu SAIR: pausado até ele voltar',
  STORE_CLOSED: 'a loja não abre na data',
  INVALID_SCHEDULE: 'a data não estava disponível',
  DATE_FULL: 'a agenda de encomendas lotou na data',
  SOLD_OUT: 'produto esgotado',
  PLAN_UNAVAILABLE: 'nenhum produto do plano disponível',
  OUT_OF_ZONE: 'o endereço saiu da área de entrega',
  DELIVERY_UNAVAILABLE: 'a entrega estava desligada',
  DELIVERY_PAUSED: 'as entregas estavam pausadas',
  PICKUP_UNAVAILABLE: 'a retirada estava desligada',
  ORDER_MIN_NOT_MET: 'ficou abaixo do pedido mínimo',
  PAYMENT_NOT_ALLOWED: 'a forma de pagamento não vale para encomendas',
  PAYMENT_METHOD_UNAVAILABLE: 'a forma de pagamento estava desligada',
  PLAN_OFF: 'o plano estava pausado',
};

type Draft = ShopperPlanIn;

const BLANK: Draft = {
  name: '',
  description: null,
  weekday: null,
  leadDays: 2,
  items: [],
  active: true,
};

const toDraft = (p: ShopperPlan): Draft => ({
  name: p.name,
  description: p.description,
  weekday: p.weekday,
  leadDays: p.leadDays,
  items: p.items,
  active: p.active,
});

export default function Planos() {
  const manager = useCan('manager');
  const s = useSession();
  const { data, error, refetch } = useQuery({ queryKey: qk.plans, queryFn: api.plans });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const plans = data?.plans ?? [];
  const link = `${s.store.url}/planos`;
  return (
    <PageBody wide>
      <PageHeader
        title="Cardápio"
        subtitle="Planos semanais: uma cesta que o cliente recebe toda semana, no mesmo dia. A loja faz o pedido sozinha e avisa o cliente pelo WhatsApp."
        actions={
          manager ? (
            <Button icon={<Plus />} onClick={() => setEdit({ id: null, draft: BLANK })}>
              novo plano
            </Button>
          ) : null
        }
      />
      <MenuTabs />
      <div className="max-w-[880px]">
        {error && !data ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : !data ? (
          <RowsSkeleton rows={3} />
        ) : (
          <div className="space-y-8">
            {data.blocked === 'whatsapp' ? (
              <Notice
                tone="warning"
                title="Conecte o WhatsApp da loja"
                icon={<ChatCircleText />}
                action={
                  <ButtonLink to="/whatsapp" size="sm" variant="secondary">
                    conectar
                  </ButtonLink>
                }
              >
                Os planos só aparecem na loja com o WhatsApp conectado: é por ele que o cliente
                confirma, recebe o Pix de cada semana e pula uma semana.
              </Notice>
            ) : data.blocked === 'pix' ? (
              <Notice
                tone="warning"
                title="Cadastre a chave Pix da loja"
                icon={<QrCode />}
                action={
                  <ButtonLink to="/pagamentos/formas" size="sm" variant="secondary">
                    cadastrar a chave
                  </ButtonLink>
                }
              >
                Cada semana é paga por Pix. Com a chave da loja, o código vai na mensagem do
                WhatsApp; com o Mercado Pago conectado, o Pix se confirma sozinho.
              </Notice>
            ) : (
              <p className="t-caption text-muted">
                Cada semana é paga por Pix: o código vai pelo WhatsApp com o pedido, e um lembrete
                sai na véspera se o dinheiro não chegou. Sem Mercado Pago, abra o pedido e marque
                como pago quando o Pix cair: o cliente recebe a confirmação.
              </p>
            )}
            {plans.length === 0 ? (
              <DuaNote pose="avatar-feliz" title="Crie o primeiro plano">
                Uma cesta de hortifruti, o pão da semana, as marmitas de segunda: escolha os
                produtos e o dia. Na loja, aparece em {link.replace('https://', '')}.
              </DuaNote>
            ) : (
              <div className="space-y-3">
                {plans.map((p) => (
                  <PlanRow
                    key={p.id}
                    plan={p}
                    disabled={!manager}
                    onOpen={() => setEdit({ id: p.id, draft: toDraft(p) })}
                  />
                ))}
                {data.offered ? (
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pt-1">
                    <CopyValue label="Link dos planos" value={link} copied="Link copiado" />
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="t-label inline-flex min-h-11 items-center gap-1.5 px-1 text-muted underline underline-offset-2"
                    >
                      ver na loja <ArrowSquareOut className="size-4" />
                    </a>
                  </div>
                ) : null}
              </div>
            )}
            {data.subscriptions.length ? (
              <Subscribers subs={data.subscriptions} plans={plans} manager={manager} />
            ) : null}
          </div>
        )}
        {manager && data ? (
          <Button
            variant="secondary"
            block
            className="mt-4 md:hidden"
            icon={<Plus />}
            onClick={() => setEdit({ id: null, draft: BLANK })}
          >
            novo plano
          </Button>
        ) : null}
      </div>
      <PlanSheet edit={edit} onClose={() => setEdit(null)} />
    </PageBody>
  );
}

function PlanRow({
  plan,
  disabled,
  onOpen,
}: {
  plan: ShopperPlan;
  disabled: boolean;
  onOpen: () => void;
}) {
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const names = new Map(
    (cat.data?.categories ?? []).flatMap((c) => c.products.map((p) => [p.id, p.name] as const)),
  );
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className="press block w-full rounded-lg bg-surface p-4 text-left ring-1 ring-line hover:bg-hover depth-1 disabled:pointer-events-none"
    >
      <span className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
          <Basket weight="bold" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {plan.name}
            {!plan.active ? <span className="t-caption ml-2 text-muted">(pausado)</span> : null}
          </span>
          <span className="t-caption block text-muted">
            <CalendarCheck className="mr-1 inline size-4 align-[-3px]" />
            {plan.weekday === null ? 'no dia da primeira entrega' : every(plan.weekday)} ·{' '}
            {plural(plan.subscribers, 'assinante', 'assinantes')}
          </span>
        </span>
      </span>
      <span className="t-caption mt-3 block text-muted">
        {plan.items.map((i) => `${i.qty}× ${names.get(i.productId) ?? 'produto'}`).join(' · ')}
      </span>
    </button>
  );
}

function Subscribers({
  subs,
  plans,
  manager,
}: {
  subs: PlanSubscription[];
  plans: ShopperPlan[];
  manager: boolean;
}) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (v: { id: string; action: 'pause' | 'resume' | 'cancel' }) =>
      api.planSubscription(v.id, v.action),
    onSuccess: (r, v) => {
      qc.setQueryData(qk.plans, r);
      toast(
        v.action === 'pause'
          ? 'Plano pausado'
          : v.action === 'resume'
            ? 'Plano retomado'
            : 'Plano encerrado',
      );
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  // ending a shopper's plan takes a second tap
  const [ending, setEnding] = useState<string | null>(null);
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? 'Plano';
  return (
    <Section
      id="assinantes"
      title="Assinantes"
      hint="Quem recebe toda semana. O cliente pula uma semana com PULAR e encerra com CANCELAR PLANO, pelo WhatsApp."
    >
      <Card className="divide-y divide-line overflow-hidden">
        {subs.map((sub) => {
          const st = STATE[sub.state];
          const busy = act.isPending && act.variables?.id === sub.id;
          return (
            <div key={sub.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <p className="font-semibold">{sub.name}</p>
                  <p className="t-caption text-muted">
                    {phone(sub.phone)} · {planName(sub.planId)} · {every(sub.weekday)} ·{' '}
                    {sub.mode === 'delivery' ? 'entrega' : 'retirada'} ·{' '}
                    {METHOD_LABEL[sub.method] ?? sub.method}
                  </p>
                </div>
                <span
                  className={cn(
                    't-caption shrink-0 rounded-full px-2 py-0.5 font-semibold',
                    st.tone,
                  )}
                >
                  {st.label}
                </span>
              </div>
              <p className="t-caption text-muted">
                {sub.state === 'active' && sub.nextOn ? `Próxima: ${ddmm(sub.nextOn)}. ` : ''}
                {sub.weeks ? `${plural(sub.weeks, 'semana feita', 'semanas feitas')}. ` : ''}
                {sub.lastOrder ? (
                  <>
                    <Link
                      to={`/pedidos/${sub.lastOrder.id}`}
                      className="underline underline-offset-2"
                    >
                      pedido #{num(sub.lastOrder.number)}
                    </Link>{' '}
                    ({ddmm(sub.lastOrder.day)}, {money(sub.lastOrder.totalCents)}):{' '}
                    {sub.lastOrder.state === 'cancelled' ? (
                      'pulado'
                    ) : sub.lastOrder.paid ? (
                      <span className="font-semibold text-success">Pix recebido</span>
                    ) : (
                      <span className="font-semibold text-warning">Pix pendente</span>
                    )}
                  </>
                ) : null}
              </p>
              {sub.lastError && sub.state !== 'cancelled' ? (
                <p className="t-caption text-warning">
                  A última semana não saiu:{' '}
                  {ERROR_WORDS[sub.lastError] ?? 'a loja não conseguiu fazer o pedido'}.
                </p>
              ) : null}
              {manager && sub.state !== 'cancelled' ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {sub.state === 'active' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pause />}
                      loading={busy && act.variables?.action === 'pause'}
                      onClick={() => act.mutate({ id: sub.id, action: 'pause' })}
                    >
                      pausar
                    </Button>
                  ) : sub.state === 'paused' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Play />}
                      loading={busy && act.variables?.action === 'resume'}
                      onClick={() => act.mutate({ id: sub.id, action: 'resume' })}
                    >
                      retomar
                    </Button>
                  ) : null}
                  {ending === sub.id ? (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<X />}
                      loading={busy && act.variables?.action === 'cancel'}
                      onClick={() => act.mutate({ id: sub.id, action: 'cancel' })}
                    >
                      confirmar: encerrar plano
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X />}
                      disabled={busy}
                      onClick={() => setEnding(sub.id)}
                    >
                      encerrar
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>
    </Section>
  );
}

function PlanSheet({
  edit,
  onClose,
}: {
  edit: { id: string | null; draft: Draft } | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={!!edit}
      onOpenChange={(v) => (v ? undefined : onClose())}
      title={edit?.id ? 'Editar plano' : 'Novo plano'}
      wide
    >
      {edit ? (
        <PlanForm key={edit.id ?? 'new'} id={edit.id} initial={edit.draft} onDone={onClose} />
      ) : null}
    </Sheet>
  );
}

const DAY_OPTIONS = [
  { value: '', label: 'O dia da primeira entrega do cliente' },
  ...WEEKDAYS_LONG.map((d, i) => ({ value: String(i), label: d[0]!.toUpperCase() + d.slice(1) })),
];

function PlanForm({
  id,
  initial,
  onDone,
}: {
  id: string | null;
  initial: Draft;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const plans = useQuery({ queryKey: qk.plans, queryFn: api.plans });
  const asks = new Set(plans.data?.needsChoices ?? []);
  const products = (cat.data?.categories ?? []).flatMap((c) =>
    c.products.filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, name: p.name })),
  );
  const nameOf = (pid: string) => products.find((p) => p.id === pid)?.name ?? 'Produto';
  const used = new Set(d.items.map((i) => i.productId));
  const free = products.filter((p) => !used.has(p.id) && !asks.has(p.id));
  const setQty = (pid: string, qty: number) =>
    setD((x) => ({
      ...x,
      items: x.items.map((i) => (i.productId === pid ? { ...i, qty } : i)),
    }));

  const save = useMutation({
    mutationFn: (b: ShopperPlanIn) => (id ? api.savePlan(id, b) : api.createPlan(b)),
    onSuccess: (r) => {
      qc.setQueryData(qk.plans, r);
      toast(id ? 'Plano salvo' : 'Plano criado');
      onDone();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlan(id!),
    onSuccess: (r) => {
      qc.setQueryData(qk.plans, r);
      toast('Plano apagado');
      onDone();
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  return (
    <form
      className="space-y-6 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!d.name.trim()) return void toast.error('Dê um nome ao plano.');
        if (!d.items.length) return void toast.error('Escolha pelo menos um produto.');
        save.mutate({ ...d, name: d.name.trim(), description: d.description?.trim() || null });
      }}
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="plan-name">
          <TextInput
            id="plan-name"
            maxLength={60}
            value={d.name}
            placeholder="Ex.: Cesta da semana"
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </Field>
        <Field label="Recado para o cliente" htmlFor="plan-desc" optional>
          <TextArea
            id="plan-desc"
            maxLength={200}
            rows={2}
            value={d.description ?? ''}
            placeholder="Ex.: Frutas e verduras da estação, escolhidas no dia."
            onChange={(e) => setD({ ...d, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dia da entrega" htmlFor="plan-day">
            <Select
              id="plan-day"
              label="dia da entrega"
              value={d.weekday === null ? '' : String(d.weekday)}
              options={DAY_OPTIONS}
              onChange={(v) => setD({ ...d, weekday: v === '' ? null : Number(v) })}
            />
          </Field>
          <Field
            label="Pedido feito antes"
            helper="Quantos dias antes da entrega a loja recebe o pedido da semana."
          >
            <Stepper
              label="dias antes"
              value={d.leadDays}
              min={1}
              max={6}
              suffix={d.leadDays === 1 ? ' dia' : ' dias'}
              onChange={(v) => setD({ ...d, leadDays: v })}
            />
          </Field>
        </div>
        <Toggle
          checked={d.active}
          onChange={(v) => setD({ ...d, active: v })}
          label="Aparece na loja"
          description={
            d.active
              ? 'O cliente encontra este plano em /planos.'
              : 'Pausado: sai da loja e as semanas dos assinantes não saem.'
          }
        />
      </div>

      <div className="space-y-2">
        <h3 className="t-label text-[1rem] font-semibold">O que vai na cesta</h3>
        {d.items.length ? (
          <ul className="divide-y divide-line rounded-md ring-1 ring-line">
            {d.items.map((x) => (
              <li key={x.productId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 basis-40">
                  <span className="block font-semibold">{nameOf(x.productId)}</span>
                  {asks.has(x.productId) ? (
                    <span className="t-caption block text-danger">
                      Pede uma escolha (sabor, tamanho): não dá para entrar num plano. Tire daqui.
                    </span>
                  ) : null}
                </span>
                <Stepper
                  label={`quantidade de ${nameOf(x.productId)}`}
                  value={x.qty}
                  min={1}
                  max={99}
                  onChange={(v) => setQty(x.productId, v)}
                />
                <IconButton
                  label={`tirar ${nameOf(x.productId)}`}
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setD({ ...d, items: d.items.filter((y) => y.productId !== x.productId) })
                  }
                >
                  <Trash />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="t-caption text-muted">Nenhum produto ainda.</p>
        )}
        {free.length && d.items.length < 20 ? (
          <Select
            label="adicionar produto"
            value=""
            options={[
              { value: '', label: '+ adicionar produto' },
              ...free.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(pid) =>
              pid && setD({ ...d, items: [...d.items, { productId: pid, qty: 1 }] })
            }
          />
        ) : null}
        <p className="t-caption text-muted">
          Cada semana sai com os preços do dia, mais a entrega. Mudar a cesta vale para as próximas
          semanas.
        </p>
      </div>

      <div
        className={cn(
          'flex flex-wrap gap-2 border-t border-line pt-4',
          id ? 'justify-between' : 'justify-end',
        )}
      >
        {id ? (
          <Button
            variant="ghost"
            icon={<Trash />}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            apagar plano
          </Button>
        ) : null}
        <Button type="submit" loading={save.isPending}>
          {id ? 'salvar' : 'criar plano'}
        </Button>
      </div>
    </form>
  );
}

import {
  ArrowSquareOut,
  CaretDown,
  ChatCircleDots,
  Check,
  CheckCircle,
  Clock,
  CreditCard,
  Gift,
  IdentificationCard,
  Info,
  PaintBrush,
  PencilSimpleLine,
  PixLogo,
  Receipt,
  Sparkle,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import {
  api,
  ApiError,
  type Account as AccountData,
  type AiPack,
  type DesignSpec,
  type Invoice,
  type Plan,
  type PlanFeature,
  type SiteRequest as SiteReq,
} from '../../lib/api.ts';
import { ago, dateShort, money, until } from '../../lib/format.ts';
import { maskDocument, parseDocument } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useMercadoPago } from '../../lib/mercadopago.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Divided, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { DuaNote, ErrorState, messageOf, Skeleton } from '../../ui/feedback.tsx';
import {
  CommitInput,
  DocumentInput,
  Field,
  Segmented,
  TextArea,
  TextInput,
} from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { PixCode, useIssuePix } from '../../ui/PixCode.tsx';
import {
  featuresLost,
  keepsAll,
  nextUp,
  perksAdded,
  perMonth,
  PerkText,
  PlanCardSkeleton,
  PlanPerks,
  publicPlans,
  shortName,
} from '../../ui/PlanCard.tsx';
import { FEATURE_LABEL, PlanCards, PlanCompare, promiseOf } from '../../ui/PlanPicker.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { DOCUMENT_ERR, PAYER_EMAIL_RE } from '../auth/pending.ts';
import { DocumentGate, needsDocument } from './DocumentGate.tsx';
import { Addresses } from './domain/Addresses.tsx';
import { CustomDomain } from './domain/CustomDomain.tsx';
import { Callout, Chip, hostOf, useAccountWrite } from './domain/kit.tsx';

type Sub = NonNullable<AccountData['subscription']>;
type Method = 'card' | 'pix';

const METHOD_LABEL: Record<Method, string> = { card: 'cartão', pix: 'Pix' };
const monthOf = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso))
    .replace(' de ', ' ');

function SubChip({ s }: { s: Sub }) {
  if (s.status === 'trialing' && !s.cancelAtPeriodEnd)
    return (
      <Chip tone="info" icon={Gift}>
        teste grátis{s.trialEndsAt ? ` até ${dateShort(s.trialEndsAt)}` : ''}
      </Chip>
    );
  if ((s.status === 'active' || s.status === 'trialing') && s.cancelAtPeriodEnd)
    return (
      <Chip tone="warning" icon={Clock}>
        termina {s.currentPeriodEnd ? dateShort(s.currentPeriodEnd) : 'em breve'}
      </Chip>
    );
  if (s.status === 'active')
    return (
      <Chip tone="success" icon={CheckCircle}>
        ativo
      </Chip>
    );
  if (s.status === 'pending')
    return (
      <Chip tone="warning" icon={Clock}>
        aguardando pagamento
      </Chip>
    );
  if (s.status === 'past_due')
    return (
      <Chip tone="danger" icon={WarningCircle}>
        pagamento atrasado
      </Chip>
    );
  return (
    <Chip tone="neutral" icon={XCircle}>
      cancelado
    </Chip>
  );
}

/** A free trial (ADR 0025): until when, and what happens then with the method chosen. */
function TrialCallout({
  s,
  plan,
  onPay,
}: {
  s: Sub;
  plan: AccountData['plan'];
  onPay: (() => void) | undefined;
}) {
  const end = s.trialEndsAt ? dateShort(s.trialEndsAt) : 'o fim do teste';
  const price = perMonth(plan);
  const needsAuth = s.method === 'card' && !!s.checkoutUrl;
  return (
    <Callout
      tone="info"
      icon={Gift}
      title={`Teste grátis até ${end}`}
      action={
        needsAuth ? (
          <Button
            size="sm"
            icon={<ArrowSquareOut />}
            onClick={() => window.location.assign(s.checkoutUrl!)}
          >
            autorizar no Mercado Pago
          </Button>
        ) : onPay ? (
          <Button size="sm" variant="secondary" icon={<PixLogo />} onClick={onPay}>
            pagar com Pix
          </Button>
        ) : null
      }
    >
      {`Depois, o ${plan.name}${price ? ` custa ${price}` : ''}. `}
      {s.method === 'pix'
        ? 'A fatura com o Pix aparece aqui 5 dias antes, e a gente avisa no WhatsApp. Prefere cartão? Troque abaixo.'
        : needsAuth
          ? `Autorize o cartão para a cobrança começar em ${end} sem interromper a loja.`
          : `A primeira cobrança no cartão é em ${end}.`}{' '}
      Se não pagar, a loja pausa os pedidos até o pagamento.
    </Callout>
  );
}

function InvoiceChip({ i }: { i: Invoice }) {
  if (i.status === 'paid')
    return (
      <Chip tone="success" icon={CheckCircle}>
        paga
      </Chip>
    );
  if (i.status === 'failed')
    return (
      <Chip tone="danger" icon={WarningCircle}>
        não passou
      </Chip>
    );
  if (i.status === 'void')
    return (
      <Chip tone="neutral" icon={XCircle}>
        cancelada
      </Chip>
    );
  return Date.parse(i.dueAt) < Date.now() ? (
    <Chip tone="danger" icon={WarningCircle}>
      vencida
    </Chip>
  ) : (
    <Chip tone="warning" icon={Clock}>
      em aberto
    </Chip>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────

export default function Account() {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const { data, error, refetch } = useQuery({
    queryKey: qk.account,
    queryFn: api.account,
    enabled: owner,
  });
  useMercadoPago(data?.billing);
  if (!owner)
    return (
      <PageBody>
        <PageHeader title="Conta e plano" />
        <DuaNote pose="seguranca" title="Conta e plano é com quem é dono da loja">
          O plano, as faturas e o endereço da loja ficam com o dono. Som, avisos e tema do painel
          estão no seu perfil.
        </DuaNote>
        <ProfileLink />
      </PageBody>
    );
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody>
      <PageHeader title="Conta e plano" subtitle={data ? session.store.name : undefined} />
      {!data ? <PlanCardSkeleton /> : <AccountView a={data} />}
    </PageBody>
  );
}

type SheetState =
  | { kind: 'change'; preselect?: string }
  | { kind: 'start'; preselect?: string }
  | { kind: 'invoice'; id: string }
  | null;

function AccountView({ a }: { a: AccountData }) {
  const [sheet, setSheet] = useState<SheetState>(null);
  const s = a.subscription;
  const live = !!s && s.status !== 'cancelled';
  const openInvoice = a.invoices.find(
    (i) => (i.status === 'open' || i.status === 'failed') && i.kind === 'period',
  );
  const next = nextUp(a.plans, a.plan);
  const choose = (preselect?: string) =>
    setSheet(
      live
        ? { kind: 'change', ...(preselect ? { preselect } : {}) }
        : { kind: 'start', ...(preselect ? { preselect } : {}) },
    );
  const resume = useAccountWrite(
    () => api.resumeSubscription(),
    () => toast('Assinatura mantida ✓'),
  );

  return (
    <div className="space-y-8">
      {a.billing.available && needsDocument(a) ? (
        <Callout
          tone="warning"
          icon={IdentificationCard}
          title="Falta o CPF ou o CNPJ da cobrança"
          action={
            <Button
              size="sm"
              onClick={() => {
                const field = document.getElementById('payer-doc');
                field?.scrollIntoView({ block: 'center' });
                field?.focus();
              }}
            >
              informar agora
            </Button>
          }
        >
          Sem ele, o Pix do plano não é gerado. Informe em Pagamento do plano.
        </Callout>
      ) : null}
      {!a.billing.available && s?.status === 'pending' ? (
        <Callout tone="warning" icon={Clock} title="Falta o primeiro pagamento">
          A equipe da Venduá confirma o pagamento do plano e a loja abre para pedidos.
        </Callout>
      ) : a.billing.available && s ? (
        s.status === 'past_due' ? (
          <Callout
            tone="danger"
            icon={WarningCircle}
            title="O pagamento do plano não entrou"
            action={
              openInvoice ? (
                <Button size="sm" onClick={() => setSheet({ kind: 'invoice', id: openInvoice.id })}>
                  pagar agora
                </Button>
              ) : null
            }
          >
            {s.method === 'card'
              ? 'O Mercado Pago não conseguiu cobrar o cartão. Pague a fatura com Pix ou autorize o cartão de novo.'
              : 'A fatura do mês está em aberto. Pague com Pix para deixar tudo em dia.'}
          </Callout>
        ) : s.status === 'pending' ? (
          <Callout
            tone="warning"
            icon={Clock}
            title="Falta o primeiro pagamento"
            action={
              s.method === 'card' && s.checkoutUrl ? (
                <Button
                  size="sm"
                  icon={<ArrowSquareOut />}
                  onClick={() => window.location.assign(s.checkoutUrl!)}
                >
                  autorizar no Mercado Pago
                </Button>
              ) : openInvoice ? (
                <Button size="sm" onClick={() => setSheet({ kind: 'invoice', id: openInvoice.id })}>
                  pagar com Pix
                </Button>
              ) : null
            }
          >
            A loja abre para pedidos assim que ele entrar.
          </Callout>
        ) : s.status === 'trialing' && !s.cancelAtPeriodEnd ? (
          <TrialCallout
            s={s}
            plan={a.plan}
            onPay={
              openInvoice ? () => setSheet({ kind: 'invoice', id: openInvoice.id }) : undefined
            }
          />
        ) : s.cancelAtPeriodEnd ? (
          <Callout
            tone="info"
            icon={Info}
            title={`A assinatura termina ${s.currentPeriodEnd ? `em ${dateShort(s.currentPeriodEnd)}` : 'no fim do período'}`}
            action={
              <Button
                size="sm"
                variant="secondary"
                loading={resume.isPending}
                onClick={() => resume.mutate(undefined)}
              >
                manter a assinatura
              </Button>
            }
          >
            Até lá, tudo continua funcionando. Mudou de ideia? Dá para manter.
          </Callout>
        ) : null
      ) : null}

      <Section title="Seu plano" id="plano">
        <PlanHero
          a={a}
          onChange={() => choose()}
          onPay={openInvoice ? () => setSheet({ kind: 'invoice', id: openInvoice.id }) : undefined}
          onInvoice={(id) => setSheet({ kind: 'invoice', id })}
        />
      </Section>

      {next ? (
        <Upsell next={next} a={a} onGo={a.billing.available ? () => choose(next.id) : undefined} />
      ) : null}

      {a.plan.features.vendedor ? (
        <Vendedor a={a} onInvoice={(id) => setSheet({ kind: 'invoice', id })} />
      ) : null}

      {live && a.billing.available ? <MethodSection a={a} s={s} /> : null}

      <Section title="Faturas" id="faturas">
        <Invoices a={a} onOpen={(id) => setSheet({ kind: 'invoice', id })} />
      </Section>

      <Section title="Endereços da loja" id="enderecos">
        <Addresses a={a} />
      </Section>

      {/* a lapsed domain stays in view after the plan loses the feature: it's still the owner's */}
      {a.plan.features.customDomain || a.customDomain ? (
        <Section
          title="Domínio próprio"
          id="dominio"
          hint="Seus clientes entram na loja pelo seu endereço, como www.sualoja.com.br."
        >
          <CustomDomain a={a} />
        </Section>
      ) : null}

      {a.plan.features.customSite ? (
        <Section
          title="Site sob medida"
          id="site"
          hint={
            a.plan.features.copilot
              ? 'Feito só para a sua loja, a partir de uma conversa com o Duá.'
              : 'Um site feito para a sua loja pelo nosso agente de IA.'
          }
        >
          <SiteRequest a={a} />
        </Section>
      ) : null}

      <Section title="Notificações e aparência do painel">
        <ProfileLink />
      </Section>

      {live && a.billing.available && !s.cancelAtPeriodEnd ? <Cancel s={s} /> : null}

      <PlanSheet
        a={a}
        mode={sheet?.kind === 'change' || sheet?.kind === 'start' ? sheet.kind : null}
        preselect={sheet && 'preselect' in sheet ? sheet.preselect : undefined}
        onClose={() => setSheet(null)}
        onInvoice={(id) => setSheet({ kind: 'invoice', id })}
      />
      <InvoiceSheet
        a={a}
        id={sheet?.kind === 'invoice' ? sheet.id : null}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

function ProfileLink() {
  return (
    <Card className="mt-3 p-5 first:mt-0">
      <p className="t-body text-muted">
        Som do pedido novo, avisos no celular e tema claro ou escuro ficam no seu perfil.
      </p>
      <Link
        to="/perfil"
        className="t-label mt-3 inline-flex min-h-11 items-center rounded-md px-3 ring-1 ring-line-strong hover:bg-hover"
      >
        abrir meu perfil
      </Link>
    </Card>
  );
}

// ── plan ────────────────────────────────────────────────────────────────────

function PlanHero({
  a,
  onChange,
  onPay,
  onInvoice,
}: {
  a: AccountData;
  onChange: () => void;
  onPay: (() => void) | undefined;
  onInvoice: (id: string) => void;
}) {
  const s = a.subscription;
  const plan = a.plan;
  const legacy = plan.priceCents === null;
  const keep = useAccountWrite(
    () => api.updateSubscription({ planId: plan.id }),
    () => toast(`Você continua no ${plan.name} ✓`),
  );
  return (
    <Card className="relative overflow-hidden p-5 md:p-6">
      <div
        aria-hidden
        className="absolute -right-12 -top-12 size-44 rounded-full bg-spark opacity-20 blur-2xl"
      />
      <Mascote pose="loja" size={112} className="absolute right-4 top-4 hidden size-28 md:block" />
      <div className="relative md:pr-32">
        <div className="flex flex-wrap items-center gap-2">
          <p className="t-caption text-muted">Plano atual</p>
          {s ? <SubChip s={s} /> : null}
        </div>
        <p className="t-title-1 mt-1 break-words">{plan.name}</p>
        {plan.priceCents !== null ? (
          <p className="mt-1">
            <span className="tnum font-display text-[2rem] font-semibold leading-10">
              {money(plan.priceCents)}
            </span>
            <span className="t-body text-muted">/mês</span>
          </p>
        ) : null}
        <p className="t-caption mt-1 text-muted">Loja criada em {dateShort(plan.since)}.</p>
      </div>

      {legacy ? (
        <p className="t-body relative mt-4 max-w-prose text-muted">
          Sua loja está no plano piloto, sem cobrança pelo painel.
          {a.billing.available
            ? ' Quando quiser, escolha um dos planos: você vê o preço e o que cada um tem antes de assinar.'
            : null}
        </p>
      ) : null}
      <PlanPerks plan={plan} address={hostOf(a.address)} className="relative mt-5" />

      {s && a.billing.available ? (
        <div className="relative mt-5 space-y-2">
          {s.status === 'trialing' && !s.cancelAtPeriodEnd && s.trialEndsAt ? (
            <p className="t-body flex items-center gap-2">
              <Gift className="size-5 shrink-0 text-muted" aria-hidden />
              <span>
                Teste grátis até <strong>{dateShort(s.trialEndsAt)}</strong>. A primeira cobrança é
                nesse dia, no {METHOD_LABEL[s.method]}.
              </span>
            </p>
          ) : null}
          {s.status === 'active' && !s.cancelAtPeriodEnd && s.currentPeriodEnd ? (
            <p className="t-body flex items-center gap-2">
              <Receipt className="size-5 shrink-0 text-muted" aria-hidden />
              <span>
                Próxima cobrança em <strong>{dateShort(s.currentPeriodEnd)}</strong>, no{' '}
                {METHOD_LABEL[s.method]}.
              </span>
            </p>
          ) : null}
          {s.status === 'cancelled' ? (
            <p className="t-body text-muted">
              A assinatura foi encerrada. Para continuar com a Venduá, escolha um plano.
            </p>
          ) : null}
          {s.pendingUpgrade ? (
            <div className="flex flex-col gap-3 rounded-md bg-info-soft p-3 sm:flex-row sm:items-center">
              <p className="t-body min-w-0 flex-1">
                Para mudar para o <strong>{s.pendingUpgrade.planName}</strong> agora, falta pagar{' '}
                <strong className="tnum">{money(s.pendingUpgrade.amountCents)}</strong>, a diferença
                até {dateShort(s.pendingUpgrade.until)}.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={<PixLogo />}
                  onClick={() => onInvoice(s.pendingUpgrade!.invoice.id)}
                >
                  pagar {money(s.pendingUpgrade.amountCents)}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={keep.isPending}
                  onClick={() => keep.mutate(undefined)}
                >
                  manter o {plan.name}
                </Button>
              </div>
            </div>
          ) : null}
          {s.pendingPlan && !s.cancelAtPeriodEnd ? (
            <div className="flex flex-col gap-3 rounded-md bg-info-soft p-3 sm:flex-row sm:items-center">
              <p className="t-body min-w-0 flex-1">
                Muda para o <strong>{s.pendingPlan.name}</strong>
                {s.currentPeriodEnd ? ` em ${dateShort(s.currentPeriodEnd)}` : ' no fim do período'}
                . Até lá, tudo do {plan.name} continua.
              </p>
              <Button
                size="sm"
                variant="secondary"
                loading={keep.isPending}
                onClick={() => keep.mutate(undefined)}
              >
                manter o {plan.name}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!a.billing.available ? (
        <p className="t-caption relative mt-5 flex items-start gap-2 rounded-md bg-sunken p-3 text-muted">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />A troca de plano e a cobrança pelo
          painel ainda não estão disponíveis. Seu plano continua como está.
        </p>
      ) : (
        <div className="relative mt-5 flex flex-wrap gap-2">
          {s?.status === 'pending' && s.method === 'card' && s.checkoutUrl ? (
            <Button
              icon={<ArrowSquareOut />}
              onClick={() => window.location.assign(s.checkoutUrl!)}
            >
              autorizar no Mercado Pago
            </Button>
          ) : (s?.status === 'pending' || s?.status === 'past_due' || s?.status === 'trialing') &&
            onPay ? (
            <Button icon={<PixLogo />} onClick={onPay}>
              pagar a fatura
            </Button>
          ) : null}
          <Button
            variant={!s || s.status === 'cancelled' ? 'primary' : 'secondary'}
            onClick={onChange}
          >
            {!s || s.status === 'cancelled' ? 'escolher um plano' : 'trocar de plano'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Upsell({ next, a, onGo }: { next: Plan; a: AccountData; onGo: (() => void) | undefined }) {
  const adds = perksAdded(next, a.plan, hostOf(a.address));
  return (
    <section
      aria-labelledby="upsell-t"
      className="relative overflow-hidden rounded-xl bg-raised bg-linear-to-b from-spark-soft to-raised to-55% p-5 ring-2 ring-spark depth-3 md:p-7"
    >
      <Mascote
        pose="publicar"
        size={128}
        className="absolute -bottom-2 right-3 hidden size-32 md:block"
      />
      <div className="relative md:pr-36">
        <p className="t-caption flex flex-wrap items-center gap-2 font-semibold text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Sparkle weight="fill" className="size-4" aria-hidden /> o próximo passo da loja
          </span>
          {next.recommended ? (
            <span className="t-caption inline-flex -rotate-2 items-center rounded-full bg-spark px-2.5 py-0.5 font-display font-bold text-on-spark">
              Recomendado
            </span>
          ) : null}
        </p>
        <h2 id="upsell-t" className="t-title-1 mt-2 max-w-[28ch] text-balance">
          {promiseOf(next)}
        </h2>
        <p className="t-body mt-2 text-muted">
          {/* staff toggle features one by one: say "tudo do" only when it's true */}
          {keepsAll(next, a.plan) ? (
            <>
              O <strong className="text-ink">{next.name}</strong> tem tudo do{' '}
              {a.plan.priceCents === null ? 'seu plano' : shortName(a.plan)}, e mais:
            </>
          ) : (
            <>
              O <strong className="text-ink">{next.name}</strong> traz:
            </>
          )}
        </p>
        <ul className={cn('mt-4 grid gap-3', adds.length > 1 && 'md:grid-cols-2')}>
          {adds.map((p) => (
            <li key={p.key} className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-line">
                <p.Icon weight="duotone" className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block break-words font-medium">
                  <PerkText p={p} />
                </span>
                <span className="t-caption block text-muted">{p.sub}</span>
              </span>
            </li>
          ))}
        </ul>
        {featuresLost(next, a.plan).length ? (
          <p className="t-caption mt-3 text-muted">
            Não inclui{' '}
            {featuresLost(next, a.plan)
              .map((f) => FEATURE_LABEL[f])
              .join(', ')}
            , que o seu plano tem.
          </p>
        ) : null}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          {next.priceCents !== null ? (
            <p className="tnum font-display text-[1.75rem] font-semibold leading-9 tracking-tight">
              {money(next.priceCents)}
              <span className="t-body font-sans font-medium text-muted">/mês</span>
            </p>
          ) : null}
          {onGo ? (
            <Button variant="primary" size="lg" className="max-sm:w-full" onClick={onGo}>
              mudar para o {shortName(next)}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ── Duá's conversations ─────────────────────────────────────────────────────

const n = (x: number) => x.toLocaleString('pt-BR');

function Vendedor({ a, onInvoice }: { a: AccountData; onInvoice: (id: string) => void }) {
  const ai = a.ai;
  const s = a.subscription;
  const [needsPaid, setNeedsPaid] = useState(false);
  const qc = useQueryClient();
  const buy = useMutation({
    mutationFn: (pack: AiPack) => api.buyAiPack(pack),
    onSuccess: (r) => {
      qc.setQueryData(qk.account, r);
      onInvoice(r.invoiceId);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AI_PACK_NEEDS_PAID_PLAN') setNeedsPaid(true);
      if (e instanceof ApiError && e.code === 'AI_PACK_CHANGED') {
        void qc.invalidateQueries({ queryKey: qk.account });
        return void toast.error('O pacote mudou. Confira o novo preço antes de comprar.');
      }
      toast.error(messageOf(e));
    },
  });

  // why a pack can't be bought here yet (Core checks it again)
  const why = !a.billing.available
    ? 'A compra de pacotes pelo painel ainda não está disponível.'
    : !s || s.status === 'cancelled'
      ? 'Disponível para quem assina um plano.'
      : needsPaid || s.status === 'trialing' || s.status === 'pending'
        ? 'Disponível depois do primeiro pagamento do plano.'
        : null;
  // a pack asked for and not paid yet: its Pix lives here, not in the plan's callouts
  const openPack = a.invoices.find(
    (i) => i.kind === 'ai_pack' && (i.status === 'open' || i.status === 'failed'),
  );
  const pct = ai.limit > 0 ? Math.min(100, Math.round((ai.used / ai.limit) * 100)) : 100;
  const over = ai.limit > 0 && ai.used >= ai.limit;

  return (
    <Section
      title="Duá"
      id="vendedor"
      hint="O vendedor com IA da sua loja no WhatsApp. Cada cliente conta como uma conversa, uma vez a cada 24 h."
    >
      <Card className="space-y-5 p-5">
        {!ai.included ? (
          <p className="t-body flex gap-2">
            <Info className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
            <span>O Duá do seu plano fica liberado assim que o pagamento do plano entrar.</span>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="flex items-center gap-3">
                <span className="dua-disc grid size-14 shrink-0 place-items-center overflow-hidden bg-spark-soft">
                  <Mascote pose={over ? 'avatar-ajuda' : 'avatar-feliz'} size={56} />
                </span>
                <div>
                  <p className="t-caption text-muted">
                    {ai.period === 'trial' ? 'no teste grátis' : 'neste mês'}
                  </p>
                  <p className="mt-0.5">
                    <span className="tnum font-display text-[2rem] font-semibold leading-10">
                      {n(ai.used)}
                    </span>
                    <span className="t-body text-muted"> de {n(ai.limit)} conversas</span>
                  </p>
                </div>
              </div>
              {ai.resetsAt ? (
                <p className="t-body text-muted">
                  {ai.period === 'trial' ? 'o teste vai até' : 'renova em'} {dateShort(ai.resetsAt)}
                </p>
              ) : null}
            </div>
            <div
              role="meter"
              aria-label="conversas usadas"
              aria-valuemin={0}
              aria-valuemax={Math.max(ai.limit, 1)}
              aria-valuenow={Math.min(ai.used, Math.max(ai.limit, 1))}
              className="h-2.5 overflow-hidden rounded-full bg-sunken"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-(--duration-quick)',
                  over ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-[var(--chart)]',
                )}
                style={{ width: `${Math.max(pct, ai.used > 0 ? 2 : 0)}%` }}
              />
            </div>
            <ul className="t-body space-y-1.5">
              <li className="flex items-center gap-2">
                <ChatCircleDots className="size-5 shrink-0 text-muted" aria-hidden />
                <span>
                  {ai.remaining > 0 ? (
                    <>
                      Restam <strong className="tnum">{n(ai.remaining)}</strong> conversas
                      {ai.packRemaining > 0 ? ', contando os pacotes' : ''}.
                    </>
                  ) : (
                    <>
                      <strong>As conversas acabaram.</strong> O Duá volta{' '}
                      {ai.resetsAt && ai.period === 'month'
                        ? `em ${dateShort(ai.resetsAt)}`
                        : 'com um pacote de conversas'}
                      .
                    </>
                  )}
                </span>
              </li>
              {ai.packRemaining > 0 ? (
                <li className="flex items-center gap-2">
                  <Gift className="size-5 shrink-0 text-muted" aria-hidden />
                  <span>
                    <strong className="tnum">{n(ai.packRemaining)}</strong> de pacotes
                    {ai.packExpiresAt
                      ? `, ${ai.packRemaining === 1 ? 'que vence' : 'as primeiras vencem'} em ${dateShort(ai.packExpiresAt)}`
                      : ''}
                    .
                  </span>
                </li>
              ) : null}
            </ul>
          </>
        )}
        {openPack ? (
          <div className="flex flex-col gap-3 rounded-md bg-warning-soft p-4 sm:flex-row sm:items-center">
            <p className="t-body min-w-0 flex-1">
              <strong>Pacote {openPack.aiPackName ?? 'de conversas'} esperando o Pix</strong> de{' '}
              <strong className="tnum">{money(openPack.amountCents)}</strong>. As conversas entram
              assim que o pagamento cair.
            </p>
            <Button
              className="shrink-0 max-sm:w-full"
              icon={<PixLogo />}
              onClick={() => onInvoice(openPack.id)}
            >
              pagar com Pix
            </Button>
          </div>
        ) : null}
        {(openPack ? [] : a.aiPacks).map((p) => (
          <div
            key={p.id}
            className="flex flex-col gap-3 rounded-md bg-sunken p-4 sm:flex-row sm:items-center"
          >
            <p className="t-body min-w-0 flex-1">
              <strong>Precisa de mais?</strong> {n(p.conversations)} conversas por{' '}
              <strong className="tnum">{money(p.priceCents)}</strong>, pagas uma vez com Pix. Valem
              por 30 dias depois do pagamento.
              {why ? <span className="t-caption mt-1 block text-muted">{why}</span> : null}
            </p>
            <Button
              className="shrink-0 max-sm:w-full"
              icon={<PixLogo />}
              disabled={!!why}
              loading={buy.isPending && buy.variables?.id === p.id}
              onClick={() => buy.mutate(p)}
            >
              comprar {p.name} · {money(p.priceCents)}
            </Button>
          </div>
        ))}
      </Card>
    </Section>
  );
}

// ── change / start a plan ───────────────────────────────────────────────────

function PlanSheet({
  a,
  mode,
  preselect,
  onClose,
  onInvoice,
}: {
  a: AccountData;
  mode: 'change' | 'start' | null;
  preselect: string | undefined;
  onClose: () => void;
  onInvoice: (id: string) => void;
}) {
  const session = useSession();
  const s = a.subscription;
  const current = a.plan;
  const offered = publicPlans(a.plans);
  const [sel, setSel] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>(s?.method ?? 'pix');
  const [email, setEmail] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [doc, setDoc] = useState('');
  const [docErr, setDocErr] = useState<string | null>(null);
  useEffect(() => {
    if (!mode) return;
    setSel(
      preselect ??
        (mode === 'change'
          ? (s?.pendingPlan?.id ?? nextUp(a.plans, current)?.id ?? current.id)
          : ((offered.find((p) => p.recommended) ?? offered[0])?.id ?? null)),
    );
    setMethod(s?.method ?? 'pix');
    setEmail(s?.payerEmail ?? session.user.email ?? '');
    setEmailErr(null);
    setDoc(maskDocument(s?.payerDocument ?? ''));
    setDocErr(null);
    // only when the sheet opens
  }, [mode]);
  const plan = offered.find((p) => p.id === sel);
  const change = useAccountWrite(
    (planId: string) => api.updateSubscription({ planId }),
    (n, planId) => {
      const up = n.subscription?.pendingUpgrade;
      if (up) return onInvoice(up.invoice.id);
      onClose();
      const p = n.plans.find((x) => x.id === planId);
      toast(
        n.subscription?.pendingPlan
          ? `Combinado: muda para o ${n.subscription.pendingPlan.name} no fim do período`
          : `Pronto, agora é ${p?.name ?? 'o plano novo'} ✓`,
      );
    },
  );
  const start = useAccountWrite(
    (v: { planId: string; method: Method; payerEmail: string; payerDocument: string }) =>
      api.startSubscription(v),
    (n) => {
      const url = n.subscription?.checkoutUrl;
      if (n.subscription?.method === 'card' && url) return window.location.assign(url);
      const inv = n.invoices.find((i) => i.status === 'open' && i.kind === 'period');
      if (inv) onInvoice(inv.id);
      else onClose();
    },
  );

  const upgrade = plan && current.priceCents !== null && plan.priceCents! > current.priceCents;
  const losing = plan ? lostOn(current, plan) : null;
  const same = plan?.id === current.id;
  const end = s?.currentPeriodEnd ? dateShort(s.currentPeriodEnd) : null;
  // a paid period: the difference is charged first (Core says how much)
  const midPeriod = (s?.status === 'active' || s?.status === 'past_due') && !!end;

  let explain: ReactNode = null;
  if (mode === 'change' && plan) {
    if (same) {
      const undo = s?.pendingPlan?.name ?? s?.pendingUpgrade?.planName;
      explain = undo
        ? `Você fica no ${current.name} e a mudança para o ${undo} é desfeita.`
        : `Esse já é o seu plano.`;
    } else if (upgrade && midPeriod)
      explain = (
        <>
          Você paga com Pix só a diferença até {end}, e o {plan.name} fica liberado assim que o
          pagamento entrar. Depois, a cobrança passa a ser {perMonth(plan)}.
        </>
      );
    else if (upgrade || current.priceCents === null)
      explain = (
        <>
          Muda <strong>agora</strong>: o que o {plan.name} tem fica liberado na hora. A próxima
          cobrança já vem com o valor dele, {perMonth(plan)}.
        </>
      );
    else
      explain = (
        <>
          Muda <strong>{end ? `em ${end}` : 'no fim do período já pago'}</strong>. Até lá, você
          continua com tudo do {current.name}. Depois, a cobrança passa a ser {perMonth(plan)}.
          {losing ? ` ${losing}` : ''}
        </>
      );
  }

  // a move up: what it opens, under the explanation
  const gains =
    mode === 'change' && plan && !same && (upgrade || current.priceCents === null)
      ? perksAdded(plan, current, hostOf(a.address))
      : [];

  const busy = change.isPending || start.isPending;
  const footer =
    mode === 'change' ? (
      <Button
        size="lg"
        block
        loading={busy}
        disabled={
          !plan || (!plan.available && !same) || (same && !s?.pendingPlan && !s?.pendingUpgrade)
        }
        onClick={() => plan && change.mutate(plan.id)}
      >
        {same
          ? s?.pendingPlan || s?.pendingUpgrade
            ? `manter o ${current.name}`
            : 'esse é o seu plano'
          : `mudar para o ${plan?.name ?? ''}`}
      </Button>
    ) : (
      <Button
        size="lg"
        block
        loading={busy}
        disabled={!plan || (!plan.available && !same)}
        icon={method === 'card' ? <ArrowSquareOut /> : undefined}
        onClick={() => {
          const e = email.trim();
          const payerDocument = parseDocument(doc);
          setEmailErr(PAYER_EMAIL_RE.test(e) ? null : 'Confira o e-mail, como maria@gmail.com.');
          setDocErr(payerDocument ? null : DOCUMENT_ERR);
          if (plan && payerDocument && PAYER_EMAIL_RE.test(e))
            start.mutate({ planId: plan.id, method, payerEmail: e, payerDocument });
        }}
      >
        {method === 'card'
          ? `assinar e abrir o Mercado Pago`
          : `assinar o ${plan?.name ?? 'plano'}`}
      </Button>
    );

  return (
    <Sheet
      open={!!mode}
      onOpenChange={(v) => !v && onClose()}
      title={mode === 'start' ? 'Escolha um plano' : 'Trocar de plano'}
      description={
        mode === 'start' ? 'Mensal, com Pix ou cartão. Dá para trocar depois.' : undefined
      }
      footer={
        <div className="space-y-3">
          {explain ? (
            <div className="t-body rounded-md bg-sunken px-4 py-3" aria-live="polite">
              <p>{explain}</p>
              {gains.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="o que você ganha">
                  {gains.map((p) => (
                    <li
                      key={p.key}
                      className="t-caption inline-flex max-w-full items-start gap-1 rounded-md bg-surface px-2 py-1 font-semibold ring-1 ring-line"
                    >
                      <CheckCircle
                        weight="fill"
                        className="mt-px size-4 shrink-0 text-success"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <PerkText p={p} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {footer}
        </div>
      }
    >
      <div className="space-y-5 pt-1">
        <PlanCards
          plans={offered}
          selected={sel}
          onSelect={setSel}
          address={hostOf(a.address)}
          badge={(p) =>
            p.id === current.id && s?.status !== 'cancelled' ? 'seu plano' : undefined
          }
          className="pt-4"
        />
        <PlanCompare plans={offered} current={s?.status !== 'cancelled' ? current.id : undefined} />
        {mode === 'start' ? (
          <>
            <Field label="Como pagar">
              <Segmented
                label="forma de pagamento"
                value={method}
                onChange={setMethod}
                options={[
                  { value: 'pix', label: 'Pix todo mês' },
                  { value: 'card', label: 'Cartão' },
                ]}
              />
            </Field>
            <p className="t-body -mt-2 text-muted">
              {method === 'card'
                ? 'Abrimos o Mercado Pago para você autorizar a cobrança mensal. O cartão fica só com eles.'
                : 'Todo mês chega a fatura com um Pix. A primeira já aparece aqui para pagar.'}
            </p>
            <Field label="E-mail para os recibos" htmlFor="payer-email" error={emailErr}>
              <TextInput
                id="payer-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={200}
                value={email}
                aria-invalid={emailErr ? true : undefined}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="CPF ou CNPJ"
              htmlFor="payer-doc"
              helper="Vai na cobrança do plano: o seu CPF ou o CNPJ da loja."
              error={docErr}
            >
              <DocumentInput
                id="payer-doc"
                value={doc}
                invalid={!!docErr}
                onChange={(v) => setDoc(v)}
              />
            </Field>
          </>
        ) : null}
        <p className="t-caption text-muted">
          Nenhuma taxa da Venduá por pedido, em nenhum plano. O Mercado Pago cobra a tarifa dele nos
          pagamentos online dos seus clientes.
        </p>
      </div>
    </Sheet>
  );
}

const listPt = (xs: string[]) =>
  new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(xs);

/** What a move down leaves behind, in one sentence (null when nothing). */
function lostOn(from: Plan, to: Plan): string | null {
  const lost = (Object.keys(FEATURE_LABEL) as PlanFeature[]).filter(
    (f) => from.features[f] && !to.features[f],
  );
  const out: string[] = [];
  if (lost.length) {
    const what = listPt(lost.map((f) => FEATURE_LABEL[f]));
    out.push(
      `${what[0]!.toUpperCase()}${what.slice(1)} não ${lost.length > 1 ? 'fazem' : 'faz'} parte do ${to.name}.`,
    );
  }
  if (from.features.vendedor && to.features.vendedor && to.aiConversations < from.aiConversations)
    out.push(`O Duá passa a ter ${n(to.aiConversations)} conversas por mês.`);
  return out.length ? out.join(' ') : null;
}

// ── how the plan is paid ────────────────────────────────────────────────────

function MethodSection({ a, s }: { a: AccountData; s: Sub }) {
  const sw = useAccountWrite(
    (method: Method) => api.updateSubscription({ method }),
    (n, m) =>
      toast(
        m === 'card'
          ? n.subscription?.checkoutUrl
            ? 'Falta autorizar o cartão no Mercado Pago'
            : 'Pronto: as próximas cobranças vão no cartão ✓'
          : 'Pronto: as próximas faturas vêm com Pix ✓',
      ),
  );
  const email = useAccountWrite(
    (payerEmail: string) => api.updateSubscription({ payerEmail }),
    () => toast('E-mail dos recibos salvo ✓'),
  );
  const doc = useAccountWrite(
    (payerDocument: string) => api.updateSubscription({ payerDocument }),
    () => toast('CPF/CNPJ da cobrança salvo ✓'),
  );
  const needsAuth = s.method === 'card' && !!s.checkoutUrl;
  return (
    <Section title="Pagamento do plano" id="pagamento">
      <Card className="space-y-5 p-5">
        <Segmented
          label="forma de pagamento do plano"
          value={s.method}
          onChange={(m) => m !== s.method && sw.mutate(m)}
          options={[
            {
              value: 'pix',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <PixLogo className="size-5" aria-hidden /> Pix
                </span>
              ),
            },
            {
              value: 'card',
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="size-5" aria-hidden /> Cartão
                </span>
              ),
            },
          ]}
        />
        <p className="t-body text-muted" aria-live="polite">
          {sw.isPending
            ? 'Trocando…'
            : s.method === 'card'
              ? 'Cobrado todo mês no cartão, automaticamente, pelo Mercado Pago. O cartão fica só com eles.'
              : 'Todo mês chega a fatura com um Pix. Você paga pelo app do banco, em segundos.'}
        </p>
        {needsAuth ? (
          <Callout
            tone="warning"
            icon={CreditCard}
            title="Falta autorizar o cartão"
            action={
              <Button
                size="sm"
                icon={<ArrowSquareOut />}
                onClick={() => window.location.assign(s.checkoutUrl!)}
              >
                autorizar no Mercado Pago
              </Button>
            }
          >
            A troca para o cartão vale depois que você autorizar a cobrança no Mercado Pago.
          </Callout>
        ) : null}
        <Field
          label="E-mail para os recibos"
          htmlFor="payer"
          helper="As faturas e os recibos do plano chegam aqui."
          state={email.isPending ? 'saving' : email.isSuccess ? 'saved' : 'idle'}
        >
          <CommitInput
            id="payer"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={200}
            value={s.payerEmail ?? ''}
            validate={(v) =>
              PAYER_EMAIL_RE.test(v.trim()) ? null : 'Confira o e-mail, como maria@gmail.com.'
            }
            onCommit={(v) => email.mutate(v)}
          />
        </Field>
        <Field
          label="CPF ou CNPJ"
          htmlFor="payer-doc"
          helper={
            s.payerDocument
              ? 'Vai na cobrança do plano: o seu CPF ou o CNPJ da loja.'
              : 'Falta preencher. Sem o seu CPF ou o CNPJ da loja, o Pix do plano não é gerado.'
          }
          state={doc.isPending ? 'saving' : doc.isSuccess ? 'saved' : 'idle'}
        >
          <CommitInput
            id="payer-doc"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={18}
            placeholder="000.000.000-00"
            className="tnum"
            value={maskDocument(s.payerDocument ?? '')}
            // a store from before signup asked for it may leave it blank; once set, it stays set
            validate={(v) =>
              parseDocument(v) || (!v.trim() && !s.payerDocument) ? null : DOCUMENT_ERR
            }
            onCommit={(v) => {
              const next = parseDocument(v);
              if (next && next !== s.payerDocument) doc.mutate(next);
            }}
          />
        </Field>
        {a.invoices.length === 0 ? null : (
          <p className="t-caption text-muted">Trocar a forma vale a partir da próxima cobrança.</p>
        )}
      </Card>
    </Section>
  );
}

// ── invoices ────────────────────────────────────────────────────────────────

function Invoices({ a, onOpen }: { a: AccountData; onOpen: (id: string) => void }) {
  if (!a.invoices.length)
    return (
      <DuaNote pose="pagamento" title="Nenhuma fatura ainda">
        {a.subscription
          ? 'A primeira aparece aqui assim que a assinatura começar.'
          : 'Quando você assinar um plano, as faturas aparecem aqui.'}
      </DuaNote>
    );
  return (
    <Card>
      <Divided>
        {a.invoices.map((i) => {
          const payable = i.status === 'open' || i.status === 'failed';
          const row = (
            <>
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
                {i.method === 'pix' ? (
                  <PixLogo className="size-5" aria-hidden />
                ) : (
                  <CreditCard className="size-5" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold first-letter:uppercase">
                  {invoiceTitle(i)}
                </span>
                <span className="t-caption block text-muted">
                  {i.kind === 'ai_pack' ? 'conversas do Duá' : i.planName} ·{' '}
                  {i.status === 'paid' && i.paidAt
                    ? `paga em ${dateShort(i.paidAt)}`
                    : payable
                      ? `vence ${dateShort(i.dueAt)}`
                      : `nº ${i.number}`}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="tnum font-semibold">{money(i.amountCents)}</span>
                <InvoiceChip i={i} />
              </span>
            </>
          );
          const cls = 'flex min-h-18 w-full items-center gap-3 px-4 py-3 text-left';
          return payable ? (
            <button
              key={i.id}
              type="button"
              onClick={() => onOpen(i.id)}
              className={cn(cls, 'hover:bg-hover active:bg-press')}
              aria-label={`fatura ${i.kind === 'upgrade' ? `da troca para o ${i.planName}` : i.kind === 'ai_pack' ? `do pacote ${i.aiPackName ?? 'de conversas'}` : `de ${monthOf(i.periodStart)}`}, em aberto: pagar`}
            >
              {row}
            </button>
          ) : (
            <div key={i.id} className={cls}>
              {row}
            </div>
          );
        })}
      </Divided>
    </Card>
  );
}

const invoiceTitle = (i: Invoice) =>
  i.kind === 'upgrade'
    ? `troca para o ${i.planName}`
    : i.kind === 'ai_pack'
      ? `pacote ${i.aiPackName ?? 'de conversas'}`
      : monthOf(i.periodStart);

function InvoiceSheet({
  a,
  id,
  onClose,
}: {
  a: AccountData;
  id: string | null;
  onClose: () => void;
}) {
  const inv = id ? a.invoices.find((i) => i.id === id) : undefined;
  const qc = useQueryClient();
  const issue = useMutation({
    mutationFn: (x: string) => api.invoicePix(x),
    onSuccess: (n) => qc.setQueryData(qk.account, n),
  });
  // no CPF/CNPJ yet: Core holds the Pix until the owner gives one, here
  const gate =
    needsDocument(a) && inv?.method === 'pix' && inv.status !== 'paid' && inv.status !== 'void';
  useIssuePix(
    inv,
    !!inv &&
      inv.method === 'pix' &&
      inv.status !== 'paid' &&
      inv.status !== 'void' &&
      !gate &&
      !issue.isPending,
    issue.mutate,
  );
  return (
    <Sheet
      open={!!inv}
      onOpenChange={(v) => !v && onClose()}
      title={
        !inv
          ? 'Fatura'
          : inv.kind === 'upgrade'
            ? `Troca para o ${inv.planName}`
            : inv.kind === 'ai_pack'
              ? `Pacote ${inv.aiPackName ?? 'de conversas'}`
              : `Fatura de ${monthOf(inv.periodStart)}`
      }
      description={
        !inv
          ? undefined
          : inv.kind === 'upgrade'
            ? `A diferença até ${dateShort(inv.periodEnd)} · nº ${inv.number}`
            : inv.kind === 'ai_pack'
              ? `Conversas do Duá, por 30 dias · nº ${inv.number}`
              : `${inv.planName} · nº ${inv.number}`
      }
    >
      {!inv ? null : gate ? (
        <DocumentGate />
      ) : inv.status === 'paid' ? (
        <div className="animate-fade-up flex flex-col items-center py-6 text-center" role="status">
          <span className="dua-disc grid size-32 place-items-center">
            <Mascote pose="sucesso" size={120} className="w-28" />
          </span>
          <p className="t-title-2 mt-3">Pagamento recebido ✓</p>
          <p className="t-body mt-1 text-muted">
            {inv.paidAt ? `Entrou ${ago(inv.paidAt)}.` : null}{' '}
            {inv.kind !== 'ai_pack'
              ? 'Obrigado!'
              : inv.aiCredited
                ? 'As conversas já estão na conta do Duá.'
                : 'O seu plano não tem mais o Duá, então as conversas não entraram. A equipe da Venduá vai devolver esse pagamento.'}
          </p>
          <Button variant="secondary" className="mt-5" onClick={onClose}>
            fechar
          </Button>
        </div>
      ) : inv.pix ? (
        <div className="space-y-4 pt-1">
          <PixCode
            copyPaste={inv.pix.copyPaste}
            amountCents={inv.amountCents}
            expiresAt={inv.pix.expiresAt}
            onRenew={() => issue.mutate(inv.id)}
            renewing={issue.isPending}
          />
          <p className="t-body flex items-center gap-2 text-muted" role="status">
            <span
              className="animate-pulse-dot size-2.5 shrink-0 rounded-full bg-[var(--chart)]"
              aria-hidden
            />
            Quando o pagamento cair, esta fatura muda sozinha.
          </p>
        </div>
      ) : inv.method === 'card' && !issue.isPending && !issue.error ? (
        <div className="space-y-4 pt-1">
          <p className="t-body text-muted">
            Essa fatura é cobrada no cartão pelo Mercado Pago. Se preferir, pague agora com Pix.
          </p>
          <Button block size="lg" icon={<PixLogo />} onClick={() => issue.mutate(inv.id)}>
            pagar com Pix
          </Button>
        </div>
      ) : issue.error ? (
        <div className="py-6 text-center" role="alert">
          <p className="font-semibold">Não conseguimos gerar o Pix</p>
          <p className="t-body mt-1 text-muted">{messageOf(issue.error)}</p>
          <Button className="mt-4" loading={issue.isPending} onClick={() => issue.mutate(inv.id)}>
            tentar de novo
          </Button>
        </div>
      ) : (
        <div
          className="grid gap-5 pt-1 md:grid-cols-[auto_minmax(0,1fr)]"
          role="status"
          aria-label="gerando o Pix"
        >
          <Skeleton className="order-2 mx-auto size-44 md:order-1 md:size-52" delay={0} />
          <div className="order-1 space-y-3 md:order-2">
            <Skeleton className="h-10 w-32" delay={0} />
            <Skeleton className="h-12 w-full" delay={0} />
            <Skeleton className="h-14 w-full" delay={0} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ── the site sob medida ─────────────────────────────────────────────────────

// The owner's way in is a conversation: Duá writes the brief with them and proposes it as a card,
// and confirming that card is the only approval they give (Core: site.build / site.revise).
const SITE_PROMPT = {
  build: 'Quero montar meu site sob medida.',
  revise: 'Quero pedir o ajuste do meu site.',
};

function useAskDua() {
  const nav = useNavigate();
  const preload = usePreload();
  return {
    go: (prompt: string) => nav('/copiloto', { state: { from: '/conta', prompt } }),
    preload: preload('/copiloto'),
  };
}

function SiteRequest({ a }: { a: AccountData }) {
  const r = a.siteRequest;
  // a plan with the site but not the Copilot (older plans) sends the brief to the team as before
  const viaDua = a.plan.features.copilot;
  if (r?.status === 'in_progress') return <SiteBuilding r={r} />;
  if (r?.status === 'delivered') return <SiteDelivered r={r} viaDua={viaDua} />;
  return <SiteStart r={r} viaDua={viaDua} />;
}

/** Before the build: what happens, and the conversation with Duá that starts it. */
function SiteStart({ r, viaDua }: { r: SiteReq | null; viaDua: boolean }) {
  const dua = useAskDua();
  // a request is open (Core opens one with the plan): Duá's card needs it, so the ideas are optional
  const open = r?.status === 'requested';
  const [writing, setWriting] = useState(false);
  const [brief, setBrief] = useState(r?.brief ?? '');
  useEffect(() => setBrief(r?.brief ?? ''), [r?.brief]);
  const saved = r?.brief?.trim() ?? '';
  const ask = useAccountWrite(
    (b: string) => (open ? api.updateSiteRequest(b) : api.requestSite(b)),
    () => {
      setWriting(false);
      toast(viaDua ? 'Ideias guardadas ✓ O Duá vai ler.' : 'Pedido enviado ✓');
    },
  );
  // no open request (none yet, or the last one was cancelled): the ideas open it, then Duá
  const start = useAccountWrite(
    (b: string) => api.requestSite(b),
    () => dua.go(SITE_PROMPT.build),
  );

  if (!viaDua)
    return (
      <Card className="space-y-4 p-5">
        {r?.status === 'cancelled' ? <Cancelled /> : null}
        {open && saved && !writing ? (
          <SavedIdeas text={saved} title="O que você pediu" onEdit={() => setWriting(true)} />
        ) : (
          <BriefForm
            value={brief}
            onChange={setBrief}
            busy={ask.isPending}
            label={open ? 'salvar pedido' : 'pedir meu site'}
            onSend={(b) => ask.mutate(b)}
            onCancel={open && saved ? () => setWriting(false) : undefined}
          />
        )}
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <div className="space-y-5 p-5">
        {r?.status === 'cancelled' ? <Cancelled /> : null}
        <div className="flex items-center gap-4">
          <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
            <Mascote pose="avatar-ola" size={64} />
          </span>
          <p className="t-title-2 min-w-0">Começa numa conversa com o Duá</p>
        </div>
        <ol className="grid gap-3 md:grid-cols-3 md:gap-4" aria-label="como funciona">
          {[
            ['O Duá monta o briefing com você', 'cores, fotos, o jeito da loja'],
            ['Você aprova o cartão dele', 'é a sua única aprovação'],
            ['O site fica pronto em 1 dia', 'fim de semana também'],
          ].map(([t, sub], i) => (
            <li key={t} className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className="tnum t-label grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-ink"
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block font-semibold leading-6">{t}</span>
                <span className="t-caption block text-muted">{sub}</span>
              </span>
            </li>
          ))}
        </ol>
        {open ? (
          <Button
            size="lg"
            icon={<ChatCircleDots weight="bold" />}
            className="max-sm:w-full"
            onClick={() => dua.go(SITE_PROMPT.build)}
            {...dua.preload}
          >
            Montar meu site com o Duá
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-line px-5 py-4">
          {writing ? (
            <BriefForm
              value={brief}
              onChange={setBrief}
              busy={ask.isPending}
              label="guardar ideias"
              title="Suas ideias para o site"
              autoFocus
              onSend={(b) => ask.mutate(b)}
              onCancel={() => {
                setWriting(false);
                setBrief(r?.brief ?? '');
              }}
            />
          ) : saved ? (
            <SavedIdeas text={saved} title="Suas ideias" onEdit={() => setWriting(true)} />
          ) : (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="press-row -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 text-left"
            >
              <PencilSimpleLine weight="bold" className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Já tem ideias? Escreva aqui</span>
                <span className="t-caption block text-muted">
                  Opcional. O Duá lê antes de conversar com você.
                </span>
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="border-t border-line px-5 py-4">
          <BriefForm
            value={brief}
            onChange={setBrief}
            busy={start.isPending}
            label="Montar meu site com o Duá"
            title="Para começar, conte como você imagina o site"
            onSend={(b) => start.mutate(b)}
          />
        </div>
      )}
    </Card>
  );
}

function Cancelled() {
  return (
    <p className="t-body rounded-md bg-sunken p-3 text-muted">
      O pedido anterior foi cancelado. Quando quiser, é só pedir de novo.
    </p>
  );
}

function SavedIdeas({ text, title, onEdit }: { text: string; title: string; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="t-caption text-muted">{title}</p>
        <p className="t-body mt-1 line-clamp-4 whitespace-pre-line break-words">{text}</p>
      </div>
      <Button variant="ghost" size="sm" className="-mr-2 shrink-0" onClick={onEdit}>
        editar
      </Button>
    </div>
  );
}

function BriefForm({
  value,
  onChange,
  onSend,
  onCancel,
  busy,
  label,
  title = 'Como você imagina o site?',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (b: string) => void;
  onCancel?: (() => void) | undefined;
  busy: boolean;
  label: string;
  title?: string;
  /** opened by a tap: the cursor goes in */
  autoFocus?: boolean;
}) {
  const ok = value.trim().length >= 10;
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSend(value.trim());
      }}
    >
      <Field
        label={title}
        htmlFor="site-brief"
        helper="Cores, fotos, o que não pode faltar, sites de que você gosta."
      >
        <TextArea
          id="site-brief"
          maxLength={2000}
          rows={4}
          autoFocus={autoFocus}
          placeholder="Ex.: cores da logo (vinho e creme), fotos grandes dos bolos, uma parte contando a história da confeitaria…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={!ok} className="max-sm:flex-1">
          {label}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const STAGES = [
  { id: 'fila', label: 'Na fila', now: 'Entrou na fila de produção.' },
  { id: 'construindo', label: 'Construindo', now: 'Sendo feito a partir do seu briefing.' },
  {
    id: 'revisao',
    label: 'Revisão final da equipe',
    now: 'A equipe da Venduá confere tudo antes de publicar.',
  },
  {
    id: 'publicando',
    label: 'Publicando',
    now: 'Falta pouco: o visual novo está entrando na loja.',
  },
] as const;

/** Approved and being built (or the adjustment): where it stands and when it's ready. */
function SiteBuilding({ r }: { r: SiteReq }) {
  const b = r.building;
  const revision = b?.kind === 'revision';
  const late = !!r.dueAt && new Date(r.dueAt).getTime() < Date.now();
  return (
    <Card className="space-y-6 p-5">
      <div className="flex items-start gap-4">
        <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
          <Mascote pose="avatar-pensando" size={64} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="t-caption font-semibold text-muted">
            {revision ? 'Ajuste em produção' : 'Em produção'}
          </p>
          <p className="t-title-2 mt-0.5">
            {!r.dueAt
              ? revision
                ? 'O ajuste está sendo feito'
                : 'O seu site está sendo feito'
              : late
                ? 'Está levando um pouco mais'
                : `Fica pronto até ${until(r.dueAt)}`}
          </p>
          <p className="t-body mt-1 text-muted">
            {late
              ? 'Passou do prazo combinado, e a equipe da Venduá já foi avisada.'
              : revision
                ? 'É o ajuste incluído no seu site, e você já aprovou: não precisa aprovar mais nada.'
                : 'Você já aprovou o briefing, não precisa aprovar mais nada.'}{' '}
            Quando ficar pronto, o visual novo entra sozinho na sua loja.
          </p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8">
        {b ? <Stages stage={b.stage} revision={revision} /> : null}
        {r.spec ? (
          <div className={cn('min-w-0', !b && 'md:col-span-2')}>
            <p className="t-caption font-semibold text-muted">
              {revision ? 'O briefing, já com o ajuste' : 'O briefing que você aprovou'}
            </p>
            <SpecSummary spec={r.spec} className="mt-2" />
          </div>
        ) : r.brief ? (
          <div className={cn('min-w-0 rounded-md bg-sunken p-4', !b && 'md:col-span-2')}>
            <p className="t-caption text-muted">O que você pediu</p>
            <p className="t-body mt-1 whitespace-pre-line break-words">{r.brief}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Stages({
  stage,
  revision,
}: {
  stage: NonNullable<SiteReq['building']>['stage'];
  revision: boolean;
}) {
  const at = Math.max(
    0,
    STAGES.findIndex((s) => s.id === stage),
  );
  return (
    <ol aria-label={revision ? 'andamento do ajuste' : 'andamento do site'}>
      {STAGES.map((s, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li
            key={s.id}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={now ? 'step' : undefined}
          >
            {i < STAGES.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute bottom-0 left-[11px] top-7 w-0.5 rounded-full',
                  done ? 'bg-success' : 'bg-line-strong',
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                done
                  ? 'bg-success text-surface'
                  : now
                    ? 'bg-spark-soft ring-2 ring-inset ring-[var(--chart)]'
                    : 'bg-surface ring-2 ring-inset ring-line-strong',
              )}
            >
              {done ? (
                <Check weight="bold" className="size-3.5" />
              ) : now ? (
                <span className="animate-pulse-dot size-2.5 rounded-full bg-[var(--chart)]" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span
                className={cn('block leading-7', now ? 'font-semibold' : done ? '' : 'text-muted')}
              >
                {s.label}
                {done ? <span className="sr-only"> (feito)</span> : null}
                {now ? <span className="sr-only"> (agora)</span> : null}
              </span>
              {now ? <span className="t-caption block text-muted">{s.now}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Delivered: when, and the one adjustment the plan includes (asked through Duá, too). */
function SiteDelivered({ r, viaDua }: { r: SiteReq; viaDua: boolean }) {
  const dua = useAskDua();
  const used = r.revisionsUsed >= r.revisionsIncluded;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
          <Mascote pose="avatar-feliz" size={64} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="t-caption font-semibold text-success">
            <CheckCircle weight="fill" className="-mt-0.5 mr-1 inline size-4" aria-hidden />
            Site no ar
          </p>
          <p className="t-title-2 mt-0.5">Entregue em {dateShort(r.deliveredAt ?? r.updatedAt)}</p>
          <p className="t-body mt-1 text-muted">O visual novo já está na sua loja.</p>
        </div>
      </div>
      {viaDua ? (
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Chip tone={used ? 'neutral' : 'success'} icon={used ? CheckCircle : PaintBrush}>
              {used ? 'Ajuste já usado' : '1 ajuste incluído'}
            </Chip>
            <p className="t-body mt-2 text-muted">
              {used
                ? 'O ajuste incluído já foi feito neste site.'
                : 'Quer mudar alguma coisa? Conte ao Duá o que ajustar. O ajuste também fica pronto em 1 dia.'}
            </p>
          </div>
          {used ? null : (
            <Button
              icon={<ChatCircleDots weight="bold" />}
              className="shrink-0 max-sm:w-full"
              onClick={() => dua.go(SITE_PROMPT.revise)}
              {...dua.preload}
            >
              Pedir um ajuste ao Duá
            </Button>
          )}
        </div>
      ) : null}
      {r.spec ? (
        <details className="group border-t border-line">
          <summary className="press-row flex min-h-14 cursor-pointer list-none items-center gap-2 px-5 font-semibold [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">Ver o briefing aprovado</span>
            <CaretDown
              weight="bold"
              className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-5 pb-5">
            <SpecSummary spec={r.spec} />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

const MOTION_LABEL = { none: 'Nenhum', subtle: 'Discreto', expressive: 'Marcante' } as const;

/** The DesignSpec as the owner said it: words, colours as colours, lists as lists. */
function SpecSummary({ spec, className }: { spec: DesignSpec; className?: string }) {
  const colors = [spec.brand.palette.primary, ...spec.brand.palette.accents].filter(
    (c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c),
  );
  const list = (xs: string[]) =>
    xs.length === 1 ? (
      xs[0]
    ) : (
      <ul className="list-disc space-y-0.5 pl-5 marker:text-faint">
        {xs.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    );
  const rows: [string, ReactNode][] = [];
  if (spec.brand.personality.length)
    rows.push([
      'Jeito',
      <span className="flex flex-wrap gap-1.5">
        {spec.brand.personality.map((p) => (
          <span
            key={p}
            className="t-caption rounded-full bg-surface px-2.5 py-1 font-semibold ring-1 ring-inset ring-line noite:bg-raised"
          >
            {p}
          </span>
        ))}
      </span>,
    ]);
  if (colors.length || spec.brand.palette.notes)
    rows.push([
      'Cores',
      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {colors.length ? (
          <span className="flex gap-1.5">
            {colors.map((c) => (
              <span
                key={c}
                role="img"
                aria-label={`cor ${c}`}
                title={c}
                className="size-7 rounded-full ring-1 ring-inset ring-line-strong"
                style={{ background: c }}
              />
            ))}
          </span>
        ) : null}
        {spec.brand.palette.notes ? (
          <span className="min-w-0">{spec.brand.palette.notes}</span>
        ) : null}
      </span>,
    ]);
  if (spec.brand.typography) rows.push(['Letras', spec.brand.typography]);
  rows.push(['Movimento', MOTION_LABEL[spec.experience.motion] ?? spec.experience.motion]);
  if (spec.copy.tone) rows.push(['Tom', spec.copy.tone]);
  if (spec.experience.mustHave.length)
    rows.push(['Não pode faltar', list(spec.experience.mustHave)]);
  if (spec.experience.differentials.length)
    rows.push(['Diferenciais', list(spec.experience.differentials)]);
  if (spec.experience.avoid.length) rows.push(['Evitar', list(spec.experience.avoid)]);
  if (spec.brand.references.length)
    rows.push([
      'Referências',
      <ul className="space-y-0.5">
        {spec.brand.references.map((ref) => (
          <li key={ref.url}>
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold underline underline-offset-2"
            >
              {hostOf(ref.url)}
            </a>
            {ref.note ? <span className="text-muted"> · {ref.note}</span> : null}
          </li>
        ))}
      </ul>,
    ]);
  return (
    <div className={cn('rounded-md bg-sunken p-4', className)}>
      {spec.summary ? <p className="t-body-lg break-words font-medium">“{spec.summary}”</p> : null}
      <dl className="mt-3 divide-y divide-line [overflow-wrap:anywhere]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-0.5 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="t-caption pt-0.5 text-muted">{label}</dt>
            <dd className="t-body min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── cancel ──────────────────────────────────────────────────────────────────

function Cancel({ s }: { s: Sub }) {
  const cancel = useAccountWrite(
    () => api.cancelSubscription(),
    () => toast('Cancelamento marcado. Dá para voltar atrás até o fim do período.'),
  );
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="cancelar a assinatura" className="border-t border-line pt-4">
      {open ? (
        <div className="mt-3 max-w-md space-y-3">
          <p className="t-body text-muted">
            {s.status === 'trialing' && s.currentPeriodEnd
              ? `O teste grátis termina em ${dateShort(s.currentPeriodEnd)} e nada é cobrado. Até lá, tudo continua, e dá para voltar atrás.`
              : s.currentPeriodEnd
                ? `A assinatura termina em ${dateShort(s.currentPeriodEnd)}, no fim do período já pago. Até lá, tudo continua, e dá para voltar atrás.`
                : 'A assinatura é cancelada e nada mais é cobrado.'}
          </p>
          <HoldButton onConfirm={() => cancel.mutate(undefined)} disabled={cancel.isPending}>
            segure para cancelar
          </HoldButton>
          <Button variant="ghost" block onClick={() => setOpen(false)}>
            continuar com o plano
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 !text-danger"
          onClick={() => setOpen(true)}
        >
          cancelar assinatura
        </Button>
      )}
    </section>
  );
}

import {
  ArrowSquareOut,
  ArrowsClockwise,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Gift,
  Globe,
  type Icon,
  Info,
  MagicWand,
  PixLogo,
  Receipt,
  Sparkle,
  WarningCircle,
  XCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  type Account as AccountData,
  type DomainStatus,
  type Invoice,
  type Plan,
} from '../../lib/api.ts';
import { ago, dateShort, money } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Divided, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { copyText, CopyValue } from '../../ui/CopyValue.tsx';
import { DuaNote, ErrorState, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { CommitInput, Field, Segmented, TextArea, TextInput } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { PixCode } from '../../ui/PixCode.tsx';
import { perMonth, PlanCardSkeleton, PlanOption, PlanPerks } from '../../ui/PlanCard.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { EMAIL_RE } from '../auth/pending.ts';

type Sub = NonNullable<AccountData['subscription']>;
type Method = 'card' | 'pix';

const METHOD_LABEL: Record<Method, string> = { card: 'cartão', pix: 'Pix' };
/** a host that wraps at its dots, never inside a word */
const Host = ({ h }: { h: string }) => (
  <>
    {h.split('.').map((part, i) => (
      <span key={i}>
        {i ? '.' : ''}
        {part}
        <wbr />
      </span>
    ))}
  </>
);
const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const monthOf = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso))
    .replace(' de ', ' ');

/** Every account write answers with the whole account: put it in place, refresh what shows it. */
function useAccountWrite<V>(
  fn: (v: V) => Promise<AccountData>,
  done?: (a: AccountData, v: V) => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (a, v) => {
      qc.setQueryData(qk.account, a);
      void qc.invalidateQueries({ queryKey: qk.home });
      void qc.invalidateQueries({ queryKey: qk.store });
      done?.(a, v);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
}

// ── chips: color + icon + word (§4.2) ───────────────────────────────────────

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const TONE: Record<Tone, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
  neutral: 'bg-sunken text-muted',
};

function Chip({ tone, icon: I, children }: { tone: Tone; icon: Icon; children: ReactNode }) {
  return (
    <span
      className={cn(
        't-caption inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold',
        TONE[tone],
      )}
    >
      <I weight="bold" className="size-4" aria-hidden />
      {children}
    </span>
  );
}

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

const DOMAIN: Record<DomainStatus, { tone: Tone; icon: Icon; label: string }> = {
  active: { tone: 'success', icon: CheckCircle, label: 'no ar' },
  pending_dns: { tone: 'warning', icon: Clock, label: 'esperando o DNS' },
  dns_ok: { tone: 'info', icon: ArrowsClockwise, label: 'ativando' },
  failed: { tone: 'danger', icon: WarningCircle, label: 'com problema' },
};

function DomainChip({ status }: { status: DomainStatus }) {
  const m = DOMAIN[status];
  return (
    <Chip tone={m.tone} icon={m.icon}>
      {m.label}
    </Chip>
  );
}

/** A banner that needs the merchant: what happened, and the one thing to do. */
function Callout({
  tone,
  icon: I,
  title,
  children,
  action,
}: {
  tone: Exclude<Tone, 'neutral'>;
  icon: Icon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-center', TONE[tone])}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <I weight="fill" className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div className="min-w-0 text-ink">
          <p className="font-semibold">{title}</p>
          {children ? <p className="t-body mt-0.5 text-muted">{children}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0 sm:ml-2">{action}</div> : null}
    </div>
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
    (i) => (i.status === 'open' || i.status === 'failed') && i.kind !== 'upgrade',
  );
  const pro = a.plans.find(
    (p) => p.priceCents !== null && p.features.customDomain && p.features.customSite,
  );
  const hasPro = a.plan.features.customDomain || a.plan.features.customSite;
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

      {live && a.billing.available ? <MethodSection a={a} s={s} /> : null}

      <Section title="Faturas" id="faturas">
        <Invoices a={a} onOpen={(id) => setSheet({ kind: 'invoice', id })} />
      </Section>

      <Section title="Endereços da loja" id="enderecos">
        <Addresses a={a} />
      </Section>

      {a.plan.features.customDomain ? (
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
          title="Site personalizado"
          id="site"
          hint="Um site feito para a sua loja pelo nosso agente de IA."
        >
          <SiteRequest a={a} />
        </Section>
      ) : null}

      {!hasPro && pro ? (
        <Upsell pro={pro} a={a} onGo={a.billing.available ? () => choose(pro.id) : undefined} />
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
      ) : (
        <PlanPerks plan={plan} address={hostOf(a.address)} className="relative mt-5" />
      )}

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

function Upsell({ pro, a, onGo }: { pro: Plan; a: AccountData; onGo: (() => void) | undefined }) {
  return (
    <section
      aria-labelledby="upsell-t"
      className="relative overflow-hidden rounded-lg bg-surface p-5 ring-1 ring-spark depth-1 md:p-6"
    >
      <div
        aria-hidden
        className="absolute -bottom-16 -left-10 size-48 rounded-full bg-spark opacity-15 blur-3xl"
      />
      <div className="relative">
        <p className="t-caption inline-flex items-center gap-1.5 font-semibold text-muted">
          <Sparkle weight="fill" className="size-4" aria-hidden /> o que o {pro.name} adiciona
        </p>
        <h2 id="upsell-t" className="t-title-2 mt-1">
          Seu endereço e um site só seu
        </h2>
        <p className="tnum t-body mt-1 font-semibold">{perMonth(pro)}</p>
        <ul className="mt-4 space-y-3">
          <li className="flex gap-3">
            <Globe weight="duotone" className="mt-0.5 size-6 shrink-0" aria-hidden />
            <span>
              <span className="block font-medium">Domínio próprio</span>
              <span className="t-body block text-muted">
                A loja também em www.sualoja.com.br, além de {hostOf(a.address)}.
              </span>
            </span>
          </li>
          <li className="flex gap-3">
            <MagicWand weight="duotone" className="mt-0.5 size-6 shrink-0" aria-hidden />
            <span>
              <span className="block font-medium">Site personalizado</span>
              <span className="t-body block text-muted">
                Feito para a sua loja pelo nosso agente de IA, no lugar do visual padrão.
              </span>
            </span>
          </li>
        </ul>
        {onGo ? (
          <Button variant="spark" className="mt-5" onClick={onGo}>
            mudar para o {pro.name}
          </Button>
        ) : null}
      </div>
    </section>
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
  const offered = a.plans.filter((p) => p.priceCents !== null);
  const other = offered.find((p) => p.id !== current.id);
  const [sel, setSel] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>(s?.method ?? 'pix');
  const [email, setEmail] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  useEffect(() => {
    if (!mode) return;
    setSel(
      preselect ??
        (mode === 'change'
          ? (s?.pendingPlan?.id ?? other?.id ?? current.id)
          : (offered[0]?.id ?? null)),
    );
    setMethod(s?.method ?? 'pix');
    setEmail(s?.payerEmail ?? session.user.email ?? '');
    setEmailErr(null);
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
    (v: { planId: string; method: Method; payerEmail: string }) => api.startSubscription(v),
    (n) => {
      const url = n.subscription?.checkoutUrl;
      if (n.subscription?.method === 'card' && url) return window.location.assign(url);
      const inv = n.invoices.find((i) => i.status === 'open');
      if (inv) onInvoice(inv.id);
      else onClose();
    },
  );

  const upgrade = plan && current.priceCents !== null && plan.priceCents! > current.priceCents;
  const losing =
    plan &&
    ((current.features.customDomain && !plan.features.customDomain) ||
      (current.features.customSite && !plan.features.customSite));
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
          {losing
            ? ` O domínio próprio e o site personalizado não fazem parte do ${plan.name}.`
            : ''}
        </>
      );
  }

  const busy = change.isPending || start.isPending;
  const footer =
    mode === 'change' ? (
      <Button
        size="lg"
        block
        loading={busy}
        disabled={!plan || (same && !s?.pendingPlan && !s?.pendingUpgrade)}
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
        disabled={!plan}
        icon={method === 'card' ? <ArrowSquareOut /> : undefined}
        onClick={() => {
          const e = email.trim();
          if (!EMAIL_RE.test(e)) return setEmailErr('Confira o e-mail, como maria@gmail.com.');
          setEmailErr(null);
          if (plan) start.mutate({ planId: plan.id, method, payerEmail: e });
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
            <p className="t-body rounded-md bg-sunken px-4 py-3" aria-live="polite">
              {explain}
            </p>
          ) : null}
          {footer}
        </div>
      }
    >
      <div className="space-y-5 pt-1">
        <div role="radiogroup" aria-label="planos" className="space-y-3">
          {offered.map((p) => (
            <PlanOption
              key={p.id}
              plan={p}
              selected={sel === p.id}
              onSelect={() => setSel(p.id)}
              address={hostOf(a.address)}
              badge={p.id === current.id && s?.status !== 'cancelled' ? 'seu plano' : undefined}
            />
          ))}
        </div>
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
              EMAIL_RE.test(v.trim()) ? null : 'Confira o e-mail, como maria@gmail.com.'
            }
            onCommit={(v) => email.mutate(v)}
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
                  {i.kind === 'upgrade' ? `troca para o ${i.planName}` : monthOf(i.periodStart)}
                </span>
                <span className="t-caption block text-muted">
                  {i.planName} ·{' '}
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
              aria-label={`fatura ${i.kind === 'upgrade' ? `da troca para o ${i.planName}` : `de ${monthOf(i.periodStart)}`}, em aberto: pagar`}
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
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!inv || inv.status === 'paid' || inv.status === 'void' || inv.pix) return;
    if (inv.method === 'pix' && asked.current !== inv.id) {
      asked.current = inv.id;
      issue.mutate(inv.id);
    }
  }, [inv, issue]);
  return (
    <Sheet
      open={!!inv}
      onOpenChange={(v) => !v && onClose()}
      title={
        !inv
          ? 'Fatura'
          : inv.kind === 'upgrade'
            ? `Troca para o ${inv.planName}`
            : `Fatura de ${monthOf(inv.periodStart)}`
      }
      description={
        !inv
          ? undefined
          : inv.kind === 'upgrade'
            ? `A diferença até ${dateShort(inv.periodEnd)} · nº ${inv.number}`
            : `${inv.planName} · nº ${inv.number}`
      }
    >
      {!inv ? null : inv.status === 'paid' ? (
        <div className="animate-fade-up flex flex-col items-center py-6 text-center" role="status">
          <span className="dua-disc grid size-32 place-items-center">
            <Mascote pose="sucesso" size={120} className="w-28" />
          </span>
          <p className="t-title-2 mt-3">Pagamento recebido ✓</p>
          <p className="t-body mt-1 text-muted">
            {inv.paidAt ? `Entrou ${ago(inv.paidAt)}.` : null} Obrigado!
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

// ── addresses and the custom domain ─────────────────────────────────────────

function Addresses({ a }: { a: AccountData }) {
  const list = a.domains.length
    ? a.domains
    : [
        {
          host: hostOf(a.address),
          kind: 'store' as const,
          status: 'active' as const,
          primary: true,
        },
      ];
  return (
    <Card>
      <Divided>
        {list.map((d) => {
          const url = `https://${d.host}`;
          return (
            <div key={d.host} className="flex items-start gap-3 p-4">
              <Globe className="mt-0.5 size-6 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  {d.status === 'active' ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 break-words font-semibold underline underline-offset-2"
                    >
                      <Host h={d.host} />
                    </a>
                  ) : (
                    <span className="min-w-0 break-words font-semibold">
                      <Host h={d.host} />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <DomainChip status={d.status} />
                  <span className="t-caption text-muted">
                    {d.kind === 'store' ? 'endereço Venduá' : 'domínio próprio'}
                    {d.primary && a.domains.length > 1 ? ' · principal' : ''}
                  </span>
                </div>
              </div>
              {d.status === 'active' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  icon={<Copy />}
                  aria-label={`copiar ${d.host}`}
                  onClick={() => void copyText(url).then((ok) => ok && toast('Endereço copiado'))}
                >
                  copiar
                </Button>
              ) : null}
            </div>
          );
        })}
      </Divided>
    </Card>
  );
}

const cleanHost = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');

function CustomDomain({ a }: { a: AccountData }) {
  const d = a.customDomain;
  const [host, setHost] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (h: string) => api.addDomain(h),
    onSuccess: (n) => {
      qc.setQueryData(qk.account, n);
      setHost('');
      toast('Domínio adicionado. Agora é criar os registros.');
    },
    onError: (e) =>
      setErr(
        e instanceof ApiError && e.code === 'INVALID_DOMAIN'
          ? 'Esse domínio não pode ser usado. Confira, como www.sualoja.com.br.'
          : messageOf(e),
      ),
  });
  if (!d)
    return (
      <Card className="p-5">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const h = cleanHost(host);
            if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h))
              return setErr('Digite o endereço, como www.sualoja.com.br.');
            setErr(null);
            add.mutate(h);
          }}
          className="space-y-4"
        >
          <p className="t-body text-muted">
            Tem um domínio? Conecte aqui. Se ainda não tem, dá para registrar um no Registro.br ou
            em outro site de domínios.
          </p>
          <Field label="Seu domínio" htmlFor="custom-host" error={err}>
            <TextInput
              id="custom-host"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={253}
              placeholder="www.sualoja.com.br"
              value={host}
              aria-invalid={err ? true : undefined}
              onChange={(e) => setHost(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={add.isPending} icon={<Globe />}>
            conectar domínio
          </Button>
        </form>
      </Card>
    );
  return <DomainSetup d={d} />;
}

const DOMAIN_STEPS = ['Criar os registros', 'DNS conferido', 'No ar'];
const stepIndex = (s: DomainStatus) => (s === 'active' ? 2 : s === 'dns_ok' ? 1 : 0);

function Progress({ steps, at, failed }: { steps: string[]; at: number; failed?: boolean }) {
  return (
    <ol
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((t, i) => {
        const done = i < at || (i === at && i === steps.length - 1);
        const now = i === at && !done;
        return (
          <li key={t} className="min-w-0" aria-current={now ? 'step' : undefined}>
            <span
              className={cn(
                'block h-1.5 rounded-full',
                done
                  ? 'bg-success'
                  : now
                    ? failed
                      ? 'bg-danger'
                      : 'bg-[var(--chart)]'
                    : 'bg-line-strong',
              )}
            />
            <span
              className={cn(
                't-caption mt-1.5 block',
                done || now ? 'font-semibold text-ink' : 'text-muted',
              )}
            >
              {t}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function DomainSetup({ d }: { d: NonNullable<AccountData['customDomain']> }) {
  const check = useAccountWrite(
    () => api.checkDomain(d.id),
    (n) => {
      const s = n.customDomain?.status;
      toast(
        s === 'pending_dns' || s === 'failed'
          ? 'Ainda não achamos os registros. Pode levar algumas horas.'
          : 'DNS conferido ✓',
        { tone: s === 'pending_dns' || s === 'failed' ? 'info' : 'ok' },
      );
    },
  );
  const remove = useAccountWrite(
    () => api.removeDomain(d.id),
    () => toast('Domínio removido'),
  );
  const [removing, setRemoving] = useState(false);
  const needsDns = d.status === 'pending_dns' || d.status === 'failed';
  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Globe className="size-6 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 break-words font-display text-lg font-semibold">
          <Host h={d.host} />
        </p>
        <DomainChip status={d.status} />
      </div>
      <Progress steps={DOMAIN_STEPS} at={stepIndex(d.status)} failed={d.status === 'failed'} />

      {d.status === 'active' ? (
        <p className="t-body">
          Pronto: a loja está no ar em{' '}
          <a
            href={`https://${d.host}`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            {d.host}
          </a>
          .
        </p>
      ) : d.status === 'dns_ok' ? (
        <p className="t-body rounded-md bg-info-soft p-3">
          Os registros estão certos ✓. Agora a equipe Venduá ativa o certificado de segurança, e o
          endereço entra no ar. Não precisa fazer mais nada.
        </p>
      ) : (
        <>
          {d.status === 'failed' ? (
            <Callout tone="danger" icon={WarningCircle} title="Não conseguimos confirmar o DNS">
              {d.lastError ?? 'Confira se os dois registros abaixo estão iguais no seu provedor.'}
            </Callout>
          ) : null}
          <div>
            <p className="font-semibold">Crie estes dois registros</p>
            <p className="t-body mt-0.5 text-muted">
              No painel de onde você comprou o domínio (Registro.br, GoDaddy, Hostinger…), procure
              por DNS ou zona de DNS e adicione:
            </p>
          </div>
          <div className="space-y-3">
            <DnsRecord type="CNAME" name={d.host} value={d.cnameTarget} />
            <DnsRecord type="TXT" name={d.txtName} value={d.txtValue} />
          </div>
          <p className="t-caption text-muted">
            Depois de salvar, pode levar algumas horas até a internet toda enxergar.
          </p>
        </>
      )}

      {needsDns || d.status === 'dns_ok' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant={needsDns ? 'primary' : 'secondary'}
            icon={<ArrowsClockwise />}
            loading={check.isPending}
            onClick={() => check.mutate(undefined)}
          >
            {d.status === 'failed' ? 'tentar de novo' : 'verificar agora'}
          </Button>
          {d.lastCheckedAt ? (
            <span className="t-caption text-muted">conferido {ago(d.lastCheckedAt)}</span>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-line pt-4">
        {removing ? (
          <div className="space-y-2">
            <p className="t-body text-muted">
              A loja sai de {d.host} e continua no endereço Venduá.
            </p>
            <HoldButton onConfirm={() => remove.mutate(undefined)} disabled={remove.isPending}>
              segure para remover o domínio
            </HoldButton>
            <Button variant="ghost" block onClick={() => setRemoving(false)}>
              deixar como está
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="!text-danger"
            onClick={() => setRemoving(true)}
          >
            remover domínio
          </Button>
        )}
      </div>
    </Card>
  );
}

function DnsRecord({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="rounded-md ring-1 ring-line">
      <p className="t-caption flex items-center gap-2 border-b border-line px-3 py-2 font-semibold">
        <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono">{type}</span>
        registro {type}
      </p>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <CopyValue label="Nome" value={name} copied="Nome copiado" />
        <CopyValue
          label={type === 'CNAME' ? 'Aponta para' : 'Valor'}
          value={value}
          copied="Valor copiado"
        />
      </div>
    </div>
  );
}

// ── the custom site ─────────────────────────────────────────────────────────

const SITE_STEPS = ['Pedido recebido', 'Em produção', 'Entregue'];
const siteAt = { requested: 0, in_progress: 1, delivered: 2, cancelled: 0 } as const;

function SiteRequest({ a }: { a: AccountData }) {
  const r = a.siteRequest;
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(r?.brief ?? '');
  useEffect(() => setBrief(r?.brief ?? ''), [r?.brief]);
  const ask = useAccountWrite(
    (b: string) => api.requestSite(b),
    () => toast('Pedido enviado ✓'),
  );
  const edit = useAccountWrite(
    (b: string) => api.updateSiteRequest(b),
    () => {
      setEditing(false);
      toast('Pedido atualizado ✓');
    },
  );
  const form = (onSend: (b: string) => void, busy: boolean, label: string, cancel?: () => void) => (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (brief.trim().length >= 10) onSend(brief.trim());
      }}
    >
      <Field
        label="Como você imagina o site?"
        htmlFor="site-brief"
        helper="Cores, fotos, o que não pode faltar, sites de que você gosta. Quanto mais contar, melhor."
      >
        <TextArea
          id="site-brief"
          maxLength={2000}
          rows={5}
          placeholder="Ex.: cores da logo (vinho e creme), fotos grandes dos bolos, uma parte contando a história da confeitaria…"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={busy}
          disabled={brief.trim().length < 10}
          icon={<MagicWand />}
        >
          {label}
        </Button>
        {cancel ? (
          <Button variant="ghost" onClick={cancel}>
            cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
  // Core opens an empty request with the plan: the brief is still the merchant's to write
  if (r && r.status === 'requested' && !r.brief?.trim())
    return (
      <Card className="space-y-4 p-5">
        <p className="t-body text-muted">
          Conte como você imagina o site da loja, e o nosso agente de IA monta para você.
        </p>
        {form((b) => edit.mutate(b), edit.isPending, 'enviar pedido')}
      </Card>
    );
  if (!r || r.status === 'cancelled')
    return (
      <Card className="space-y-4 p-5">
        {r?.status === 'cancelled' ? (
          <p className="t-body rounded-md bg-sunken p-3 text-muted">
            O pedido anterior foi cancelado. Quando quiser, é só pedir de novo.
          </p>
        ) : (
          <p className="t-body text-muted">
            Conte como você imagina o site da loja, e o nosso agente de IA monta para você.
          </p>
        )}
        {form((b) => ask.mutate(b), ask.isPending, 'pedir meu site')}
      </Card>
    );
  return (
    <Card className="space-y-5 p-5">
      <Progress steps={SITE_STEPS} at={siteAt[r.status]} />
      <p className="t-body">
        {r.status === 'requested'
          ? `Pedido recebido ${ago(r.createdAt)}. O próximo passo é a produção do site.`
          : r.status === 'in_progress'
            ? 'O seu site está sendo feito. Avisamos por aqui quando ficar pronto.'
            : `Entregue ${ago(r.updatedAt)}. O visual novo já está na sua loja.`}
      </p>
      {editing ? (
        form(
          (b) => edit.mutate(b),
          edit.isPending,
          'salvar pedido',
          () => {
            setEditing(false);
            setBrief(r.brief ?? '');
          },
        )
      ) : (
        <div className="rounded-md bg-sunken p-4">
          <p className="t-caption text-muted">O que você pediu</p>
          <p className="t-body mt-1 whitespace-pre-line break-words">{r.brief || '—'}</p>
          {r.status !== 'delivered' ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => setEditing(true)}>
              editar pedido
            </Button>
          ) : null}
        </div>
      )}
    </Card>
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

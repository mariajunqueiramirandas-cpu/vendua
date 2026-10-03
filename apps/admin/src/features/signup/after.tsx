import {
  ArrowRight,
  ArrowSquareOut,
  CreditCard,
  LockSimple,
  PixLogo,
  Storefront,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Account } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Confetti } from '../../ui/Celebration.tsx';
import { ErrorState, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PixCode, useIssuePix } from '../../ui/PixCode.tsx';
import { ChapterList } from '../onboarding/Overview.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import type { Draft } from './progress.ts';

const paid = (a: Account | undefined) => a?.subscription?.status === 'active';

/** Account while a first payment is on its way: polled, since the live stream is the Shell's. */
function useAccount(poll: number | false) {
  return useQuery({
    queryKey: qk.account,
    queryFn: api.account,
    refetchInterval: (q) => (paid(q.state.data) ? false : poll),
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-3">
      {items.map((t, i) => (
        <li key={t} className="flex items-center gap-3">
          <span className="tnum grid size-8 shrink-0 place-items-center rounded-full bg-sunken font-display font-semibold">
            {i + 1}
          </span>
          <span className="t-body-lg">{t}</span>
        </li>
      ))}
    </ol>
  );
}

// ── card: a calm hand-off to Mercado Pago ───────────────────────────────────

const HANDOFF_MS = 2600;

export function CardHandoff({
  d,
  onLeave,
  onPix,
}: {
  d: Draft;
  /** mark the hand-off done before the page goes */
  onLeave: () => void;
  onPix: (invoiceId: string | null) => void;
}) {
  const account = useAccount(false);
  const fromSignup = d.created?.next.kind === 'card' ? d.created.next.url : null;
  const url = account.data?.subscription?.checkoutUrl ?? fromSignup;
  // the first time only: someone who came back without finishing chooses for themselves
  const auto = !d.created?.handedOff && !!fromSignup;
  const [going, setGoing] = useState(false);
  const [fill, setFill] = useState(false);
  const leave = () => {
    if (!url) return;
    setGoing(true);
    onLeave();
    window.location.assign(url);
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    if (!auto) return;
    const f = requestAnimationFrame(() => setFill(true));
    const t = setTimeout(() => leaveRef.current(), HANDOFF_MS);
    return () => {
      cancelAnimationFrame(f);
      clearTimeout(t);
    };
  }, [auto]);
  const toPix = useMutation({
    mutationFn: () => api.updateSubscription({ method: 'pix' }),
    onSuccess: (a) => {
      const open = a.invoices.find((i) => i.status === 'open');
      onPix(open?.id ?? null);
    },
  });
  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-center gap-4">
        <span className="dua-disc grid size-24 shrink-0 place-items-center bg-spark-soft">
          <Mascote pose="pagamento" size={88} className="w-22" />
        </span>
        <div className="min-w-0">
          <h1 className="t-title-1 md:text-[2rem] md:leading-[2.5rem]">
            {auto ? 'Agora é no Mercado Pago' : 'Faltou autorizar o cartão'}
          </h1>
        </div>
      </div>
      <p className="t-body-lg text-muted">
        {auto
          ? 'Vamos abrir o Mercado Pago para você cadastrar o cartão. A cobrança do plano é mensal e automática.'
          : 'O Mercado Pago não confirmou a assinatura ainda. Abra de novo para terminar, ou pague este mês com Pix.'}
      </p>
      <div className="rounded-lg bg-surface p-5 depth-1">
        <Steps
          items={[
            'Cadastre o cartão no Mercado Pago',
            'Você volta para cá sozinho',
            'A loja abre assim que o pagamento entrar',
          ]}
        />
        <p className="t-caption mt-4 flex items-center gap-2 text-muted">
          <LockSimple className="size-4 shrink-0" aria-hidden /> Os dados do cartão ficam só com o
          Mercado Pago. A Venduá não vê nem guarda o número.
        </p>
      </div>
      {auto ? (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-line-strong"
          role="progressbar"
          aria-label="abrindo o Mercado Pago"
        >
          <span
            className="block h-full rounded-full bg-[var(--chart)] ease-linear"
            style={{
              width: fill ? '100%' : '0%',
              transitionProperty: 'width',
              transitionDuration: `${HANDOFF_MS}ms`,
            }}
          />
        </div>
      ) : null}
      <div className="space-y-2">
        <Button
          size="lg"
          block
          loading={going}
          disabled={!url}
          icon={<ArrowSquareOut />}
          onClick={leave}
        >
          {auto ? 'abrir o Mercado Pago agora' : 'abrir o Mercado Pago de novo'}
        </Button>
        {!url && account.isPending ? (
          <p className="t-caption text-center text-muted">Preparando o link…</p>
        ) : null}
        <Button
          variant="ghost"
          block
          icon={<PixLogo />}
          loading={toPix.isPending}
          onClick={() => toPix.mutate()}
        >
          prefiro pagar com Pix
        </Button>
        {toPix.error ? (
          <p className="t-body text-center text-danger" role="alert">
            {messageOf(toPix.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── card: back from Mercado Pago, waiting for its word ──────────────────────

const PATIENCE_MS = 45_000;

export function CardConfirm({ onPaid, onLater }: { onPaid: () => void; onLater: () => void }) {
  const account = useAccount(3000);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), PATIENCE_MS);
    return () => clearTimeout(t);
  }, []);
  const done = paid(account.data);
  useEffect(() => {
    if (done) onPaid();
  }, [done, onPaid]);
  const signedOut = account.error instanceof ApiError && account.error.status === 401;
  if (signedOut)
    return (
      <div className="animate-fade-up space-y-6">
        <h1 className="t-title-1">Entre para ver a sua loja</h1>
        <p className="t-body-lg text-muted">
          Sua loja foi criada. Entre com o WhatsApp que você confirmou para acompanhar o pagamento.
        </p>
        <ButtonLink to="/entrar" size="lg" block>
          entrar
        </ButtonLink>
      </div>
    );
  const checkout = account.data?.subscription?.checkoutUrl;
  return (
    <div className="animate-fade-up space-y-6" aria-live="polite">
      <div className="flex flex-col items-center py-4 text-center">
        <span className="dua-disc grid size-40 place-items-center">
          <Mascote pose="carregando" size={144} className="w-36" />
        </span>
        <h1 className="t-title-1 mt-4 inline-flex items-center gap-2">
          {slow ? 'Ainda não chegou a confirmação' : 'Confirmando com o Mercado Pago'}
        </h1>
        <p className="t-body-lg mt-2 max-w-md text-muted">
          {slow
            ? 'Às vezes o Mercado Pago leva alguns minutos. Pode seguir montando a loja: ela abre para pedidos quando o pagamento entrar.'
            : 'Só um instante. Esta tela muda sozinha quando o pagamento entrar.'}
        </p>
        {!slow ? <Spinner className="mt-4 size-6" label="conferindo" /> : null}
      </div>
      {slow ? (
        <div className="space-y-2">
          <Button size="lg" block onClick={onLater} icon={<ArrowRight />}>
            montar minha loja enquanto isso
          </Button>
          {checkout ? (
            <Button
              variant="ghost"
              block
              icon={<ArrowSquareOut />}
              onClick={() => window.location.assign(checkout)}
            >
              abrir o Mercado Pago de novo
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── pix: the first month, paid in the app ───────────────────────────────────

export function PixPay({
  invoiceId,
  onPaid,
  onLater,
  onCard,
}: {
  invoiceId: string | null;
  onPaid: () => void;
  onLater: () => void;
  onCard: (url: string) => void;
}) {
  const qc = useQueryClient();
  const account = useAccount(4000);
  const a = account.data;
  const inv =
    a?.invoices.find((i) => i.id === invoiceId) ?? a?.invoices.find((i) => i.status === 'open');
  const done = paid(a) || inv?.status === 'paid';
  useEffect(() => {
    if (done) onPaid();
  }, [done, onPaid]);
  const issue = useMutation({
    mutationFn: (id: string) => api.invoicePix(id),
    onSuccess: (n) => qc.setQueryData(qk.account, n),
  });
  // an invoice without its Pix yet (or one whose Pix expired): ask for it, once per code
  useIssuePix(
    inv,
    (inv?.status === 'open' || inv?.status === 'failed') && !issue.isPending,
    issue.mutate,
  );
  const toCard = useMutation({
    mutationFn: () => api.updateSubscription({ method: 'card' }),
    onSuccess: (n) => {
      qc.setQueryData(qk.account, n);
      if (n.subscription?.checkoutUrl) onCard(n.subscription.checkoutUrl);
    },
  });
  const [checking, setChecking] = useState(false);

  if (account.error && !a)
    return <ErrorState error={account.error} retry={() => void account.refetch()} />;
  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="t-title-1 md:text-[2rem] md:leading-[2.5rem]">
          Pague o primeiro mês com Pix
        </h1>
        <p className="t-body-lg mt-2 text-muted">
          Quando o pagamento cair, a loja abre para pedidos. Esta tela avisa sozinha.
        </p>
      </div>
      <div className="rounded-lg bg-surface p-5 depth-1">
        {!a || (inv && !inv.pix && (issue.isPending || !issue.error)) ? (
          <div
            className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]"
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
        ) : !inv ? (
          <div className="text-center">
            <p className="font-semibold">Ainda não achamos a sua fatura</p>
            <p className="t-body mt-1 text-muted">
              Ela aparece em instantes. Se demorar, toque abaixo.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => void account.refetch()}>
              procurar de novo
            </Button>
          </div>
        ) : inv.pix ? (
          <PixCode
            copyPaste={inv.pix.copyPaste}
            amountCents={inv.amountCents}
            expiresAt={inv.pix.expiresAt}
            onRenew={() => issue.mutate(inv.id)}
            renewing={issue.isPending}
          />
        ) : (
          <div className="text-center" role="alert">
            <p className="font-semibold">Não conseguimos gerar o Pix</p>
            <p className="t-body mt-1 text-muted">{messageOf(issue.error)}</p>
            <Button className="mt-4" loading={issue.isPending} onClick={() => issue.mutate(inv.id)}>
              tentar de novo
            </Button>
          </div>
        )}
      </div>
      <p className="t-body flex items-center gap-2 text-muted" role="status">
        <span className="relative flex size-2.5 shrink-0" aria-hidden>
          <span className="animate-pulse-dot absolute inset-0 rounded-full bg-[var(--chart)]" />
          <span className="relative size-2.5 rounded-full bg-[var(--chart)]" />
        </span>
        Esperando o pagamento…
      </p>
      <div className="space-y-2">
        <Button
          variant="secondary"
          size="lg"
          block
          loading={checking}
          onClick={() => {
            setChecking(true);
            void account.refetch().finally(() => setChecking(false));
          }}
        >
          já paguei
        </Button>
        <Button variant="ghost" block icon={<Storefront />} onClick={onLater}>
          montar a loja enquanto isso
        </Button>
        <Button
          variant="ghost"
          block
          icon={<CreditCard />}
          loading={toCard.isPending}
          onClick={() => toCard.mutate()}
        >
          prefiro cartão
        </Button>
        {toCard.error ? (
          <p className="t-body text-center text-danger" role="alert">
            {messageOf(toCard.error)}
          </p>
        ) : null}
        <p className="t-caption pt-2 text-center text-muted">
          O Pix também fica em Conta e plano, para pagar quando quiser.
        </p>
      </div>
    </div>
  );
}

// ── the moment ──────────────────────────────────────────────────────────────

export function Welcome({
  storeName,
  address,
  paid,
  trialEndsAt = null,
  onGo,
}: {
  storeName: string;
  address: string;
  /** false after an access-code signup (the team confirms the payment later) or a trial */
  paid: boolean;
  /** the store opened on a free trial that ends then */
  trialEndsAt?: string | null;
  onGo: () => void;
}) {
  useEffect(() => haptic.commit(), []);
  return (
    <div className="animate-fade-up space-y-6">
      <section className="relative overflow-visible rounded-xl bg-primary p-6 text-on-primary depth-2 md:p-10">
        <Confetti />
        <div className="flex flex-col gap-6 md:flex-row md:items-center">
          <span className="dua-disc grid size-36 shrink-0 place-items-center self-center bg-[#f7f4ea] md:size-44">
            <Mascote pose="sucesso" size={160} className="w-32 md:w-40" />
          </span>
          <div className="min-w-0">
            <h1 className="t-moment text-[2.5rem] leading-[2.75rem]">Loja criada!</h1>
            <p className="t-body-lg mt-2 opacity-85">
              {paid ? 'Pagamento confirmado. ' : ''}A {storeName} já tem endereço:
            </p>
            <p className="tnum mt-2 break-words font-display text-xl font-semibold">
              {address.split('.').map((part, i) => (
                <span key={i}>
                  {i ? '.' : ''}
                  {part}
                  <wbr />
                </span>
              ))}
            </p>
            {trialEndsAt ? (
              <p className="t-body mt-3 opacity-85">
                Ela já pode receber pedidos. Seu teste grátis vai até{' '}
                <strong className="whitespace-nowrap">
                  {new Date(trialEndsAt).toLocaleDateString('pt-BR', {
                    day: 'numeric',
                    month: 'long',
                  })}
                </strong>
                , sem cobrança.
              </p>
            ) : paid ? null : (
              <p className="t-body mt-3 opacity-85">
                Ela abre para pedidos quando a equipe da Venduá confirmar o pagamento do plano.
              </p>
            )}
          </div>
        </div>
      </section>
      <div>
        <p className="t-title-2">Agora, a parte gostosa: montar a loja</p>
        <p className="t-body mt-1 text-muted">
          Quatro partes, uma pergunta de cada vez, e você vê a loja aparecendo. Já começo com o que
          você me contou.
        </p>
      </div>
      <ChapterList />
      <Button variant="spark" size="lg" block onClick={onGo}>
        montar minha loja <ArrowRight />
      </Button>
    </div>
  );
}

import { SignIn, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Session } from '../../lib/api.ts';
import { resetClient } from '../../lib/persist.ts';
import { qk } from '../../lib/query.ts';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import type { Pose } from '../../ui/Mascote.tsx';
import { useKeyboard } from '../../ui/keyboard.ts';
import { Toaster } from '../../ui/Toast.tsx';
import { Guide } from '../onboarding/Guide.tsx';
import { JourneyBar } from '../onboarding/Journey.tsx';
import { CardConfirm, CardHandoff, PixPay, Welcome } from './after.tsx';
import {
  afterCreate,
  clearDraft,
  trialOf,
  EMPTY,
  loadDraft,
  loadToken,
  saveDraft,
  type Draft,
  type StepId,
  type Verified,
} from './progress.ts';
import {
  addressOf,
  CodeStep,
  ExistingStep,
  PayStep,
  PlanStep,
  PlanStepSkeleton,
  StoreStep,
  Summary,
  TipoStep,
  WhatsappStep,
  YouStep,
  type FlowProps,
} from './steps.tsx';

// Self-serve signup (/comecar): the same one-question-per-screen conversation as the
// onboarding, ending in a paid plan. Plan → store → you → WhatsApp → payment → create; then a
// card hand-off to Mercado Pago or a Pix to pay here, and the welcome into /bem-vindo.

const QUESTIONS: StepId[] = ['plano', 'loja', 'tipo', 'voce', 'whatsapp', 'pagamento'];
const AT: Partial<Record<StepId, number>> = {
  plano: 0,
  loja: 1,
  tipo: 2,
  voce: 3,
  whatsapp: 4,
  codigo: 4,
  existente: 4,
  pagamento: 5,
};
const PRE = new Set<StepId>([
  'plano',
  'loja',
  'tipo',
  'voce',
  'whatsapp',
  'codigo',
  'existente',
  'pagamento',
]);

const LINE: Record<StepId, string> = {
  plano: 'Oi! Vou abrir a sua loja com você, rapidinho e sem palavra difícil.',
  loja: 'Agora o mais importante: o nome!',
  tipo: 'Me conta mais da loja.',
  voce: 'Quero saber com quem estou falando.',
  whatsapp: 'É pelo WhatsApp que você entra no painel. Nada de senha.',
  codigo: 'Mandei o código. Pode abrir o WhatsApp, eu espero aqui.',
  existente: 'Olha só, a gente já se conhece.',
  pagamento: 'Última pergunta, prometo.',
  cartao: 'Vou te levar ao Mercado Pago rapidinho.',
  confirmando: 'Só um instante…',
  pix: 'Falta só o Pix. Quando cair, eu aviso.',
  pronto: '',
};
const POSE: Record<StepId, Pose> = {
  plano: 'avatar-ola',
  loja: 'loja',
  tipo: 'avatar-pensando',
  voce: 'avatar-feliz',
  whatsapp: 'seguranca',
  codigo: 'avatar-pensando',
  existente: 'avatar-feliz',
  pagamento: 'pagamento',
  cartao: 'pagamento',
  confirmando: 'carregando',
  pix: 'pagamento',
  pronto: 'sucesso',
};

/** Where a saved draft may pick up: never on a step whose token or code has gone. */
function resume(d: Draft): { d: Draft; notice: string | null } {
  const back = new URLSearchParams(window.location.search).get('assinatura') === 'retorno';
  if (d.created) {
    if (back && d.created.next.kind === 'card')
      return { d: { ...d, step: 'confirmando' }, notice: null };
    return {
      d: PRE.has(d.step) ? { ...d, step: afterCreate(d.created.next) } : d,
      notice: null,
    };
  }
  if (!PRE.has(d.step)) return { d: { ...d, step: 'plano' }, notice: null };
  if (d.step === 'codigo' && (!d.codeExpiresAt || d.codeExpiresAt < Date.now()))
    return { d: { ...d, step: 'whatsapp' }, notice: 'O código venceu. Peça outro.' };
  if ((d.step === 'existente' || d.step === 'pagamento') && !loadToken(d.phone))
    return {
      d: { ...d, step: 'whatsapp' },
      notice: 'Para continuar de onde parou, confirme o WhatsApp de novo.',
    };
  return { d, notice: null };
}

export default function Signup({ signedIn = false }: { signedIn?: boolean }) {
  useKeyboard();
  const qc = useQueryClient();
  const nav = useNavigate();
  const plans = useQuery({
    queryKey: qk.signupPlans,
    queryFn: api.signup.plans,
    staleTime: 5 * 60_000,
  });
  const first = useRef<ReturnType<typeof resume>>();
  first.current ??= resume(
    signedIn ? prefill(loadDraft(), qc.getQueryData<Session>(qk.session)) : loadDraft(),
  );
  const [d, setD] = useState<Draft>(first.current.d);
  const [notice, setNotice] = useState<string | null>(first.current.notice);
  const [praise, setPraise] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [verified, setVerified] = useState<Verified | null>(() =>
    loadToken(first.current!.d.phone),
  );
  // one source of truth that's saved synchronously: a reload (or a redirect) right after an
  // answer must find it on disk
  const cur = useRef(d);
  const patch = useCallback((p: Partial<Draft>) => {
    const n = { ...cur.current, ...p };
    cur.current = n;
    saveDraft(n);
    setD(n);
  }, []);
  const go = useCallback(
    (step: StepId, say: { praise?: string | null; notice?: string | null } = {}) => {
      setNotice(say.notice ?? null);
      setPraise(say.praise ?? null);
      patch({ step });
      window.scrollTo({ top: 0 });
    },
    [patch],
  );

  // the return from Mercado Pago lands with ?assinatura=retorno: drop it once read
  useEffect(() => {
    if (window.location.search.includes('assinatura='))
      window.history.replaceState(null, '', '/admin/comecar');
  }, []);

  // the plan chosen on the site (?plano=) wins; otherwise the one with the trial (said above the
  // cards), then the recommended one: one less tap
  const fromSite = useRef(new URLSearchParams(window.location.search).get('plano'));
  useEffect(() => {
    const list = plans.data?.plans;
    if (!list?.length) return;
    const site = fromSite.current;
    fromSite.current = null;
    // a closed plan (Pangolim before own domains) is never preselected, even from the site
    const open = list.filter((p) => p.available);
    if (site && !cur.current.created && open.some((p) => p.id === site)) {
      patch({ planId: site });
      if (window.location.search.includes('plano='))
        window.history.replaceState(null, '', '/admin/comecar');
    } else if (
      !list.some((p) => p.id === cur.current.planId) ||
      // a closed plan is swapped only before the owner moves on: further along (a signup that
      // created its store and is resuming) Core decides whether the store still holds it
      (cur.current.step === 'plano' && !open.some((p) => p.id === cur.current.planId))
    ) {
      const trial = plans.data?.billing.available
        ? open.find((p) => p.trialDays > 0 && p.priceCents !== null)
        : undefined;
      const pick = trial ?? open.find((p) => p.recommended) ?? open[0];
      if (pick) patch({ planId: pick.id });
    }
  }, [plans.data, patch]);

  const finish = useCallback(() => {
    clearDraft();
    nav('/bem-vindo', { replace: true });
  }, [nav]);
  const toPronto = useCallback(() => go('pronto'), [go]);

  const step = d.step;
  const at = AT[step];
  const answered = at ?? QUESTIONS.length;
  const questions = QUESTIONS.length;
  const done = !PRE.has(step);
  // three plans side by side need the whole width: the summary waits for the next step
  const wide = step === 'plano';

  const props: FlowProps | null = plans.data ? { d, patch, go, notice, plans: plans.data } : null;
  // the free days this signup starts with, once the phone is known to be eligible
  const planTrial = plans.data?.plans.find((p) => p.id === d.planId)?.trialDays ?? 0;
  const trialDays =
    trialOf(d.created?.next) ||
    (verified?.trialEligible && plans.data?.billing.available && !d.byCode)
      ? planTrial
      : 0;

  let body: React.ReactNode;
  if (step === 'pronto')
    body = (
      <Welcome
        storeName={d.created?.store.name ?? d.storeName}
        address={addressOf(
          d.created?.store.slug ?? d.slug,
          plans.data?.storeDomain ?? 'vendua.com.br',
        )}
        paid={d.created?.next.kind === 'pix' || d.created?.next.kind === 'card'}
        trialEndsAt={trialOf(d.created?.next)}
        onGo={finish}
      />
    );
  else if (step === 'cartao')
    body = (
      <CardHandoff
        d={d}
        onLeave={() => patch({ created: { ...cur.current.created!, handedOff: true } })}
        onPix={(invoiceId) => {
          patch({
            created: {
              ...cur.current.created!,
              next: invoiceId ? { kind: 'pix', invoiceId } : { kind: 'pix', invoiceId: '' },
            },
          });
          go('pix');
        }}
      />
    );
  else if (step === 'confirmando') body = <CardConfirm onPaid={toPronto} onLater={finish} />;
  else if (step === 'pix')
    body = (
      <PixPay
        invoiceId={d.created?.next.kind === 'pix' ? d.created.next.invoiceId || null : null}
        onPaid={toPronto}
        onLater={finish}
        onCard={(url) => {
          patch({
            created: { ...cur.current.created!, next: { kind: 'card', url }, handedOff: false },
          });
          go('cartao');
        }}
      />
    );
  else if (!props)
    body = plans.error ? (
      <ErrorState error={plans.error} retry={() => void plans.refetch()} />
    ) : (
      <PlanStepSkeleton />
    );
  else if (step === 'plano')
    body = <PlanStep {...props} trialEligible={verified ? verified.trialEligible : undefined} />;
  else if (step === 'loja') body = <StoreStep {...props} />;
  else if (step === 'tipo') body = <TipoStep {...props} />;
  else if (step === 'voce') body = <YouStep {...props} />;
  else if (step === 'whatsapp') body = <WhatsappStep {...props} onDevCode={setDevCode} />;
  else if (step === 'codigo')
    body = <CodeStep {...props} devCode={devCode} onVerified={setVerified} />;
  else if (!verified)
    // the token went (another tab, cleared storage): the phone must be confirmed again
    body = (
      <WhatsappStep
        {...props}
        notice="Confirme o WhatsApp de novo para continuar."
        onDevCode={setDevCode}
      />
    );
  else if (step === 'existente') body = <ExistingStep {...props} verified={verified} />;
  else
    body = (
      <PayStep
        {...props}
        verified={verified}
        onCreated={async (r) => {
          const created = { store: r.store, next: r.next };
          patch({ created, step: afterCreate(r.next) });
          setNotice(null);
          setPraise(null);
          setVerified(null);
          if (signedIn) {
            // signed in to another store until now: none of its data may carry into this one
            await resetClient(qc);
            window.location.replace('/admin/comecar');
            return;
          }
          void qc.invalidateQueries({ queryKey: qk.session });
          window.scrollTo({ top: 0 });
        }}
      />
    );

  const exit = done ? null : signedIn ? (
    <Link
      to="/"
      className="t-label inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-muted hover:bg-hover"
      aria-label="sair do cadastro e voltar ao painel"
    >
      <X className="size-5" /> <span className="hidden sm:inline">voltar ao painel</span>
    </Link>
  ) : (
    <Link
      to="/entrar"
      className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-muted hover:bg-hover"
    >
      <SignIn className="size-5" /> <span>já tenho loja</span>
    </Link>
  );

  return (
    <div className="min-h-dvh overflow-x-clip">
      {step === 'pronto' ? (
        <JourneyBar phase="loja" progress={0} status="começando" />
      ) : (
        <JourneyBar
          phase="conta"
          progress={done ? 1 : Math.max(answered, 0.35) / questions}
          status={done ? 'loja criada' : `${answered + 1} de ${questions}`}
          exit={exit}
        />
      )}

      <div
        className={cn(
          'mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-[calc(1rem+var(--kb,0px))] pt-8 md:px-8',
          step !== 'pronto' && !wide && 'lg:grid-cols-[minmax(0,1fr)_360px]',
        )}
      >
        <main
          className={cn('mx-auto w-full max-w-xl space-y-8', wide ? 'lg:max-w-none' : 'lg:mx-0')}
        >
          {step !== 'pronto' ? (
            <Guide turn={step} pose={POSE[step]}>
              {praise ? <strong className="mr-1">{praise}</strong> : null}
              {LINE[step]}
            </Guide>
          ) : null}
          {body}
        </main>
        {step !== 'pronto' && !wide ? (
          <aside
            className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
            aria-label="resumo da sua loja"
          >
            <p className="t-label mb-3 text-center text-muted">Sua loja, tomando forma</p>
            <Summary d={d} plans={plans.data} trial={trialDays} />
          </aside>
        ) : null}
      </div>
      <Toaster />
    </div>
  );
}

/** Signed in already (a second store): the person is known, only the store is new. */
function prefill(d: Draft, s: Session | undefined): Draft {
  if (!s || d !== EMPTY) return d;
  return { ...d, ownerName: s.user.name, email: s.user.email ?? '' };
}

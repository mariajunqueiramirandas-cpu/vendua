import { Eye, EyeSlash, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  type Category,
  type Onboarding as OnboardingData,
  type Payments,
  type StoreTokens,
  type StoreView,
} from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { useKeyboard } from '../../ui/keyboard.ts';
import { toWeek } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ImportFlow } from '../import/ImportFlow.tsx';
import { Finale, type Pending } from './Finale.tsx';
import {
  after,
  answered,
  CHAPTERS,
  chapterOf,
  isStep,
  landOn,
  LINE,
  POSE,
  FOLLOWS,
  STEP_FOR_ITEM,
  stepsFor,
  type StepId,
} from './flow.ts';
import { Guide } from './Guide.tsx';
import { JourneyBar } from './Journey.tsx';
import { MiniStore, type Draft } from './MiniStore.tsx';
import { Welcome, type ChapterProgress } from './Overview.tsx';
import { planState, PlanBanner, PlanPix, usePlan } from './PlanPay.tsx';
import { markLeft, readStep, saveStep } from './progress.ts';
import { GENERIC, segmentOf, type SegmentId } from './segments.ts';
import {
  HoursStep,
  HowStep,
  LogoStep,
  NameStep,
  PickupStep,
  ProductsStep,
  SegmentStep,
  TaglineStep,
  WhatsappStep,
  type StepProps,
} from './steps.tsx';
import { ColorsStep, DeliveryStep, MercadoPagoStep, MethodsStep, PixStep } from './steps-more.tsx';

// The store builds itself (§6.8): one question per screen in four parts, a friendly guide, and
// the store assembling in the phone beside it (behind "espiar" on phones). Every answer saves
// on "Continuar"; where the merchant stopped lives in Core, so any device picks up from there.

const draftOf = (s: StoreView, t: StoreTokens | null): Draft => ({
  name: s.profile.name,
  tagline: s.profile.tagline ?? '',
  logoUrl: s.profile.logoUrl,
  week: toWeek(s.hours.windows),
  pickup: s.operations.pickupEnabled,
  delivery: s.operations.deliveryEnabled,
  accent: t?.color.accent ?? null,
  onAccent: t?.color.onAccent ?? null,
});

// this tab already walked in: a reload resumes the question instead of the welcome-back map
const TAB = 'vendua-onboarding-tab';
const inTab = () => {
  try {
    return sessionStorage.getItem(TAB) === '1';
  } catch {
    return false;
  }
};
const markTab = () => {
  try {
    sessionStorage.setItem(TAB, '1');
  } catch {
    /* private mode */
  }
};

export default function Onboarding() {
  const session = useSession();
  const manager = can(session.user.role, 'manager');
  const store = useQuery({ queryKey: qk.store, queryFn: api.store, enabled: manager });
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog, enabled: manager });
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments, enabled: manager });
  const ob = useQuery({ queryKey: qk.onboarding, queryFn: api.onboarding, enabled: manager });
  // the colours only tint the preview: the wizard doesn't wait for them
  const look = useQuery({ queryKey: qk.appearance, queryFn: api.appearance, enabled: manager });
  // the store's settings are the manager's; an attendant would only hit "no permission" on every step
  if (!manager)
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6 pt-12">
        <Guide turn="sem-acesso" pose="seguranca">
          Montar a loja é com o dono ou um gerente. Peça a eles!
        </Guide>
        <ButtonLink to="/" size="lg" block>
          Ir para o painel
        </ButtonLink>
      </div>
    );
  if (!store.data || !cat.data || !ob.data || !pay.data) {
    const error = store.error ?? cat.error ?? ob.error ?? pay.error;
    return (
      <div className="mx-auto max-w-lg p-6">
        {error ? (
          <ErrorState
            error={error}
            retry={() => {
              for (const q of [store, cat, ob, pay]) void q.refetch();
            }}
          />
        ) : (
          <Loading />
        )}
      </div>
    );
  }
  return (
    <Flow
      s={store.data}
      categories={cat.data.categories}
      pay={pay.data}
      ob={ob.data}
      tokens={look.data?.tokens?.tokens ?? null}
    />
  );
}

function Flow({
  s,
  categories,
  pay,
  ob,
  tokens: savedTokens,
}: {
  s: StoreView;
  categories: Category[];
  pay: Payments;
  ob: OnboardingData;
  tokens: StoreTokens | null;
}) {
  useKeyboard();
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const storeId = session.store.id;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const products = useMemo(
    () => categories.flatMap((c) => c.products).map((p) => ({ ...p, imageUrl: p.imageUrl })),
    [categories],
  );

  // what decides the questions is read once, as the wizard opens: a question answered on the way
  // stays in the list, so the count doesn't jump under the merchant's thumb
  const [known] = useState(() => ({
    askSegment: !ob.segment,
    askName: ob.from !== 'signup',
    importable: products.length === 0,
    owner,
    mp: owner && pay.mercadoPago.available && pay.mercadoPago.status !== 'connected',
  }));
  const [tokens, setTokens] = useState(savedTokens);
  useEffect(() => setTokens((t) => t ?? savedTokens), [savedTokens]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(s, savedTokens));
  const patch = useCallback((d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d })), []);
  // colours and an imported logo arrive after the first paint
  useEffect(() => {
    if (savedTokens)
      setDraft((x) =>
        x.accent
          ? x
          : { ...x, accent: savedTokens.color.accent, onAccent: savedTokens.color.onAccent },
      );
  }, [savedTokens]);
  const liveLogo = s.profile.logoUrl;
  useEffect(() => {
    if (liveLogo) setDraft((x) => (x.logoUrl ? x : { ...x, logoUrl: liveLogo }));
  }, [liveLogo]);

  const steps = useMemo(
    () => stepsFor({ ...known, pickup: draft.pickup, delivery: draft.delivery }),
    [known, draft.pickup, draft.delivery],
  );
  const questions: StepId[] = steps.filter((x) => x !== 'oi' && x !== 'pronto');
  const segment = segmentOf(ob.segment) ?? GENERIC;

  // where to open: a deep link (?passo=), Mercado Pago's return, the saved place, or the start
  const first = useRef<{ step: StepId; solo: boolean; resume: StepId | null } | null>(null);
  if (!first.current) {
    const passo = params.get('passo');
    // a saved question that dropped out of this store's list (answered elsewhere, Mercado Pago
    // connected) resumes at the one after it
    const raw = [ob.step, readStep(storeId)].find(
      (x): x is StepId => isStep(x) && x !== 'oi' && x !== 'pronto',
    );
    const landed = raw ? landOn(steps, raw) : null;
    const saved = landed && landed !== 'pronto' ? landed : undefined;
    const mp = params.get('mp');
    if (isStep(passo) && steps.includes(passo))
      first.current = { step: passo, solo: true, resume: null };
    else if (mp && owner)
      first.current = {
        step: mp === 'connected' ? after(steps, 'mercadopago') : landOn(steps, 'mercadopago'),
        solo: false,
        resume: null,
      };
    else if (saved && inTab()) first.current = { step: saved, solo: false, resume: null };
    else if (saved || ob.finishedAt)
      first.current = { step: 'oi', solo: false, resume: saved ?? null };
    // signup's own welcome already said hello: straight to the first question
    else if (ob.from === 'signup')
      first.current = { step: questions[0]!, solo: false, resume: null };
    else first.current = { step: 'oi', solo: false, resume: null };
  }
  const [step, setStep] = useState<StepId>(first.current.step);
  const [solo, setSolo] = useState(first.current.solo);
  const [praise, setPraise] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);

  const remember = useCallback(
    (body: Parameters<typeof api.updateOnboarding>[0]) =>
      api.updateOnboarding(body).then(
        (n) => qc.setQueryData(qk.onboarding, n),
        () => undefined, // where the wizard stands is a convenience: never block on it
      ),
    [qc],
  );
  const go = useCallback(
    (to: StepId, p: string | null) => {
      setPraise(p);
      setStep(to);
      saveStep(storeId, to);
      markTab();
      void remember(to === 'pronto' ? { step: to, finished: true } : { step: to });
      if (to === 'pronto') void qc.invalidateQueries({ queryKey: qk.home });
      window.scrollTo({ top: 0 });
    },
    [storeId, remember, qc],
  );

  // Mercado Pago's return and deep links from the finale: read once, then out of the address
  useEffect(() => {
    const mp = params.get('mp');
    const passo = params.get('passo');
    if (!mp && !passo) return;
    if (mp === 'connected') {
      toast('Mercado Pago conectado! O cartão já aparece no site.');
      void qc.invalidateQueries({ queryKey: qk.payments });
    } else if (mp === 'error')
      toast.error(
        params.get('reason') === 'access_denied'
          ? 'A conexão foi cancelada no Mercado Pago. Dá para tentar de novo.'
          : 'Não deu para conectar o Mercado Pago. Tente de novo.',
      );
    if (isStep(passo) && steps.includes(passo) && passo !== step) {
      setSolo(true);
      go(passo, null);
    }
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const save = useCallback(
    (body: Record<string, unknown>) =>
      api.updateStore(body).then(
        (n) => {
          qc.setQueryData(qk.store, n);
          void qc.invalidateQueries({ queryKey: qk.home });
          void qc.invalidateQueries({ queryKey: qk.session });
          return true;
        },
        (e) => {
          toast.error(messageOf(e));
          return false;
        },
      ),
    [qc],
  );

  const facts = {
    s,
    pay,
    segment: ob.segment,
    products: products.length,
    hasColors: !!tokens,
    reached: ob.finishedAt ? ('pronto' as const) : isStep(ob.step) ? ob.step : null,
  };
  const at = steps.indexOf(step);
  // a detour from the finale answers its question and what that question opens, then goes back
  const soloNext = (): StepId =>
    FOLLOWS[step]?.find((x) => steps.includes(x) && !answered(x, facts)) ?? 'pronto';
  const next = (p?: string) =>
    go(solo ? soloNext() : (steps[Math.min(at + 1, steps.length - 1)] ?? 'pronto'), p ?? null);
  const back = at > 0 && !solo ? () => go(steps[at - 1]!, null) : null;
  const skip = () => {
    const skipped = [...new Set([...ob.skipped, step])].slice(-20);
    qc.setQueryData<OnboardingData>(qk.onboarding, (o) => (o ? { ...o, skipped } : o));
    void remember({ skipped });
    next();
  };
  const chapter = chapterOf(step);
  const inChapter = chapter ? chapter.steps.filter((x) => steps.includes(x)) : [];
  const eyebrow = chapter
    ? `${chapter.label} · ${inChapter.indexOf(step) + 1} de ${inChapter.length}`
    : '';
  const me = { name: session.user.name, phone: session.user.phone };
  const props: StepProps = { s, draft, patch, save, next, back, skip, eyebrow, segment, me };

  const leave = () => {
    markLeft(storeId);
    void remember({ dismissed: true });
  };

  // ── the welcome-back map and the finale ──
  const progress: ChapterProgress[] = CHAPTERS.map((c) => {
    const mine = c.steps.filter((x) => steps.includes(x));
    return {
      id: c.id,
      total: mine.length,
      done: mine.filter((x) => answered(x, facts) || ob.skipped.includes(x)).length,
    };
  });
  const resumeAt =
    first.current.resume ?? questions.find((x) => !answered(x, facts) && !ob.skipped.includes(x));
  const resume =
    step === 'oi' && (first.current.resume || ob.finishedAt) && resumeAt
      ? { step: resumeAt, chapter: chapterOf(resumeAt)!.id, label: LINE_SHORT[resumeAt] }
      : null;

  const hold = s.status.billingHold;
  const plan = usePlan(owner, hold);
  // the finale says until when a free trial runs (Conta is the owner's)
  const account = useQuery({
    queryKey: qk.account,
    queryFn: api.account,
    enabled: owner && step === 'pronto',
  });
  const ps = planState(plan.data);
  const pending: Pending[] = [
    ...ob.checklist
      .filter((c) => !c.done && c.id !== 'first_order')
      .filter((c) => c.id !== 'pix' || owner)
      .map((c) => {
        // "logo e WhatsApp": whichever of the two is missing
        const to = c.id === 'profile' && s.profile.logoUrl ? 'whatsapp' : STEP_FOR_ITEM[c.id];
        return {
          id: c.id,
          label: c.label,
          to: to && steps.includes(to) ? `/bem-vindo?passo=${to}` : c.href,
        };
      }),
    // delivery the merchant wants but left unpriced: pickup alone already ticks Core's item
    ...((draft.delivery || ob.skipped.includes('entrega')) &&
    !answered('entrega', facts) &&
    ob.checklist.some((c) => c.id === 'delivery' && c.done)
      ? [{ id: 'entrega', label: 'Preço da entrega', to: '/bem-vindo?passo=entrega' }]
      : []),
    ...(owner && pay.mercadoPago.available && pay.mercadoPago.status !== 'connected'
      ? [
          {
            id: 'mp',
            label: 'Receber cartão pelo site',
            to: steps.includes('mercadopago') ? '/bem-vindo?passo=mercadopago' : '/pagamentos',
          },
        ]
      : []),
  ];

  const answeredCount = Math.max(0, questions.indexOf(step));
  const header =
    step === 'pronto' ? (
      <JourneyBar
        phase="abrir"
        progress={hold ? 0.5 : 1}
        status={hold ? 'falta o plano' : 'no ar!'}
        exit={<Exit leave={leave} done />}
      />
    ) : (
      <JourneyBar
        phase="loja"
        progress={step === 'oi' ? 0 : answeredCount / questions.length}
        status={step === 'oi' ? 'começando' : `${answeredCount + 1} de ${questions.length}`}
        exit={<Exit leave={leave} />}
      />
    );

  let body: React.ReactNode;
  if (step === 'oi')
    body = (
      <Welcome
        first={session.user.name.trim().split(/\s+/)[0] ?? ''}
        questions={questions.length}
        progress={progress}
        resume={resume}
        onStart={() => go(resume?.step ?? questions[0]!, null)}
        onLeave={leave}
      />
    );
  else if (step === 'tipo')
    body = (
      <SegmentStep
        eyebrow={eyebrow}
        back={back}
        current={ob.segment}
        onPick={async (id: SegmentId) => {
          try {
            qc.setQueryData(qk.onboarding, await api.updateOnboarding({ segment: id }));
          } catch (e) {
            toast.error(messageOf(e));
            return false;
          }
          next(segmentOf(id)?.praise);
          return true;
        }}
      />
    );
  else if (step === 'importar')
    body = (
      <ImportFlow
        where="onboarding"
        owner={owner}
        hasProducts={products.length > 0}
        intro={
          <div>
            <p className="t-label tnum mb-2 text-muted">{eyebrow}</p>
            <h1 className="t-title-1 md:text-[2rem] md:leading-[2.5rem]">
              Já vende em outro app de cardápio?
            </h1>
            <p className="t-body-lg mt-2 text-muted">
              Cole o link da sua loja e eu trago produtos, fotos, horários e Pix. Você confere tudo
              antes de entrar.
            </p>
          </div>
        }
        onSkip={() => next()}
        onApplied={() =>
          void qc
            .fetchQuery({ queryKey: qk.store, queryFn: api.store, staleTime: 0 })
            .then((fresh) => setDraft(draftOf(fresh, tokens)))
            .catch(() => undefined)
            .finally(() => next('Trouxe tudo! Agora é só conferir.'))
        }
      />
    );
  else if (step === 'nome') body = <NameStep {...props} />;
  else if (step === 'logo') body = <LogoStep {...props} />;
  else if (step === 'cores')
    body = (
      <ColorsStep
        {...props}
        tokens={tokens}
        onSaved={(t) => {
          setTokens(t);
          void qc.invalidateQueries({ queryKey: qk.appearance });
        }}
      />
    );
  else if (step === 'frase') body = <TaglineStep {...props} />;
  else if (step === 'whatsapp') body = <WhatsappStep {...props} />;
  else if (step === 'horarios') body = <HoursStep {...props} />;
  else if (step === 'como') body = <HowStep {...props} />;
  else if (step === 'retirada') body = <PickupStep {...props} />;
  else if (step === 'entrega') body = <DeliveryStep {...props} />;
  else if (step === 'formas') body = <MethodsStep {...props} pay={pay} />;
  else if (step === 'pix') body = <PixStep {...props} pay={pay} />;
  else if (step === 'mercadopago') body = <MercadoPagoStep {...props} />;
  else if (step === 'produtos')
    body = <ProductsStep {...props} products={products} categories={categories} />;
  else
    body = (
      <Finale
        url={session.store.url}
        name={draft.name.trim() || s.profile.name}
        live={!hold}
        trialEndsAt={
          account.data?.subscription?.status === 'trialing'
            ? account.data.subscription.trialEndsAt
            : null
        }
        waiting={
          ps.kind === 'pix' && plan.data ? (
            <PlanPix a={plan.data} invoiceId={ps.invoiceId} />
          ) : ps.kind === 'card' && ps.url ? (
            <Button onClick={() => window.location.assign(ps.url!)}>
              autorizar o cartão no Mercado Pago
            </Button>
          ) : (
            <p className="t-body text-muted">
              {owner
                ? 'A equipe da Venduá confirma o pagamento do plano e a loja abre em seguida.'
                : 'Quem é dono da loja acerta o plano em Conta. A loja abre logo depois.'}
            </p>
          )
        }
        pending={pending}
      />
    );

  const preview = (
    <MiniStore
      draft={draft}
      products={products}
      whatsapp={!!s.profile.whatsapp}
      timeZone={s.hours.timezone}
      specialDays={s.specialDays}
      url={session.store.url.replace(/^https?:\/\//, '')}
      examples={segment.examples}
    />
  );

  return (
    <div className="min-h-dvh overflow-x-clip">
      {header}
      {step !== 'pronto' ? <PlanBanner owner={owner} hold={hold} /> : null}
      <div
        className={cn(
          'mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-[calc(1rem+var(--kb,0px))] pt-8 md:px-8',
          step !== 'pronto' && 'lg:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <main className="mx-auto w-full max-w-xl space-y-8 lg:mx-0">
          {step !== 'pronto' ? (
            <Guide turn={step} pose={POSE[step]}>
              {praise ? <strong className="mr-1">{praise}</strong> : null}
              {step === 'oi'
                ? resume
                  ? 'Que bom te ver de novo! Guardei tudo o que você já fez.'
                  : `Oi, ${session.user.name.trim().split(/\s+/)[0] ?? ''}! Meu nome é Duá. ${LINE.oi}`
                : LINE[step]}
            </Guide>
          ) : null}

          {body}

          {step !== 'oi' && step !== 'pronto' ? (
            <div className="lg:hidden">
              <Button
                variant="secondary"
                block
                icon={peek ? <EyeSlash /> : <Eye />}
                aria-expanded={peek}
                onClick={() => setPeek((v) => !v)}
              >
                {peek ? 'Fechar a prévia' : 'Espiar minha loja'}
              </Button>
              {peek ? <div className="animate-fade-up mt-4">{preview}</div> : null}
            </div>
          ) : null}
        </main>

        {step !== 'pronto' ? (
          <aside
            className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
            aria-label="prévia da sua loja"
          >
            <p className="t-label mb-3 text-center text-muted">Sua loja, ao vivo</p>
            {preview}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function Exit({ leave, done }: { leave: () => void; done?: boolean }) {
  return (
    <Link
      to="/"
      onClick={done ? undefined : leave}
      className="t-label inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-muted hover:bg-hover"
      aria-label={done ? 'ir para o painel' : 'sair e continuar depois'}
    >
      <X className="size-5" />{' '}
      <span className="hidden sm:inline">{done ? 'ir ao painel' : 'continuar depois'}</span>
    </Link>
  );
}

/** The button on the welcome-back map names the next question in a couple of words. */
const LINE_SHORT: Record<StepId, string> = {
  oi: 'início',
  tipo: 'o que você vende',
  importar: 'trazer o cardápio',
  nome: 'o nome',
  logo: 'a logo',
  cores: 'as cores',
  frase: 'a frase',
  whatsapp: 'o WhatsApp',
  horarios: 'os horários',
  como: 'retirada e entrega',
  retirada: 'onde buscar',
  entrega: 'a taxa de entrega',
  formas: 'as formas de pagamento',
  pix: 'a chave Pix',
  mercadopago: 'o Mercado Pago',
  produtos: 'o cardápio',
  pronto: 'o fim',
};

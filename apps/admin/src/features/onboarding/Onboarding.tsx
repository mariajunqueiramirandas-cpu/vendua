import { X } from '@phosphor-icons/react';
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
import { trackPageview } from '../../lib/analytics.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { useKeyboard } from '../../ui/keyboard.ts';
import type { Pose } from '../../ui/Mascote.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toWeek } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ImportFlow } from '../import/ImportFlow.tsx';
import { Finale, FinaleHero, type Pending } from './Finale.tsx';
import {
  after,
  ALL_STEPS,
  answered,
  CHAPTERS,
  chapterOf,
  isStep,
  landOn,
  LINE_SHORT,
  FOLLOWS,
  SPOT,
  STEP_FOR_ITEM,
  stepsFor,
  type StepId,
} from './flow.ts';
import { Guide, Reaction } from './Guide.tsx';
import { Ribbon, TRACKS } from './Ribbon.tsx';
import { MiniStore, type Draft } from './MiniStore.tsx';
import { Welcome, type ChapterProgress } from './Overview.tsx';
import { StepMap, type Mark } from './StepMap.tsx';
import { StoreCard } from './StoreCard.tsx';
import { SPOT_LINE, Vitrine } from './Vitrine.tsx';
import { planState, PlanBanner, PlanPix, usePlan } from './PlanPay.tsx';
import { markLeft, readStep, saveStep } from './progress.ts';
import { GENERIC, segmentOf, type SegmentId } from './segments.ts';
import {
  HoursStep,
  HowStep,
  LogoStep,
  NameStep,
  PickupStep,
  AddressStep,
  ProductsStep,
  SegmentStep,
  TaglineStep,
  WhatsappStep,
  type StepProps,
} from './steps.tsx';
import { ColorsStep, DeliveryStep, MercadoPagoStep, MethodsStep, PixStep } from './steps-more.tsx';

// The store builds itself (§6.8): one question per screen in four parts, Duá reacting to each
// answer, and the store assembling as it goes. On phones and tablets the store is a card above
// the question, in its own colour (the card Início will wear); from 1200 px it stands lit in a
// shop window cut into the paper beside the question, with the map of questions as a spine on the
// other side. The header names the place and, below 1200 px, opens that map. Every answer saves
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
  const stepRef = useRef(step);
  stepRef.current = step;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  // each question counts as its own page, so the CRM sees where the setup stalls
  useEffect(() => trackPageview(`/bem-vindo/${step}`), [step]);
  const [solo, setSolo] = useState(first.current.solo);
  // Duá's line over the next question: praise for the answer, a part that just finished, and
  // the pose of the part that begins
  const [said, setSaid] = useState<{
    praise: string | null;
    done: string | null;
    pose: Pose | null;
  } | null>(null);
  // which way the questions slide: forward from the right, back from the left
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  // questions the merchant moved on from this visit (an import declined counts as answered)
  const [left, setLeft] = useState<ReadonlySet<StepId>>(() => new Set());
  const [peek, setPeek] = useState(false);
  const [map, setMap] = useState(false);
  // bumps when an answer changed the store, so its card lights up
  const [spark, setSpark] = useState(0);
  // the furthest question "Continuar" got to (a jump from the map or "voltar" doesn't move it):
  // the ones before it that need no answer of their own (the methods, an import declined) count
  const [furthest, setFurthest] = useState<StepId | null>(() =>
    ob.finishedAt ? 'pronto' : isStep(ob.step) ? ob.step : null,
  );

  const remember = useCallback(
    (body: Parameters<typeof api.updateOnboarding>[0]) =>
      api.updateOnboarding(body).then(
        (n) => qc.setQueryData(qk.onboarding, n),
        () => undefined, // where the wizard stands is a convenience: never block on it
      ),
    [qc],
  );
  const go = useCallback(
    (
      to: StepId,
      p: string | null,
      how: 'step' | 'jump' | 'detour' = 'step',
      /** the question just left closed its part: how many of it were left for later */
      part: { later: number } | null = null,
    ) => {
      const from = stepRef.current;
      const ahead = ALL_STEPS.indexOf(to) > ALL_STEPS.indexOf(from);
      const was = chapterOf(from);
      const now = chapterOf(to);
      // a new part on the way forward: Duá introduces it, and ticks off the one just finished
      const parts = CHAPTERS.filter((c) => c.steps.some((x) => stepsRef.current.includes(x)));
      // (not on a jump from the map, nor on a detour from the finale)
      const entering = ahead && how === 'step' && !!now && now.id !== was?.id;
      const n = `Parte ${parts.findIndex((c) => c.id === was?.id) + 1} de ${parts.length}`;
      const finished =
        entering && was && part
          ? part.later
            ? `${n} feita (${part.later} para depois)`
            : `${n} pronta`
          : null;
      const line = [p, entering ? now!.start : null].filter(Boolean).join(' ');
      setSaid(line ? { praise: line, done: finished, pose: entering ? now!.pose : null } : null);
      setDir(ahead ? 'fwd' : 'back');
      setStep(to);
      if (p) setSpark((n) => n + 1);
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
      go(passo, null, 'detour');
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
    reached: furthest,
  };
  const at = steps.indexOf(step);
  // a detour from the finale answers its question and what that question opens, then goes back
  const soloNext = (): StepId =>
    FOLLOWS[step]?.find((x) => steps.includes(x) && !answered(x, facts)) ?? 'pronto';
  const mark = (x: StepId): Mark =>
    x === step
      ? 'current'
      : answered(x, facts)
        ? 'done'
        : ob.skipped.includes(x)
          ? 'skipped'
          : left.has(x)
            ? 'done'
            : 'open';
  const settled = (x: StepId) => {
    const m = mark(x);
    return m === 'done' || m === 'skipped';
  };
  const next = (p?: string, skipping = false) => {
    const to = solo ? soloNext() : (steps[Math.min(at + 1, steps.length - 1)] ?? 'pronto');
    // the last question of its part, with every other one of it settled: Duá ticks the part off
    const was = chapterOf(step);
    const rest = was ? was.steps.filter((x) => x !== step && steps.includes(x)) : [];
    const part =
      !solo && was && chapterOf(to)?.id !== was.id && rest.every(settled)
        ? { later: rest.filter((x) => mark(x) === 'skipped').length + (skipping ? 1 : 0) }
        : null;
    setLeft((x) => new Set(x).add(step));
    if (!solo) setFurthest((f) => (!f || ALL_STEPS.indexOf(to) > ALL_STEPS.indexOf(f) ? to : f));
    go(to, p ?? null, solo ? 'detour' : 'step', part);
  };
  const back = at > 0 && !solo ? () => go(steps[at - 1]!, null) : null;
  const skip = () => {
    const skipped = [...new Set([...ob.skipped, step])].slice(-20);
    qc.setQueryData<OnboardingData>(qk.onboarding, (o) => (o ? { ...o, skipped } : o));
    void remember({ skipped });
    next(undefined, true);
  };
  // straight to any question, from the map; the focus then goes to its title, not back to the
  // header that opened the map
  const jumped = useRef(false);
  const jump = (to: StepId) => {
    jumped.current = true;
    setMap(false);
    setSolo(false);
    if (to !== step) go(to, null, 'jump');
  };
  const chapter = chapterOf(step);
  const inChapter = chapter ? chapter.steps.filter((x) => steps.includes(x)) : [];
  const me = { name: session.user.name, phone: session.user.phone };
  const props: StepProps = { s, draft, patch, save, next, back, skip, segment, me };

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
      done: mine.filter((x) => answered(x, facts) || ob.skipped.includes(x) || left.has(x)).length,
      later: mine.filter((x) => !answered(x, facts) && ob.skipped.includes(x)).length,
    };
  });
  // a returning merchant picks up at the first question still open from where they stopped
  // (they may have stopped on one they went back to), else the first open one at all
  const open = (x: StepId) => !answered(x, facts) && !ob.skipped.includes(x);
  const saved = first.current.resume;
  const resumeAt =
    (saved ? questions.slice(Math.max(0, questions.indexOf(saved))).find(open) : undefined) ??
    questions.find(open);
  const returning = !!(saved || ob.finishedAt);
  const resume =
    step === 'oi' && returning && resumeAt
      ? { step: resumeAt, chapter: chapterOf(resumeAt)!.id, label: LINE_SHORT[resumeAt] }
      : null;
  // came back with every question answered: the welcome offers the finale, or a review
  const complete = step === 'oi' && returning && !resumeAt;

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
            to: steps.includes('mercadopago') ? '/bem-vindo?passo=mercadopago' : '/loja/pagamentos',
          },
        ]
      : []),
  ];

  // each part of the header's hairline fills as its questions are answered (or left for later)
  const parts = CHAPTERS.flatMap((c) => {
    const mine = c.steps.filter((x) => steps.includes(x));
    return mine.length
      ? [{ id: c.id, label: c.label, fill: mine.filter(settled).length / mine.length }]
      : [];
  });
  const header =
    step === 'pronto' ? (
      <Ribbon
        parts={parts}
        place={hold ? 'Sua loja, pronta' : 'Sua loja, no ar!'}
        done={!hold}
        exit={<Exit leave={leave} done />}
      />
    ) : step === 'oi' ? (
      <Ribbon parts={parts} place="Montar a loja" exit={<Exit leave={leave} />} />
    ) : (
      <Ribbon
        parts={parts}
        place={chapter?.label ?? ''}
        count={`${inChapter.indexOf(step) + 1} de ${inChapter.length}`}
        onPlace={() => setMap(true)}
        exit={<Exit leave={leave} worded />}
      />
    );

  let body: React.ReactNode;
  if (step === 'oi')
    body = (
      <Welcome
        first={session.user.name.trim().split(/\s+/)[0] ?? ''}
        questions={questions.length}
        minutes={Math.max(2, Math.round((questions.length * 20) / 60))}
        progress={progress}
        resume={resume}
        complete={complete}
        onStart={() => go(complete ? 'pronto' : (resume?.step ?? questions[0]!), null)}
        onReview={() => go(questions[0]!, null, 'jump')}
        later={questions.filter((x) => !answered(x, facts) && ob.skipped.includes(x)).length}
        onLeave={leave}
      />
    );
  else if (step === 'tipo')
    body = (
      <SegmentStep
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
            <h1 className="t-title-1 text-balance text-[1.875rem] leading-[2.25rem] tracking-[-0.03em] md:text-[2.5rem] md:leading-[2.875rem] xl:text-[2.75rem] xl:leading-[3.125rem]">
              Já vende em outro app de cardápio?
            </h1>
            <p className="t-body-lg mt-3 max-w-[34rem] text-pretty text-muted">
              Cole o link da sua loja e eu trago produtos, fotos, horários e Pix. Você confere tudo
              antes de entrar.
            </p>
          </div>
        }
        onSkip={() => next()}
        onBack={back}
        onPhotosDone={() => next('Cardápio dentro! Depois coloque as fotos de cada produto.')}
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
  else if (step === 'endereco') body = <AddressStep {...props} />;
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

  const question = step !== 'oi' && step !== 'pronto';
  const spot = question ? (SPOT[step] ?? null) : null;
  const preview = (wide?: boolean) => (
    <MiniStore
      draft={draft}
      products={products}
      whatsapp={!!s.profile.whatsapp}
      timeZone={s.hours.timezone}
      specialDays={s.specialDays}
      url={session.store.url.replace(/^https?:\/\//, '')}
      examples={segment.examples}
      spot={spot}
      // as tall as the window allows, never past 280 px wide
      className={wide ? 'w-[min(100%,280px,calc((100dvh-19rem)*0.47))]' : undefined}
    />
  );
  const stepMap = <StepMap steps={steps} mark={mark} onJump={jump} />;
  const name = draft.name.trim() || s.profile.name;

  return (
    // a column as tall as the screen, so a question's bar can hold the bottom on phones (not
    // while typing: the keyboard covers the bottom)
    <div className="flex min-h-dvh min-w-0 flex-col overflow-x-clip kb:min-h-0">
      {header}
      {step !== 'pronto' ? <PlanBanner owner={owner} hold={hold} /> : null}
      <div
        className={cn(
          // one column on phones and tablets; from 1200 px the map, the question and the window,
          // on the header's own tracks
          'mx-auto grid w-full max-w-[84rem] flex-1 grid-cols-[minmax(0,1fr)] px-4 pt-4 md:px-8 md:pt-6 lg:pt-6',
          TRACKS,
          // a question's bar keeps the screen's bottom edge (ActionBar `pinned`), scrolled or not
          question ? 'pb-[var(--kb,0px)] lg:pb-10' : 'pb-[calc(1.5rem+var(--kb,0px))] lg:pb-10',
        )}
      >
        {question ? (
          <nav
            aria-label="todas as perguntas"
            // its rows' text on the track's edge, their highlight in the gutter
            className="hidden lg:sticky lg:top-[5.5rem] lg:-mx-2 lg:block lg:self-start lg:pt-2"
          >
            <p className="t-caption mb-2 px-2 text-muted">
              <span className="tnum font-semibold text-ink">
                {questions.filter(settled).length} de {questions.length}
              </span>{' '}
              respondidas
            </p>
            <StepMap rail steps={steps} mark={mark} onJump={jump} />
          </nav>
        ) : (
          <span aria-hidden className="hidden lg:block" />
        )}

        <main className="mx-auto flex w-full max-w-xl flex-col lg:mx-0 lg:max-w-none lg:pt-2">
          {step === 'pronto' ? (
            <div className="mb-6 lg:hidden">
              <FinaleHero name={name} live={!hold} phone={preview()} accent={draft.accent} />
            </div>
          ) : null}
          {question ? (
            <div className="mb-6 lg:hidden">
              <StoreCard
                draft={draft}
                products={products.length}
                whatsapp={!!s.profile.whatsapp}
                timeZone={s.hours.timezone}
                specialDays={s.specialDays}
                spot={spot}
                spark={spark}
                url={session.store.url.replace(/^https?:\/\//, '')}
                onOpen={() => setPeek(true)}
              />
            </div>
          ) : null}
          <div
            key={step}
            className={cn(
              'flex flex-1 flex-col space-y-6',
              dir === 'back' ? 'animate-step-back' : 'animate-step-fwd',
            )}
          >
            {question && said ? (
              <Reaction done={said.done} pose={said.pose}>
                {said.praise}
              </Reaction>
            ) : null}
            {body}
          </div>
        </main>

        <Vitrine
          phone={preview(true)}
          accent={draft.accent}
          spark={spark}
          title={
            step === 'pronto'
              ? hold
                ? 'Sua loja, pronta'
                : 'Sua loja, no ar'
              : 'Sua loja, ao vivo'
          }
          line={
            step === 'pronto'
              ? hold
                ? 'Ela abre para pedidos assim que o plano for confirmado.'
                : 'Seus clientes já podem pedir por esse link.'
              : spot
                ? SPOT_LINE[spot]
                : 'Cada resposta aparece aqui, na hora.'
          }
        />
      </div>

      {question ? (
        <>
          <Sheet
            open={peek}
            onOpenChange={setPeek}
            title="Sua loja, ao vivo"
            description="Cada resposta entra aqui na hora. O que está marcado é o que essa pergunta muda."
          >
            <div className="mx-auto max-w-[300px] py-2">{preview()}</div>
          </Sheet>
          <Sheet
            open={map}
            onOpenChange={setMap}
            onCloseAutoFocus={(e) => {
              if (!jumped.current) return;
              jumped.current = false;
              e.preventDefault();
              document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
            }}
            title="Todas as perguntas"
            description="Toque em qualquer uma para ir direto. O que você já respondeu fica guardado."
          >
            <div className="pb-2">{stepMap}</div>
          </Sheet>
        </>
      ) : null}
    </div>
  );
}

function Exit({ leave, done, worded }: { leave: () => void; done?: boolean; worded?: boolean }) {
  return (
    <Link
      to="/"
      onClick={done ? undefined : leave}
      // -mr-3: the X sits on the column's right edge
      className="t-label -mr-3 inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-muted hover:bg-hover"
      aria-label={done ? 'ir para o painel' : 'sair e continuar depois'}
    >
      <X className="size-5" />
      {worded ? <span className="hidden lg:inline">continuar depois</span> : null}
    </Link>
  );
}

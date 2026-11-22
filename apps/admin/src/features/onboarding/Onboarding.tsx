import { platform } from '../../platform/index.ts';
import { Check, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { Sheet } from '../../ui/Sheet.tsx';
import { toWeek } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { ImportFlow } from '../import/ImportFlow.tsx';
import { Finale, FinaleHero } from './Finale.tsx';
import { SCREENS, screenOf, screensFor, type ScreenId, type StepId } from './flow.ts';
import { Guide, Say } from './Guide.tsx';
import { Ribbon, TRACKS } from './Ribbon.tsx';
import { MiniStore, type Draft } from './MiniStore.tsx';
import { StoreCard } from './StoreCard.tsx';
import { SPOT_LINE, Vitrine } from './Vitrine.tsx';
import { planState, PlanBanner, PlanPix, usePlan } from './PlanPay.tsx';
import { forgetIfReset, markLeft, readStep, saveStep } from './progress.ts';
import { GENERIC, segmentOf } from './segments.ts';
import { AtendimentoScreen, CaraScreen, PagamentoScreen, type ScreenProps } from './screens.tsx';
import { ProductsStep, Voice } from './steps.tsx';

// The store builds itself (§6.8): four screens, each one part of the store with its questions
// together and good answers already filled in, and the store assembling as it goes. On phones and
// tablets the store is a card above the screen, in its own colour; from 1200 px it stands lit in a
// shop window beside it, with the four parts as a spine on the other side. Every screen saves on
// "Continuar"; where the merchant stopped lives in Core, so any device picks up from there.

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
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const products = useMemo(() => categories.flatMap((c) => c.products), [categories]);

  // what decides the screen's questions is read once, as the wizard opens: an answer given on the
  // way doesn't make a question vanish under the merchant's thumb
  const [known] = useState(() => ({
    askSegment: !ob.segment,
    askName: ob.from !== 'signup',
    importable: products.length === 0,
  }));
  const [segmentId, setSegmentId] = useState(ob.segment);
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

  const screens = useMemo(() => screensFor(owner), [owner]);
  const questions = screens.filter((x): x is Exclude<ScreenId, 'pronto'> => x !== 'pronto');
  const segment = segmentOf(segmentId) ?? GENERIC;

  // where to open: a link to one screen (?passo=, the old step names too), Mercado Pago's return,
  // where the merchant stopped, the finale once it's done, or the first screen
  const first = useRef<{ step: StepId; solo: boolean } | null>(null);
  if (!first.current) {
    forgetIfReset(storeId, ob.resetAt);
    const passo = screenOf(params.get('passo'), screens);
    const saved = screenOf(ob.step, screens) ?? screenOf(readStep(storeId), screens);
    first.current =
      passo && passo !== 'pronto'
        ? { step: passo, solo: true }
        : params.get('mp') && owner
          ? { step: 'pagamento', solo: false }
          : ob.finishedAt
            ? { step: 'pronto', solo: false }
            : { step: saved ?? questions[0]!, solo: false };
  }
  const [step, setStep] = useState<StepId>(first.current.step);
  const solo = first.current.solo;
  // each screen counts as its own page, so the CRM sees where the setup stalls
  useEffect(() => trackPageview(`/bem-vindo/${step}`), [step]);
  const [praise, setPraise] = useState<string | null>(null);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [peek, setPeek] = useState(false);
  // bumps when an answer changed the store, so its card lights up
  const [spark, setSpark] = useState(0);
  // the furthest screen reached: the header fills up to it
  const [furthest, setFurthest] = useState(() =>
    ob.finishedAt ? screens.length - 1 : Math.max(0, screens.indexOf(screenOf(ob.step, screens)!)),
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
    (to: StepId, said: string | null = null) => {
      setDir(
        to === 'importar' || screens.indexOf(to as ScreenId) >= screens.indexOf(step as ScreenId)
          ? 'fwd'
          : 'back',
      );
      setPraise(said);
      setStep(to);
      if (said) setSpark((n) => n + 1);
      if (to !== 'importar') {
        const at = screens.indexOf(to);
        setFurthest((f) => Math.max(f, at));
        saveStep(storeId, to);
        void remember(to === 'pronto' ? { step: to, finished: true } : { step: to });
      }
      if (to === 'pronto') void qc.invalidateQueries({ queryKey: qk.home });
      window.scrollTo({ top: 0 });
    },
    [screens, step, storeId, remember, qc],
  );

  // Mercado Pago's return: read once, then out of the address
  useEffect(() => {
    const mp = params.get('mp');
    if (!mp && !params.get('passo')) return;
    if (mp === 'connected') {
      toast('Mercado Pago conectado! O cartão já aparece no site.');
      void qc.invalidateQueries({ queryKey: qk.payments });
    } else if (mp === 'error')
      toast.error(
        params.get('reason') === 'access_denied'
          ? 'A conexão foi cancelada no Mercado Pago. Dá para tentar de novo.'
          : 'Não deu para conectar o Mercado Pago. Tente de novo.',
      );
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const at = questions.indexOf(step as never);
  const next = (said?: string) => {
    // a link to one screen (from the setup list, from Duá's training) goes back where it came from
    if (solo) {
      if (said) toast(said);
      if ((window.history.state as { idx?: number } | null)?.idx) return nav(-1);
      return go('pronto');
    }
    go(questions[at + 1] ?? 'pronto', said ?? null);
  };
  const back = solo ? null : at > 0 ? () => go(questions[at - 1]!) : null;
  const me = { name: session.user.name, phone: session.user.phone };
  const props: ScreenProps = { s, draft, patch, save, next, back, segment, me };

  const leave = () => {
    markLeft(storeId);
    void remember({ dismissed: true });
  };

  const hold = s.status.billingHold;
  const plan = usePlan(owner, hold);
  // the finale says until when a free trial runs (Conta is the owner's)
  const account = useQuery({
    queryKey: qk.account,
    queryFn: api.account,
    enabled: owner && step === 'pronto',
  });
  const ps = planState(plan.data);
  const current = step === 'importar' ? 'cara' : step;
  const screen = SCREENS.find((x) => x.id === current);
  const parts = questions.map((id, i) => ({
    id,
    label: SCREENS.find((x) => x.id === id)!.label,
    fill: step === 'pronto' || i < furthest || i < at ? 1 : i === at ? 0.5 : 0,
  }));
  const header =
    step === 'pronto' ? (
      <Ribbon
        parts={parts}
        place={hold ? 'Sua loja, pronta' : 'Sua loja, no ar!'}
        done={!hold}
        exit={<Exit leave={leave} done />}
      />
    ) : (
      <Ribbon
        parts={parts}
        place={screen?.label ?? ''}
        count={
          solo
            ? undefined
            : `${Math.max(0, questions.indexOf(current as never)) + 1} de ${questions.length}`
        }
        exit={<Exit leave={leave} worded />}
      />
    );

  let body: React.ReactNode;
  if (step === 'importar')
    body = (
      <ImportFlow
        where="onboarding"
        owner={owner}
        hasProducts={products.length > 0}
        intro={
          <div>
            <h1 className="t-title-1 text-balance text-[1.875rem] leading-[2.25rem] tracking-[-0.03em] md:text-[2.5rem] md:leading-[2.875rem]">
              Trazer de outro app
            </h1>
            <div className="mt-4">
              <Say>
                Cole o link da sua loja e eu trago produtos, fotos, horários e Pix. Você confere
                tudo antes de entrar.
              </Say>
            </div>
          </div>
        }
        onSkip={() => go('cara')}
        onBack={() => go('cara')}
        onPhotosDone={() => go('cara', 'Cardápio dentro! Depois coloque as fotos de cada produto.')}
        onApplied={() =>
          void qc
            .fetchQuery({ queryKey: qk.store, queryFn: api.store, staleTime: 0 })
            .then((fresh) => setDraft(draftOf(fresh, tokens)))
            .catch(() => undefined)
            .finally(() => go('cara', 'Trouxe tudo! Confira cada parte e ajuste o que quiser.'))
        }
      />
    );
  else if (step === 'cara')
    body = (
      <CaraScreen
        {...props}
        askName={known.askName}
        segmentId={segmentId}
        onSegment={
          known.askSegment
            ? async (id) => {
                try {
                  qc.setQueryData(qk.onboarding, await api.updateOnboarding({ segment: id }));
                  setSegmentId(id);
                  return true;
                } catch (e) {
                  toast.error(messageOf(e));
                  return false;
                }
              }
            : null
        }
        tokens={tokens}
        onTokens={(t) => {
          setTokens(t);
          void qc.invalidateQueries({ queryKey: qk.appearance });
        }}
        onImport={known.importable && products.length === 0 ? () => go('importar') : null}
      />
    );
  else if (step === 'atendimento') body = <AtendimentoScreen {...props} />;
  else if (step === 'pagamento') body = <PagamentoScreen {...props} pay={pay} />;
  else if (step === 'cardapio')
    body = (
      <ProductsStep
        next={next}
        back={back}
        skip={() => next()}
        segment={segment}
        products={products}
        categories={categories}
      />
    );
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
          platform.canPay && ps.kind === 'pix' && plan.data ? (
            <PlanPix a={plan.data} invoiceId={ps.invoiceId} />
          ) : platform.canPay && ps.kind === 'card' && ps.url ? (
            <Button onClick={() => platform.openExternal(ps.url!)}>
              autorizar o cartão no Mercado Pago
            </Button>
          ) : (
            <p className="t-body text-muted">
              {!platform.canPay
                ? 'A loja abre assim que o pagamento do plano for confirmado.'
                : owner
                  ? 'A equipe da Venduá confirma o pagamento do plano e a loja abre em seguida.'
                  : 'Quem é dono da loja acerta o plano em Conta. A loja abre logo depois.'}
            </p>
          )
        }
        checklist={ob.checklist}
      />
    );

  const question = step !== 'pronto' && step !== 'importar';
  const spot = question ? (screen?.spot ?? null) : null;
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
  const name = draft.name.trim() || s.profile.name;

  return (
    // a column as tall as the screen, so a screen's bar can hold the bottom on phones (not while
    // typing: the keyboard covers the bottom)
    <div className="flex min-h-dvh min-w-0 flex-col overflow-x-clip kb:min-h-0">
      {header}
      {step !== 'pronto' ? <PlanBanner owner={owner} hold={hold} /> : null}
      <div
        className={cn(
          // one column on phones and tablets; from 1200 px the parts, the screen and the window,
          // on the header's own tracks
          'mx-auto grid w-full max-w-[84rem] flex-1 grid-cols-[minmax(0,1fr)] px-4 pt-4 md:px-8 md:pt-6 lg:pt-6',
          TRACKS,
          question ? 'pb-[var(--kb,0px)] lg:pb-10' : 'pb-[calc(1.5rem+var(--kb,0px))] lg:pb-10',
        )}
      >
        {question && !solo ? (
          <nav
            aria-label="partes da loja"
            className="hidden lg:sticky lg:top-[5.5rem] lg:-mx-2 lg:block lg:self-start lg:pt-2"
          >
            <ol className="space-y-1">
              {questions.map((id, i) => {
                const x = SCREENS.find((y) => y.id === id)!;
                const now = id === current;
                const done = !now && (i < furthest || i < at);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => id !== step && go(id)}
                      aria-current={now ? 'step' : undefined}
                      className={cn(
                        'press-row flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left',
                        now ? 'bg-surface font-semibold depth-1' : 'hover:bg-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-8 shrink-0 place-items-center rounded-full',
                          done
                            ? 'bg-success text-on-primary'
                            : now
                              ? 'bg-spark text-on-spark'
                              : 'bg-sunken text-muted',
                        )}
                      >
                        {done ? (
                          <Check weight="bold" className="size-4" aria-hidden />
                        ) : (
                          <x.Icon weight="duotone" className="size-4.5" aria-hidden />
                        )}
                      </span>
                      <span className={cn('min-w-0 truncate', !now && !done && 'text-muted')}>
                        {x.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
          <span className="hidden lg:block" aria-hidden />
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
            <Voice.Provider value={question ? { praise, done: null, pose: null } : null}>
              {body}
            </Voice.Provider>
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
        <Sheet
          open={peek}
          onOpenChange={setPeek}
          title="Sua loja, ao vivo"
          description="Cada resposta entra aqui na hora."
        >
          <div className="mx-auto max-w-[300px] py-2">{preview()}</div>
        </Sheet>
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

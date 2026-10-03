import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  api,
  type Coverage,
  type MenuGap,
  type VendedorOnboarding,
  type VendedorOnboardingProgress,
} from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { toast } from '../../ui/Toast.tsx';
import { AgentGuide, AgentJourney, MiniChat, type ChatLine } from '../../ui/vendedor/index.ts';
import { Finale, WhenStep } from './Train.comecar.tsx';
import { NameStep, WhatsappStep } from './Train.conhecer.tsx';
import { HandoffStep, InterviewStep, ReadStep, useSaveSettings } from './Train.ensinar.tsx';
import {
  articleOf,
  gapKey,
  greetingPreview,
  interviewState,
  isStep,
  journeyAt,
  ORDER,
  PART_OF,
  withSkipped,
  type Persona,
  type StepId,
} from './Train.model.ts';
import { Dots, Exit } from './Train.parts.tsx';
import { OcultoStep, OrderStep } from './Train.testar.tsx';

// Treinar a Ana (sales-agent-ux §3.12): the Vendedor's own onboarding, owner only, in the Shell's
// bare mode. She guides it in first person, and a WhatsApp preview shows her answering better
// as the owner chooses. Nothing she proposes is kept without "está certo"; turning her on is the
// owner's last tap, never gated by what was skipped.

export default function Train() {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const poll = usePollWhenOffline(3_000, 6_000);
  const ob = useQuery({
    queryKey: qk.vendedor.onboarding,
    queryFn: api.vendedor.onboarding,
    enabled: owner,
    // the interviewer answers in an agent turn: the stream says when, polling covers a quiet one
    refetchInterval: (q) => (q.state.data && interviewState(q.state.data).waiting ? poll : false),
  });
  if (!owner)
    return (
      <div className="mx-auto max-w-lg space-y-6 p-6 pt-12">
        <AgentGuide name={session.vendedor?.name ?? 'Ana'} turn="sem-acesso">
          Quem me treina e me liga é o dono da loja. Peça a ele!
        </AgentGuide>
        <ButtonLink to="/vendedor" size="lg" block>
          ir para o Vendedor
        </ButtonLink>
      </div>
    );
  if (!ob.data)
    return (
      <div className="mx-auto max-w-xl p-4 pt-8 md:p-8">
        {ob.error ? <ErrorState error={ob.error} retry={() => void ob.refetch()} /> : <Loading />}
      </div>
    );
  return <Flow ob={ob.data} />;
}

function Flow({ ob }: { ob: VendedorOnboarding }) {
  const session = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const store = session.store.name;

  // where to open: a detour back from the finale (?passo=), where the owner stopped, or the start
  const [step, setStep] = useState<StepId>(() => {
    const passo = params.get('passo');
    if (isStep(passo)) return passo;
    if (ob.progress.finished) return 'pronto';
    if (isStep(ob.progress.step)) return ob.progress.step;
    return 'nome';
  });
  const [peek, setPeek] = useState(false);
  const [draft, setDraftState] = useState<Persona>(() => ({
    name: ob.settings.name,
    disclose: ob.settings.disclose,
    tone: ob.settings.tone,
  }));
  const setDraft = useCallback((p: Partial<Persona>) => setDraftState((d) => ({ ...d, ...p })), []);
  const name = (step === 'nome' ? draft.name.trim() : ob.settings.name) || ob.settings.name;

  const progress = useMutation({
    mutationFn: (p: VendedorOnboardingProgress) => api.vendedor.updateOnboarding(p),
    onSuccess: (d) => qc.setQueryData(qk.vendedor.onboarding, d),
    onError: (e) => toast.error(messageOf(e)),
  });
  const settings = useSaveSettings();

  // the first visit tells Core the journey started, so Início shows the resume map
  const told = useRef(false);
  useEffect(() => {
    if (told.current || ob.progress.started) return;
    told.current = true;
    progress.mutate({ started: true, part: PART_OF[step], step });
  }, [ob.progress.started, progress, step]);

  const go = useCallback(
    (to: StepId, extra: VendedorOnboardingProgress = {}) => {
      setStep(to);
      setPeek(false);
      if (params.has('passo')) setParams({}, { replace: true });
      window.scrollTo({ top: 0 });
      progress.mutate({ started: true, part: PART_OF[to], step: to, ...extra });
    },
    [params, setParams, progress],
  );
  const at = ORDER.indexOf(step);
  const back = at > 0 ? () => go(ORDER[at - 1]!) : null;
  const skipped = ob.progress.skipped ?? [];
  // a detour from the finale (or a deep link once it's done) returns to the finale
  const [detour, setDetour] = useState(() => !!ob.progress.finished);
  const next = (to: StepId, extra: VendedorOnboardingProgress = {}) =>
    go(detour ? 'pronto' : to, extra);
  const skip = (id: string, to: StepId) => next(to, { skipped: withSkipped(skipped, [id]) });

  const iv = interviewState(ob);
  const left: MenuGap[] = ob.gaps.filter((g) => !skipped.includes(gapKey(g)));
  const linked = ob.readiness.whatsapp;
  const { progress: fill, status } = journeyAt(step, iv.asked);
  const eyebrow = (s: string) => `${PART_LABEL[PART_OF[step]]} · ${s}`;

  const [starting, setStarting] = useState<'ensaio' | 'agora' | null>(null);
  const start = async (how: 'ensaio' | 'agora') => {
    setStarting(how);
    try {
      await settings.mutateAsync(
        how === 'ensaio' ? { enabled: true, coverage: 'rehearsal' } : { enabled: true },
      );
      await progress.mutateAsync({ finished: true, part: 'comecar', step: 'pronto' });
      void qc.invalidateQueries({ queryKey: qk.session });
      haptic.commit();
      toast(how === 'ensaio' ? `${name} começou em ensaio` : `${name} está atendendo`);
      nav('/vendedor');
    } catch {
      setStarting(null);
    }
  };

  let guide: ReactNode = null;
  let body: ReactNode;
  switch (step) {
    case 'nome':
      guide = `Oi! Eu vou atender seus clientes no WhatsApp. Como você quer me chamar?`;
      body = (
        <NameStep
          ob={ob}
          draft={draft}
          setDraft={setDraft}
          eyebrow={eyebrow('1 de 2')}
          busy={settings.isPending}
          onNext={() => {
            const patch = {
              ...(draft.name.trim() !== ob.settings.name ? { name: draft.name.trim() } : {}),
              ...(draft.disclose !== ob.settings.disclose ? { disclose: draft.disclose } : {}),
              ...(draft.tone !== ob.settings.tone ? { tone: draft.tone } : {}),
            };
            if (!Object.keys(patch).length) return next('whatsapp');
            settings.mutate(patch, { onSuccess: () => next('whatsapp') });
          }}
        />
      );
      break;
    case 'whatsapp':
      guide = linked
        ? 'Já estou no WhatsApp da loja. Só um cuidado antes de seguir:'
        : 'Eu atendo pelo WhatsApp da loja. Vamos conectar?';
      body = (
        <WhatsappStep
          name={name}
          eyebrow={eyebrow('2 de 2')}
          back={back!}
          onNext={() => next('li')}
        />
      );
      break;
    case 'li':
      guide = left.length
        ? `Li sua loja. Quase tudo claro, só ${left.length === 1 ? '1 coisa' : `${left.length} coisas`}:`
        : 'Li sua loja. Está tudo claro!';
      body = (
        <ReadStep
          ob={ob}
          name={name}
          left={left}
          eyebrow={eyebrow('o que eu li')}
          back={back!}
          onNext={() => next('entrevista')}
          onLeave={(g) => progress.mutate({ skipped: withSkipped(skipped, [gapKey(g)]) })}
        />
      );
      break;
    case 'entrevista':
      guide = iv.done ? (
        'Anotei tudo! Confira o que eu aprendi, e seguimos.'
      ) : iv.waiting ? (
        <Dots name={name} />
      ) : iv.current ? (
        iv.current
      ) : (
        'Agora umas perguntas sobre o que só você sabe. Bem rápidas, prometo.'
      );
      body = (
        <InterviewStep
          ob={ob}
          name={name}
          eyebrow={eyebrow(iv.asked ? `pergunta ${iv.asked}` : 'a entrevista')}
          back={back!}
          onNext={() => (iv.done ? next('passar') : skip('entrevista', 'passar'))}
          onSkip={() => skip('entrevista', 'passar')}
        />
      );
      break;
    case 'passar':
      guide = 'E quando eu passo a conversa para você? Já deixei o mais comum ligado.';
      body = (
        <HandoffStep
          settings={ob.settings}
          name={name}
          eyebrow={eyebrow('quando passar para você')}
          back={back!}
          onNext={() => next('peca')}
        />
      );
      break;
    case 'peca':
      guide = 'Agora me teste: peça como se fosse um cliente. Nada vai para a cozinha.';
      body = (
        <OrderStep
          name={name}
          eyebrow={eyebrow('1 de 2')}
          back={back!}
          onNext={() => next('oculto', { tested: true })}
          onSkip={() => skip('peca', 'oculto')}
        />
      );
      break;
    case 'oculto':
      guide =
        'Agora clientes de teste pedem no seu cardápio. Pode seguir: eu termino enquanto você escolhe quando eu atendo.';
      body = (
        <OcultoStep
          name={name}
          eyebrow={eyebrow('2 de 2')}
          back={back!}
          onNext={() => next('quando')}
        />
      );
      break;
    case 'quando':
      guide = 'Por último: quando você quer que eu atenda?';
      body = (
        <WhenStep
          settings={ob.settings}
          name={name}
          eyebrow={eyebrow('quando atender')}
          back={back!}
          busy={settings.isPending}
          onNext={(p: { coverage: Coverage; slowAfterMin: 1 | 2 | 5 }) => {
            if (p.coverage === ob.settings.coverage && p.slowAfterMin === ob.settings.slowAfterMin)
              return next('pronto');
            settings.mutate(p, { onSuccess: () => next('pronto') });
          }}
        />
      );
      break;
    case 'pronto':
      body = (
        <Finale
          ob={ob}
          name={name}
          store={store}
          linked={linked}
          go={(s) => {
            setDetour(true);
            go(s);
          }}
          onStart={(how) => void start(how)}
          starting={starting}
        />
      );
      break;
  }

  // the preview shows her getting better: the greeting as chosen, then what she just learned
  const lines = previewLines(step, ob, step === 'nome' ? draft : { ...ob.settings }, store);
  const preview =
    step === 'peca' || step === 'pronto' ? null : (
      <MiniChat
        name={name}
        label={
          step === 'entrevista' && ob.proposals.length
            ? 'prévia com a sua resposta'
            : 'prévia no WhatsApp'
        }
        lines={lines}
      />
    );
  // on phones the first screen shows the preview up top: every answer there changes her greeting
  const topPreview = step === 'nome';
  // Peça para mim is the chat itself: wide screens get ideas of what to try beside it
  const side = preview ? (
    <section
      className="hidden lg:sticky lg:top-28 lg:block lg:self-start"
      aria-label={`prévia de ${articleOf(name)} ${name} no WhatsApp`}
    >
      <p className="t-label mb-3 text-center text-muted">No WhatsApp, ao vivo</p>
      {preview}
    </section>
  ) : step === 'peca' ? (
    <section
      aria-labelledby="tr-try"
      className="hidden rounded-lg bg-surface p-5 depth-1 lg:sticky lg:top-28 lg:block lg:self-start"
    >
      <h2 id="tr-try" className="t-label mb-3">
        Para testar de verdade
      </h2>
      <ul className="t-body space-y-2.5 text-muted">
        {TRY.map((t) => (
          <li key={t} className="flex gap-2.5">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-muted" />
            {t}
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  return (
    <div className="min-h-dvh overflow-x-clip">
      <AgentJourney
        name={name}
        part={PART_OF[step]}
        progress={fill}
        status={status}
        exit={<Exit done={step === 'pronto'} />}
      />
      <div
        className={cn(
          'mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-[calc(1rem+var(--kb,0px))] pt-6 md:px-8 md:pt-8',
          side && 'lg:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <div className={cn('mx-auto w-full max-w-xl space-y-6', side && 'lg:mx-0')}>
          {topPreview && preview ? <div className="lg:hidden">{preview}</div> : null}
          {guide ? (
            <AgentGuide
              name={name}
              turn={step === 'entrevista' ? `${step}-${iv.currentId}-${iv.waiting}` : step}
            >
              {guide}
            </AgentGuide>
          ) : null}

          {body}

          {preview && !topPreview ? (
            <div className="lg:hidden">
              <Button
                variant="secondary"
                block
                icon={peek ? <EyeSlash /> : <Eye />}
                aria-expanded={peek}
                aria-controls="tr-peek"
                onClick={() => setPeek((v) => !v)}
              >
                {peek ? 'fechar a prévia' : `espiar ${articleOf(name)} ${name}`}
              </Button>
              <div id="tr-peek" hidden={!peek} className="animate-fade-up mt-4">
                {peek ? preview : null}
              </div>
            </div>
          ) : null}
        </div>

        {side}
      </div>
    </div>
  );
}

const TRY = [
  'Peça meio a meio, ou mude de ideia no meio do pedido.',
  'Dê um endereço fora da sua área de entrega.',
  'Pague em dinheiro e peça troco.',
  'Pergunte algo que só você sabe responder.',
];

const PART_LABEL = {
  conhecer: 'Conhecer',
  ensinar: 'Ensinar',
  testar: 'Testar',
  comecar: 'Começar',
};

function previewLines(
  step: StepId,
  ob: VendedorOnboarding,
  persona: Persona,
  store: string,
): ChatLine[] {
  const delivers = ob.read.zones > 0;
  const hello: ChatLine[] = [
    { voice: 'in', text: 'oi, vocês entregam?' },
    { voice: 'seller', text: greetingPreview(persona, store, delivers) },
  ];
  if (step === 'entrevista') {
    const p = [...ob.proposals]
      .filter((x) => x.kind === 'answer' && x.question && x.answer)
      .sort((x, y) => y.at.localeCompare(x.at))[0];
    if (p)
      return [
        { voice: 'in', text: p.question!.toLowerCase().replace(/\?*$/, '?') },
        { voice: 'seller', text: p.answer! },
      ];
  }
  if (step === 'passar')
    return [
      { voice: 'in', text: 'isso tem lactose? sou alérgica' },
      {
        voice: 'seller',
        text: ob.settings.handoff.allergy
          ? 'Para alergia eu prefiro não arriscar: já chamei a equipe da loja, que te responde aqui mesmo.'
          : 'O cardápio não diz, então não posso garantir. Quer ver outra opção?',
      },
    ];
  return hello;
}

import { ArrowRight, Eye, EyeSlash, X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type StoreView } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, Loading, messageOf } from '../../ui/feedback.tsx';
import { toWeek } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Finale, type Pending } from './Finale.tsx';
import { Guide } from './Guide.tsx';
import { MiniStore, type Draft } from './MiniStore.tsx';
import { markLeft, readStep, saveStep } from './progress.ts';
import {
  HoursStep,
  HowStep,
  LogoStep,
  NameStep,
  PixStep,
  ProductsStep,
  TaglineStep,
  WhatsappStep,
  type StepProps,
} from './steps.tsx';

// The store builds itself (§6.8), told as a conversation: one question per screen, a
// friendly guide, and the store assembling in the phone beside it (behind "espiar" on
// phones). Every answer saves on "Continuar", so leaving halfway loses nothing.

const ORDER = [
  'oi',
  'nome',
  'logo',
  'whatsapp',
  'frase',
  'horarios',
  'como',
  'pix',
  'produtos',
  'pronto',
] as const;
type StepId = (typeof ORDER)[number];

const LINE: Record<StepId, string> = {
  oi: 'Vou montar a sua loja junto com você, sem pressa e sem palavra difícil.',
  nome: 'Primeiro o mais importante: o nome!',
  logo: 'Agora um rostinho para a loja.',
  whatsapp: 'Como os clientes vão falar com você?',
  frase: 'Quase lá! Um toque de personalidade.',
  horarios: 'Hora de dizer quando você trabalha.',
  como: 'Como o pedido chega até o cliente?',
  pix: 'Agora vamos cuidar do dinheiro.',
  produtos: 'A parte mais gostosa: o cardápio!',
  pronto: 'Olha só o que a gente fez juntos!',
};

export default function Onboarding() {
  const store = useQuery({ queryKey: qk.store, queryFn: api.store });
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  const session = useSession();
  // the store's settings are the manager's; an attendant would only hit "no permission" on every step
  if (!can(session.user.role, 'manager'))
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
  if (!store.data || !cat.data) {
    const error = store.error ?? cat.error;
    return (
      <div className="mx-auto max-w-lg p-6">
        {error ? (
          <ErrorState
            error={error}
            retry={() => {
              void store.refetch();
              void cat.refetch();
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
      products={cat.data.categories.flatMap((c) => c.products)}
      firstCategory={cat.data.categories[0]?.id ?? null}
      hasPix={!!pay.data?.pix}
    />
  );
}

function Flow({
  s,
  products,
  firstCategory,
  hasPix,
}: {
  s: StoreView;
  products: { id: string; name: string; priceCents: number; imageUrl: string | null }[];
  firstCategory: string | null;
  hasPix: boolean;
}) {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const storeId = session.store.id;
  const qc = useQueryClient();
  const steps = ORDER.filter((id) => owner || id !== 'pix');
  const [step, setStep] = useState<StepId>(() => {
    const saved = readStep(storeId) as StepId | null;
    return saved && saved !== 'pronto' && steps.includes(saved) ? saved : 'oi';
  });
  const [praise, setPraise] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: s.profile.name,
    tagline: s.profile.tagline ?? '',
    logoUrl: s.profile.logoUrl,
    week: toWeek(s.hours.windows),
    pickup: s.operations.pickupEnabled,
    delivery: s.operations.deliveryEnabled,
  }));
  const patch = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));

  const save = (body: Record<string, unknown>) =>
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
    );

  const at = steps.indexOf(step);
  const go = (to: StepId, p: string | null) => {
    setPraise(p);
    setStep(to);
    saveStep(storeId, to);
    window.scrollTo({ top: 0 });
  };
  const next = (p?: string) => go(steps[Math.min(at + 1, steps.length - 1)]!, p ?? null);
  const back = at > 1 ? () => go(steps[at - 1]!, null) : null;
  const props: StepProps = { s, draft, patch, save, next, back };

  const questions = steps.length - 2; // without the welcome and the finale
  const answered = Math.max(0, Math.min(at, questions));
  const first = session.user.name.trim().split(/\s+/)[0] ?? '';

  const pending: Pending[] = [
    ...(draft.logoUrl
      ? []
      : [{ id: 'logo', label: 'Colocar a logo da loja', href: '/loja#perfil' }]),
    ...(owner && !hasPix
      ? [{ id: 'pix', label: 'Cadastrar a chave Pix', href: '/pagamentos' }]
      : []),
    ...(products.length < 3
      ? [{ id: 'menu', label: 'Cadastrar mais produtos com foto', href: '/cardapio' }]
      : []),
  ];

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm md:px-8">
        <p className="font-display text-lg font-semibold">venduá</p>
        <div
          className="flex flex-1 items-center justify-center gap-3"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={questions}
          aria-valuenow={answered}
          aria-label="andamento"
        >
          <span className="h-2 w-full max-w-64 overflow-hidden rounded-full bg-line-strong">
            <span
              className="block h-full rounded-full bg-[var(--chart)] transition-[width] duration-(--duration-smooth) ease-(--ease-soft)"
              style={{ width: `${(answered / questions) * 100}%` }}
            />
          </span>
          <span className="t-caption tnum hidden text-muted sm:inline">
            {step === 'pronto'
              ? 'pronto!'
              : step === 'oi'
                ? 'começando'
                : `${answered} de ${questions}`}
          </span>
        </div>
        <Link
          to="/"
          onClick={() => markLeft(storeId)}
          className="t-label inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-muted hover:bg-hover"
          aria-label="sair e continuar depois"
        >
          <X className="size-5" /> <span className="hidden sm:inline">continuar depois</span>
        </Link>
      </header>

      <div
        className={cn(
          'mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-10 px-4 pb-24 pt-8 md:px-8',
          step !== 'pronto' && 'lg:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        <div className="mx-auto w-full max-w-xl space-y-8 lg:mx-0">
          <Guide turn={step}>
            {praise ? <strong className="mr-1">{praise}</strong> : null}
            {step === 'oi' ? `Oi, ${first}! Meu nome é Duá. ` : null}
            {LINE[step]}
          </Guide>

          {step === 'oi' ? (
            <div className="animate-fade-up space-y-6">
              <div>
                <h1 className="t-title-1 md:text-[2rem]">Vamos abrir a sua loja online?</h1>
                <p className="t-body-lg mt-2 text-muted">
                  São {questions} perguntinhas, uma de cada vez. Você vai ver a loja aparecendo{' '}
                  <span className="hidden lg:inline">ao lado</span>
                  <span className="lg:hidden">no botão &ldquo;espiar&rdquo;</span>. Se cansar, pode
                  sair: eu guardo tudo.
                </p>
              </div>
              <Button size="lg" block onClick={() => next()}>
                Bora começar <ArrowRight />
              </Button>
              <Link
                to="/"
                onClick={() => markLeft(storeId)}
                className="t-label flex min-h-12 items-center justify-center text-muted underline underline-offset-2"
              >
                já sei mexer, ir direto ao painel
              </Link>
            </div>
          ) : step === 'nome' ? (
            <NameStep {...props} back={null} />
          ) : step === 'logo' ? (
            <LogoStep {...props} />
          ) : step === 'whatsapp' ? (
            <WhatsappStep {...props} />
          ) : step === 'frase' ? (
            <TaglineStep {...props} />
          ) : step === 'horarios' ? (
            <HoursStep {...props} />
          ) : step === 'como' ? (
            <HowStep {...props} />
          ) : step === 'pix' ? (
            <PixStep hasPix={hasPix} next={next} back={back} />
          ) : step === 'produtos' ? (
            <ProductsStep
              products={products}
              firstCategory={firstCategory}
              next={next}
              back={back}
            />
          ) : (
            <Finale
              url={session.store.url}
              name={draft.name.trim() || s.profile.name}
              pending={pending}
            />
          )}

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
              {peek ? (
                <div className="animate-fade-up mt-4">
                  <MiniStore draft={draft} products={products} whatsapp={!!s.profile.whatsapp} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {step !== 'pronto' ? (
          <aside
            className="hidden lg:sticky lg:top-24 lg:block lg:self-start"
            aria-label="prévia da sua loja"
          >
            <p className="t-label mb-3 text-center text-muted">Sua loja, ao vivo</p>
            <MiniStore draft={draft} products={products} whatsapp={!!s.profile.whatsapp} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

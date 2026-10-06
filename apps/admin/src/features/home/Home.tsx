import {
  ArrowRight,
  Bell,
  BellSlash,
  CheckCircle,
  Circle,
  ClockCountdown,
  CloudWarning,
  Eye,
  Fire,
  Package,
  Pause,
  Play,
  CreditCard,
  Plugs,
  Printer,
  Receipt,
  ShieldWarning,
  ShoppingBag,
  Timer,
  UsersThree,
  Wallet,
  WarningCircle,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatTime } from '@vendua/kernel/rules';
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, type Home as HomeData } from '../../lib/api.ts';
import { ago, clock, greeting, money, moneyShort, num, plural } from '../../lib/format.ts';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { qk, useMutation } from '../../lib/query.ts';
import { can, useCan, useSession } from '../../lib/session.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { HelpButton } from '../../ui/Page.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { Celebration, markMilestone, unseenMilestone } from '../../ui/Celebration.tsx';
import { Sparkline } from '../../ui/charts.tsx';
import { cn } from '../../ui/cn.ts';
import { DuaNote, ErrorState, messageOf, Skeleton } from '../../ui/feedback.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { HeroCard, type DayPhase } from '../../ui/HeroCard.tsx';
import { Mascote, type Pose } from '../../ui/Mascote.tsx';
import { Odometer } from '../../ui/Odometer.tsx';
import { STATE_META } from '../../ui/StateChip.tsx';
import { toast } from '../../ui/Toast.tsx';
import { untilChange, useLiveState, usePollWhenOffline } from '../../lib/live.ts';
import { statusWords, useStoreQuery } from '../store/StatusPill.tsx';
import { BILLING_HOLD_TEXT, isBillingHold } from '../store/BillingHold.tsx';
import { StatusSheet } from '../store/StatusSheet.tsx';
import { DeviceCard } from './DeviceCard.tsx';
import { hasLeft } from '../onboarding/progress.ts';
import { usePreload } from '../../app/routes.ts';

export default function Home() {
  const s = useSession();
  const poll = usePollWhenOffline(60_000);
  const { data, error, refetch } = useQuery({
    queryKey: qk.home,
    queryFn: api.home,
    refetchInterval: (q) => {
      const flip = untilChange(q.state.data?.status.changesAt);
      return flip === false ? poll : poll === false ? flip : Math.min(flip, poll);
    },
  });
  const [milestone, setMilestone] = useState<number | null>(null);
  useEffect(() => {
    if (data) setMilestone(unseenMilestone(s.store.id, data.totalOrders));
  }, [data, s.store.id]);
  // an order step the app closed on before Core answered goes out now, without opening Pedidos
  useEffect(() => {
    try {
      if (localStorage.getItem('vendua.moves')) void import('../orders/transition.ts');
    } catch {
      /* private mode: nothing was kept */
    }
  }, []);

  // a store nobody has touched yet opens the step-by-step, and so does one fresh from signup that
  // never chose to leave it; "continuar depois" is kept by Core, so no device steers them back
  // (automated browsers skip it)
  const ob = data?.onboarding;
  if (
    data &&
    !navigator.webdriver &&
    can(s.user.role, 'manager') &&
    data.totalOrders === 0 &&
    !ob?.finished &&
    !ob?.dismissed &&
    (ob?.from === 'signup' || data.checklist.every((c) => !c.done)) &&
    !hasLeft(s.store.id)
  )
    return <Navigate to="/bem-vindo" replace />;

  if (error && !data)
    return (
      <div className="mx-auto max-w-[880px] p-4 md:p-8">
        <ErrorState error={error} retry={() => void refetch()} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-32 pt-3 md:px-8 md:pb-12 md:pt-8">
      <h1 className="sr-only">Início</h1>
      <div className="-mt-1 mb-1 flex justify-end md:-mt-4">
        <HelpButton className="-mr-2" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr] lg:items-start lg:gap-6">
        <div className="contents space-y-5 lg:block lg:space-y-6">
          {data ? <Hero data={data} /> : <Skeleton className="h-[340px] rounded-xl" delay={0} />}
          <Section title="Agora na loja" className="order-3 lg:order-none">
            <Presence />
            {data ? <Feed data={data} /> : <RowsSkeleton rows={4} trailing={false} />}
          </Section>
        </div>
        <div className="contents space-y-5 lg:block lg:space-y-6">
          <Section title="Precisa de você" className="order-1 lg:order-none">
            {data ? <Attention data={data} /> : <RowsSkeleton rows={2} />}
          </Section>
          <DeviceCard className="order-2 lg:order-none" />
          {data && data.checklist.some((c) => !c.done) ? (
            <div className="order-2 lg:order-none">
              <Checklist items={data.checklist} onboarding={data.onboarding} />
            </div>
          ) : null}
          <Section title="Mais vendidos hoje" className="order-4 lg:order-none">
            {data ? <Best data={data} /> : <RowsSkeleton rows={3} avatar={false} />}
          </Section>
        </div>
      </div>
      {milestone && data ? (
        <Celebration
          milestone={milestone}
          shareUrl={s.store.url}
          onClose={() => {
            markMilestone(s.store.id, milestone);
            setMilestone(null);
          }}
        />
      ) : null}
    </div>
  );
}

function phaseOf(d: HomeData): DayPhase {
  if (d.status.status === 'open') return 'open';
  if (d.status.status === 'paused') return 'paused';
  // closed: before today's first opening is dawn, after the last closing is dusk
  if (d.status.resumesAt) {
    const soon = new Date(d.status.resumesAt).getTime() - Date.now();
    const sameDay = new Date(d.status.resumesAt).toDateString() === new Date().toDateString();
    if (sameDay && soon < 10 * 3600_000) return 'dawn';
  }
  return 'dusk';
}

const HERO_POSE: Record<DayPhase, Pose> = {
  dawn: 'avatar-ola',
  open: 'avatar-feliz',
  paused: 'avatar-pensando',
  dusk: 'carinho',
};

function Hero({ data }: { data: HomeData }) {
  const store = useStoreQuery().data;
  // held for the first plan payment: "voltar agora" can't work, so say what can
  const hold = !!store?.status.billingHold;
  const owner = useCan('owner');
  const [sheet, setSheet] = useState<false | 'pause' | 'demand'>(false);
  const demand = store?.operations.demand === 'high';
  const qc = useQueryClient();
  const phase = phaseOf(data);
  const light = phase === 'dusk';
  const w = store ? statusWords(store.status, data.timezone) : null;
  const t = data.today;
  const delta = t.lastWeekSalesCents
    ? Math.round(((t.salesCents - t.lastWeekSalesCents) / t.lastWeekSalesCents) * 100)
    : null;
  const resume = useMutation({
    mutationFn: api.resume,
    onSuccess: (st) => {
      qc.setQueryData(qk.store, st);
      void qc.invalidateQueries({ queryKey: qk.home });
      toast('Loja aberta de novo ✓');
    },
    onError: (e) => {
      if (isBillingHold(e)) {
        void qc.invalidateQueries({ queryKey: qk.store });
        toast(BILLING_HOLD_TEXT, { tone: 'error', ms: 8000 });
      } else toast.error(messageOf(e));
    },
  });
  const muted = light ? 'text-[#c9d3cd]' : 'text-muted';
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (phase !== 'dawn' || !data.status.resumesAt) return;
    const tick = () => {
      const ms = new Date(data.status.resumesAt!).getTime() - Date.now();
      const h = Math.floor(ms / 3600_000);
      const m = Math.max(0, Math.round((ms % 3600_000) / 60_000));
      setCountdown(ms <= 0 ? 'abrindo…' : h ? `faltam ${h} h ${m} min` : `faltam ${m} min`);
    };
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, [phase, data.status.resumesAt]);

  return (
    <HeroCard phase={phase} className="order-0">
      <div className="flex items-start justify-between gap-4">
        <p className="t-moment">
          {greeting(data.timezone)}, {data.greetingName}
        </p>
        {/* Duá keeps the store company: waving before it opens, happy while it sells,
            thinking through a pause, resting after close — on a cream disc over the dark dusk */}
        <span
          className="dua-disc -mr-1 -mt-1 grid size-[76px] shrink-0 place-items-center"
          {...(light ? { 'data-dark': '' } : {})}
        >
          <Mascote pose={HERO_POSE[phase]} size={72} className="size-[72px]" />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {w ? (
          <button
            type="button"
            onClick={() => setSheet('pause')}
            className={cn(
              'press t-label inline-flex min-h-10 items-center gap-2 rounded-full px-3.5 ring-1',
              light ? 'bg-white/10 ring-white/20' : 'bg-surface/70 ring-line',
            )}
          >
            <span
              className={cn(
                'size-2 rounded-full',
                w.tone === 'open' ? 'bg-success' : w.tone === 'paused' ? 'bg-warning' : 'bg-faint',
              )}
            />
            {w.label}
          </button>
        ) : null}
        {phase === 'dawn' && countdown ? (
          <span className={cn('t-body', muted)}>{countdown}</span>
        ) : null}
        {hold ? (
          owner ? (
            <Link
              to="/conta"
              className="press t-label inline-flex min-h-10 items-center gap-1.5 rounded-full bg-warning-soft px-3.5 text-warning"
            >
              <CreditCard weight="bold" className="size-4" /> pagar o plano para abrir
            </Link>
          ) : (
            <span className="t-label inline-flex min-h-10 items-center gap-1.5 rounded-full bg-warning-soft px-3.5 text-warning">
              <CreditCard weight="bold" className="size-4" /> aguardando o pagamento do plano
            </span>
          )
        ) : phase === 'paused' ? (
          <button
            type="button"
            onClick={() => resume.mutate()}
            className="press t-label inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-3.5 text-on-primary"
          >
            <Play weight="fill" className="size-4" /> voltar agora
          </button>
        ) : phase === 'open' ? (
          <>
            <button
              type="button"
              onClick={() => setSheet('pause')}
              className={cn(
                'press t-label inline-flex min-h-10 items-center gap-1.5 rounded-full px-3',
                muted,
                'hover:bg-hover',
              )}
            >
              <Pause className="size-4" /> pausar
            </button>
            {store ? (
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setSheet('demand')}
                className={cn(
                  'press t-label inline-flex min-h-10 items-center gap-1.5 rounded-full px-3',
                  demand ? 'bg-warning-soft px-3.5 text-warning' : cn(muted, 'hover:bg-hover'),
                )}
              >
                <Fire weight={demand ? 'fill' : 'regular'} className="size-4" />
                {demand
                  ? `muitos pedidos${store.operations.demandUntil ? ` até ${formatTime(store.operations.demandUntil, data.timezone)}` : ''}`
                  : 'muitos pedidos?'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="mt-8 md:mt-10">
        <p className={cn('t-label', muted)}>{phase === 'dusk' ? 'Seu dia' : 'Vendas de hoje'}</p>
        <p className="t-hero mt-1 max-md:text-[2.75rem] max-md:leading-[3rem]">
          <Odometer cents={t.salesCents} />
        </p>
        {delta !== null ? (
          <p className={cn('t-body mt-1', muted)}>
            <span
              className={cn(
                'font-semibold',
                delta >= 0 ? (light ? 'text-[#8fe0b2]' : 'text-success') : '',
              )}
            >
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
            </span>{' '}
            vs. o mesmo dia da semana passada, até esta hora
          </p>
        ) : null}
      </div>

      <dl
        className="mt-6 grid grid-cols-3 gap-3 border-t pt-5"
        style={{ borderColor: light ? 'rgb(255 255 255 / .15)' : 'var(--line)' }}
      >
        <div>
          <dt className={cn('t-caption', muted)}>Pedidos</dt>
          <dd className="tnum font-display text-2xl font-semibold">{num(t.orders)}</dd>
        </div>
        <div>
          <dt className={cn('t-caption', muted)}>Ticket médio</dt>
          <dd className="tnum font-display text-2xl font-semibold">
            {t.orders ? moneyShort(t.avgTicketCents) : '—'}
          </dd>
        </div>
        <div>
          <dt className={cn('t-caption', muted)}>7 dias</dt>
          <dd>
            <Sparkline
              values={data.spark.map((p) => p.salesCents)}
              label={`vendas dos últimos 7 dias: ${data.spark.map((p) => money(p.salesCents)).join(', ')}`}
            />
          </dd>
        </div>
      </dl>

      {phase === 'dusk' && t.orders > 0 ? (
        <div className="mt-5 rounded-lg bg-white/8 p-4 ring-1 ring-white/15">
          <p className="t-label">Resumo do dia</p>
          <p className="t-body mt-1 text-[#c9d3cd]">
            {data.best[0] ? `Campeão: ${data.best[0].name} (${data.best[0].qty}). ` : ''}
            {data.busiest ? `Hora mais movimentada: ${data.busiest.hour}h. ` : ''}
            {t.lastWeekOrders
              ? `Na mesma ${new Date().toLocaleDateString('pt-BR', { weekday: 'long' })} passada: ${plural(t.lastWeekOrders, 'pedido', 'pedidos')}.`
              : ''}
          </p>
        </div>
      ) : null}

      {store ? (
        <StatusSheet
          open={!!sheet}
          onOpenChange={(v) => !v && setSheet(false)}
          store={store}
          {...(sheet === 'demand' ? { startWith: 'demand' as const } : {})}
        />
      ) : null}
    </HeroCard>
  );
}

type Tone = 'live' | 'warning' | 'danger' | 'info';
const ATTENTION: Record<string, { Icon: typeof Bell; tone: Tone; cta: string }> = {
  orders_waiting: { Icon: Bell, tone: 'live', cta: 'ver' },
  closed_with_orders: { Icon: Timer, tone: 'warning', cta: 'resolver' },
  pix_to_confirm: { Icon: Wallet, tone: 'warning', cta: 'conferir' },
  low_stock: { Icon: Package, tone: 'warning', cta: 'resolver' },
  waitlist: { Icon: UsersThree, tone: 'warning', cta: 'ver' },
  waitlist_open: { Icon: UsersThree, tone: 'info', cta: 'conectar' },
  alerts_failing: { Icon: BellSlash, tone: 'warning', cta: 'resolver' },
  mp_expiring: { Icon: ClockCountdown, tone: 'warning', cta: 'reconectar' },
  mp_disconnected: { Icon: Plugs, tone: 'danger', cta: 'reconectar' },
  mp_restricted: { Icon: ShieldWarning, tone: 'danger', cta: 'resolver' },
  billing_pending: { Icon: Receipt, tone: 'warning', cta: 'pagar' },
  billing_past_due: { Icon: WarningCircle, tone: 'danger', cta: 'pagar' },
  invoice_open: { Icon: Receipt, tone: 'warning', cta: 'pagar' },
  trial_ending: { Icon: ClockCountdown, tone: 'info', cta: 'escolher' },
  print_failed: { Icon: Printer, tone: 'warning', cta: 'resolver' },
  // our problem, not theirs: informative, never alarming
  incident: { Icon: CloudWarning, tone: 'info', cta: 'ver' },
};
const TONE_DISC: Record<Tone, string> = {
  live: 'bg-spark text-on-spark',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

function Attention({ data }: { data: HomeData }) {
  const items = data.attention.slice(0, 3);
  if (!items.length)
    return (
      <DuaNote pose="avatar-feliz" title="Tudo em dia">
        Nada esperando por você agora.
      </DuaNote>
    );
  return (
    <Card as="section" className="divide-y divide-line overflow-hidden">
      {items.map((a, i) => {
        const { Icon, tone, cta } = ATTENTION[a.kind] ?? {
          Icon: Bell,
          tone: 'warning',
          cta: 'resolver',
        };
        const urgent = tone === 'live';
        return (
          <Link
            key={i}
            to={a.href}
            className="press-row flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
          >
            <span
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full',
                TONE_DISC[tone],
              )}
            >
              <Icon weight="bold" className={cn('size-5', urgent && 'animate-ring')} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{a.title}</span>
              {a.detail ? <span className="t-caption block text-muted">{a.detail}</span> : null}
            </span>
            <span className="t-label inline-flex items-center gap-1 text-muted">
              {cta} <ArrowRight className="size-4" />
            </span>
          </Link>
        );
      })}
    </Card>
  );
}

function Checklist({
  items,
  onboarding,
}: {
  items: HomeData['checklist'];
  onboarding: HomeData['onboarding'] | undefined;
}) {
  const done = items.filter((i) => i.done).length;
  const pct = done / items.length;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <Card as="section" className="p-5" aria-label="deixe sua loja pronta">
      <div className="flex items-center gap-4">
        <svg
          viewBox="0 0 56 56"
          className="size-14 shrink-0 -rotate-90"
          role="img"
          aria-label={`${done} de ${items.length} passos prontos`}
        >
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke="var(--surface-sunken)"
            strokeWidth="6"
          />
          <circle
            cx="28"
            cy="28"
            r={r}
            fill="none"
            stroke="var(--chart)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${pct * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div>
          <p className="t-title-2">Deixe sua loja pronta</p>
          <p className="t-body text-muted">
            {done} de {items.length} passos
          </p>
        </div>
      </div>
      <ButtonLink to="/bem-vindo" variant="spark" block className="mt-4">
        {onboarding?.finished
          ? 'terminar o que falta'
          : onboarding?.step
            ? 'continuar o passo a passo'
            : 'fazer o passo a passo'}
      </ButtonLink>
      <ul className="mt-3 space-y-1">
        {items.map((i) => (
          <li key={i.id}>
            <Link
              to={i.href}
              className={cn(
                'press-row flex min-h-12 items-center gap-3 rounded-md px-2 hover:bg-hover',
                i.done && 'text-muted',
              )}
            >
              {i.done ? (
                <CheckCircle weight="fill" className="size-6 shrink-0 text-success" />
              ) : (
                <Circle className="size-6 shrink-0 text-faint" />
              )}
              <span className={cn('flex-1', i.done && 'line-through decoration-line-strong')}>
                {i.label}
              </span>
              {!i.done ? <ArrowRight className="size-4 text-muted" /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Feed({ data }: { data: HomeData }) {
  const preload = usePreload();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        <div className="flex items-center gap-3 p-4">
          <Eye weight="duotone" className="size-7 text-muted" />
          <div>
            <p className="tnum font-display text-2xl font-semibold">{num(data.live.visitors)}</p>
            <p className="t-caption text-muted">olhando a loja (30 min)</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-4">
          <ShoppingBag weight="duotone" className="size-7 text-muted" />
          <div>
            <p className="tnum font-display text-2xl font-semibold">{num(data.live.carts)}</p>
            <p className="t-caption text-muted">com sacola montada</p>
          </div>
        </div>
      </div>
      {data.feed.length ? (
        <ol className="divide-y divide-line">
          {data.feed.map((f, i) => {
            const m = STATE_META[f.to];
            return (
              <li key={i}>
                <Link
                  to={`/pedidos/${f.orderId}`}
                  {...preload(`/pedidos/${f.orderId}`)}
                  data-vt-src={`order:${f.orderId}`}
                  className="press-row flex min-h-16 items-center gap-3 px-4 py-2.5 hover:bg-hover"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-full"
                    style={{ background: `var(--st-${m.var})`, color: `var(--st-${m.var}-ink)` }}
                  >
                    <m.Icon weight="bold" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <strong>#{f.number}</strong> {f.name.split(' ')[0]} ·{' '}
                      {f.to === 'placed' ? 'pediu' : m.label.toLowerCase()}
                    </span>
                    <span className="t-caption text-muted">
                      {ago(f.at)} · {clock(f.at, data.timezone)}
                    </span>
                  </span>
                  <span className="tnum t-body shrink-0 text-muted">{money(f.totalCents)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="flex items-center gap-4 p-4 pr-5 text-muted">
          <span className="dua-disc grid size-[76px] shrink-0 place-items-center">
            <Mascote pose="sem-pedidos" size={72} className="size-[72px]" />
          </span>
          <p className="t-body">Os pedidos das últimas 24 horas aparecem aqui, na hora.</p>
        </div>
      )}
    </Card>
  );
}

function Best({ data }: { data: HomeData }) {
  if (!data.best.length)
    return (
      <DuaNote
        pose="catalogo"
        action={
          <ButtonLink to="/marketing#compartilhar" variant="secondary">
            compartilhar a loja
          </ButtonLink>
        }
      >
        Assim que sair o primeiro pedido do dia, os campeões aparecem aqui.
      </DuaNote>
    );
  return (
    <div className="grid grid-cols-3 gap-3">
      {data.best.map((b, i) => (
        <Card key={b.productId ?? i} className="overflow-hidden">
          <div className="relative aspect-[4/3] bg-sunken">
            {b.imageUrl ? (
              <img src={b.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <NoPhoto />
            )}
            <span className="tnum absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-surface text-sm font-bold depth-1">
              {i + 1}
            </span>
          </div>
          <div className="p-3">
            <p className="t-body line-clamp-2 font-semibold leading-snug">{b.name}</p>
            <p className="t-caption text-muted">{plural(b.qty, 'vendido', 'vendidos')}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

// Live from the admin stream: open storefront tabs, and sacolas with items touched in the last 30 min.
function Presence() {
  const { presence } = useLiveState();
  if (!presence) return null;
  return (
    <p
      className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 t-body text-muted"
      aria-live="polite"
      data-testid="presence"
    >
      <span className="inline-flex items-center gap-1.5">
        <Eye size={16} weight="duotone" aria-hidden />
        {presence.viewers === 0
          ? 'Ninguém olhando agora'
          : plural(presence.viewers, 'pessoa vendo a loja', 'pessoas vendo a loja')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <ShoppingBag size={16} weight="duotone" aria-hidden />
        {plural(presence.carts, 'sacola com itens', 'sacolas com itens')}
      </span>
    </p>
  );
}

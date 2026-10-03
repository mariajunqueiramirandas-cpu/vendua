import {
  CaretRight,
  ChartLineUp,
  ChatsCircle,
  ChatText,
  Detective,
  GearSix,
  HandPalm,
  MapPin,
  Receipt,
  Plus,
  Student,
  MaskHappy,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import { api, type VendedorHome as Data, type WaitingRow } from '../../lib/api.ts';
import { clock, minutesSince, money, num, plural } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Odometer } from '../../ui/Odometer.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { RowsSkeleton, StatTilesSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { PersonaAvatar, ReasonChip } from '../../ui/vendedor/index.ts';
import { COVERAGE_LABEL, FirstUse, useAgentSwitch } from './Home.parts.tsx';

export default function VendedorHome() {
  const session = useSession();
  const { data, error, refetch } = useQuery({
    queryKey: qk.vendedor.home,
    queryFn: api.vendedor.home,
  });
  const header = <PageHeader title="Duá" subtitle={session.store.name} />;
  if (!data)
    return (
      <PageBody>
        {header}
        {error ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : (
          <div className="space-y-4">
            <StatTilesSkeleton count={3} />
            <RowsSkeleton rows={3} />
          </div>
        )}
      </PageBody>
    );
  // never switched on: the first-use door (§3.1); switched off later: the home, paused (§3.2)
  const firstUse = !data.agent.enabled && !data.agent.enabledAt;
  return (
    <PageBody>
      {header}
      {firstUse ? (
        <FirstUse data={data} owner={session.user.role === 'owner'} />
      ) : (
        <Running data={data} />
      )}
    </PageBody>
  );
}

/** re-renders every 30 s so "esperando há 2 min" keeps counting */
function useMinuteTick() {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);
}

const seconds = (s: number | null) =>
  s === null ? '—' : s < 1 ? 'menos de 1 s' : `${num(Math.round(s))} s`;

function Running({ data }: { data: Data }) {
  const session = useSession();
  const manager = can(session.user.role, 'manager');
  useMinuteTick();
  const announce = useAnnouncer(data);
  return (
    <div className="space-y-8">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
        <Presence data={data} manager={manager} owner={session.user.role === 'owner'} />
        <Today data={data} />
      </div>
      <FirstSale data={data} storeId={session.store.id} />
      <Waiting data={data} />
      {data.agent.enabled && data.today.conversations === 0 && data.presence !== 'rehearsal' ? (
        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <p className="t-body min-w-0 flex-1 basis-60">
            Ninguém escreveu ainda hoje. O Duá responde assim que alguém chamar.
          </p>
          {manager ? (
            <ButtonLink to="/vendedor/testar" variant="secondary" icon={<ChatText />}>
              testar como cliente
            </ButtonLink>
          ) : null}
        </Card>
      ) : null}
      {data.whileAway.length || data.demand.unmet.length || data.demand.outOfZone.length ? (
        <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
          {data.whileAway.length ? <WhileAway data={data} /> : null}
          {data.demand.unmet.length || data.demand.outOfZone.length ? (
            <Demand data={data} manager={manager} />
          ) : null}
        </div>
      ) : null}
      <Shortcuts data={data} manager={manager} />
    </div>
  );
}

/** "Júlia precisa de você, alergia" and a new sale, said once each (sales-agent-ux §7). */
function useAnnouncer(data: Data) {
  const seen = useRef<Set<string> | null>(null);
  const sold = useRef(data.today.closedCents);
  const [text, setText] = useState('');
  useEffect(() => {
    const ids = new Set(data.waiting.map((w) => w.threadId));
    const prev = seen.current;
    seen.current = ids;
    const fresh = prev ? data.waiting.filter((w) => !prev.has(w.threadId)) : [];
    const sale = data.today.closedCents > sold.current ? data.today.closedCents - sold.current : 0;
    sold.current = data.today.closedCents;
    const parts = [
      ...fresh.map((w) => `${w.name} precisa de você${w.reason ? `, ${w.reason}` : ''}`),
      ...(sale ? [`O Duá vendeu mais ${money(sale)}`] : []),
    ];
    if (parts.length) setText(parts.join('. '));
  }, [data]);
  return text;
}

function Presence({ data, manager, owner }: { data: Data; manager: boolean; owner: boolean }) {
  const on = useAgentSwitch();
  const warn =
    data.presence === 'disconnected' || data.presence === 'budget' || data.presence === 'trouble';
  let title: string;
  let detail: ReactNode = null;
  let action: ReactNode = null;
  switch (data.presence) {
    case 'answering':
      title = 'O Duá está atendendo';
      detail = `${plural(data.active, 'conversa', 'conversas')} agora · responde em ${seconds(data.replyP50Sec)}`;
      break;
    case 'rehearsal':
      title = 'O Duá está em ensaio';
      detail = `escreveu ${plural(data.today.drafts, 'resposta', 'respostas')} hoje, sem mandar`;
      action = manager ? (
        <ButtonLink to="/vendedor/ensaio" variant="secondary" size="sm" className="h-12">
          ver ensaio
        </ButtonLink>
      ) : null;
      break;
    case 'covering':
      title = 'Você está atendendo';
      detail =
        data.agent.coverage === 'after_hours'
          ? 'o Duá entra quando a loja fechar'
          : `o Duá entra se você demorar ${data.agent.slowAfterMin} min`;
      break;
    case 'disconnected':
      title = 'O Duá parou: o WhatsApp da loja desconectou';
      action = manager ? (
        <ButtonLink to="/whatsapp" variant="secondary" size="sm" className="h-12">
          reconectar
        </ButtonLink>
      ) : null;
      break;
    case 'budget':
      title = 'O Duá está mandando o link da loja até o mês virar';
      action = owner ? (
        <ButtonLink to="/conta" variant="secondary" size="sm" className="h-12">
          ver limite
        </ButtonLink>
      ) : null;
      break;
    case 'trouble':
      title = 'O Duá está com instabilidade; as conversas foram para você';
      break;
    default:
      title = 'O Duá está pausado';
      detail = 'As conversas ficam com você.';
      action = owner ? (
        <Button
          variant="primary"
          size="sm"
          className="h-12"
          loading={on.isPending}
          onClick={() =>
            on.mutate({ enabled: true }, { onSuccess: () => toast('O Duá está ligado') })
          }
        >
          ligar
        </Button>
      ) : null;
  }
  const coverage = COVERAGE_LABEL[data.agent.coverage];
  const row = (
    <>
      <span className="t-label whitespace-nowrap">Quando atende</span>
      <span className="flex min-w-0 items-center gap-1 text-muted">
        <span className="truncate">{coverage}</span>
        {manager ? <CaretRight weight="bold" className="size-4 shrink-0" aria-hidden /> : null}
      </span>
    </>
  );
  return (
    <Card className="flex flex-col p-4">
      <div role="status" className="flex flex-1 items-center gap-4">
        <PersonaAvatar
          size="md"
          answering={data.presence === 'answering'}
          pose={warn ? 'avatar-ajuda' : undefined}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('t-title-2', warn && 'text-warning')}>{title}</p>
          {detail ? <p className="t-body text-muted">{detail}</p> : null}
        </div>
      </div>
      {action ? <div className="mt-3 flex justify-end">{action}</div> : null}
      {data.agent.enabled ? (
        manager ? (
          <Link
            to="/vendedor/configurar"
            className="press-row -mx-4 -mb-4 mt-3 flex min-h-13 items-center justify-between gap-3 rounded-b-lg border-t border-line px-4 hover:bg-hover"
          >
            {row}
          </Link>
        ) : (
          <div className="-mx-4 -mb-4 mt-3 flex min-h-13 items-center justify-between gap-3 border-t border-line px-4">
            {row}
          </div>
        )
      ) : null}
    </Card>
  );
}

function Today({ data }: { data: Data }) {
  const t = data.today;
  const conversion = t.conversion === null ? '—' : `${Math.round(t.conversion * 100)}%`;
  return (
    <Card className="p-4">
      <p className="t-caption text-muted">Vendido pelo Duá hoje</p>
      <Odometer cents={t.closedCents} className="t-display mt-1 tnum" />
      <p className="t-caption tnum text-muted">
        {plural(t.orders, 'pedido', 'pedidos')}
        {t.averageCents !== null ? ` · ticket médio ${money(t.averageCents)}` : ''}
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <Stat value={conversion} label="das conversas viraram pedido" />
        <Stat
          value={
            data.replyP50Sec !== null && data.replyP50Sec < 1 ? '< 1 s' : seconds(data.replyP50Sec)
          }
          label="para responder"
        />
        <Stat value={num(t.suggestionsTaken)} label="sugestões aceitas" />
      </dl>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse">
      <dt className="t-caption text-muted">{label}</dt>
      <dd className="tnum font-display text-[1.375rem] font-semibold leading-7">{value}</dd>
    </div>
  );
}

/** The first order Duá closes gets one moment (sales-agent-ux §6), once per device. */
function FirstSale({ data, storeId }: { data: Data; storeId: string }) {
  const key = `vendua-vendedor-first-sale:${storeId}`;
  const at = data.agent.firstSaleAt;
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return true;
    }
  });
  const fresh = !!at && Date.now() - new Date(at).getTime() < 24 * 3_600_000;
  useEffect(() => {
    if (!fresh || seen) return;
    try {
      localStorage.setItem(key, '1');
    } catch {
      // private mode: it shows again next time, which is fine
    }
  }, [fresh, seen, key]);
  if (!fresh || seen) return null;
  return (
    <Card className="flex items-center gap-4 bg-spark-soft p-5">
      <PersonaAvatar size="lg" pose="avatar-feliz" />
      <div className="min-w-0 flex-1">
        <p className="t-moment text-[1.75rem] leading-8">O Duá fez a primeira venda</p>
        <p className="t-caption text-muted">às {clock(at)}, no WhatsApp da loja.</p>
      </div>
      <Button variant="ghost" size="sm" className="h-12" onClick={() => setSeen(true)}>
        ok
      </Button>
    </Card>
  );
}

function initials(name: string) {
  const w = name.trim().split(/\s+/);
  return ((w[0]?.[0] ?? '') + (w.length > 1 ? (w[w.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function Waiting({ data }: { data: Data }) {
  const n = data.waiting.length;
  return (
    <Section
      id="precisa"
      title={
        <span className="inline-flex items-center gap-2">
          Precisa de você
          {n ? (
            <span className="tnum t-label grid h-6 min-w-6 place-items-center rounded-full bg-warning px-1.5 text-surface">
              {n}
            </span>
          ) : null}
        </span>
      }
    >
      {n ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.waiting.map((w) => (
              <WaitingItem key={w.threadId} w={w} />
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="t-body p-4 text-muted">
          Ninguém esperando por você agora. Quando alguém precisar, aparece aqui e no seu celular.
        </Card>
      )}
    </Section>
  );
}

function WaitingItem({ w }: { w: WaitingRow }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const preload = usePreload();
  const to = `/vendedor/conversas/${w.threadId}`;
  const min = Math.max(0, minutesSince(w.since));
  const take = useMutation({
    mutationFn: () => api.vendedor.take(w.threadId),
    onMutate: () => haptic.tick(),
    onSuccess: (d) => {
      qc.setQueryData(qk.vendedor.thread(w.threadId), d);
      void qc.invalidateQueries({ queryKey: qk.vendedor.home });
      void qc.invalidateQueries({ queryKey: qk.session });
      nav(to);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken t-label text-muted"
      >
        {initials(w.name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={to}
            {...preload(to)}
            className="min-w-0 truncate font-semibold underline-offset-2 hover:underline"
          >
            {w.name}
          </Link>
          {w.reason ? <ReasonChip reason={w.reason} /> : null}
        </div>
        {w.preview ? <p className="t-body mt-0.5 line-clamp-2 text-muted">“{w.preview}”</p> : null}
        <div className="mt-2 flex items-center justify-between gap-3">
          <time
            dateTime={w.since}
            className={cn('t-caption tnum', min >= 5 ? 'font-semibold text-warning' : 'text-muted')}
          >
            {min < 1 ? 'esperando agora' : `esperando há ${num(min)} min`}
          </time>
          <Button
            variant="secondary"
            size="sm"
            className="h-12"
            icon={<HandPalm weight="bold" />}
            loading={take.isPending}
            onClick={() => take.mutate()}
            aria-label={`assumir a conversa com ${w.name}`}
          >
            assumir
          </Button>
        </div>
      </div>
    </li>
  );
}

const night = (iso: string) => {
  const h = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso)),
  );
  return h >= 22 || h < 8;
};

// Core sends `scheduled_for::text` ("2026-10-04 12:00:00+00"): make it something Date reads
const scheduled = (s: string) => {
  const d = new Date(s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function WhileAway({ data }: { data: Data }) {
  const preload = usePreload();
  const rows = data.whileAway;
  const slept = rows.every((o) => night(o.placedAt));
  return (
    <Card className="p-4">
      <h2 className="t-moment text-[1.75rem] leading-8">
        {slept ? 'Enquanto você dormia' : 'Enquanto você estava fora'}
      </h2>
      <p className="t-caption mt-0.5 text-muted">
        O Duá fechou {plural(rows.length, 'pedido', 'pedidos')} sem precisar de você.
      </p>
      <ul className="-mx-4 -mb-4 mt-3 divide-y divide-line border-t border-line">
        {rows.map((o) => {
          const when = o.scheduledFor ? scheduled(o.scheduledFor) : null;
          return (
            <li key={o.orderId}>
              <Link
                to={`/pedidos/${o.orderId}`}
                {...preload(`/pedidos/${o.orderId}`)}
                data-vt-src={`order:${o.orderId}`}
                className="press-row flex min-h-13 items-center gap-3 px-4 py-2 hover:bg-hover"
              >
                <Receipt weight="duotone" className="size-5 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <strong>#{o.number}</strong> · {clock(o.placedAt)}
                  </span>
                  {when ? (
                    <span className="t-caption block truncate text-muted">
                      agendado para {clock(when)}
                    </span>
                  ) : null}
                </span>
                <span className="tnum t-body shrink-0 text-muted">{money(o.totalCents)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Core keeps demand terms folded (lowercase, no accents): show them as a word, not a slug
const term = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Demand({ data, manager }: { data: Data; manager: boolean }) {
  const { unmet, outOfZone } = data.demand;
  const top = Math.max(1, ...unmet.map((u) => u.count));
  return (
    <Card className="space-y-5 p-4">
      {unmet.length ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="t-label">Pediram e você não tem</h2>
            <span className="t-caption text-muted">esta semana</span>
          </div>
          <ul className="mt-3 space-y-2.5">
            {unmet.slice(0, 5).map((u) => (
              <li key={u.term}>
                <div className="t-body flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{term(u.term)}</span>
                  <span className="tnum shrink-0 font-semibold">
                    {num(u.count)}
                    <span className="sr-only"> {u.count === 1 ? 'pedido' : 'pedidos'}</span>
                  </span>
                </div>
                <span aria-hidden className="mt-1 block h-2 rounded-full bg-sunken noite:bg-line">
                  <span
                    className="block h-2 rounded-full bg-(--chart)"
                    style={{ width: `${Math.max(6, (u.count / top) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
          {manager ? (
            <ButtonLink
              to="/cardapio?novo=1"
              variant="secondary"
              size="sm"
              className="mt-3 h-12"
              icon={<Plus weight="bold" />}
            >
              adicionar ao cardápio
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
      {outOfZone.length ? (
        <div className={cn(unmet.length && 'border-t border-line pt-4')}>
          <h2 className="t-label">Pediram entrega onde você não entrega</h2>
          <dl className="t-body mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
            {outOfZone.slice(0, 5).map((z) => (
              <div key={z.term} className="contents">
                <dt className="truncate">{term(z.term)}</dt>
                <dd className="tnum text-right font-semibold">{num(z.count)}</dd>
              </div>
            ))}
          </dl>
          {manager ? (
            <ButtonLink
              to="/loja#entrega"
              variant="ghost"
              size="sm"
              className="-ml-3.5 mt-2 h-12"
              icon={<MapPin weight="bold" />}
            >
              ver no mapa
            </ButtonLink>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function Shortcuts({ data, manager }: { data: Data; manager: boolean }) {
  const preload = usePreload();
  const links: { to: string; label: string; hint: string; Icon: Icon; show: boolean }[] = [
    {
      to: '/vendedor/conversas',
      label: 'Conversas',
      hint: 'tudo o que ele está atendendo',
      Icon: ChatsCircle,
      show: true,
    },
    {
      to: '/vendedor/ensinar',
      label: 'Ensinar',
      hint: 'respostas e regras da loja',
      Icon: Student,
      show: manager,
    },
    {
      to: '/vendedor/ensaio',
      label: 'Ensaio',
      hint: 'o que ele diria, sem mandar',
      Icon: MaskHappy,
      show: manager,
    },
    {
      to: '/vendedor/cliente-oculto',
      label: 'Cliente oculto',
      hint: 'a nota no seu cardápio',
      Icon: Detective,
      show: manager,
    },
    {
      to: '/vendedor/resultados',
      label: 'Resultados',
      hint: 'o que ele vendeu',
      Icon: ChartLineUp,
      show: manager,
    },
    {
      to: '/vendedor/testar',
      label: 'Testar como cliente',
      hint: 'peça para ele, só você vê',
      Icon: ChatText,
      show: manager,
    },
    {
      to: '/vendedor/configurar',
      label: 'Configurar',
      hint: 'como o Duá fala e o que pode fazer',
      Icon: GearSix,
      show: manager,
    },
  ];
  return (
    <nav aria-label="Mais sobre o Duá">
      <ul className="grid gap-2 sm:grid-cols-2">
        {links
          .filter((l) => l.show)
          .map((l) => (
            <li key={l.to}>
              <Link
                to={l.to}
                {...preload(l.to)}
                className="press flex min-h-16 items-center gap-3 rounded-md bg-surface px-4 py-3 depth-1 hover:bg-hover"
              >
                <l.Icon weight="duotone" className="size-6 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.label}</span>
                  <span className="t-caption block truncate text-muted">{l.hint}</span>
                </span>
                <CaretRight weight="bold" className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
      </ul>
    </nav>
  );
}

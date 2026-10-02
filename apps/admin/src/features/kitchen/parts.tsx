import {
  ArrowsIn,
  ArrowsOut,
  Bag,
  CaretDown,
  CaretLeft,
  Check,
  Fire,
  GearSix,
  Keyboard,
  ListNumbers,
  Monitor,
  Moped,
  Plus,
  SpeakerHigh,
  SpeakerSlash,
  Stack,
  Trash,
  WarningOctagon,
  WifiSlash,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  Kitchen,
  KitchenStats,
  KitchenStation,
  KitchenTicket,
  PayMethod,
} from '../../lib/api.ts';
import { useLiveState } from '../../lib/live.ts';
import { readTheme, setTheme, type ThemePref } from '../../lib/theme.ts';
import { wakeLockSupported } from '../../lib/wakeLock.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Sparkline } from '../../ui/charts.tsx';
import { cn } from '../../ui/cn.ts';
import { Chips, CommitInput, Segmented, Toggle } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { useStations } from './data.ts';
import { minutes, type AllDayRow, type StationPick } from './model.ts';
import { useSecond } from './Ticket.tsx';
import { voiceSupported } from './voice.ts';

const hm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function Clock({ className }: { className?: string }) {
  const now = useSecond();
  return (
    <time className={cn('tnum font-display font-semibold', className)}>
      {hm.format(new Date(now))}
    </time>
  );
}

/** "ao vivo" while the stream is up; the kitchen must know when it's looking at old tickets */
export function LiveDot() {
  const live = useLiveState();
  const state = !live.online ? 'off' : live.streaming ? 'on' : 'wait';
  return (
    <span
      role="status"
      className={cn(
        't-caption inline-flex items-center gap-1.5 font-semibold',
        state === 'on' ? 'text-success' : state === 'wait' ? 'text-warning' : 'text-danger',
      )}
    >
      {state === 'off' ? (
        <WifiSlash weight="bold" className="size-4" aria-hidden />
      ) : (
        <span
          className={cn(
            'size-2.5 rounded-full',
            state === 'on' ? 'animate-pulse-dot bg-success' : 'bg-warning',
          )}
          aria-hidden
        />
      )}
      <span className={cn(state === 'on' && 'max-md:sr-only')}>
        {state === 'on' ? 'ao vivo' : state === 'wait' ? 'conectando' : 'sem conexão'}
      </span>
    </span>
  );
}

function Count({
  n,
  label,
  tone,
  pulse,
}: {
  n: number;
  label: string;
  tone: string;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        't-label inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full pl-1.5 pr-3.5',
        pulse && 'animate-pulse-dot',
      )}
      style={{ background: `var(--st-${tone})`, color: `var(--st-${tone}-ink)` }}
    >
      <span className="tnum grid h-7 min-w-7 place-items-center rounded-full bg-surface/70 px-1.5 font-display text-[1rem] font-bold noite:bg-bg/40">
        {n}
      </span>
      {label}
    </span>
  );
}

export function TopBar({
  station,
  counts,
  stats,
  allDay,
  sound,
  onStation,
  onAllDay,
  onSound,
  onSettings,
}: {
  station: string;
  counts: { queue: number; cooking: number; late: number };
  stats: KitchenStats | undefined;
  allDay: boolean;
  sound: boolean;
  onStation: () => void;
  onAllDay: () => void;
  onSound: () => void;
  onSettings: () => void;
}) {
  const hour = new Date().getHours();
  const hourly = stats?.hourly.slice(Math.max(0, hour - 7), hour + 1) ?? [];
  return (
    <header className="chrome sticky top-0 z-30 border-b border-line bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm">
      <div className="flex items-center gap-2 px-3 py-2 md:gap-3 md:px-4">
        <Link
          to="/pedidos"
          aria-label="sair da cozinha"
          className="press -ml-1 flex h-12 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-ink hover:bg-hover lg:pr-3"
        >
          <CaretLeft weight="bold" className="size-6" aria-hidden />
          <span className="t-label max-lg:sr-only">Pedidos</span>
        </Link>
        <h1 className="t-title-2 shrink-0 max-sm:sr-only">Cozinha</h1>
        <button
          type="button"
          onClick={onStation}
          className="press t-label inline-flex h-11 min-w-0 items-center gap-1.5 rounded-full bg-surface px-3.5 ring-1 ring-line-strong depth-1"
          aria-label={`estação desta tela: ${station}. trocar`}
        >
          <Stack weight="bold" className="size-5 shrink-0" aria-hidden />
          <span className="truncate">{station}</span>
          <CaretDown weight="bold" className="size-4 shrink-0" aria-hidden />
        </button>

        <div className="hidden min-w-0 flex-1 items-center gap-2 overflow-hidden md:flex">
          {counts.late ? (
            <span className="t-label inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-danger px-3.5 text-surface">
              <WarningOctagon weight="fill" className="size-5" aria-hidden />
              <span className="tnum font-display font-bold">{counts.late}</span>
              {counts.late === 1 ? 'atrasado' : 'atrasados'}
            </span>
          ) : null}
          <Count n={counts.queue} label="na fila" tone="aceito" />
          <Count n={counts.cooking} label="em preparo" tone="preparando" />
        </div>
        <div className="flex-1 md:hidden" />

        {stats && stats.readyToday ? (
          <div className="hidden items-center gap-4 min-[1400px]:flex">
            <dl className="flex items-center gap-4">
              <Stat label="tempo médio">
                {stats.avgMakeSeconds === null ? '—' : minutes(stats.avgMakeSeconds * 1000)}
              </Stat>
              <Stat label="no prazo">
                {stats.onTimeRate === null ? '—' : `${Math.round(stats.onTimeRate * 100)}%`}
              </Stat>
              <Stat label="prontos hoje">{stats.readyToday}</Stat>
            </dl>
            {hourly.length > 1 ? (
              <Sparkline
                values={hourly}
                className="w-24"
                label={`prontos por hora, das ${hour - hourly.length + 1}h às ${hour}h: ${hourly.join(', ')}`}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex shrink-0 flex-col items-end leading-none">
          <Clock className="text-[1.625rem] md:text-[2rem]" />
          <LiveDot />
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ToolButton
            on={allDay}
            onClick={onAllDay}
            label="tudo junto"
            className="max-[999px]:hidden"
          >
            <ListNumbers weight="bold" />
          </ToolButton>
          <ToolButton on={sound} onClick={onSound} label={sound ? 'som ligado' : 'som desligado'}>
            {sound ? <SpeakerHigh weight="bold" /> : <SpeakerSlash weight="bold" />}
          </ToolButton>
          <ToolButton onClick={onSettings} label="ajustes">
            <GearSix weight="bold" />
          </ToolButton>
        </div>
      </div>

      {/* phones and tablets: the counts get their own line */}
      <div className="scroll-row flex gap-2 px-3 pb-2 md:hidden">
        {counts.late ? (
          <span className="t-label inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-danger px-3.5 text-surface">
            <WarningOctagon weight="fill" className="size-5" aria-hidden />
            <span className="tnum font-display font-bold">{counts.late}</span>
            {counts.late === 1 ? 'atrasado' : 'atrasados'}
          </span>
        ) : null}
        <Count n={counts.queue} label="na fila" tone="aceito" />
        <Count n={counts.cooking} label="em preparo" tone="preparando" />
      </div>
    </header>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-end">
      <dt className="t-caption text-muted">{label}</dt>
      <dd className="tnum font-display text-[1.25rem] font-semibold leading-tight">{children}</dd>
    </div>
  );
}

/** a labelled tool: the label shows from desktop up, and names it everywhere (§2.2.7) */
function ToolButton({
  on,
  onClick,
  label,
  className,
  children,
}: {
  on?: boolean;
  onClick: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      {...(on === undefined ? {} : { 'aria-pressed': on })}
      className={cn(
        'press t-label inline-flex h-12 min-w-12 items-center justify-center gap-2 rounded-full px-3 ring-1 [&_svg]:size-5',
        on ? 'bg-spark-soft ring-spark' : 'ring-line hover:bg-hover',
        className,
      )}
    >
      {children}
      <span className="max-[1699px]:sr-only">{label}</span>
    </button>
  );
}

/** Orders still waiting for "aceitar": the kitchen can take them on itself. */
export function Incoming({
  tickets,
  now,
  acceptTarget,
  prepDefault,
  onAccept,
}: {
  tickets: KitchenTicket[];
  now: number;
  acceptTarget: number;
  prepDefault: number;
  onAccept: (t: KitchenTicket, prep: number) => void;
}) {
  if (!tickets.length) return null;
  const preps = [...new Set([15, 30, 45, prepDefault])].sort((a, b) => a - b).slice(0, 4);
  return (
    <section aria-label="aguardando aceite" className="border-b border-line bg-spark-soft/60">
      <div className="scroll-row flex items-stretch gap-3 px-3 py-3 md:px-4">
        <h2 className="t-label flex shrink-0 items-center gap-2 pr-1 text-[var(--st-novo-ink)]">
          <span className="animate-pulse-dot size-2.5 rounded-full bg-[var(--st-novo-ink)]" />
          Chegando
        </h2>
        {tickets.map((t) => {
          const age = Math.floor((now - Date.parse(t.placedAt)) / 60_000);
          const late = age >= acceptTarget;
          return (
            <article
              key={t.id}
              aria-label={`Pedido ${t.number} aguardando aceite`}
              className={cn(
                'animate-drop-in flex shrink-0 items-center gap-3 rounded-md bg-surface py-2 pl-3 pr-2 ring-1 depth-1',
                late ? 'ring-2 ring-warning' : 'ring-line',
              )}
            >
              <div className="min-w-0">
                <p className="tnum font-display text-[1.375rem] font-semibold leading-none">
                  #{t.number}
                </p>
                <p className={cn('t-caption mt-1', late ? 'font-bold text-warning' : 'text-muted')}>
                  {t.items.reduce((n, i) => n + i.qty, 0)} itens ·{' '}
                  {age < 1 ? 'agora' : `há ${age} min`}
                </p>
              </div>
              <div
                className="flex gap-1"
                role="group"
                aria-label={`aceitar #${t.number} com tempo de preparo`}
              >
                {preps.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onAccept(t, m)}
                    className={cn(
                      'press t-label grid h-12 min-w-12 place-items-center rounded-sm px-2 leading-none',
                      m === prepDefault
                        ? 'bg-primary text-on-primary'
                        : 'bg-sunken text-ink hover:bg-hover',
                    )}
                    aria-label={`aceitar com ${m} minutos`}
                  >
                    <span className="tnum font-display text-[1rem] font-bold">{m}</span>
                    <span className="text-[0.6875rem] font-semibold opacity-80">min</span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// what the counter takes when the customer comes in: "Cobrar na retirada: dinheiro"
const AT_COUNTER: Partial<Record<PayMethod, string>> = {
  cash: 'dinheiro',
  card_on_delivery: 'cartão',
  meal_voucher: 'vale-refeição',
  pix: 'Pix',
};

/** The pass: what's ready, waiting for the courier or the customer. */
export function ReadyList({
  tickets,
  now,
  onHandOff,
  className,
}: {
  tickets: KitchenTicket[];
  now: number;
  onHandOff: (t: KitchenTicket) => void;
  className?: string;
}) {
  return (
    <ul className={cn('space-y-2', className)}>
      {tickets.map((t) => {
        const wait = t.readyAt ? now - Date.parse(t.readyAt) : 0;
        const slow = wait > 10 * 60_000;
        const Icon = t.mode === 'delivery' ? Moped : Bag;
        return (
          <li
            key={t.id}
            className="animate-fade-up rounded-md bg-surface p-3 ring-1 ring-line depth-1"
          >
            <div className="flex items-center gap-3">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-full"
                style={{ background: 'var(--st-pronto)', color: 'var(--st-pronto-ink)' }}
              >
                <Icon weight="bold" className="size-6" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="tnum font-display text-[1.375rem] font-semibold leading-none">
                  #{t.number}
                  {t.name ? (
                    <span className="t-label ml-2 align-middle font-sans text-muted">{t.name}</span>
                  ) : null}
                </p>
                <p className={cn('t-caption mt-1', slow ? 'font-bold text-warning' : 'text-muted')}>
                  {t.mode === 'delivery' ? 'esperando o entregador' : 'esperando o cliente'} ·{' '}
                  {wait < 60_000 ? 'agora' : `há ${minutes(wait)}`}
                </p>
              </div>
            </div>
            {!t.paid && t.mode === 'pickup' && AT_COUNTER[t.payMethod] ? (
              <p className="t-caption mt-2 rounded-sm bg-warning-soft px-2 py-1 font-semibold text-warning">
                Cobrar na retirada: {AT_COUNTER[t.payMethod]}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => onHandOff(t)}
              className="press t-label mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-sunken hover:bg-hover"
            >
              <Check weight="bold" className="size-5" aria-hidden />
              {t.mode === 'delivery' ? 'saiu para entrega' : 'retirado'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Tudo junto": the open tickets folded into one prep list; tap a dish to find its tickets. */
export function AllDay({
  rows,
  focus,
  onFocus,
}: {
  rows: AllDayRow[];
  focus: string | null;
  onFocus: (key: string | null) => void;
}) {
  if (!rows.length)
    return <p className="t-body px-1 py-6 text-center text-muted">Nada para fazer agora.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const on = focus === r.key;
        return (
          <li key={r.key}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => onFocus(on ? null : r.key)}
              className={cn(
                'press-row flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left ring-1',
                on ? 'bg-spark-soft ring-spark' : 'bg-surface ring-line hover:bg-hover',
              )}
            >
              <span className="tnum grid h-10 min-w-10 shrink-0 place-items-center rounded-sm bg-ink px-1.5 font-display text-[1.25rem] font-bold text-surface">
                {r.qty}
              </span>
              <span className="min-w-0 flex-1 pt-0.5">
                <span className="block text-[1.0625rem] font-bold leading-snug">{r.name}</span>
                {r.variants.some((v) => v.label) ? (
                  <span className="mt-0.5 block space-y-0.5">
                    {r.variants.map((v) => (
                      <span key={v.label} className="t-caption block text-muted">
                        <span className="tnum font-bold text-ink">{v.qty}×</span>{' '}
                        {v.label || 'do jeito normal'}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="t-caption mt-0.5 block text-muted">
                  em {r.tickets.length} {r.tickets.length === 1 ? 'pedido' : 'pedidos'}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function TicketMenu({
  ticket,
  canEdit,
  onClose,
  onRush,
  onAllDone,
  onReset,
  onOpen,
}: {
  ticket: KitchenTicket | null;
  canEdit: boolean;
  onClose: () => void;
  onRush: (t: KitchenTicket) => void;
  onAllDone: (t: KitchenTicket) => void;
  onReset: (t: KitchenTicket) => void;
  onOpen: (t: KitchenTicket) => void;
}) {
  const t = ticket;
  const done = t ? t.items.filter((i) => i.doneAt).length : 0;
  return (
    <Sheet open={!!t} onOpenChange={(v) => !v && onClose()} title={t ? `Pedido #${t.number}` : ''}>
      {t ? (
        <div className="grid gap-2 pt-1">
          <Button
            variant={t.rush ? 'secondary' : 'primary'}
            size="lg"
            block
            icon={<Fire weight={t.rush ? 'regular' : 'fill'} />}
            onClick={() => onRush(t)}
          >
            {t.rush ? 'tirar a prioridade' : 'passar na frente (prioridade)'}
          </Button>
          {canEdit && done < t.items.length ? (
            <Button
              variant="secondary"
              size="lg"
              block
              icon={<Check />}
              onClick={() => onAllDone(t)}
            >
              marcar todos os itens como feitos
            </Button>
          ) : null}
          {canEdit && done ? (
            <Button variant="ghost" size="lg" block onClick={() => onReset(t)}>
              desmarcar os itens feitos
            </Button>
          ) : null}
          <Button variant="ghost" size="lg" block onClick={() => onOpen(t)}>
            ver o pedido completo
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

export function StationSheet({
  open,
  onOpenChange,
  kitchen,
  pick,
  onPick,
  canManage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kitchen: Kitchen | undefined;
  pick: StationPick;
  onPick: (s: StationPick) => void;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);
  const stations = kitchen?.stations ?? [];
  const pending = (s: StationPick) =>
    (kitchen?.tickets ?? [])
      .filter((t) => t.state === 'confirmed' || t.state === 'preparing')
      .flatMap((t) => t.items)
      .filter((i) => !i.doneAt && (s === 'all' || i.stationId === s || i.stationId === null))
      .reduce((n, i) => n + i.qty, 0);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Estações da cozinha' : 'O que esta tela mostra'}
      description={
        editing
          ? 'Cada categoria do cardápio vai para uma estação. O que não tiver estação aparece em todas.'
          : 'A escolha fica neste aparelho. Cada tela da cozinha pode mostrar uma estação.'
      }
      wide={editing}
    >
      {editing && kitchen ? (
        <StationEditor kitchen={kitchen} />
      ) : (
        <div className="grid gap-2 pt-1">
          {[{ id: 'all', name: 'Tudo (expedição)' }, ...stations].map((s) => {
            const on = pick === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  onPick(s.id);
                  onOpenChange(false);
                }}
                className={cn(
                  'press flex min-h-14 items-center gap-3 rounded-md px-4 text-left ring-1',
                  on ? 'bg-spark-soft ring-spark' : 'ring-line hover:bg-hover',
                )}
              >
                <span className="min-w-0 flex-1 font-semibold">{s.name}</span>
                <span className="t-caption tnum text-muted">{pending(s.id)} a fazer</span>
                {on ? <Check weight="bold" className="size-5" aria-hidden /> : null}
              </button>
            );
          })}
          {!stations.length ? (
            <p className="t-body mt-2 text-muted">
              Separe a cozinha em estações (Chapa, Fritura, Bar) e cada tela mostra só o que é dela.
              {canManage ? '' : ' Peça a quem gerencia a loja para criar.'}
            </p>
          ) : null}
          {canManage ? (
            <Button
              variant="secondary"
              size="lg"
              block
              className="mt-2"
              disabled={!kitchen}
              onClick={() => setEditing(true)}
            >
              {stations.length ? 'editar estações' : 'criar estações'}
            </Button>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

function StationEditor({ kitchen }: { kitchen: Kitchen }) {
  const save = useStations();
  const [draft, setDraft] = useState<KitchenStation[]>(kitchen.stations);
  const commit = (next: KitchenStation[], undo?: KitchenStation[]) => {
    setDraft(next);
    save.mutate(next, {
      onError: () => setDraft(kitchen.stations),
      ...(undo
        ? {
            onSuccess: () =>
              toast('Estação removida', {
                undo: () => {
                  setDraft(undo);
                  save.mutate(undo);
                },
              }),
          }
        : {}),
    });
  };
  const owner = (cat: string) => draft.find((s) => s.categoryIds.includes(cat));
  const toggle = (s: KitchenStation, cat: string) =>
    commit(
      draft.map((x) =>
        x.id === s.id
          ? {
              ...x,
              categoryIds: x.categoryIds.includes(cat)
                ? x.categoryIds.filter((c) => c !== cat)
                : [...x.categoryIds, cat],
            }
          : // a category lives in one station: picking it here takes it from the other
            { ...x, categoryIds: x.categoryIds.filter((c) => c !== cat) },
      ),
    );
  const names = ['Chapa', 'Fritura', 'Montagem', 'Bar', 'Sobremesas', 'Forno'];
  const nextName =
    names.find((n) => !draft.some((s) => s.name.toLowerCase() === n.toLowerCase())) ??
    `Estação ${draft.length + 1}`;
  return (
    <div className="space-y-4 pt-1">
      {draft.map((s) => (
        <section key={s.id} className="space-y-3 rounded-md bg-sunken/60 p-4">
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="t-label mb-1.5 block">Nome</span>
              <CommitInput
                value={s.name}
                maxLength={40}
                validate={(v) =>
                  !v.trim()
                    ? 'Dê um nome à estação.'
                    : draft.some(
                          (x) => x.id !== s.id && x.name.toLowerCase() === v.trim().toLowerCase(),
                        )
                      ? 'Já tem uma estação com esse nome.'
                      : null
                }
                onCommit={(name) => commit(draft.map((x) => (x.id === s.id ? { ...x, name } : x)))}
              />
            </label>
            <Button
              variant="ghost"
              className="text-danger!"
              icon={<Trash />}
              aria-label={`remover a estação ${s.name}`}
              onClick={() =>
                commit(
                  draft.filter((x) => x.id !== s.id),
                  draft,
                )
              }
            >
              <span className="max-sm:sr-only">remover</span>
            </Button>
          </div>
          <Chips
            multi
            label={`categorias da estação ${s.name}`}
            value={s.categoryIds}
            onChange={(cat) => toggle(s, cat)}
            options={kitchen.categories.map((c) => {
              const o = owner(c.id);
              return {
                value: c.id,
                label: o && o.id !== s.id ? `${c.name} · em ${o.name}` : c.name,
              };
            })}
          />
        </section>
      ))}
      {draft.length < 12 ? (
        <Button
          variant="secondary"
          size="lg"
          block
          icon={<Plus />}
          onClick={() =>
            commit([...draft, { id: crypto.randomUUID(), name: nextName, categoryIds: [] }])
          }
        >
          nova estação
        </Button>
      ) : null}
      {!kitchen.categories.length ? (
        <p className="t-body text-muted">
          Crie categorias no cardápio para dividir entre estações.
        </p>
      ) : null}
    </div>
  );
}

export function SettingsSheet({
  open,
  onOpenChange,
  voice,
  onVoice,
  awake,
  fullscreen,
  onFullscreen,
  onShortcuts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  voice: boolean;
  onVoice: (v: boolean) => void;
  awake: { on: boolean; toggle: () => void };
  fullscreen: boolean;
  onFullscreen: () => void;
  onShortcuts: () => void;
}) {
  const [theme, setThemeState] = useState<ThemePref>(readTheme);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ajustes da cozinha">
      <div className="space-y-1 pt-1">
        <Toggle
          checked={voice}
          onChange={onVoice}
          disabled={!voiceSupported()}
          label="Ler os pedidos em voz alta"
          description={
            voiceSupported()
              ? 'Quando um pedido entra na fila, a tela fala os itens.'
              : 'Este aparelho não tem voz.'
          }
        />
        {wakeLockSupported() ? (
          <Toggle
            checked={awake.on}
            onChange={awake.toggle}
            label="Manter a tela ligada"
            description="A tela não apaga enquanto a cozinha estiver aberta."
          />
        ) : null}
        <div className="py-3">
          <p className="mb-2 font-semibold">Cores</p>
          <Segmented
            label="cores"
            value={theme}
            onChange={(v) => {
              setThemeState(v);
              setTheme(v);
            }}
            options={[
              { value: 'noite', label: 'Noite' },
              { value: 'creme', label: 'Creme' },
              { value: 'system', label: 'Do aparelho' },
            ]}
          />
          <p className="t-caption mt-2 text-muted">Noite cansa menos a vista na cozinha.</p>
        </div>
        <div className="grid gap-2 pt-2">
          <Button
            variant="secondary"
            size="lg"
            block
            icon={fullscreen ? <ArrowsIn /> : <ArrowsOut />}
            onClick={onFullscreen}
          >
            {fullscreen ? 'sair da tela cheia' : 'tela cheia'}
          </Button>
          <ButtonLink to="/cozinha/painel" variant="secondary" size="lg" block icon={<Monitor />}>
            painel de retirada (TV)
          </ButtonLink>
          <Button
            variant="ghost"
            size="lg"
            block
            icon={<Keyboard />}
            onClick={onShortcuts}
            className="max-md:hidden"
          >
            atalhos do teclado
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

export const SHORTCUTS: [string, string][] = [
  ['1 – 9', 'escolher o pedido'],
  ['← →', 'pedido anterior / próximo'],
  ['↑ ↓', 'item anterior / próximo'],
  ['Espaço', 'marcar o item como feito'],
  ['Enter', 'começar / pronto'],
  ['Z', 'desfazer o último pronto'],
  ['P', 'prioridade'],
  ['T', 'tudo junto'],
  ['E', 'trocar a estação'],
  ['S', 'som'],
  ['F', 'tela cheia'],
  ['Esc', 'limpar a seleção'],
];

export function ShortcutsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Atalhos do teclado"
      description="Funcionam com teclado ou com um bump bar ligado no computador."
    >
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 pt-1">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="contents">
            <dt>
              <kbd className="t-label tnum inline-grid h-9 min-w-9 place-items-center rounded-sm bg-sunken px-2 ring-1 ring-line-strong">
                {k}
              </kbd>
            </dt>
            <dd className="t-body">{v}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

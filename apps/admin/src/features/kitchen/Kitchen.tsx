import { ListNumbers } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type KitchenItem, type KitchenTicket } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { markOrdersSeen } from '../../lib/live.ts';
import { useCan } from '../../lib/session.ts';
import { chimeLate, chimeTicket } from '../../lib/sound.ts';
import { useWakeLock } from '../../lib/wakeLock.ts';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { KitchenSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { useAdvance, useBumpQueue, useKitchen, useMarkItems, usePref, useRush } from './data.ts';
import { actionFor, allDay, byDue, itemsFor, spoken, timing, type StationPick } from './model.ts';
import {
  AllDay,
  Incoming,
  ReadyList,
  SettingsSheet,
  ShortcutsSheet,
  StationSheet,
  TicketMenu,
  TopBar,
} from './parts.tsx';
import { Ticket } from './Ticket.tsx';
import { hush, speak } from './voice.ts';

// Cozinha: the kitchen display. A full-screen board for a tablet on the wall or a TV over the
// pass. Tickets arrive as orders are accepted, oldest-due first; each item is tapped as it's made;
// "pronto" waits a few seconds with "desfazer" and then tells the customer. Stations split the
// work across screens, "tudo junto" folds every open ticket into one prep list, and a keyboard or
// bump bar drives it all without touching the glass.

type Tab = 'fila' | 'prontos' | 'junto';
type SheetId = 'station' | 'settings' | 'keys' | null;

const ARRIVING_MS = 60_000;

function useTicker(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useFullscreen() {
  const supported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;
  const [on, setOn] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const f = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else
      void document.documentElement
        .requestFullscreen?.()
        .catch(() => toast.error('Este aparelho não deixou abrir em tela cheia.'));
  }, []);
  return { on, toggle, supported };
}

export default function Kitchen() {
  const { data, error, refetch, isPending } = useKitchen();
  const nav = useNavigate();
  const canManage = useCan('manager');
  const [pref, setPref] = usePref<string>('vendua-kds-station', 'all');
  const [sound, setSound] = usePref('vendua-kds-sound', true);
  const [voice, setVoice] = usePref('vendua-kds-voice', false);
  const [allDayOn, setAllDayOn] = usePref('vendua-kds-allday', false);
  const awake = useWakeLock('vendua-kds-awake', true);
  const full = useFullscreen();
  const now = useTicker(10_000);
  const [tab, setTab] = useState<Tab>('fila');
  const [sheet, setSheet] = useState<SheetId>(null);
  const [menu, setMenu] = useState<KitchenTicket | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [keys, setKeys] = useState(false);
  const [arrived, setArrived] = useState<Record<string, number>>({});

  const stations = data?.stations ?? [];
  // a station removed elsewhere drops this screen back to everything
  const station: StationPick =
    pref === 'all' || !data || stations.some((s) => s.id === pref) ? pref : 'all';
  const stationLabel =
    station === 'all' ? 'Tudo' : (stations.find((s) => s.id === station)?.name ?? 'Tudo');
  const stationName = useCallback(
    (id: string | null) =>
      id ? (stations.find((s) => s.id === id)?.name ?? 'outra estação') : 'sem estação',
    [stations],
  );

  const tickets = data?.tickets ?? [];
  const incoming = useMemo(
    () =>
      tickets
        .filter((t) => t.state === 'placed')
        .sort((a, b) => a.placedAt.localeCompare(b.placedAt)),
    [tickets],
  );
  const queue = useMemo(() => {
    const ownDone = (t: KitchenTicket) => itemsFor(t, station).mine.every((i) => i.doneAt);
    return tickets
      .filter(
        (t) =>
          (t.state === 'confirmed' || t.state === 'preparing') &&
          itemsFor(t, station).mine.length > 0,
      )
      .sort((a, b) => {
        // at a station, tickets whose share is done step to the back
        const d = Number(ownDone(a)) - Number(ownDone(b));
        return station !== 'all' && d ? d : byDue(a, b);
      });
  }, [tickets, station]);
  const ready = useMemo(
    () =>
      tickets
        .filter((t) => t.state === 'ready')
        .sort((a, b) => (a.readyAt ?? '').localeCompare(b.readyAt ?? '')),
    [tickets],
  );
  const rows = useMemo(() => allDay(tickets, station), [tickets, station]);
  const counts = {
    queue: queue.filter((t) => t.state === 'confirmed').length,
    cooking: queue.filter((t) => t.state === 'preparing').length,
    late: queue.filter((t) => timing(t, now).urgency === 'late').length,
  };

  const marks = useMarkItems();
  const rush = useRush();
  const advance = useAdvance();
  // ids this screen moved itself: their arrival or exit is no news here
  const self = useRef(new Set<string>());
  const bumps = useBumpQueue((t) => {
    self.current.add(t.id);
    void advance.run(t, 'ready').catch(() => undefined);
  });

  // ── what's new, what's late, what was cancelled under the cook's hands ──
  const known = useRef<Set<string> | null>(null);
  const live = useRef({ sound, voice, station, queue });
  live.current = { sound, voice, station, queue };
  useEffect(() => {
    if (!data) return;
    const cooking = data.tickets.filter((t) => t.state === 'confirmed' || t.state === 'preparing');
    const ids = new Set(cooking.map((t) => t.id));
    if (!known.current) {
      known.current = ids;
      return;
    }
    const prev = known.current;
    known.current = ids;
    const fresh = cooking.filter((t) => !prev.has(t.id));
    if (fresh.length)
      setArrived((a) => ({ ...a, ...Object.fromEntries(fresh.map((t) => [t.id, Date.now()])) }));
    const news = fresh.filter(
      (t) => !self.current.has(t.id) && itemsFor(t, live.current.station).mine.length,
    );
    if (news.length) {
      if (live.current.sound) chimeTicket();
      haptic.newOrder();
      if (live.current.voice) news.forEach((t) => speak(spoken(t, live.current.station)));
    }
    for (const id of prev) {
      if (ids.has(id) || self.current.has(id)) continue;
      // gone without this screen moving it: ready elsewhere, or cancelled — find out which
      void api
        .order(id)
        .then(({ order }) => {
          if (order.state !== 'cancelled') return;
          toast.error(`Pedido #${order.number} foi cancelado. Pode parar o preparo.`);
          if (live.current.sound) chimeLate();
          if (live.current.voice) speak(`Atenção: pedido ${order.number} cancelado.`);
        })
        .catch(() => undefined);
    }
  }, [data]);

  useEffect(() => {
    const t = setInterval(() => {
      setArrived((a) => {
        const keep = Object.entries(a).filter(([, at]) => Date.now() - at < ARRIVING_MS);
        return keep.length === Object.keys(a).length ? a : Object.fromEntries(keep);
      });
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  const lateSeen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const check = () => {
      const late = live.current.queue.filter((t) => timing(t, Date.now()).urgency === 'late');
      // tickets already late when the screen opened don't ring
      if (!lateSeen.current) {
        if (!data) return;
        lateSeen.current = new Set(late.map((t) => t.id));
        return;
      }
      const newly = late.filter((t) => !lateSeen.current!.has(t.id));
      newly.forEach((t) => lateSeen.current!.add(t.id));
      if (!newly.length) return;
      if (live.current.sound) chimeLate();
      if (live.current.voice)
        speak(
          newly.length === 1
            ? `Pedido ${newly[0]!.number} atrasado.`
            : `${newly.length} pedidos atrasados.`,
        );
    };
    check();
    const t = setInterval(check, 5_000);
    return () => clearInterval(t);
  }, [data]);

  // on screen = seen: Pedidos' new-order chime stops repeating
  useEffect(() => {
    if (incoming.length && document.visibilityState === 'visible') markOrdersSeen();
  }, [incoming.length, data]);
  useEffect(() => () => hush(), []);

  // ── actions (stable, so the memoized tickets don't re-render on every tick) ──
  const act = useRef({ marks, rush, advance, bumps, station, nav });
  act.current = { marks, rush, advance, bumps, station, nav };
  const settle = (id: string) =>
    setArrived((a) => {
      if (!(id in a)) return a;
      const { [id]: _, ...rest } = a;
      return rest;
    });
  const onToggle = useCallback((t: KitchenTicket, items: KitchenItem[], done: boolean) => {
    settle(t.id);
    act.current.marks.mutate({ ticket: t, items: items.map((i) => i.id), done });
  }, []);
  const onAction = useCallback((t: KitchenTicket) => {
    const { station: s, advance: adv, bumps: b, marks: m } = act.current;
    const a = actionFor(t, s);
    if (!a) return;
    settle(t.id);
    if (a.kind === 'start') void adv.run(t, 'preparing').catch(() => undefined);
    else if (a.kind === 'mine')
      m.mutate({
        ticket: t,
        items: itemsFor(t, s)
          .mine.filter((i) => !i.doneAt)
          .map((i) => i.id),
        done: true,
      });
    else b.bump(t);
  }, []);
  const onUndo = useCallback((t: KitchenTicket) => {
    if (act.current.bumps.undo(t.id)) toast(`#${t.number} voltou para a fila`, { tone: 'info' });
  }, []);
  const onSelect = useCallback((t: KitchenTicket) => setSel(t.id), []);
  const onAccept = (t: KitchenTicket, prep: number) => {
    self.current.add(t.id);
    void advance.run(t, 'confirmed', prep).catch(() => undefined);
  };
  const onHandOff = (t: KitchenTicket) => {
    self.current.add(t.id);
    void advance
      .run(t, t.mode === 'delivery' ? 'out_for_delivery' : 'delivered')
      .catch(() => undefined);
  };

  // ── keyboard and bump bars (a key press also brings up the 1–9 slots) ──
  const allDayRef = useRef(allDayOn);
  allDayRef.current = allDayOn;
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const kb = useRef({ queue, sel, cursor, station });
  kb.current = { queue, sel, cursor, station };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable], [role="dialog"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const { queue: q, sel: s, cursor: c, station: st } = kb.current;
      const i = q.findIndex((t) => t.id === s);
      const cur = i >= 0 ? q[i]! : undefined;
      const mine = cur ? itemsFor(cur, st).mine : [];
      const pick = (n: number) => {
        const t = q[(n + q.length) % q.length];
        if (!t) return;
        setSel(t.id);
        setCursor(null);
        document
          .querySelector(`[data-ticket="${t.id}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      // a focused button already answers Enter and Space itself
      const onButton = !!target.closest('button, a');
      let handled = true;
      if (/^[1-9]$/.test(e.key)) pick(Number(e.key) - 1);
      else if (e.key === 'ArrowRight') pick(i + 1);
      else if (e.key === 'ArrowLeft') pick(i < 0 ? q.length - 1 : i - 1);
      else if (e.key === 'ArrowDown' && cur)
        setCursor(c === null ? 0 : Math.min(mine.length - 1, c + 1));
      else if (e.key === 'ArrowUp' && cur) setCursor(c === null ? 0 : Math.max(0, c - 1));
      else if (e.key === ' ' && cur && c !== null && !onButton) {
        const item = mine[c];
        if (item) onToggle(cur, [item], !item.doneAt);
      } else if (e.key === 'Enter' && !onButton) {
        const t = cur ?? q[0];
        if (t) onAction(t);
      } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
        if (act.current.bumps.undo())
          toast('Pronto desfeito: o pedido voltou para a fila', { tone: 'info' });
      } else if ((e.key === 'p' || e.key === 'P') && cur)
        act.current.rush.mutate({ ticket: cur, rush: !cur.rush });
      else if (e.key === 't' || e.key === 'T') setAllDayOn(!allDayRef.current);
      else if (e.key === 'e' || e.key === 'E') setSheet('station');
      else if (e.key === 's' || e.key === 'S') setSound(!soundRef.current);
      else if (e.key === 'f' || e.key === 'F') full.toggle();
      else if (e.key === '?') setSheet('keys');
      else if (e.key === 'Escape') {
        setSel(null);
        setCursor(null);
        setFocusKey(null);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        setKeys(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // everything it reads lives in refs; the setters are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (sel && !queue.some((t) => t.id === sel)) setSel(null);
  }, [queue, sel]);

  const grid = (
    <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,310px),1fr))] md:gap-4">
      {queue.map((t, k) => (
        <Ticket
          key={t.id}
          ticket={t}
          station={station}
          stationName={stationName}
          slot={keys && k < 9 ? k + 1 : undefined}
          selected={sel === t.id && keys}
          cursor={sel === t.id ? cursor : null}
          arriving={t.id in arrived}
          focusKey={focusKey}
          bumpAt={bumps.pending[t.id]}
          onToggle={onToggle}
          onAction={onAction}
          onMore={setMenu}
          onUndo={onUndo}
          onSelect={onSelect}
        />
      ))}
    </div>
  );

  const emptyQueue = (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <Mascote pose="sucesso" size={150} />
      <p className="t-title-1 mt-4">Cozinha em dia</p>
      <p className="t-body-lg mt-2 max-w-md text-muted">
        {station === 'all'
          ? 'Quando um pedido for aceito, ele aparece aqui na hora, com o tempo correndo.'
          : `Quando chegar algo para ${stationLabel}, aparece aqui na hora.`}
      </p>
      {data?.stats.readyToday ? (
        <p className="t-label mt-4 rounded-full bg-success-soft px-4 py-2 text-success">
          {data.stats.readyToday}{' '}
          {data.stats.readyToday === 1 ? 'pedido pronto' : 'pedidos prontos'} hoje
        </p>
      ) : null}
    </div>
  );

  const readyEmpty = (
    <p className="t-body px-1 py-6 text-center text-muted">Nada esperando no balcão.</p>
  );

  return (
    <div className="flex min-h-dvh flex-col min-[1000px]:h-dvh min-[1000px]:overflow-hidden">
      <TopBar
        station={stationLabel}
        counts={counts}
        stats={data?.stats}
        allDay={allDayOn}
        sound={sound}
        onStation={() => setSheet('station')}
        onAllDay={() => setAllDayOn(!allDayOn)}
        onSound={() => setSound(!sound)}
        onSettings={() => setSheet('settings')}
      />
      <Incoming
        tickets={incoming}
        now={now}
        acceptTarget={data?.acceptTargetMinutes ?? 5}
        prepDefault={data?.prepDefaultMinutes ?? 30}
        onAccept={onAccept}
      />

      {isPending ? (
        <KitchenSkeleton />
      ) : error && !data ? (
        <div className="mx-auto w-full max-w-lg p-6">
          <ErrorState error={error} retry={() => void refetch()} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {allDayOn ? (
            <aside
              aria-label="tudo junto"
              className="hidden w-[300px] shrink-0 overflow-y-auto border-r border-line bg-sunken/40 p-3 min-[1000px]:block"
            >
              <h2 className="t-label mb-2 flex items-center gap-2 px-1">
                <ListNumbers weight="bold" className="size-5" aria-hidden /> Tudo junto
              </h2>
              <AllDay rows={rows} focus={focusKey} onFocus={setFocusKey} />
            </aside>
          ) : null}

          <main
            id="cozinha"
            aria-label="pedidos na cozinha"
            className="min-w-0 flex-1 p-3 md:p-4 min-[1000px]:overflow-y-auto"
          >
            <Segmented
              label="o que mostrar"
              value={tab}
              onChange={setTab}
              className="mb-3 min-[1000px]:hidden"
              options={[
                { value: 'fila', label: 'Fila', count: queue.length },
                { value: 'prontos', label: 'Prontos', count: ready.length },
                { value: 'junto', label: 'Tudo junto' },
              ]}
            />
            <div className={cn(tab !== 'fila' && 'max-[999px]:hidden')}>
              {queue.length ? grid : emptyQueue}
            </div>
            <div className={cn('min-[1000px]:hidden', tab !== 'prontos' && 'hidden')}>
              {ready.length ? (
                <ReadyList
                  tickets={ready}
                  now={now}
                  onHandOff={onHandOff}
                  className="grid gap-3 space-y-0 md:grid-cols-2"
                />
              ) : (
                readyEmpty
              )}
            </div>
            <div className={cn('min-[1000px]:hidden', tab !== 'junto' && 'hidden')}>
              <AllDay
                rows={rows}
                focus={focusKey}
                onFocus={(k) => {
                  setFocusKey(k);
                  if (k) setTab('fila');
                }}
              />
            </div>
          </main>

          <aside
            aria-label="prontos"
            className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line bg-sunken/40 p-3 min-[1000px]:block"
          >
            <h2 className="t-label mb-2 flex items-center justify-between px-1">
              Prontos no balcão
              <span
                className="tnum rounded-full px-2"
                style={{ background: 'var(--st-pronto)', color: 'var(--st-pronto-ink)' }}
              >
                {ready.length}
              </span>
            </h2>
            {ready.length ? (
              <ReadyList tickets={ready} now={now} onHandOff={onHandOff} />
            ) : (
              readyEmpty
            )}
          </aside>
        </div>
      )}

      {focusKey ? (
        <button
          type="button"
          onClick={() => setFocusKey(null)}
          className="press t-label fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-5 py-3 text-surface depth-3"
        >
          mostrando só “{rows.find((r) => r.key === focusKey)?.name ?? ''}” · ver tudo
        </button>
      ) : null}

      <TicketMenu
        ticket={menu}
        canEdit={!!menu && (menu.state === 'confirmed' || menu.state === 'preparing')}
        onClose={() => setMenu(null)}
        onRush={(t) => {
          rush.mutate({ ticket: t, rush: !t.rush });
          setMenu(null);
        }}
        onAllDone={(t) => {
          onToggle(
            t,
            t.items.filter((i) => !i.doneAt),
            true,
          );
          setMenu(null);
        }}
        onReset={(t) => {
          onToggle(
            t,
            t.items.filter((i) => i.doneAt),
            false,
          );
          setMenu(null);
        }}
        onOpen={(t) => nav(`/pedidos/${t.id}`)}
      />
      <StationSheet
        open={sheet === 'station'}
        onOpenChange={(v) => setSheet(v ? 'station' : null)}
        kitchen={data}
        pick={station}
        onPick={(s) => {
          setPref(s);
          setFocusKey(null);
        }}
        canManage={canManage}
      />
      <SettingsSheet
        open={sheet === 'settings'}
        onOpenChange={(v) => setSheet(v ? 'settings' : null)}
        voice={voice}
        onVoice={(v) => {
          setVoice(v);
          if (v) speak('A voz da cozinha está ligada.');
        }}
        awake={awake}
        fullscreen={full.on}
        onFullscreen={
          full.supported ? full.toggle : () => toast.error('Este aparelho não tem tela cheia.')
        }
        onShortcuts={() => setSheet('keys')}
      />
      <ShortcutsSheet open={sheet === 'keys'} onOpenChange={(v) => setSheet(v ? 'keys' : null)} />
    </div>
  );
}

import { CaretLeft, GearSix, Moped, SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KitchenTicket } from '../../lib/api.ts';
import { setSoundOn } from '../../lib/live.ts';
import { isPlanRequired, useFeature, useSession } from '../../lib/session.ts';
import { chimeCall, unlockAudio } from '../../lib/sound.ts';
import { useWakeLock } from '../../lib/wakeLock.ts';
import { StoreAvatar } from '../../app/StoreAvatar.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Toggle } from '../../ui/fields.tsx';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { KitchenSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { useKitchen, usePref } from './data.ts';
import { Clock, LiveDot } from './parts.tsx';
import { hush, speak, voiceSupported } from './voice.ts';

// Painel de retirada: a TV facing the customers. Numbers being made on one side, numbers ready
// on the other; when one turns ready it takes the whole screen for a moment, with a ding-dong
// and the number called out loud. Order numbers only, unless the store chooses first names.

const SPOTLIGHT_MS = 7_000;
const MAX_READY = 12;

export default function Pickup() {
  return useFeature('kds') ? (
    <PickupPanel />
  ) : (
    <LockedPage title="Painel de retirada" feature="kds" />
  );
}

function PickupPanel() {
  const { data, error, refetch, isPending } = useKitchen();
  const s = useSession();
  const [deliveries, setDeliveries] = usePref('vendua-painel-entregas', false);
  const [names, setNames] = usePref('vendua-painel-nomes', false);
  const [call, setCall] = usePref('vendua-painel-chamar', true);
  const [settings, setSettings] = useState(false);
  const [armed, setArmed] = useState(false);
  useWakeLock('vendua-painel-awake', true);

  // a screen the customers see doesn't chime for new orders: that's the kitchen's job
  useEffect(() => {
    setSoundOn(false);
    return () => {
      setSoundOn(s.user.prefs.sound !== false);
      hush();
    };
  }, [s.user.prefs.sound]);
  useEffect(() => {
    const arm = () => {
      unlockAudio();
      setArmed(true);
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  const shown = (t: KitchenTicket) => deliveries || t.mode === 'pickup';
  const tickets = data?.tickets ?? [];
  const making = useMemo(
    () =>
      tickets
        .filter((t) => (t.state === 'confirmed' || t.state === 'preparing') && shown(t))
        .sort((a, b) => a.number - b.number),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, deliveries],
  );
  const ready = useMemo(
    () =>
      tickets
        .filter((t) => t.state === 'ready' && shown(t))
        .sort((a, b) => (b.readyAt ?? '').localeCompare(a.readyAt ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, deliveries],
  );

  // newly ready numbers take the stage one at a time
  const [stage, setStage] = useState<KitchenTicket | null>(null);
  const line = useRef<KitchenTicket[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const prefs = useRef({ call, names });
  prefs.current = { call, names };
  useEffect(() => {
    if (!data) return;
    const ids = new Set(ready.map((t) => t.id));
    if (!seen.current) {
      seen.current = ids;
      return;
    }
    const fresh = ready.filter((t) => !seen.current!.has(t.id)).reverse();
    seen.current = new Set([...seen.current, ...ids]);
    line.current.push(...fresh);
    if (!stage) setStage(line.current.shift() ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    if (!stage) return;
    if (prefs.current.call) {
      chimeCall();
      const who = prefs.current.names && stage.name ? `, ${stage.name}` : '';
      window.setTimeout(
        () => speak(`Pedido ${stage.number}${who}. Pronto para retirada!`, { rate: 0.95 }),
        900,
      );
    }
    const t = window.setTimeout(() => setStage(line.current.shift() ?? null), SPOTLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [stage]);

  if (isPending) return <KitchenSkeleton pickup />;
  if (error && !data)
    return (
      <div className="mx-auto max-w-lg p-6">
        {isPlanRequired(error) ? (
          <PlanLocked feature="kds" reason={reasonOf(error)} refresh />
        ) : (
          <ErrorState error={error} retry={() => void refetch()} />
        )}
      </div>
    );

  const label = (t: KitchenTicket) => (names && t.name ? t.name : null);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+12px)] md:gap-4 md:px-8 md:pt-6">
        <Link
          to="/cozinha"
          aria-label="voltar para a cozinha"
          className="press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-hover"
        >
          <CaretLeft weight="bold" className="size-6" />
        </Link>
        <span className="max-sm:hidden">
          <StoreAvatar size={48} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="t-title-2 truncate md:t-title-1">{s.store.name}</h1>
          <p className="t-body text-muted max-sm:hidden">Acompanhe seu pedido</p>
        </div>
        <div className="flex flex-col items-end leading-none">
          <Clock className="text-[1.5rem] md:text-[2.75rem]" />
          <LiveDot />
        </div>
        <button
          type="button"
          onClick={() => setSettings(true)}
          aria-label="ajustes do painel"
          title="ajustes do painel"
          className="press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-hover"
        >
          <GearSix weight="bold" className="size-6" />
        </button>
      </header>

      <div className="grid flex-1 gap-4 p-4 md:grid-cols-[2fr_3fr] md:gap-6 md:p-8 md:pt-4">
        <section
          aria-label="preparando"
          className="flex flex-col rounded-xl bg-surface p-5 ring-1 ring-line depth-1 md:p-7"
        >
          <h2 className="t-title-1 mb-5 flex items-center gap-3 text-muted">
            <span
              className="size-3 rounded-full"
              style={{ background: 'var(--st-preparando-ink)' }}
              aria-hidden
            />
            Preparando
          </h2>
          {making.length ? (
            <ul className="grid content-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(130px,1fr))]">
              {making.map((t) => (
                <li
                  key={t.id}
                  className="animate-fade-up flex flex-col items-center justify-center rounded-lg bg-sunken px-3 py-4"
                >
                  <Num t={t} className="text-[2.75rem] md:text-[3.25rem]" />
                  {label(t) ? (
                    <span className="t-body-lg truncate text-muted">{label(t)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-body-lg text-muted">Nenhum pedido no fogo agora.</p>
          )}
        </section>

        <section
          aria-label="pronto, pode retirar"
          aria-live="polite"
          className="flex flex-col rounded-xl p-5 ring-1 ring-line depth-1 md:p-7"
          style={{ background: 'var(--st-pronto)', color: 'var(--st-pronto-ink)' }}
        >
          <h2 className="t-title-1 mb-5 flex items-center gap-3">
            <span className="animate-pulse-dot size-3 rounded-full bg-current" aria-hidden />
            Pronto · pode retirar
          </h2>
          {ready.length ? (
            <ul className="grid content-start gap-4 [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))]">
              {ready.slice(0, MAX_READY).map((t, k) => (
                <li
                  key={t.id}
                  className={cn(
                    'animate-call-in flex flex-col items-center justify-center rounded-lg bg-surface px-3 py-5 text-ink depth-2',
                    k === 0 && 'ring-4 ring-spark',
                  )}
                >
                  <Num t={t} className="text-[3.5rem] md:text-[4.5rem]" />
                  {label(t) ? <span className="t-title-2 truncate">{label(t)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="t-body-lg opacity-80">Os números aparecem aqui quando ficam prontos.</p>
          )}
        </section>
      </div>

      {stage ? (
        <div
          role="alert"
          className="animate-fade-up absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-spark p-6 text-center text-on-spark"
        >
          <p className="font-display text-[clamp(1.75rem,4vw,3.25rem)] font-semibold">
            Pronto para retirada
          </p>
          <p
            key={stage.id}
            className="animate-call-in tnum font-display font-bold leading-none tracking-tight text-[clamp(7rem,28vw,22rem)]"
          >
            {stage.number}
          </p>
          {label(stage) ? <p className="t-display">{label(stage)}</p> : null}
        </div>
      ) : null}

      {call && !armed ? (
        <button
          type="button"
          onClick={() => {
            unlockAudio();
            setArmed(true);
            if (voiceSupported()) speak('Som ligado.');
          }}
          className="press t-label fixed bottom-[calc(16px+env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 py-3 text-surface depth-3"
        >
          <SpeakerHigh weight="bold" className="size-5" aria-hidden />
          toque para ligar o som das chamadas
        </button>
      ) : null}

      <Sheet open={settings} onOpenChange={setSettings} title="Ajustes do painel">
        <div className="space-y-1 pt-1">
          <Toggle
            checked={call}
            onChange={setCall}
            label="Chamar os números"
            description="Toca um aviso e fala o número quando o pedido fica pronto."
          />
          <Toggle
            checked={names}
            onChange={setNames}
            label="Mostrar o primeiro nome"
            description="Só o primeiro nome do cliente, junto do número."
          />
          <Toggle
            checked={deliveries}
            onChange={setDeliveries}
            label="Mostrar entregas também"
            description="Para o entregador ver os pedidos dele. Aparecem com uma motinho."
          />
        </div>
      </Sheet>
    </div>
  );
}

function Num({ t, className }: { t: KitchenTicket; className?: string }) {
  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-2 font-display font-bold leading-none',
        className,
      )}
    >
      {t.mode === 'delivery' ? (
        <Moped weight="bold" className="size-[0.5em] shrink-0" aria-label="entrega" />
      ) : null}
      {t.number}
    </span>
  );
}

import { platform } from '../../platform/index.ts';
import {
  ArrowRight,
  ArrowSquareOut,
  Check,
  CreditCard,
  Crosshair,
  DownloadSimple,
  ForkKnife,
  LockSimple,
  MapPin,
  Money,
  Motorcycle,
  Path,
  PixLogo,
  Signpost,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_TOKENS, paletteFrom, readableAccent } from '@vendua/templates';
import { whatsappDigits } from '@vendua/kernel/rules';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type Payments,
  type PayMethod,
  type StoreTokens,
  type StoreView,
} from '../../lib/api.ts';
import { maskCep, money, phone as fmtPhone } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { mediaUrl } from '../../lib/media.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import {
  Chips,
  Field,
  MoneyField,
  PhoneInput,
  TextInput,
  TimeInput,
  Toggle,
} from '../../ui/fields.tsx';
import { useStreetSuggest } from '../../ui/StreetSuggest.tsx';
import { fromWeek, TimeRangeField, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import { logoColors, PRESETS as COLOR_PRESETS, readable } from '../appearance/Colors.tsx';
import { AnswerLogo } from './Answer.tsx';
import { DishPrint } from './dishes.tsx';
import type { Draft } from './MiniStore.tsx';
import { SegmentPicker } from './SegmentPicker.tsx';
import type { HoursPreset, Segment, SegmentId } from './segments.ts';
import { deliveryReady, Frame } from './steps.tsx';

const ZoneMap = lazy(() => import('../../ui/ZoneMap.tsx').then((m) => ({ default: m.ZoneMap })));

// The onboarding's screens that ask more than one thing (§6.8, reworked): each part of the store
// is one screen with its questions as sections, good answers already filled in, and one
// "Continuar" that saves the lot. What's left blank isn't a dead end: the setup list on the
// finale and on Início points back to it.

export interface ScreenProps {
  s: StoreView;
  draft: Draft;
  patch: (d: Partial<Draft>) => void;
  /** PATCH /store; false when Core said no (the toast already told the merchant why) */
  save: (body: Record<string, unknown>) => Promise<boolean>;
  next: (praise?: string) => void;
  back: (() => void) | null;
  segment: Segment;
  /** the person filling it in: their verified WhatsApp and name suggest answers */
  me: { name: string; phone: string };
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, (p: Promise<unknown>) => (setBusy(true), p.finally(() => setBusy(false)))] as const;
}

/** One block of a screen: a small title, a line on why, and its fields. */
export function Section({
  title,
  hint,
  optional,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div>
        <h2 className="t-title-2 flex items-baseline gap-2">
          {title}
          {optional ? <span className="t-caption font-normal text-muted">opcional</span> : null}
        </h2>
        {hint ? <p className="t-body mt-1 text-pretty text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

// ── 1 · A cara da loja ──────────────────────────────────────────────────────

export function CaraScreen({
  s,
  draft,
  patch,
  save,
  next,
  back,
  segment,
  askName,
  segmentId,
  onSegment,
  tokens,
  onTokens,
  onImport,
}: ScreenProps & {
  /** the store wasn't born in signup: its name was never asked */
  askName: boolean;
  /** what the store sells, when the wizard has to ask it (null: already known) */
  segmentId: string | null | undefined;
  onSegment: ((id: SegmentId) => Promise<boolean>) | null;
  tokens: StoreTokens | null;
  onTokens: (t: StoreTokens) => void;
  /** an empty menu: bring everything from another app instead */
  onImport: (() => void) | null;
}) {
  const [busy, run] = useBusy();
  const [picked, setPicked] = useState<StoreTokens | null>(null);
  const name = draft.name.trim();
  const tag = draft.tagline.trim();
  const missing =
    askName && name.length < 2
      ? 'Escreva o nome da loja.'
      : onSegment && !segmentId
        ? 'Toque no que a loja vende.'
        : null;
  return (
    <Frame
      title="A cara da loja"
      hint="Logo, cor e uma frase: é o que o cliente vê primeiro. Nada aqui é obrigatório, e muda quando quiser."
      back={back}
      busy={busy}
      disabled={!!missing}
      why={missing}
      onSubmit={() =>
        void run(
          (async () => {
            const profile: Record<string, string> = {};
            if (askName && name !== s.profile.name) profile.name = name;
            if (tag !== (s.profile.tagline ?? '')) profile.tagline = tag;
            if (Object.keys(profile).length && !(await save({ profile }))) return;
            if (picked) {
              try {
                await api.saveTokens(picked);
                onTokens(picked);
              } catch (e) {
                return void toast.error(messageOf(e));
              }
            }
            next(draft.logoUrl || picked || tag ? 'Ficou a sua cara!' : undefined);
          })(),
        )
      }
    >
      {onImport ? (
        <button
          type="button"
          onClick={onImport}
          className="press flex w-full items-center gap-4 rounded-lg bg-spark-soft p-4 text-left ring-1 ring-inset ring-spark/50 hover:bg-spark/30"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-spark text-on-spark">
            <DownloadSimple weight="bold" className="size-6" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Já vende em outro app de cardápio?</span>
            <span className="t-body block text-muted">
              Cole o link e eu trago produtos, fotos, horários e Pix de uma vez.
            </span>
          </span>
          <ArrowRight className="size-5 shrink-0" aria-hidden />
        </button>
      ) : null}
      <div className="space-y-8">
        {askName ? (
          <Section title="Nome da loja">
            <Field label="Nome que o cliente vê" htmlFor="ob-name">
              <TextInput
                id="ob-name"
                maxLength={80}
                autoComplete="off"
                autoCapitalize="words"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Doces da Maria"
              />
            </Field>
          </Section>
        ) : null}
        {onSegment ? (
          <Section title="O que a loja vende?" hint="Assim eu sugiro horários, frases e exemplos.">
            <SegmentPicker
              compact
              value={segmentId ?? null}
              busy={busy}
              onPick={(id) => void run(onSegment(id))}
            />
          </Section>
        ) : null}
        <Section
          title="Foto ou logo"
          hint="Pode ser uma foto tirada agora, do celular mesmo. As cores podem sair dela."
        >
          <AnswerLogo
            url={draft.logoUrl}
            onChange={async (logoUrl) => {
              patch({ logoUrl });
              await save({ profile: { logoUrl } });
            }}
          />
        </Section>
        <Section title="Cor da loja" hint="Vai nos botões e nos detalhes do site.">
          <ColorSwatches
            draft={draft}
            tokens={tokens}
            picked={picked}
            onPick={(t) => {
              setPicked(t);
              patch({ accent: t.color.accent, onAccent: t.color.onAccent });
            }}
          />
        </Section>
        <Section title="Uma frase" hint="Curtinha, como se fosse contar para um vizinho.">
          <Field label="Frase da loja" htmlFor="ob-tag">
            <TextInput
              id="ob-tag"
              maxLength={120}
              value={draft.tagline}
              onChange={(e) => patch({ tagline: e.target.value })}
              placeholder={segment.taglines[0]}
            />
          </Field>
          <Chips
            label="ideias de frase"
            value={tag}
            onChange={(v) => patch({ tagline: v })}
            options={segment.taglines.map((t) => ({ value: t, label: t }))}
          />
        </Section>
      </div>
    </Frame>
  );
}

/** Swatches only (logo colours first), each the store's own front in that colour: the full
 *  editor stays in Aparência. */
function ColorSwatches({
  draft,
  tokens,
  picked,
  onPick,
}: {
  draft: Draft;
  tokens: StoreTokens | null;
  picked: StoreTokens | null;
  onPick: (t: StoreTokens) => void;
}) {
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  useEffect(() => {
    if (!draft.logoUrl) return;
    logoColors(draft.logoUrl).then(setFromLogo, () => setFromLogo([]));
  }, [draft.logoUrl]);
  const base = tokens ?? DEFAULT_TOKENS;
  const swatches = [
    ...fromLogo.map((c) => [c, 'do logo'] as [string, string]),
    ...COLOR_PRESETS,
  ].slice(0, 6);
  const current = (picked ?? tokens)?.color.accent ?? null;
  return (
    <div role="radiogroup" aria-label="cores" className="grid grid-cols-3 gap-2.5">
      {swatches.map(([c, name], i) => {
        const accent = readableAccent(c);
        const on = current === accent;
        const t = paletteFrom(c, base);
        return (
          <button
            key={c + i}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`cor ${name}`}
            onClick={() => {
              if (!readable(t)) return toast.error('Essa cor fica difícil de ler. Tente outra.');
              haptic.tick();
              onPick(t);
            }}
            className={cn(
              'press relative overflow-hidden rounded-lg bg-surface text-left after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-inset',
              on ? 'after:ring-2 after:ring-primary' : 'after:ring-1 after:ring-line-strong',
            )}
          >
            <span
              aria-hidden
              className="relative block h-12 overflow-hidden"
              style={{
                background: accent,
                color: `color-mix(in srgb, ${t.color.onAccent} 22%, transparent)`,
              }}
            >
              <DishPrint scale={0.28} />
            </span>
            <span
              aria-hidden
              className="relative -mt-3.5 ml-2.5 grid size-7 place-items-center overflow-hidden rounded-[9px] bg-spark font-display text-[0.875rem] font-semibold leading-none text-on-spark shadow-[0_0_0_2px_var(--surface)]"
            >
              {draft.logoUrl ? (
                <img
                  src={mediaUrl(draft.logoUrl)}
                  alt=""
                  className="size-full bg-white object-cover"
                />
              ) : (
                (draft.name.trim().slice(0, 1) || '?').toUpperCase()
              )}
            </span>
            <span className="flex min-h-8 items-center justify-between gap-1 px-2.5 pb-2 pt-0.5">
              <span className="t-caption truncate font-semibold">{name}</span>
              {on ? (
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
                  <Check weight="bold" className="size-2.5" aria-hidden />
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── 2 · Atendimento ─────────────────────────────────────────────────────────

const PRESETS: Record<HoursPreset, { label: string; days: readonly number[] }> = {
  todos: { label: 'Todos os dias', days: [0, 1, 2, 3, 4, 5, 6] },
  sab: { label: 'Segunda a sábado', days: [1, 2, 3, 4, 5, 6] },
  tdom: { label: 'Terça a domingo', days: [0, 2, 3, 4, 5, 6] },
  semana: { label: 'Segunda a sexta', days: [1, 2, 3, 4, 5] },
  fim: { label: 'Fim de semana', days: [0, 6] },
};

const build = (days: readonly number[], open: string, close: string): WeekModel =>
  Array.from({ length: 7 }, (_, d) => (days.includes(d) ? [{ open, close }] : []));

/** Which preset (and hours) a saved week is, or null when it's more custom than that. */
function detect(w: WeekModel): { preset: HoursPreset; open: string; close: string } | null {
  const days = w.flatMap((r, d) => (r.length ? [d] : []));
  const first = w[days[0] ?? 0]?.[0];
  if (!first) return null;
  if (
    !days.every(
      (d) => w[d]!.length === 1 && w[d]![0]!.open === first.open && w[d]![0]!.close === first.close,
    )
  )
    return null;
  const hit = (Object.keys(PRESETS) as HoursPreset[]).find(
    (k) => PRESETS[k].days.length === days.length && PRESETS[k].days.every((d) => days.includes(d)),
  );
  return hit ? { preset: hit, open: first.open, close: first.close } : null;
}

const PREP = [15, 20, 30, 45, 60] as const;
const FEE_MAX = 100_000;
const feeRule = (c: number) => (c > FEE_MAX ? `Até ${money(FEE_MAX)}.` : null);

export function AtendimentoScreen({ s, draft, patch, save, next, back, segment, me }: ScreenProps) {
  const qc = useQueryClient();
  const [busy, run] = useBusy();

  // WhatsApp: the number signup (or sign-in) just confirmed is the likeliest answer
  const [wa, setWa] = useState(fmtPhone(s.profile.whatsapp ?? (me.phone || null)));
  const waDigits = whatsappDigits(wa);

  // hours: a first visit shows the week a store like this usually keeps
  const saved = detect(draft.week);
  const typical = segment.hours;
  const [preset, setPreset] = useState<HoursPreset | 'custom'>(
    saved?.preset ?? (draft.week.some((d) => d.length) ? 'custom' : typical.preset),
  );
  const [open, setOpen] = useState(saved?.open ?? typical.open);
  const [close, setClose] = useState(saved?.close ?? typical.close);
  useEffect(() => {
    if (!draft.week.some((d) => d.length))
      patch({ week: build(PRESETS[typical.preset].days, typical.open, typical.close) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const apply = (p: HoursPreset, o: string, c: string) => {
    setPreset(p);
    setOpen(o);
    setClose(c);
    patch({ week: build(PRESETS[p].days, o, c) });
  };
  const anyDay = draft.week.some((d) => d.length);

  // a fresh store answers with pickup on: it's the one that needs nothing else
  useEffect(() => {
    if (!s.operations.pickupEnabled && !s.operations.deliveryEnabled && !draft.delivery)
      patch({ pickup: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const address = useAddress(s);
  const delivery = useDelivery(s, address.line);
  const [prep, setPrep] = useState(s.operations.prepTimeMinutes || 30);
  const [minOrder, setMinOrder] = useState<number | null>(s.operations.minOrderCents || null);

  const missing = !waDigits
    ? 'Coloque o WhatsApp da loja com DDD.'
    : !anyDay
      ? 'Deixe pelo menos um dia aberto.'
      : !draft.pickup && !draft.delivery
        ? 'Marque retirada, entrega ou os dois.'
        : !address.cepOk
          ? 'Confira o CEP: são 8 números.'
          : draft.pickup && address.street.trim().length < 5
            ? 'Escreva o endereço onde o cliente busca.'
            : draft.delivery && !delivery.ok
              ? delivery.why
              : null;

  return (
    <Frame
      title="Como você atende"
      hint="Já deixei o que costuma funcionar para lojas como a sua. Confira e ajuste o que for diferente."
      back={back}
      busy={busy}
      disabled={!!missing}
      why={missing}
      onSubmit={() => {
        void run(
          (async () => {
            const profile = { ...address.changed };
            if (waDigits !== s.profile.whatsapp) Object.assign(profile, { whatsapp: waDigits });
            if (Object.keys(profile).length && !(await save({ profile }))) return;
            if (!(await save({ hours: fromWeek(draft.week) }))) return;
            if (draft.delivery && !(await delivery.commit(save))) return;
            const ops: Record<string, unknown> = {
              pickupEnabled: draft.pickup,
              deliveryEnabled: draft.delivery,
              prepTimeMinutes: prep,
            };
            if (draft.delivery) ops.minOrderCents = minOrder ?? 0;
            if (draft.pickup) {
              const where = address.pickupLine();
              if (where !== s.operations.pickupAddress) ops.pickupAddress = where;
            }
            if (!(await save({ operations: ops }))) return;
            void qc.invalidateQueries({ queryKey: qk.store });
            next(
              draft.delivery && draft.pickup
                ? 'Retirada e entrega, que capricho!'
                : 'Agora o cliente sabe quando e como te achar.',
            );
          })(),
        );
      }}
    >
      <div className="space-y-8">
        <Section
          title="WhatsApp da loja"
          hint={
            !s.profile.whatsapp && me.phone
              ? 'Coloquei o número que você confirmou no cadastro. Se os clientes falam com outro, troque.'
              : 'O número que seus clientes usam para falar com você.'
          }
        >
          <Field
            label={
              <span className="inline-flex items-center gap-2">
                <WhatsappLogo weight="fill" className="size-5 text-success" aria-hidden /> WhatsApp
                com DDD
              </span>
            }
            htmlFor="ob-wa"
            error={wa && !waDigits ? 'Faltam números: DDD + o número, como (22) 99999-0000.' : null}
          >
            <PhoneInput id="ob-wa" value={wa} onChange={(v) => setWa(v)} />
          </Field>
        </Section>

        <Section title="Quando abre">
          <Chips
            label="dias de funcionamento"
            value={preset}
            onChange={(p) => (p === 'custom' ? setPreset('custom') : apply(p, open, close))}
            options={[
              ...(Object.keys(PRESETS) as HoursPreset[]).map((k) => ({
                value: k,
                label: PRESETS[k].label,
              })),
              ...(preset === 'custom' ? [{ value: 'custom' as const, label: 'Do meu jeito' }] : []),
            ]}
          />
          {preset !== 'custom' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-body-lg">Das</span>
              <div className="w-28">
                <TimeInput label="abre às" value={open} onCommit={(t) => apply(preset, t, close)} />
              </div>
              <span className="t-body-lg">às</span>
              <div className="w-28">
                <TimeInput
                  label="fecha às"
                  value={close}
                  onCommit={(t) => apply(preset, open, t)}
                />
              </div>
            </div>
          ) : null}
          <Disclosure
            title="Cada dia é diferente?"
            summary="Ajuste dia por dia, com almoço e jantar se precisar"
            defaultOpen={preset === 'custom'}
          >
            <div className="px-4 pb-2">
              <TimeRangeField
                value={draft.week}
                onChange={(week) => {
                  setPreset('custom');
                  patch({ week });
                }}
              />
            </div>
          </Disclosure>
        </Section>

        <Section title="Como o cliente recebe" hint="Pode marcar os dois.">
          <div className="grid grid-cols-2 gap-3">
            <Tile
              on={draft.pickup}
              onClick={() => patch({ pickup: !draft.pickup })}
              icon={<Storefront />}
              title="Retirada"
              body="Busca com você"
            />
            <Tile
              on={draft.delivery}
              onClick={() => patch({ delivery: !draft.delivery })}
              icon={<Motorcycle />}
              title="Entrega"
              body="Você leva"
            />
          </div>
          <div className="space-y-4">
            <p className="t-label">
              {draft.pickup ? 'Endereço da loja (onde o cliente busca)' : 'Endereço da loja'}
              {draft.pickup ? null : (
                <span className="t-caption ml-2 font-normal text-muted">opcional</span>
              )}
            </p>
            {address.ui}
          </div>
          {draft.delivery ? delivery.ui : null}
        </Section>

        <Section title="Tempo e pedido mínimo">
          <div className="space-y-2">
            <p className="t-label" id="ob-prep-label">
              Quanto tempo leva para ficar pronto?
            </p>
            <Chips
              label="tempo de preparo"
              value={String(prep)}
              onChange={(v) => setPrep(Number(v))}
              options={PREP.map((m) => ({ value: String(m), label: `${m} min` }))}
            />
            <p className="t-caption text-muted">
              O cliente vê a previsão. Em dia cheio, dá para aumentar em Pedidos.
            </p>
          </div>
          {draft.delivery ? (
            <Field
              label="Pedido mínimo para entrega"
              optional
              htmlFor="ob-min"
              helper="Deixe vazio para aceitar qualquer valor."
            >
              <MoneyField id="ob-min" cents={minOrder} validate={feeRule} onCommit={setMinOrder} />
            </Field>
          ) : null}
        </Section>
      </div>
    </Frame>
  );
}

/** Retirada / Entrega as two tiles side by side: a checkbox each. */
function Tile({
  on,
  onClick,
  icon,
  title,
  body,
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => {
        haptic.tick();
        onClick();
      }}
      className={cn(
        'press relative flex min-h-28 flex-col items-start justify-between gap-3 rounded-lg p-4 text-left ring-inset transition-[background-color,box-shadow] duration-(--duration-quick)',
        on
          ? 'bg-spark-soft ring-2 ring-primary'
          : 'bg-surface ring-1 ring-line-strong hover:bg-hover',
      )}
    >
      <span
        className={cn(
          'grid size-11 place-items-center rounded-full transition-colors [&_svg]:size-6',
          on ? 'bg-spark text-on-spark' : 'bg-sunken text-ink',
        )}
      >
        {icon}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="t-caption block text-muted">{body}</span>
      </span>
      <span
        className={cn(
          'absolute right-3 top-3 grid size-6 place-items-center rounded-full ring-2',
          on ? 'bg-primary text-on-primary ring-primary' : 'ring-line-strong',
        )}
      >
        {on ? <Check weight="bold" className="size-3.5" aria-hidden /> : null}
      </span>
    </button>
  );
}

/** The store's address: a CEP fills the city and the street, and pickup shows it to the customer. */
function useAddress(s: StoreView) {
  const p = s.profile;
  const [cep, setCep] = useState(maskCep(p.cep ?? ''));
  const [city, setCity] = useState(p.city ?? '');
  const [street, setStreet] = useState(p.address ?? s.operations.pickupAddress ?? '');
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const looked = useRef<string | null>(null);
  const digits = cep.replace(/\D/g, '');

  const lookUp = async (d: string) => {
    looked.current = d;
    setNote({ text: 'Buscando o CEP…' });
    try {
      const a = (await api.cep(d)).address;
      if (looked.current !== d) return;
      if (a.city) setCity((c) => c.trim() || a.city!);
      if (a.street)
        setStreet((x) => x.trim() || [a.street, a.neighborhood].filter(Boolean).join(' · '));
      setNote({
        text: a.street
          ? 'Achei a rua. Coloque o número.'
          : a.city && a.state
            ? `${a.city} – ${a.state}`
            : '',
      });
    } catch (e) {
      if (looked.current !== d) return;
      setNote(
        e instanceof ApiError && e.code === 'CEP_NOT_FOUND'
          ? { text: 'Esse CEP não existe. Confira os números.', bad: true }
          : { text: 'A busca de CEP não respondeu agora. Preencha a rua e a cidade.' },
      );
    }
  };
  const suggest = useStreetSuggest((x) => {
    setStreet(
      [x.number ? `${x.street}, ${x.number}` : x.street, x.neighborhood]
        .filter(Boolean)
        .join(' · '),
    );
    if (x.city) setCity((c) => c.trim() || x.city!);
  });

  const changed: Record<string, string | null> = {};
  if ((digits || null) !== (p.cep ?? null)) changed.cep = digits || null;
  if ((city.trim() || null) !== (p.city ?? null)) changed.city = city.trim() || null;
  if ((street.trim() || null) !== (p.address ?? null)) changed.address = street.trim() || null;
  const line = [street.trim(), city.trim()].filter(Boolean).join(', ');
  return {
    changed,
    street,
    line,
    cepOk: digits.length === 0 || (digits.length === 8 && !note?.bad),
    /** what a pickup order shows: the street and the city */
    pickupLine: () => line.slice(0, 200),
    ui: (
      <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3">
        <Field label="CEP" htmlFor="ob-cep">
          <TextInput
            id="ob-cep"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            className="tnum"
            value={cep}
            aria-invalid={note?.bad || undefined}
            aria-describedby="ob-cep-note"
            onChange={(e) => {
              const v = maskCep(e.target.value);
              setCep(v);
              const d = v.replace(/\D/g, '');
              if (d.length === 8) void lookUp(d);
              else {
                looked.current = null;
                setNote(null);
              }
            }}
          />
        </Field>
        <Field label="Cidade" htmlFor="ob-city">
          <TextInput
            id="ob-city"
            maxLength={80}
            autoComplete="address-level2"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </Field>
        <p
          id="ob-cep-note"
          role="status"
          className={cn(
            't-caption col-span-2 -mt-1 empty:hidden',
            note?.bad ? 'text-danger' : 'text-muted',
          )}
        >
          {note?.text ?? ''}
        </p>
        <div className="col-span-2">
          <Field label="Rua, número e bairro" htmlFor="ob-addr">
            <TextInput
              id="ob-addr"
              maxLength={300}
              autoComplete="off"
              placeholder="Rua das Flores, 120 · Centro"
              value={street}
              {...suggest.input}
              onChange={(e) => {
                setStreet(e.target.value);
                suggest.typing(e.target.value);
              }}
            />
            {suggest.list}
          </Field>
        </div>
      </div>
    ),
  };
}

/** How delivery is priced: a fee for a list of bairros, or by road distance from the store's pin
 *  (ADR 0024). Nothing is stored until the screen's "Continuar" (`commit`). */
function useDelivery(s: StoreView, addressLine: string) {
  const qc = useQueryClient();
  const zoneMade = useRef(false);
  const ready = deliveryReady(s);
  const [mode, setMode] = useState<'bairro' | 'km'>(s.distancePricing.enabled ? 'km' : 'bairro');
  const [places, setPlaces] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const list = places
    .split(/[,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const [pin, setPin] = useState(s.location);
  const [finding, setFinding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [base, setBase] = useState<number | null>(
    s.distancePricing.enabled ? s.distancePricing.baseFeeCents : null,
  );
  const [perKm, setPerKm] = useState<number | null>(
    s.distancePricing.enabled ? s.distancePricing.feePerKmCents : null,
  );
  const [maxKm, setMaxKm] = useState(String(s.distancePricing.maxKm || 8));
  const km = Number(maxKm.replace(',', '.'));
  const kmOk = Number.isFinite(km) && km >= 1 && km <= 50;

  const find = async () => {
    setFinding(true);
    try {
      const { point } = await api.geocode(addressLine, s.profile.cep);
      if (!point) return void toast.error('Não achei no mapa. Toque no mapa para marcar à mão.');
      setPin({ latitude: point.lat, longitude: point.lng });
      toast(
        point.precision === 'address'
          ? 'Achei! Confira o pino no mapa.'
          : 'Marquei perto. Toque em “ajustar” e depois no lugar certo.',
      );
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setFinding(false);
    }
  };

  const ok = ready
    ? true
    : mode === 'bairro'
      ? list.length > 0 && fee !== null
      : !!pin && base !== null && perKm !== null && kmOk;
  const why =
    mode === 'bairro'
      ? !list.length
        ? 'Escreva em quais bairros você entrega.'
        : 'Coloque quanto cobra pela entrega. Se for de graça, digite 0.'
      : !pin
        ? 'Marque no mapa de onde a entrega sai.'
        : !kmOk
          ? 'A distância vai de 1 a 50 km.'
          : 'Preencha a taxa de saída e o valor por km.';

  const commit = async (save: ScreenProps['save']): Promise<boolean> => {
    if (ready) return true;
    if (mode === 'bairro') {
      // a second tap after a failed save doesn't make the zone twice
      if (zoneMade.current) return true;
      try {
        await api.createZone({
          name: 'Entrega',
          kind: 'neighborhood',
          neighborhoods: list,
          feeCents: fee ?? 0,
        });
        zoneMade.current = true;
        void qc.invalidateQueries({ queryKey: qk.store });
        return true;
      } catch (e) {
        toast.error(messageOf(e));
        return false;
      }
    }
    // the pin before the rule: Core refuses distance pricing without one
    if (!(await save({ location: pin }))) return false;
    return save({
      distancePricing: {
        enabled: true,
        baseFeeCents: base ?? 0,
        feePerKmCents: perKm ?? 0,
        maxKm: km,
      },
    });
  };

  const ui = ready ? (
    <p className="t-body flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-success">
      <Check weight="bold" className="size-5 shrink-0" aria-hidden /> Sua entrega já tem preço. Dá
      para ajustar em Loja › Entrega.
    </p>
  ) : (
    <Card className="animate-fade-up space-y-4 p-4">
      <p className="t-label">Quanto custa a entrega?</p>
      <Chips
        label="como cobrar a entrega"
        value={mode}
        onChange={(m) => setMode(m)}
        options={[
          {
            value: 'bairro',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Signpost className="size-4" aria-hidden /> por bairro
              </span>
            ),
          },
          {
            value: 'km',
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Path className="size-4" aria-hidden /> por distância
              </span>
            ),
          },
        ]}
      />
      {mode === 'bairro' ? (
        <>
          <Field
            label="Em quais bairros você entrega?"
            htmlFor="ob-places"
            helper="Separe com vírgula. Depois dá para ter taxas diferentes por área."
          >
            <TextInput
              id="ob-places"
              maxLength={400}
              value={places}
              onChange={(e) => setPlaces(e.target.value)}
              placeholder="Ex.: Centro, Itaúna, Vilatur"
            />
          </Field>
          <Field label="Taxa de entrega" htmlFor="ob-fee" helper="Se for de graça, digite 0.">
            <MoneyField id="ob-fee" cents={fee} validate={feeRule} onCommit={setFee} />
          </Field>
        </>
      ) : (
        <>
          {/* isolate: Leaflet's panes (z-index 400) stay under the sticky buttons */}
          <div className="isolate overflow-hidden rounded-md ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-sunken px-3 py-2">
              <p className="t-caption min-w-0 flex-1 text-muted">
                {moving
                  ? 'Toque no mapa onde fica a loja.'
                  : pin
                    ? 'O pino é de onde a entrega sai.'
                    : 'Ache pelo endereço acima ou marque no mapa.'}
              </p>
              {pin ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<MapPin />}
                  loading={finding}
                  disabled={addressLine.length < 5}
                  onClick={() => void find()}
                >
                  achar
                </Button>
              )}
              <Button
                variant={moving ? 'primary' : 'ghost'}
                size="sm"
                icon={<Crosshair />}
                onClick={() => setMoving((v) => !v)}
              >
                {moving ? 'toque no mapa' : pin ? 'ajustar' : 'marcar'}
              </Button>
            </div>
            <Suspense fallback={<div className="skeleton h-48" />}>
              <ZoneMap
                center={pin}
                zones={[]}
                className="h-48 w-full"
                label="local da loja"
                onPick={
                  moving
                    ? (p) => {
                        setMoving(false);
                        setPin(p);
                      }
                    : undefined
                }
              />
            </Suspense>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Saída" htmlFor="ob-base">
              <MoneyField id="ob-base" cents={base} validate={feeRule} onCommit={setBase} />
            </Field>
            <Field label="Por km" htmlFor="ob-km">
              <MoneyField id="ob-km" cents={perKm} validate={feeRule} onCommit={setPerKm} />
            </Field>
            <Field label="Até" htmlFor="ob-max" error={kmOk ? null : 'De 1 a 50 km.'}>
              <TextInput
                id="ob-max"
                inputMode="decimal"
                maxLength={4}
                value={maxKm}
                trail="km"
                onChange={(e) => setMaxKm(e.target.value.replace(/[^\d,.]/g, ''))}
              />
            </Field>
          </div>
          {base !== null && perKm !== null && kmOk ? (
            <p className="t-body rounded-md bg-sunken px-3 py-2" role="status">
              {money(base)} de saída, mais {money(perKm)} por km, até {km.toLocaleString('pt-BR')}{' '}
              km.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
  return { ok, why, commit, ui };
}

// ── 3 · Pagamento ───────────────────────────────────────────────────────────

const METHODS: { id: PayMethod; label: string; body: string; Icon: typeof Money }[] = [
  { id: 'pix', label: 'Pix', body: 'Na sua chave, sem taxa nossa.', Icon: PixLogo },
  {
    id: 'card_on_delivery',
    label: 'Cartão na entrega',
    body: 'Na maquininha, na entrega ou retirada.',
    Icon: CreditCard,
  },
  { id: 'cash', label: 'Dinheiro', body: 'Na entrega ou retirada, com troco.', Icon: Money },
  {
    id: 'meal_voucher',
    label: 'Vale-refeição',
    body: 'O cartão de vale na maquininha.',
    Icon: ForkKnife,
  },
];

const KEY_TYPES = [
  { value: 'phone', label: 'celular' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'e-mail' },
  { value: 'random', label: 'aleatória' },
] as const;

export function PagamentoScreen({
  s,
  next,
  back,
  me,
  pay,
}: Pick<ScreenProps, 's' | 'next' | 'back' | 'me'> & { pay: Payments }) {
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const [methods, setMethods] = useState<PayMethod[]>(pay.methods);
  // the owner's verified number is the commonest Pix key; their name is the beneficiary
  const [type, setType] = useState<string>('phone');
  const [key, setKey] = useState(me.phone ? me.phone.replace(/^55/, '') : '');
  const [name, setName] = useState(me.name.slice(0, 25));
  const [err, setErr] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const pixOn = methods.includes('pix');
  const askKey = pixOn && !pay.pix && !later;
  const mp = platform.canPay && pay.mercadoPago.available && pay.mercadoPago.status !== 'connected';
  const connect = async () => {
    try {
      platform.openExternal((await api.mpConnect('onboarding')).url);
    } catch (e) {
      toast.error(messageOf(e));
    }
  };
  const missing = !methods.length
    ? 'Deixe pelo menos uma forma de pagamento.'
    : askKey && !key.trim()
      ? 'Coloque a sua chave Pix, ou deixe para depois.'
      : askKey && name.trim().length < 2
        ? 'Escreva o nome de quem recebe, como no banco.'
        : null;
  const changed =
    methods.length !== pay.methods.length || methods.some((m) => !pay.methods.includes(m));
  return (
    <Frame
      title="Como você recebe"
      hint="Marque o que você aceita: o site só mostra essas opções. O Pix cai direto na sua conta."
      back={back}
      busy={busy}
      disabled={!!missing}
      why={missing}
      onSubmit={() => {
        setErr(null);
        void run(
          (async () => {
            const body: Parameters<typeof api.updatePayments>[0] = {};
            if (changed) body.methods = methods;
            if (askKey)
              body.pix = {
                keyType: type,
                key: key.trim(),
                beneficiary: name.trim(),
                city: s.profile.city?.slice(0, 15) || null,
              };
            if (Object.keys(body).length) {
              try {
                qc.setQueryData(qk.payments, await api.updatePayments(body));
                void qc.invalidateQueries({ queryKey: qk.home });
              } catch (e) {
                return void setErr(messageOf(e));
              }
            }
            next(askKey ? 'Pix pronto, o dinheiro cai direto na sua conta.' : 'Combinado!');
          })(),
        );
      }}
    >
      <div className="space-y-8">
        <Section title="Formas de pagamento">
          <Card className="divide-y divide-line px-4">
            {METHODS.map((m) => {
              const on = methods.includes(m.id);
              return (
                <div key={m.id} className="flex items-center gap-3 py-2">
                  <m.Icon weight="duotone" className="size-7 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Toggle
                      checked={on}
                      disabled={on && methods.length === 1}
                      onChange={(v) =>
                        setMethods((x) => (v ? [...x, m.id] : x.filter((y) => y !== m.id)))
                      }
                      label={m.label}
                      description={m.body}
                    />
                  </div>
                </div>
              );
            })}
          </Card>
        </Section>

        {pixOn ? (
          <Section title="Chave Pix">
            {pay.pix ? (
              <p className="t-body flex items-center gap-2 rounded-md bg-success-soft px-4 py-3 text-success">
                <Check weight="bold" className="size-5 shrink-0" aria-hidden />
                <span className="min-w-0">
                  A chave <strong className="break-all">{pay.pix.key}</strong> recebe os pedidos.
                </span>
              </p>
            ) : later ? (
              <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">
                Sem chave, o cliente ainda não consegue pagar com Pix. Fica na sua lista para
                depois.{' '}
                <button
                  type="button"
                  onClick={() => setLater(false)}
                  className="font-semibold text-ink underline underline-offset-2"
                >
                  colocar agora
                </button>
              </p>
            ) : (
              <>
                <Chips
                  label="tipo de chave"
                  value={type}
                  onChange={(t) => {
                    setType(t);
                    setErr(null);
                    if (t !== 'phone' && key === me.phone.replace(/^55/, '')) setKey('');
                  }}
                  options={KEY_TYPES.map((k) => ({ ...k }))}
                />
                <Field label="Chave Pix" htmlFor="ob-pix" error={err}>
                  <TextInput
                    id="ob-pix"
                    value={key}
                    maxLength={100}
                    inputMode={type === 'email' ? 'email' : type === 'random' ? 'text' : 'numeric'}
                    autoComplete="off"
                    onChange={(e) => setKey(e.target.value)}
                  />
                </Field>
                <Field
                  label="Nome de quem recebe"
                  htmlFor="ob-pixname"
                  helper="Como aparece no seu banco."
                >
                  <TextInput
                    id="ob-pixname"
                    maxLength={25}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-mx-3.5 text-muted"
                  onClick={() => setLater(true)}
                >
                  deixar a chave para depois
                </Button>
              </>
            )}
          </Section>
        ) : null}

        {mp ? (
          <Section
            title="Cartão pelo site"
            optional
            hint="Conecte o Mercado Pago e o cliente paga com cartão ou Pix no site: o pedido já chega pago."
          >
            <Card className="space-y-3 p-4">
              <ul className="t-body space-y-2">
                <li className="flex items-start gap-2">
                  <CreditCard weight="duotone" className="mt-0.5 size-5 shrink-0" /> Crédito e
                  débito no site, sem maquininha.
                </li>
                <li className="flex items-start gap-2">
                  <ArrowSquareOut weight="duotone" className="mt-0.5 size-5 shrink-0" /> Você entra
                  no Mercado Pago, autoriza e volta para cá.
                </li>
              </ul>
              <p className="t-caption flex items-center gap-2 text-muted">
                <LockSimple className="size-4 shrink-0" aria-hidden /> O Mercado Pago cobra a tarifa
                dele. A Venduá não cobra nada por pedido.
              </p>
              <Button variant="secondary" onClick={() => void connect()}>
                conectar o Mercado Pago
              </Button>
            </Card>
          </Section>
        ) : null}
      </div>
    </Frame>
  );
}

import {
  Camera,
  Check,
  ClipboardText,
  Motorcycle,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { whatsappDigits } from '@vendua/kernel/rules';
import { api, type Category, type StoreView } from '../../lib/api.ts';
import { money, phone as fmtPhone } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
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
  TextArea,
  TextInput,
  TimeInput,
} from '../../ui/fields.tsx';
import { PhotoField, type Photo } from '../../ui/PhotoField.tsx';
import { StepFrame } from '../../ui/StepFrame.tsx';
import { fromWeek, TimeRangeField, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import type { Draft } from './MiniStore.tsx';
import { SegmentPicker } from './SegmentPicker.tsx';
import type { HoursPreset, Segment, SegmentId } from './segments.ts';

export interface StepProps {
  s: StoreView;
  draft: Draft;
  patch: (d: Partial<Draft>) => void;
  /** PATCH /store; false when Core said no (the toast already told the merchant why) */
  save: (body: Record<string, unknown>) => Promise<boolean>;
  next: (praise?: string) => void;
  back: (() => void) | null;
  /** leave it for later: Core remembers it was skipped, the finale lists it */
  skip: () => void;
  /** "Atendimento · 2 de 4" */
  eyebrow: string;
  /** what the store sells (the generic one while unknown) */
  segment: Segment;
  /** the person filling it in: their verified WhatsApp and name suggest answers */
  me: { name: string; phone: string };
}

/** One question per screen (StepFrame) with a quiet "pular" beside the main button. */
export function Frame({
  skipLabel = 'pular',
  onSkip,
  ...p
}: Parameters<typeof StepFrame>[0] & { onSkip?: (() => void) | undefined; skipLabel?: string }) {
  return (
    <StepFrame
      {...p}
      aside={
        onSkip ? (
          <Button variant="quiet" size="lg" onClick={onSkip}>
            {skipLabel}
          </Button>
        ) : (
          p.aside
        )
      }
    />
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, (p: Promise<unknown>) => (setBusy(true), p.finally(() => setBusy(false)))] as const;
}

// ── A cara da loja ──────────────────────────────────────────────────────────

export function SegmentStep({
  eyebrow,
  back,
  current,
  onPick,
}: Pick<StepProps, 'eyebrow' | 'back'> & {
  current: string | null;
  onPick: (id: SegmentId) => Promise<boolean>;
}) {
  const [busy, run] = useBusy();
  return (
    <Frame
      eyebrow={eyebrow}
      title="O que a sua loja vende?"
      hint="Assim eu já sugiro horários, frases e exemplos que combinam com você."
      back={back}
      busy={busy}
      disabled={!current}
      onSubmit={() => current && void run(onPick(current as SegmentId))}
    >
      <SegmentPicker value={current} busy={busy} onPick={(id) => void run(onPick(id))} />
    </Frame>
  );
}

export function NameStep({ s, draft, patch, save, next, back, eyebrow }: StepProps) {
  const [busy, run] = useBusy();
  const name = draft.name.trim();
  return (
    <Frame
      eyebrow={eyebrow}
      title="Como se chama a sua loja?"
      hint="Esse é o nome que seus clientes vão ver."
      back={back}
      busy={busy}
      disabled={name.length < 2}
      onSubmit={() =>
        void run(
          (name === s.profile.name ? Promise.resolve(true) : save({ profile: { name } })).then(
            (ok) => ok && next(`${name}… que nome bonito!`),
          ),
        )
      }
    >
      <Field label="Nome da loja" htmlFor="ob-name">
        <TextInput
          id="ob-name"
          maxLength={80}
          autoComplete="off"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Ex.: Doces da Maria"
        />
      </Field>
    </Frame>
  );
}

export function LogoStep({ draft, patch, save, next, back, skip, eyebrow }: StepProps) {
  return (
    <Frame
      eyebrow={eyebrow}
      title="Tem uma foto ou logo?"
      hint="Pode ser uma foto tirada agora, do celular mesmo. As cores da loja podem sair dela."
      back={back}
      disabled={!draft.logoUrl}
      onSkip={draft.logoUrl ? undefined : skip}
      onSubmit={() => next('Ficou lindo!')}
    >
      <div className="w-44">
        <PhotoField
          label="logo"
          aspect="1:1"
          max={1}
          photos={draft.logoUrl ? [{ url: draft.logoUrl }] : []}
          onChange={async (p) => {
            const logoUrl = p[0]?.url ?? null;
            patch({ logoUrl });
            await save({ profile: { logoUrl } });
          }}
        />
      </div>
    </Frame>
  );
}

export function TaglineStep({
  s,
  draft,
  patch,
  save,
  next,
  back,
  skip,
  eyebrow,
  segment,
}: StepProps) {
  const [busy, run] = useBusy();
  const tag = draft.tagline.trim();
  return (
    <Frame
      eyebrow={eyebrow}
      title="Uma frase que descreve a loja"
      hint="Curtinha, como se fosse contar para um vizinho. Se não vier nada na cabeça, toque em uma das ideias."
      back={back}
      busy={busy}
      disabled={!tag}
      onSkip={tag ? undefined : skip}
      onSubmit={() =>
        void run(
          (tag === (s.profile.tagline ?? '')
            ? Promise.resolve(true)
            : save({ profile: { tagline: tag } })
          ).then((ok) => ok && next('Adorei!')),
        )
      }
    >
      <Field label="Frase" htmlFor="ob-tag">
        <TextInput
          id="ob-tag"
          maxLength={120}
          value={draft.tagline}
          onChange={(e) => patch({ tagline: e.target.value })}
          placeholder={`Ex.: ${segment.taglines[0]}`}
        />
      </Field>
      <Chips
        label="ideias de frase"
        value={tag}
        onChange={(v) => patch({ tagline: v })}
        options={segment.taglines.map((t) => ({ value: t, label: t }))}
      />
    </Frame>
  );
}

// ── Atendimento ─────────────────────────────────────────────────────────────

export function WhatsappStep({ s, save, next, back, eyebrow, me }: StepProps) {
  // the number signup (or sign-in) just confirmed is the likeliest answer
  const suggested = !s.profile.whatsapp && !!me.phone;
  const [shown, setShown] = useState(fmtPhone(s.profile.whatsapp ?? (me.phone || null)));
  const [busy, run] = useBusy();
  // Core's rule: DDD + number, stored with the country code
  const digits = whatsappDigits(shown);
  const ok = !!digits;
  return (
    <Frame
      eyebrow={eyebrow}
      title="Qual é o WhatsApp da loja?"
      hint={
        suggested
          ? 'Coloquei o número que você confirmou no cadastro. Se os clientes falam com outro, é só trocar.'
          : 'É o número que seus clientes usam para falar com você.'
      }
      back={back}
      busy={busy}
      disabled={!ok}
      onSubmit={() =>
        void run(
          (digits === s.profile.whatsapp
            ? Promise.resolve(true)
            : save({ profile: { whatsapp: digits } })
          ).then((ok) => ok && next('Anotado!')),
        )
      }
    >
      <Field
        label={
          <span className="inline-flex items-center gap-2">
            <WhatsappLogo weight="fill" className="size-5 text-success" /> WhatsApp com DDD
          </span>
        }
        htmlFor="ob-wa"
        helper={shown && !ok ? 'Faltam números: DDD + o número, como (22) 99999-0000.' : undefined}
      >
        <PhoneInput id="ob-wa" value={shown} onChange={(v) => setShown(v)} />
      </Field>
    </Frame>
  );
}

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

export function HoursStep({ draft, patch, save, next, back, eyebrow, segment }: StepProps) {
  const saved = detect(draft.week);
  const typical = segment.hours;
  const [preset, setPreset] = useState<HoursPreset | 'custom'>(
    saved?.preset ?? (draft.week.some((d) => d.length) ? 'custom' : typical.preset),
  );
  const [open, setOpen] = useState(saved?.open ?? typical.open);
  const [close, setClose] = useState(saved?.close ?? typical.close);
  const [busy, run] = useBusy();
  // a first visit shows the week a store like this usually keeps; nothing is stored until "Continuar"
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
  return (
    <Frame
      eyebrow={eyebrow}
      title="Quando a loja abre?"
      hint="Já deixei um horário comum para lojas como a sua. Ajuste os dias e as horas."
      back={back}
      busy={busy}
      disabled={!anyDay}
      onSubmit={() =>
        void run(
          save({ hours: fromWeek(draft.week) }).then(
            (ok) => ok && next('Agora as pessoas sabem quando te achar.'),
          ),
        )
      }
    >
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
            <TimeInput label="fecha às" value={close} onCommit={(t) => apply(preset, open, t)} />
          </div>
        </div>
      ) : null}
      <Disclosure
        title="Cada dia é diferente?"
        summary="Ajuste dia por dia, com almoço e jantar se precisar"
        defaultOpen={preset === 'custom'}
      >
        <div className="px-4 pb-2" onChange={() => setPreset('custom')}>
          <TimeRangeField
            value={draft.week}
            onChange={(week) => {
              setPreset('custom');
              patch({ week });
            }}
          />
        </div>
      </Disclosure>
    </Frame>
  );
}

export function Choice({
  on,
  onClick,
  icon,
  title,
  body,
  role = 'checkbox',
}: {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  title: string;
  body: string;
  role?: 'checkbox' | 'radio';
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={() => {
        haptic.tick();
        onClick();
      }}
      className={cn(
        'flex min-h-24 w-full items-center gap-4 rounded-lg p-4 text-left ring-2 transition-[background-color,box-shadow,scale] duration-(--duration-quick) active:scale-[0.99]',
        on ? 'bg-spark-soft ring-primary' : 'bg-surface ring-line-strong hover:bg-hover',
      )}
    >
      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-sunken [&_svg]:size-7">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-title-2 block">{title}</span>
        <span className="t-body block text-muted">{body}</span>
      </span>
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-full ring-2',
          on ? 'bg-primary text-on-primary ring-primary' : 'ring-line-strong',
        )}
      >
        {on ? <Check weight="bold" className="size-5" /> : null}
      </span>
    </button>
  );
}

/** Delivery is switched on only once there's somewhere to deliver (the entrega step). */
export const deliveryReady = (s: StoreView) =>
  s.zones.some((z) => z.active) || s.distancePricing.enabled;

export function HowStep({ s, draft, patch, save, next, back, eyebrow }: StepProps) {
  const [busy, run] = useBusy();
  const ok = draft.pickup || draft.delivery;
  return (
    <Frame
      eyebrow={eyebrow}
      title="Como o cliente recebe?"
      hint="Pode marcar os dois."
      back={back}
      busy={busy}
      disabled={!ok}
      onSubmit={() =>
        void run(
          (async () => {
            const ready = !draft.delivery || deliveryReady(s);
            const ops = ready
              ? { pickupEnabled: draft.pickup, deliveryEnabled: draft.delivery }
              : draft.pickup
                ? { pickupEnabled: true }
                : null;
            if (ops && !(await save({ operations: ops }))) return;
            next(
              draft.delivery && draft.pickup
                ? 'Retirada e entrega, que capricho!'
                : draft.delivery
                  ? 'Entrega, anotado!'
                  : 'Retirada, anotado!',
            );
          })(),
        )
      }
    >
      <div className="space-y-3">
        <Choice
          on={draft.pickup}
          onClick={() => patch({ pickup: !draft.pickup })}
          icon={<Storefront />}
          title="Retirada"
          body="O cliente busca o pedido com você."
        />
        <Choice
          on={draft.delivery}
          onClick={() => patch({ delivery: !draft.delivery })}
          icon={<Motorcycle />}
          title="Entrega"
          body="Você leva até a casa do cliente."
        />
      </div>
    </Frame>
  );
}

export function PickupStep({ s, save, next, back, skip, eyebrow }: StepProps) {
  const [busy, run] = useBusy();
  const [where, setWhere] = useState(s.operations.pickupAddress ?? s.profile.address ?? '');
  const [how, setHow] = useState(s.operations.pickupInstructions ?? '');
  const ok = where.trim().length >= 5;
  return (
    <Frame
      eyebrow={eyebrow}
      title="Onde o cliente busca?"
      hint="Só quem pede para retirar vê esse endereço, junto com o pedido."
      back={back}
      busy={busy}
      disabled={!ok}
      onSkip={skip}
      onSubmit={() =>
        void run(
          save({
            operations: {
              pickupAddress: where.trim(),
              pickupInstructions: how.trim() || null,
            },
          }).then((ok) => ok && next('Fácil de achar!')),
        )
      }
    >
      <Field label="Endereço para retirada" htmlFor="ob-pick">
        <TextInput
          id="ob-pick"
          maxLength={200}
          autoComplete="street-address"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Ex.: Rua das Flores, 120 · Centro"
        />
      </Field>
      <Field
        label="Alguma dica para chegar?"
        optional
        htmlFor="ob-pickhow"
        helper="Ex.: portão verde, toque o interfone 3."
      >
        <TextArea
          id="ob-pickhow"
          maxLength={300}
          rows={2}
          value={how}
          onChange={(e) => setHow(e.target.value)}
        />
      </Field>
    </Frame>
  );
}

// ── Cardápio ────────────────────────────────────────────────────────────────

const CHEERS = ['Que delícia!', 'Esse vai vender!', 'Deu fome aqui!', 'Já quero um!'];
const GOAL = 3;

type Listed = { id: string; name: string; priceCents: number; imageUrl: string | null };

export function ProductsStep({
  products,
  categories,
  next,
  back,
  skip,
  eyebrow,
  segment,
}: Pick<StepProps, 'next' | 'back' | 'skip' | 'eyebrow' | 'segment'> & {
  products: Listed[];
  categories: Category[];
}) {
  const qc = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [paste, setPaste] = useState(false);
  // the menu's first category, named for what the store sells, made on the first product
  const category = async () =>
    categories[0]?.id ?? (await api.createCategory(segment.category)).category.id;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.catalog });
    void qc.invalidateQueries({ queryKey: qk.home });
  };
  const add = useMutation({
    mutationFn: async () => {
      const r = await api.createProduct({
        name: name.trim(),
        priceCents: price ?? 0,
        categoryId: await category(),
      });
      if (photo)
        await api.setMedia(r.product.id, [
          { url: photo.url, width: photo.width ?? null, height: photo.height ?? null },
        ]);
      return r;
    },
    onSuccess: (r) => {
      refresh();
      haptic.commit();
      toast(`${r.product.name} no cardápio. ${CHEERS[products.length % CHEERS.length]}`);
      setName('');
      setPrice(null);
      setPhoto(null);
      nameRef.current?.focus({ preventScroll: true });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const ready = name.trim().length >= 2 && price !== null;
  const withPhoto = products.filter((p) => p.imageUrl).length;
  return (
    <Frame
      eyebrow={eyebrow}
      title="O que você vende?"
      hint={`Comece com os ${GOAL} que mais saem, com foto: é o que faz o cliente pedir. Detalhes e opções você coloca depois.`}
      back={back}
      busy={add.isPending}
      disabled={!ready && !products.length}
      label={ready ? 'Adicionar ao cardápio' : 'Terminei'}
      onSkip={products.length ? undefined : skip}
      aside={
        ready && products.length ? (
          <Button variant="quiet" size="lg" onClick={() => next('Cardápio no ar!')}>
            Terminei
          </Button>
        ) : undefined
      }
      onSubmit={() => (ready ? add.mutate() : next('Cardápio no ar!'))}
    >
      <div
        className="flex items-center gap-3"
        role="img"
        aria-label={`${Math.min(withPhoto, GOAL)} de ${GOAL} produtos com foto`}
      >
        <div className="flex flex-1 gap-2">
          {Array.from({ length: GOAL }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-2 flex-1 rounded-full transition-colors duration-(--duration-smooth)',
                i < withPhoto
                  ? 'bg-[var(--chart)]'
                  : i < products.length
                    ? 'bg-[var(--chart)] opacity-40'
                    : 'bg-line-strong',
              )}
            />
          ))}
        </div>
        <span className="t-caption tnum shrink-0 text-muted">
          {Math.min(withPhoto, GOAL)}/{GOAL} com foto
        </span>
      </div>
      {products.length ? (
        <ul className="space-y-2">
          {products.slice(-5).map((p) => (
            <ProductRow key={p.id} p={p} onPhoto={refresh} />
          ))}
        </ul>
      ) : null}
      <Card className="space-y-4 p-4">
        <div className="flex gap-4">
          <div className="w-24 shrink-0">
            <PhotoField
              label="foto do produto"
              aspect="1:1"
              max={1}
              photos={photo ? [photo] : []}
              onChange={(p) => setPhoto(p[0] ?? null)}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-4">
            <Field label={products.length ? 'Mais um produto' : 'Nome do produto'} htmlFor="ob-p">
              <TextInput
                id="ob-p"
                ref={nameRef}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Ex.: ${segment.examples[products.length % 3]}`}
              />
            </Field>
            <Field label="Preço" htmlFor="ob-price">
              <MoneyField id="ob-price" cents={price} onCommit={setPrice} />
            </Field>
          </div>
        </div>
      </Card>
      {paste ? (
        <PasteList
          category={category}
          onDone={(n) => {
            refresh();
            setPaste(false);
            toast(`${n} ${n === 1 ? 'produto entrou' : 'produtos entraram'} no cardápio`);
          }}
          onCancel={() => setPaste(false)}
        />
      ) : (
        <Button
          variant="ghost"
          icon={<ClipboardText />}
          className="-mx-3.5"
          onClick={() => setPaste(true)}
        >
          tenho a lista no WhatsApp, quero colar
        </Button>
      )}
    </Frame>
  );
}

function ProductRow({ p, onPhoto }: { p: Listed; onPhoto: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="animate-fade-up flex min-h-16 items-center gap-3 rounded-md bg-surface px-3 py-2 depth-1">
      {p.imageUrl ? (
        <img src={p.imageUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className={cn('w-12 shrink-0', busy && 'opacity-60')}>
          <PhotoField
            label={`pôr foto em ${p.name}`}
            aspect="1:1"
            max={1}
            compact
            photos={[]}
            onChange={async (ph) => {
              const f = ph[0];
              if (!f) return;
              setBusy(true);
              try {
                await api.setMedia(p.id, [
                  { url: f.url, width: f.width ?? null, height: f.height ?? null },
                ]);
                onPhoto();
              } catch (e) {
                toast.error(messageOf(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{p.name}</span>
        {!p.imageUrl ? (
          <span className="t-caption inline-flex items-center gap-1 text-muted">
            <Camera className="size-3.5" /> toque para pôr foto
          </span>
        ) : null}
      </span>
      <span className="tnum text-muted">{money(p.priceCents)}</span>
      <Check weight="bold" className="size-5 shrink-0 text-success" aria-label="no cardápio" />
    </li>
  );
}

/** "Cole a lista do WhatsApp": Core reads names and prices out of the text (Cardápio's own parser). */
function PasteList({
  category,
  onDone,
  onCancel,
}: {
  category: () => Promise<string>;
  onDone: (created: number) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [items, setItems] = useState<{ name: string; priceCents: number }[] | null>(null);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 3) return setItems(null);
    const h = setTimeout(() => {
      api.importPreview(t.slice(0, 20_000)).then(
        (r) => setItems(r.items),
        () => setItems([]),
      );
    }, 300);
    return () => clearTimeout(h);
  }, [text]);
  const run = useMutation({
    mutationFn: async () => api.importProducts(text.trim().slice(0, 20_000), await category()),
    onSuccess: (r) => onDone(r.created),
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Card className="animate-fade-up space-y-4 p-4">
      <Field
        label="Cole a lista aqui"
        htmlFor="ob-paste"
        helper="Um produto por linha, com o preço: “Pudim de leite 12,00”."
      >
        <TextArea
          id="ob-paste"
          rows={5}
          maxLength={20_000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Pudim de leite 12,00\nBolo de cenoura 25,00'}
        />
      </Field>
      {items?.length ? (
        <ul className="t-body max-h-48 space-y-1 overflow-y-auto" aria-label="o que eu entendi">
          {items.slice(0, 30).map((i, n) => (
            <li key={n} className="flex justify-between gap-3">
              <span className="truncate">{i.name}</span>
              <span className="tnum shrink-0 text-muted">{money(i.priceCents)}</span>
            </li>
          ))}
        </ul>
      ) : items ? (
        <p className="t-caption text-muted">Ainda não achei produtos com preço nesse texto.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={run.isPending} disabled={!items?.length} onClick={() => run.mutate()}>
          {items?.length
            ? `adicionar ${items.length} ${items.length === 1 ? 'produto' : 'produtos'}`
            : 'adicionar'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          cancelar
        </Button>
      </div>
    </Card>
  );
}

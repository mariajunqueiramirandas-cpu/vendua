import {
  ArrowLeft,
  ArrowRight,
  Check,
  Motorcycle,
  Storefront,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type StoreView } from '../../lib/api.ts';
import { money, phone as fmtPhone, waDigits } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, MoneyField, PhoneInput, TextInput, TimeInput } from '../../ui/fields.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { fromWeek, TimeRangeField, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';
import type { Draft } from './MiniStore.tsx';

export interface StepProps {
  s: StoreView;
  draft: Draft;
  patch: (d: Partial<Draft>) => void;
  /** PATCH /store; false when Core said no (the toast already told the merchant why) */
  save: (body: Record<string, unknown>) => Promise<boolean>;
  next: (praise?: string) => void;
  back: (() => void) | null;
}

/** One question per screen: a big title, one plain sentence, the answer, one obvious button. */
function Frame({
  title,
  hint,
  children,
  onSubmit,
  label = 'Continuar',
  disabled,
  busy,
  back,
  skip,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  onSubmit: () => void;
  label?: string;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  back: (() => void) | null;
  skip?: { label: string; onClick: () => void } | undefined;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="animate-fade-up space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && !busy) onSubmit();
      }}
    >
      <div>
        <h2
          ref={head}
          tabIndex={-1}
          className="t-title-1 outline-none focus-visible:shadow-none md:text-[2rem]"
        >
          {title}
        </h2>
        {hint ? <p className="t-body-lg mt-2 text-muted">{hint}</p> : null}
      </div>
      {children}
      <div className="sticky bottom-[var(--kb,0px)] z-20 -mx-4 flex scroll-mb-24 flex-col-reverse gap-3 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:flex-row sm:items-center md:-mx-8 md:px-8 lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none">
        {back ? (
          <Button variant="ghost" size="lg" icon={<ArrowLeft />} onClick={back}>
            voltar
          </Button>
        ) : null}
        <div className="hidden flex-1 sm:block" />
        {skip ? (
          <Button variant="quiet" size="lg" onClick={skip.onClick}>
            {skip.label}
          </Button>
        ) : null}
        <Button type="submit" size="lg" loading={!!busy} disabled={disabled}>
          {label} <ArrowRight />
        </Button>
      </div>
    </form>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  return [busy, (p: Promise<unknown>) => (setBusy(true), p.finally(() => setBusy(false)))] as const;
}

export function NameStep({ s, draft, patch, save, next, back }: StepProps) {
  const [busy, run] = useBusy();
  const name = draft.name.trim();
  return (
    <Frame
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
          autoComplete="organization"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Ex.: Doces da Maria"
        />
      </Field>
    </Frame>
  );
}

export function LogoStep({ draft, patch, save, next, back }: StepProps) {
  return (
    <Frame
      title="Tem uma foto ou logo?"
      hint="Pode ser uma foto tirada agora, do celular mesmo. Se não tiver, tudo bem."
      back={back}
      label={draft.logoUrl ? 'Continuar' : 'Pular, coloco depois'}
      onSubmit={() => next(draft.logoUrl ? 'Ficou lindo!' : undefined)}
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

export function WhatsappStep({ s, save, next, back }: StepProps) {
  const [shown, setShown] = useState(fmtPhone(s.profile.whatsapp));
  const [busy, run] = useBusy();
  const digits = waDigits(shown);
  const ok = !!digits && /^\d{12,13}$/.test(digits);
  return (
    <Frame
      title="Qual é o seu WhatsApp?"
      hint="É o número que seus clientes usam para falar com você. Pode digitar só os números."
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

const TAGLINES = ['Feito com carinho', 'Tudo fresquinho', 'Entrega rápida', 'O melhor da cidade'];

export function TaglineStep({ s, draft, patch, save, next, back }: StepProps) {
  const [busy, run] = useBusy();
  const tag = draft.tagline.trim();
  return (
    <Frame
      title="Uma frase que descreve a loja"
      hint="Curtinha, como se fosse contar para um vizinho. Se não vier nada na cabeça, toque em uma das ideias."
      back={back}
      busy={busy}
      label={tag ? 'Continuar' : 'Pular, coloco depois'}
      onSubmit={() =>
        void run(
          (tag === (s.profile.tagline ?? '')
            ? Promise.resolve(true)
            : save({ profile: { tagline: tag || null } })
          ).then((ok) => ok && next(tag ? 'Adorei!' : undefined)),
        )
      }
    >
      <Field label="Frase" optional htmlFor="ob-tag">
        <TextInput
          id="ob-tag"
          maxLength={120}
          value={draft.tagline}
          onChange={(e) => patch({ tagline: e.target.value })}
          placeholder="Ex.: Pudins sem furinhos"
        />
      </Field>
      <Chips
        label="ideias de frase"
        value={tag}
        onChange={(v) => patch({ tagline: v })}
        options={TAGLINES.map((t) => ({ value: t, label: t }))}
      />
    </Frame>
  );
}

const PRESETS = {
  todos: { label: 'Todos os dias', days: [0, 1, 2, 3, 4, 5, 6] },
  sab: { label: 'Segunda a sábado', days: [1, 2, 3, 4, 5, 6] },
  semana: { label: 'Segunda a sexta', days: [1, 2, 3, 4, 5] },
  fim: { label: 'Fim de semana', days: [0, 6] },
} as const;
type Preset = keyof typeof PRESETS;

const build = (days: readonly number[], open: string, close: string): WeekModel =>
  Array.from({ length: 7 }, (_, d) => (days.includes(d) ? [{ open, close }] : []));

/** Which preset (and hours) a saved week is, or null when it's more custom than that. */
function detect(w: WeekModel): { preset: Preset; open: string; close: string } | null {
  const days = w.flatMap((r, d) => (r.length ? [d] : []));
  const first = w[days[0] ?? 0]?.[0];
  if (!first) return null;
  if (
    !days.every(
      (d) => w[d]!.length === 1 && w[d]![0]!.open === first.open && w[d]![0]!.close === first.close,
    )
  )
    return null;
  const hit = (Object.keys(PRESETS) as Preset[]).find(
    (k) => PRESETS[k].days.length === days.length && PRESETS[k].days.every((d) => days.includes(d)),
  );
  return hit ? { preset: hit, open: first.open, close: first.close } : null;
}

export function HoursStep({ s, draft, patch, save, next, back }: StepProps) {
  const saved = detect(draft.week);
  const [preset, setPreset] = useState<Preset | 'custom'>(
    saved?.preset ?? (draft.week.some((d) => d.length) ? 'custom' : 'sab'),
  );
  const [open, setOpen] = useState(saved?.open ?? '09:00');
  const [close, setClose] = useState(saved?.close ?? '18:00');
  const [busy, run] = useBusy();
  // a first visit shows a sensible week right away; nothing is stored until "Continuar"
  useEffect(() => {
    if (!draft.week.some((d) => d.length))
      patch({ week: build(PRESETS.sab.days, '09:00', '18:00') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const apply = (p: Preset, o: string, c: string) => {
    setPreset(p);
    setOpen(o);
    setClose(c);
    patch({ week: build(PRESETS[p].days, o, c) });
  };
  const anyDay = draft.week.some((d) => d.length);
  return (
    <Frame
      title="Quando a loja abre?"
      hint="Escolha os dias e o horário. Depois você pode mudar quando quiser."
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
          ...(Object.keys(PRESETS) as Preset[]).map((k) => ({ value: k, label: PRESETS[k].label })),
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
        summary="Ajuste dia por dia, com mais de um horário se precisar"
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

function Choice({
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
      onClick={onClick}
      className={cn(
        'flex min-h-24 w-full items-center gap-4 rounded-lg p-4 text-left ring-2 transition-[background-color,box-shadow,transform] duration-(--duration-quick) active:scale-[0.99]',
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

export function HowStep({ s, draft, patch, save, next, back }: StepProps) {
  const qc = useQueryClient();
  const [busy, run] = useBusy();
  const [places, setPlaces] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const hasZones = s.zones.length > 0;
  const list = places
    .split(/[,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  const needZone = draft.delivery && !hasZones;
  const ok = (draft.pickup || draft.delivery) && (!needZone || (list.length > 0 && fee !== null));
  return (
    <Frame
      title="Como o cliente recebe?"
      hint="Pode marcar os dois."
      back={back}
      busy={busy}
      disabled={!ok}
      onSubmit={() =>
        void run(
          (async () => {
            // the zone first: if it fails, delivery stays off rather than on with nowhere to go
            if (needZone) {
              try {
                await api.createZone({
                  name: 'Entrega',
                  kind: 'neighborhood',
                  neighborhoods: list,
                  feeCents: fee ?? 0,
                });
                void qc.invalidateQueries({ queryKey: qk.store });
              } catch (e) {
                return void toast.error(messageOf(e));
              }
            }
            if (
              !(await save({
                operations: { pickupEnabled: draft.pickup, deliveryEnabled: draft.delivery },
              }))
            )
              return;
            next(
              draft.delivery && draft.pickup
                ? 'Retirada e entrega, que capricho!'
                : draft.delivery
                  ? 'Entrega combinada!'
                  : 'Retirada combinada!',
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
          body="O cliente busca na sua loja."
        />
        <Choice
          on={draft.delivery}
          onClick={() => patch({ delivery: !draft.delivery })}
          icon={<Motorcycle />}
          title="Entrega"
          body="Você leva até a casa do cliente."
        />
      </div>
      {draft.delivery ? (
        hasZones ? (
          <Card className="t-body p-4">
            Você já tem {s.zones.length} {s.zones.length === 1 ? 'área' : 'áreas'} de entrega.{' '}
            <Link to="/loja#entrega" className="font-semibold underline underline-offset-2">
              ver ou ajustar
            </Link>
          </Card>
        ) : (
          <Card className="animate-fade-up space-y-4 p-4">
            <Field
              label="Em quais bairros você entrega?"
              htmlFor="ob-places"
              helper="Separe com vírgula. Depois dá para separar por área, com taxas diferentes."
            >
              <TextInput
                id="ob-places"
                maxLength={400}
                value={places}
                onChange={(e) => setPlaces(e.target.value)}
                placeholder="Ex.: Centro, Itaúna, Vilatur"
              />
            </Field>
            <Field
              label="Quanto cobra pela entrega?"
              htmlFor="ob-fee"
              helper="Se for de graça, digite 0."
            >
              <MoneyField id="ob-fee" cents={fee} onCommit={setFee} />
            </Field>
          </Card>
        )
      ) : null}
    </Frame>
  );
}

export function PixStep({
  hasPix,
  next,
  back,
}: Pick<StepProps, 'next' | 'back'> & { hasPix: boolean }) {
  const qc = useQueryClient();
  const [type, setType] = useState('phone');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => api.updatePayments({ pix: { keyType: type, key, beneficiary: name } }),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      void qc.invalidateQueries({ queryKey: qk.home });
      next('Pix pronto, o dinheiro cai direto na sua conta.');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (hasPix)
    return (
      <Frame
        title="Receber pelo Pix"
        hint="Sua chave Pix já está cadastrada. Os clientes veem o Pix com o valor já preenchido."
        back={back}
        onSubmit={() => next()}
      >
        <></>
      </Frame>
    );
  return (
    <Frame
      title="Para onde vai o dinheiro?"
      hint="Coloque a chave Pix que você já usa. O cliente paga e o dinheiro cai direto na sua conta, sem taxa nossa."
      back={back}
      busy={m.isPending}
      disabled={!key.trim() || name.trim().length < 2}
      label="Salvar Pix"
      skip={{ label: 'Faço depois', onClick: () => next() }}
      onSubmit={() => m.mutate()}
    >
      <Chips
        label="tipo de chave"
        value={type}
        onChange={setType}
        options={[
          { value: 'phone', label: 'celular' },
          { value: 'cpf', label: 'CPF' },
          { value: 'cnpj', label: 'CNPJ' },
          { value: 'email', label: 'e-mail' },
          { value: 'random', label: 'aleatória' },
        ]}
      />
      <Field label="Chave Pix" htmlFor="ob-pix">
        <TextInput
          id="ob-pix"
          value={key}
          inputMode={type === 'email' ? 'email' : type === 'random' ? 'text' : 'numeric'}
          autoComplete="off"
          onChange={(e) => setKey(e.target.value)}
        />
      </Field>
      <Field label="Nome de quem recebe" htmlFor="ob-pixname" helper="Como aparece no seu banco.">
        <TextInput
          id="ob-pixname"
          maxLength={25}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Frame>
  );
}

const CHEERS = ['Que delícia!', 'Esse vai vender!', 'Deu fome aqui!', 'Já quero um!'];

export function ProductsStep({
  products,
  firstCategory,
  next,
  back,
}: Pick<StepProps, 'next' | 'back'> & {
  products: { id: string; name: string; priceCents: number }[];
  firstCategory: string | null;
}) {
  const qc = useQueryClient();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const categoryId = firstCategory ?? (await api.createCategory('Cardápio')).category.id;
      return api.createProduct({ name: name.trim(), priceCents: price ?? 0, categoryId });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      void qc.invalidateQueries({ queryKey: qk.home });
      toast(`${r.product.name} no cardápio. ${CHEERS[products.length % CHEERS.length]}`);
      setName('');
      setPrice(null);
      nameRef.current?.focus({ preventScroll: true });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const ready = name.trim().length >= 2 && price !== null;
  const goal = 3;
  return (
    <Frame
      title="O que você vende?"
      hint="Comece com os 3 que mais saem. Foto e detalhes você coloca depois, com calma."
      back={back}
      busy={add.isPending}
      label={
        ready ? 'Adicionar ao cardápio' : products.length ? 'Terminei' : 'Pular, coloco depois'
      }
      skip={
        ready && products.length
          ? { label: 'Terminei', onClick: () => next('Cardápio no ar!') }
          : undefined
      }
      onSubmit={() =>
        ready ? add.mutate() : next(products.length ? 'Cardápio no ar!' : undefined)
      }
    >
      <div
        className="flex items-center gap-2"
        role="img"
        aria-label={`${Math.min(products.length, goal)} de ${goal} produtos`}
      >
        {Array.from({ length: goal }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-2 flex-1 rounded-full transition-colors duration-(--duration-smooth)',
              i < products.length ? 'bg-[var(--chart)]' : 'bg-line-strong',
            )}
          />
        ))}
      </div>
      {products.length ? (
        <ul className="space-y-2">
          {products.slice(-4).map((p) => (
            <li
              key={p.id}
              className="animate-fade-up flex min-h-12 items-center gap-3 rounded-md bg-surface px-4 depth-1"
            >
              <Check weight="bold" className="size-5 shrink-0 text-success" />
              <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
              <span className="tnum text-muted">{money(p.priceCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Card className="space-y-4 p-4">
        <Field label={products.length ? 'Mais um produto' : 'Nome do produto'} htmlFor="ob-p">
          <TextInput
            id="ob-p"
            ref={nameRef}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Pudim de leite"
          />
        </Field>
        <Field label="Preço" htmlFor="ob-price">
          <MoneyField id="ob-price" cents={price} onCommit={setPrice} />
        </Field>
      </Card>
      <p className="t-body text-muted">
        Tem uma lista no WhatsApp?{' '}
        <Link to="/cardapio" className="font-semibold underline underline-offset-2">
          Cole no Cardápio
        </Link>{' '}
        e eu separo tudo.
      </p>
    </Frame>
  );
}

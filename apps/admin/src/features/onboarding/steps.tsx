import { Camera, Check, ClipboardText } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api, withRetryScope, type Category, type StoreView } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, MoneyField, TextArea, TextInput } from '../../ui/fields.tsx';
import type { Pose } from '../../ui/Mascote.tsx';
import { PhotoField, type Photo } from '../../ui/PhotoField.tsx';
import { StepFrame } from '../../ui/StepFrame.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Say } from './Guide.tsx';
import type { Draft } from './MiniStore.tsx';
import type { Segment } from './segments.ts';
import { mediaUrl } from '../../lib/media.ts';

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
  /** what the store sells (the generic one while unknown) */
  segment: Segment;
  /** the person filling it in: their verified WhatsApp and name suggest answers */
  me: { name: string; phone: string };
}

/**
 * One question per screen (StepFrame) with a quiet "pular" under the main button, beside "voltar".
 * The onboarding slides its questions in itself, and names the part in its header.
 */
/** What Duá has to say over the open question: praise for the answer just given, a part just
 *  finished, and the pose of a part that begins (then he's above the title, bigger). */
export const Voice = createContext<{
  praise: string | null;
  done: string | null;
  pose: Pose | null;
} | null>(null);

export function Frame({
  skipLabel = 'deixar para depois',
  onSkip,
  hint,
  ...p
}: Parameters<typeof StepFrame>[0] & { onSkip?: (() => void) | undefined; skipLabel?: string }) {
  const said = useContext(Voice);
  // a part's opening already put Duá above the title: the hint stays a plain line then
  const face = !said?.pose;
  const praise = face ? (said?.praise ?? null) : null;
  return (
    <StepFrame
      enter={false}
      big
      {...p}
      lead={
        hint || praise ? (
          <Say praise={praise} face={face}>
            {hint}
          </Say>
        ) : undefined
      }
      aside={
        onSkip ? (
          // its padding hangs in the gutter, so the words end on the column's edge
          <Button variant="ghost" size="sm" onClick={onSkip} className="-mr-3.5 text-muted">
            {skipLabel}
          </Button>
        ) : (
          p.aside
        )
      }
    />
  );
}

/** Delivery is switched on only once there's somewhere to deliver (the entrega step). */
export const deliveryReady = (s: StoreView) =>
  s.zones.some((z) => z.active) || s.distancePricing.enabled;

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
  segment,
}: Pick<StepProps, 'next' | 'back' | 'skip' | 'segment'> & {
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
    mutationFn: async (_: void, ctx) => {
      const categoryId = await category();
      // past that await the retry scope is gone: back in it, a retry reuses the product's key
      const r = await withRetryScope(ctx, () =>
        api.createProduct({ name: name.trim(), priceCents: price ?? 0, categoryId }),
      );
      // the product exists once created: a failed photo must not leave the form to create it twice
      let photoFailed = false;
      if (photo)
        await api
          .setMedia(r.product.id, [
            { url: photo.url, width: photo.width ?? null, height: photo.height ?? null },
          ])
          .catch(() => (photoFailed = true));
      return { ...r, photoFailed };
    },
    onSuccess: (r) => {
      refresh();
      haptic.commit();
      if (r.photoFailed)
        toast.error(
          `${r.product.name} entrou no cardápio, mas a foto não. Toque na linha para pôr de novo.`,
        );
      else toast(`${r.product.name} no cardápio. ${CHEERS[products.length % CHEERS.length]}`);
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
      title="O que você vende?"
      hint={`Comece com os ${GOAL} que mais saem, com foto: é o que faz o cliente pedir. Detalhes e opções você coloca depois.`}
      back={back}
      busy={add.isPending}
      disabled={!ready && !products.length}
      why={
        name.trim().length < 2
          ? 'Escreva o nome do produto.'
          : 'Coloque o preço. Se for de graça, digite 0.'
      }
      label={ready || !products.length ? 'Adicionar ao cardápio' : 'Terminei'}
      onSkip={products.length ? undefined : skip}
      aside={
        ready && products.length ? (
          <Button variant="ghost" onClick={() => next('Cardápio no ar!')} className="-mr-3">
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
        {/* the other way in, inside the same card: a list pasted from WhatsApp */}
        {paste ? null : (
          <Button
            variant="ghost"
            size="sm"
            icon={<ClipboardText />}
            className="-mx-3.5 -mb-2 text-muted"
            onClick={() => setPaste(true)}
          >
            tenho a lista no WhatsApp, quero colar
          </Button>
        )}
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
      ) : null}
    </Frame>
  );
}

function ProductRow({ p, onPhoto }: { p: Listed; onPhoto: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <li className="animate-fade-up flex min-h-16 items-center gap-3 rounded-md bg-surface px-3 py-2 depth-1">
      {p.imageUrl ? (
        <img
          src={mediaUrl(p.imageUrl)}
          alt=""
          className="size-12 shrink-0 rounded-md object-cover"
        />
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
    mutationFn: async (_: void, ctx) => {
      const categoryId = await category();
      return withRetryScope(ctx, () =>
        api.importProducts(text.trim().slice(0, 20_000), categoryId),
      );
    },
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

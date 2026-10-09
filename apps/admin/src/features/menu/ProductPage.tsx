import {
  ArrowDown,
  ArrowsDownUp,
  ArrowUp,
  Calculator,
  CalendarBlank,
  Clock,
  Copy,
  CopySimple,
  Eye,
  EyeSlash,
  Leaf,
  ListChecks,
  MagnifyingGlass,
  Package,
  Plus,
  SealPercent,
  SlidersHorizontal,
  Stack,
  Trash,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { priceDisplay } from '@vendua/kernel/rules';
import {
  api,
  ApiError,
  type DietaryTag,
  type KitSlot,
  type OptionGroup,
  type OptionItem,
  type PricingDefaults,
  type PricingRule,
  type ProductDetail,
} from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { money, plural } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { takeSharedPhoto } from '../../lib/share.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import {
  Chips,
  CommitInput,
  Field,
  MoneyField,
  SaveMark,
  Segmented,
  Select,
  SavedStepper,
  Stepper,
  TextInput,
  Toggle,
  useSaveState,
} from '../../ui/fields.tsx';
import { ProductSkeleton, RowsSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { availability } from '../../ui/ProductTile.tsx';
import { toast } from '../../ui/Toast.tsx';
import { pct, PricingSheet } from './PricingSheet.tsx';
import { PromoEditor } from './PromoEditor.tsx';
import { outsideNow } from './schedule.ts';
import { ScheduleEditor } from './ScheduleEditor.tsx';
import { useHeld } from './held.ts';

export default function ProductPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  useEffect(() => {
    if (search.get('foto') === 'compartilhada') void takeSharedPhoto().then(setSharedFile);
  }, [search]);
  const { data, error, refetch } = useQuery({
    queryKey: qk.product(id),
    queryFn: () => api.product(id),
  });
  const cats = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  if (error && !data)
    return (
      <PageBody>
        <PageHeader title="Produto" back="/cardapio" />
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        <PageHeader title="Produto" back="/cardapio" />
        <ProductSkeleton />
      </PageBody>
    );
  return (
    <Editor
      p={data.product}
      cats={cats.data?.categories ?? []}
      openPhoto={search.get('foto') === '1'}
      sharedFile={sharedFile}
    />
  );
}

function Editor({
  p,
  cats,
  openPhoto,
  sharedFile,
}: {
  p: ProductDetail;
  cats: Cats;
  openPhoto: boolean;
  sharedFile: File | null;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const field = useSaveState();
  const put = (next: ProductDetail) => {
    // keeps pricingDefaults, which only GET /products/:id carries
    qc.setQueryData<{ product: ProductDetail; pricingDefaults: PricingDefaults | null }>(
      qk.product(p.id),
      (d) => ({ pricingDefaults: null, ...d, product: next }),
    );
    void qc.invalidateQueries({ queryKey: qk.catalog });
  };
  // fields save independently: only the newest reply may paint, an older one asks for the truth
  const seq = useRef(0);
  const patch = (body: Record<string, unknown>) => {
    const mine = ++seq.current;
    return field
      .track(api.updateProduct(p.id, body))
      .then((r) => {
        if (mine === seq.current) put(r.product);
        else void qc.invalidateQueries({ queryKey: qk.product(p.id) });
        if (r.waitlistWoken)
          toast(
            `${r.waitlistWoken} pessoas esperavam por ${r.product.name}. Avise elas em Marketing.`,
          );
        return r;
      })
      .catch((e) =>
        toast.error(
          e instanceof ApiError && e.field === 'compareAtPriceCents'
            ? 'O preço “de” precisa ser maior que o preço. Mude ou apague o preço “de”.'
            : e instanceof ApiError && e.field === 'promoSchedule.priceCents'
              ? 'O preço precisa ficar acima do preço da promoção. Mude ou desligue a promoção.'
              : messageOf(e),
        ),
      );
  };
  const media = useMutation({
    mutationFn: (m: ProductDetail['gallery']) => api.setMedia(p.id, m),
    onSuccess: (r) => put(r.product),
    onError: (e) => toast.error(messageOf(e)),
  });
  const dup = useMutation({
    mutationFn: () => api.duplicateProduct(p.id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast('Cópia criada (escondida até você revisar)');
      nav(`/cardapio/produto/${r.product.id}`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  // a soft delete: "desfazer" restores it (Core keeps it, its orders keep their lines)
  const del = useMutation({
    mutationFn: () => api.deleteProduct(p.id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.product(p.id) });
      void qc.invalidateQueries({ queryKey: qk.catalog });
      nav('/cardapio', { replace: true, state: { vt: 'pop' } });
      toast(`${p.name} apagado`, {
        undo: () =>
          void api.restoreProduct(p.id).then(
            () => {
              void qc.invalidateQueries({ queryKey: qk.catalog });
              toast(`${p.name} voltou para o cardápio`);
            },
            (e) => toast.error(messageOf(e)),
          ),
      });
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const [pricing, setPricing] = useState(false);
  const a = availability(p);
  const tracked = p.stockQuantity !== null;
  const promo = p.promoSchedule ?? null;
  // the storefront's own summary (Core's): which price form, the badge, the schedule's words
  const sf = p.storefront;
  const price = priceDisplay(sf);
  const soldOut = sf.status === 'sold_out';
  // outside a 'hidden' schedule the store doesn't list it at all
  const unlisted =
    sf.status === 'archived' || (outsideNow(p) && p.availabilitySchedule?.outside === 'hidden');
  const groupsSummary = p.groups.length
    ? `${plural(p.groups.length, 'grupo', 'grupos')}, ${plural(
        p.groups.reduce((n, g) => n + g.options.length, 0),
        'opção',
        'opções',
      )}`
    : 'Sem opções (ex.: sabor, tamanho, calda)';

  return (
    <PageBody>
      <PageHeader
        title={p.name}
        back="/cardapio"
        subtitle={<SaveMark state={field.state} />}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<Copy />}
              loading={dup.isPending}
              onClick={() => dup.mutate()}
            >
              duplicar
            </Button>
            <Button
              variant="secondary"
              icon={a === 'hidden' ? <Eye /> : <EyeSlash />}
              onClick={() => void patch({ availability: a === 'hidden' ? 'available' : 'hidden' })}
            >
              {a === 'hidden' ? 'mostrar na loja' : 'esconder da loja'}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] [&>*]:min-w-0">
        <div className="space-y-5">
          <PhotoField
            label="foto do produto"
            photos={p.gallery}
            autoOpen={openPhoto}
            initialFile={sharedFile}
            vtKey={`product:${p.id}`}
            onChange={(next) =>
              media.mutateAsync(
                next.map((x) => ({
                  url: x.url,
                  alt: x.alt ?? p.name,
                  width: x.width ?? null,
                  height: x.height ?? null,
                })),
              )
            }
          />
          <Card className="space-y-5 p-5">
            <Field label="Nome" htmlFor="pname">
              <CommitInput
                id="pname"
                maxLength={120}
                value={p.name}
                onCommit={(v) => void patch({ name: v })}
                validate={(v) =>
                  v.trim().length < 2 ? 'Dê um nome com pelo menos 2 letras.' : null
                }
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
              <Field
                label="Preço"
                htmlFor="pprice"
                {...(promo
                  ? { helper: `Na promoção por horário: ${money(promo.priceCents)}.` }
                  : {})}
              >
                <MoneyField
                  id="pprice"
                  cents={p.priceCents}
                  validate={(v) =>
                    p.compareAtPriceCents !== null && v >= p.compareAtPriceCents
                      ? `Precisa ficar abaixo do preço “de” (${money(p.compareAtPriceCents)}).`
                      : promo && v <= promo.priceCents
                        ? `Precisa ficar acima do preço da promoção (${money(promo.priceCents)}).`
                        : null
                  }
                  onCommit={(v) => void patch({ priceCents: v ?? 0 })}
                />
              </Field>
              <Field
                label="Preço “de”"
                optional
                htmlFor="pcompare"
                helper="Aparece riscado ao lado do preço, para mostrar a promoção."
              >
                <MoneyField
                  id="pcompare"
                  cents={p.compareAtPriceCents}
                  allowEmpty
                  placeholder=""
                  validate={(v) =>
                    v <= p.priceCents
                      ? `Precisa ser maior que ${money(p.priceCents)}. Vazio tira a promoção.`
                      : null
                  }
                  onCommit={(v) => void patch({ compareAtPriceCents: v })}
                />
              </Field>
            </div>
            <CostLine p={p} onOpen={() => setPricing(true)} />
            <Field
              label="Descrição"
              optional
              htmlFor="pdesc"
              helper="O que tem, tamanho, para quantas pessoas."
            >
              <CommitInput
                id="pdesc"
                multiline
                maxLength={1000}
                value={p.description ?? ''}
                onCommit={(v) => void patch({ description: v || null })}
              />
            </Field>
            <Field label="Categoria" htmlFor="pcat">
              <Select
                id="pcat"
                value={p.categoryId}
                onChange={(v) => void patch({ categoryId: v })}
                options={cats.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </Card>
        </div>

        <div className="space-y-4">
          <div>
            <p className="t-caption mb-2 px-1 font-semibold text-muted">Como aparece na loja</p>
            <Card className="flex gap-3 p-3">
              <span className="size-20 shrink-0 overflow-hidden rounded-sm bg-sunken">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="size-full object-cover" />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="font-semibold">{p.name}</p>
                {p.description ? (
                  <p className="t-caption line-clamp-2 text-muted">{p.description}</p>
                ) : null}
                {soldOut ? (
                  <p className="t-caption mt-1 inline-flex items-center gap-1 font-semibold text-danger">
                    {sf.availabilityLabel ? (
                      <Clock className="size-3.5 shrink-0" aria-hidden />
                    ) : null}
                    {sf.availabilityLabel ?? 'Esgotado'}
                  </p>
                ) : (
                  <p className="tnum mt-1 font-semibold">
                    {price.struckCents !== null ? (
                      <>
                        <s className="mr-1.5 font-normal text-muted">
                          <span className="sr-only">de </span>
                          {money(price.struckCents)}
                        </s>
                        <span className="sr-only">por </span>
                      </>
                    ) : null}
                    {price.form === 'from' ? (
                      <span className="font-normal text-muted">a partir de </span>
                    ) : null}
                    {money(price.cents)}
                  </p>
                )}
                {price.promoLabel ? (
                  <p className="t-caption mt-1 flex items-center gap-1 text-muted">
                    <SealPercent className="size-3.5 shrink-0" aria-hidden />
                    Promoção: {price.promoLabel}
                  </p>
                ) : null}
                {!soldOut && sf.lowStock && p.stockQuantity ? (
                  <p className="t-caption mt-1 font-semibold text-warning">
                    {p.stockQuantity === 1 ? 'Última unidade' : `Últimas ${p.stockQuantity}`}
                  </p>
                ) : null}
                {unlisted ? (
                  <p className="t-caption mt-1 flex items-center gap-1 text-muted">
                    <EyeSlash className="size-3.5 shrink-0" aria-hidden />
                    {sf.status === 'archived' ? 'escondido da loja' : 'fora do cardápio agora'}
                  </p>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <TrendUp className="size-5 text-muted" />
              <p className="tnum mt-1 font-display text-2xl font-semibold">{p.sales30.qty}</p>
              <p className="t-caption text-muted">
                vendidos em 30 dias · {money(p.sales30.revenueCents)}
              </p>
            </Card>
            <Card className="p-4">
              <UsersThree className="size-5 text-muted" />
              <p className="tnum mt-1 font-display text-2xl font-semibold">{p.waiting}</p>
              <p className="t-caption text-muted">na lista de espera</p>
            </Card>
          </div>

          <Disclosure
            title="Disponibilidade"
            icon={<Eye />}
            defaultOpen
            summary={
              a === 'available'
                ? outsideNow(p)
                  ? 'Disponível, mas fora do horário agora'
                  : 'Disponível na loja'
                : a === 'hidden'
                  ? 'Escondido da loja'
                  : p.soldOutUntil
                    ? 'Esgotado hoje, volta amanhã'
                    : 'Esgotado'
            }
          >
            <Chips
              label="disponibilidade"
              value={a === 'sold_out' && p.soldOutUntil ? 'sold_out_today' : a}
              onChange={(v) => void patch({ availability: v })}
              options={[
                { value: 'available', label: 'disponível' },
                { value: 'sold_out_today', label: 'esgotado hoje' },
                { value: 'sold_out', label: 'esgotado' },
                { value: 'hidden', label: 'escondido' },
              ]}
            />
            <p className="t-caption mt-3 text-muted">
              “Esgotado hoje” volta sozinho à meia-noite. Quem pedir para ser avisado entra na lista
              de espera.
            </p>
          </Disclosure>

          <Disclosure
            title="Dias e horários"
            icon={<Clock />}
            summary={
              p.availabilitySchedule && sf.availabilityScheduleLabel
                ? `${sf.availabilityScheduleLabel}${outsideNow(p) ? ' · fora do horário agora' : ''}`
                : 'Todos os dias em que a loja abre'
            }
          >
            <ScheduleEditor p={p} onSaved={put} />
          </Disclosure>

          <Disclosure
            title="Promoção por horário"
            icon={<SealPercent />}
            summary={
              promo
                ? [`${money(promo.priceCents)}${p.promoNow ? ' agora' : ''}`, sf.promoScheduleLabel]
                    .filter(Boolean)
                    .join(' · ')
                : 'Sem promoção (ex.: happy hour, terça do pastel)'
            }
          >
            <PromoEditor p={p} onSaved={put} />
          </Disclosure>

          <Disclosure
            title="Estoque"
            icon={<Package />}
            summary={
              tracked
                ? `${p.stockQuantity} em estoque${p.lowStockThreshold != null ? ` · alerta com ${p.lowStockThreshold}` : ''}`
                : 'Feito sob pedido (sem contar estoque)'
            }
          >
            <Toggle
              checked={tracked}
              onChange={(v) =>
                void patch({
                  stockQuantity: v ? 10 : null,
                  ...(v ? {} : { lowStockThreshold: null }),
                })
              }
              label="Contar estoque"
              description="Quando chegar a zero, o produto aparece como esgotado sozinho."
            />
            {tracked ? (
              <div className="mt-4 space-y-4">
                <Field label="Quantidade agora">
                  <SavedStepper
                    label="quantidade em estoque"
                    value={p.stockQuantity ?? 0}
                    max={100000}
                    onSave={(v) => patch({ stockQuantity: v })}
                  />
                </Field>
                <Field
                  label="Me avise quando tiver só"
                  helper="Aparece em “Precisa de você” no Início."
                >
                  <SavedStepper
                    label="alerta de estoque baixo"
                    value={p.lowStockThreshold ?? 0}
                    max={1000}
                    onSave={(v) => patch({ lowStockThreshold: v || null })}
                  />
                </Field>
              </div>
            ) : null}
          </Disclosure>

          <Disclosure title="Opções" icon={<ListChecks />} summary={groupsSummary}>
            <OptionsEditor p={p} cats={cats} onSaved={put} />
          </Disclosure>

          <Disclosure
            title="Alergênicos e dieta"
            icon={<Leaf />}
            summary={
              p.dietary?.length
                ? p.dietary.map((t) => DIET_LABEL[t]).join(' · ')
                : 'Nada informado (ex.: sem glúten, contém lactose)'
            }
          >
            <DietaryEditor p={p} patch={patch} />
          </Disclosure>

          <Disclosure
            title="Encomenda"
            icon={<CalendarBlank />}
            summary={
              p.requiresPreorder
                ? `Só por encomenda, com ${plural(p.preorderLeadDays, 'dia', 'dias')} de antecedência`
                : 'Pronta entrega'
            }
          >
            <Toggle
              checked={p.requiresPreorder}
              onChange={(v) => void patch({ requiresPreorder: v })}
              label="Só por encomenda"
              description="O cliente escolhe a data na hora de pedir."
            />
            {p.requiresPreorder ? (
              <Field label="Antecedência mínima" className="mt-4">
                <SavedStepper
                  label="dias de antecedência"
                  value={p.preorderLeadDays}
                  max={60}
                  suffix=" dias"
                  onSave={(v) => patch({ preorderLeadDays: v })}
                />
              </Field>
            ) : null}
          </Disclosure>

          <Disclosure
            title="Kit"
            icon={<Stack />}
            summary={
              p.kind === 'combo'
                ? `${plural(p.comboSlots.length, 'etapa', 'etapas')} para o cliente montar`
                : 'Não é um kit'
            }
          >
            <KitEditor p={p} cats={cats} onSaved={put} />
          </Disclosure>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="secondary"
              icon={<Copy />}
              loading={dup.isPending}
              className="md:hidden"
              onClick={() => dup.mutate()}
            >
              duplicar
            </Button>
            <Button
              variant="ghost"
              icon={<Trash />}
              loading={del.isPending}
              className="text-danger!"
              onClick={() => del.mutate()}
            >
              apagar produto
            </Button>
          </div>
          <p className="t-caption -mt-2 px-1 text-muted">
            Apagar tira do cardápio e da loja. Os pedidos antigos continuam com ele.
          </p>
        </div>
      </div>
      <PricingSheet product={pricing ? p : null} onClose={() => setPricing(false)} />
    </PageBody>
  );
}

/** Under the price: what one costs and what's left (Core's marginBp), or the way to work it out. */
function CostLine({ p, onOpen }: { p: ProductDetail; onOpen: () => void }) {
  const cost = p.costCents ?? null;
  const margin = p.marginBp ?? null;
  const target = p.pricing?.marginBp ?? null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="press t-caption -mx-2 -mt-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 text-left hover:bg-hover"
    >
      <Calculator className="size-4.5 shrink-0 text-muted" aria-hidden />
      {cost !== null ? (
        <span className="min-w-0 flex-1">
          <span className="text-muted">custo </span>
          <span className="tnum font-semibold">{money(cost)}</span>
          {margin !== null ? (
            <>
              <span className="text-muted"> · </span>
              <span
                className={cn(
                  'tnum font-semibold',
                  margin < 0 ? 'text-danger' : target !== null && margin < target && 'text-warning',
                )}
              >
                margem {pct(margin)}
              </span>
            </>
          ) : null}
        </span>
      ) : (
        <span className="min-w-0 flex-1 text-muted">quanto cobrar?</span>
      )}
      <span className="font-semibold text-primary">calcular</span>
    </button>
  );
}

/** pt-BR for Core's DIETARY_TAGS, in the order the chips show them */
const DIET_LABEL: Record<DietaryTag, string> = {
  vegano: 'vegano',
  vegetariano: 'vegetariano',
  sem_gluten: 'sem glúten',
  sem_lactose: 'sem lactose',
  apimentado: 'apimentado',
  contem_gluten: 'contém glúten',
  contem_lactose: 'contém lactose',
  contem_ovo: 'contém ovo',
  contem_amendoim: 'contém amendoim',
  contem_castanhas: 'contém castanhas',
  contem_frutos_do_mar: 'contém frutos do mar',
};
const DIET_IS: DietaryTag[] = ['vegano', 'vegetariano', 'sem_gluten', 'sem_lactose', 'apimentado'];
const DIET_HAS: { tag: DietaryTag; label: string }[] = [
  { tag: 'contem_gluten', label: 'glúten' },
  { tag: 'contem_lactose', label: 'lactose' },
  { tag: 'contem_ovo', label: 'ovo' },
  { tag: 'contem_amendoim', label: 'amendoim' },
  { tag: 'contem_castanhas', label: 'castanhas' },
  { tag: 'contem_frutos_do_mar', label: 'frutos do mar' },
];
// Core refuses these together (modules/catalog.ts DIETARY_CONFLICTS): picking one drops the other
const DIET_CONFLICTS: [DietaryTag, DietaryTag][] = [
  ['sem_gluten', 'contem_gluten'],
  ['sem_lactose', 'contem_lactose'],
  ['vegano', 'contem_lactose'],
  ['vegano', 'contem_ovo'],
  ['vegano', 'contem_frutos_do_mar'],
  ['vegetariano', 'contem_frutos_do_mar'],
];

/** What the product is and what it contains, in the shopper's words; saves on each tap. */
function DietaryEditor({
  p,
  patch,
}: {
  p: ProductDetail;
  patch: (body: Record<string, unknown>) => Promise<unknown>;
}) {
  const [tags, setTags] = useState<DietaryTag[]>(p.dietary ?? []);
  const key = (p.dietary ?? []).join();
  useEffect(() => setTags(p.dietary ?? []), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (t: DietaryTag) => {
    const next = tags.includes(t)
      ? tags.filter((x) => x !== t)
      : [
          ...tags.filter(
            (x) => !DIET_CONFLICTS.some(([a, b]) => (a === t && b === x) || (b === t && a === x)),
          ),
          t,
        ];
    setTags(next);
    void patch({ dietary: next });
  };
  return (
    <div className="space-y-4">
      <p className="t-body text-muted">
        Aparece para o cliente na loja. Marque só o que você tem certeza.
      </p>
      <Field label="O produto é">
        <Chips
          multi
          label="o produto é"
          value={tags}
          onChange={flip}
          options={DIET_IS.map((t) => ({ value: t, label: DIET_LABEL[t] }))}
        />
      </Field>
      <Field label="Contém" helper="Os alergênicos mais comuns. Contém um deles? Marque.">
        <Chips
          multi
          label="contém"
          value={tags}
          onChange={flip}
          options={DIET_HAS.map((x) => ({ value: x.tag, label: x.label }))}
        />
      </Field>
    </div>
  );
}

const RULES: { value: PricingRule; label: string; help: string }[] = [
  {
    value: 'sum',
    label: 'Soma',
    help: 'Cobra cada escolha. Ex.: 2 adicionais de R$ 3,00 somam R$ 6,00.',
  },
  {
    value: 'average',
    label: 'Média',
    help: 'Cobra a média das escolhas. Bom para pizza meio a meio.',
  },
  {
    value: 'most_expensive',
    label: 'Mais caro',
    help: 'Cobra só a escolha mais cara. Ex.: meio a meio sai pelo sabor mais caro.',
  },
];

/** Core's cap on one group's options (a pizzeria's flavours) */
const MAX_OPTIONS = 100;

/** a group can ask for as many units as its options offer together (Core's cap is 40) */
const unitsOf = (g: OptionGroup) =>
  Math.max(
    1,
    Math.min(
      40,
      g.options.reduce((n, o) => n + (o.maxQty ?? 1), 0),
    ),
  );
const fit = (g: OptionGroup): OptionGroup => {
  const maxSelect = Math.max(1, Math.min(g.maxSelect, unitsOf(g)));
  return { ...g, maxSelect, minSelect: Math.min(g.minSelect, maxSelect) };
};
const blankOption = (): OptionItem => ({
  name: '',
  priceDeltaCents: 0,
  status: 'active',
  maxQty: 1,
  description: null,
  imageUrl: null,
});

/** Core's cap on a product's groups */
const MAX_GROUPS = 12;

/** a copy of another product's group: no ids, so Core makes new rows for this product */
const copyOf = (g: OptionGroup): OptionGroup => {
  const { id: _g, ...rest } = g;
  return { ...rest, options: g.options.map(({ id: _o, ...o }) => o) };
};

const moved = <T,>(xs: T[], i: number, d: -1 | 1) => {
  const n = [...xs];
  const [x] = n.splice(i, 1);
  n.splice(i + d, 0, x!);
  return n;
};

type Cats = {
  id: string;
  name: string;
  products: {
    id: string;
    name: string;
    imageUrl: string | null;
    kind: string;
    groupCount?: number;
  }[];
}[];

function OptionsEditor({
  p,
  cats,
  onSaved,
}: {
  p: ProductDetail;
  cats: Cats;
  onSaved: (p: ProductDetail) => void;
}) {
  const valid = (gs: OptionGroup[]) =>
    gs.every((g) => g.name.trim() && g.options.length && g.options.every((o) => o.name.trim()));
  const { draft, setDraft, state } = useAutosave<OptionGroup[]>(
    p.groups,
    async (gs) => {
      const r = await api.setOptions(p.id, gs);
      onSaved(r.product);
      return r.product.groups;
    },
    { valid },
  );
  // a saved group deleted a moment ago stays in the draft, hidden, until "desfazer" runs out:
  // its options keep their ids (and the carts holding them) if it comes back
  const { held, hold } = useHeld();
  // which option has its details open: "group:option"
  const [open, setOpen] = useState<string | null>(null);
  // the group whose options are being put in order
  const [ordering, setOrdering] = useState<number | null>(null);
  const [copying, setCopying] = useState(false);
  const uid = useId();
  const upd = (i: number, g: Partial<OptionGroup>) =>
    setDraft((d) => d.map((x, k) => (k === i ? fit({ ...x, ...g }) : x)));
  const updOpt = (i: number, j: number, o: Partial<OptionItem>) =>
    setDraft((d) =>
      d.map((x, k) =>
        k === i
          ? fit({
              ...x,
              options: x.options.map((y, m) => (m === j ? { ...y, ...o } : y)),
            })
          : x,
      ),
    );
  const remove = (i: number) => {
    const g = draft[i]!;
    const name = g.name.trim() ? `Grupo “${g.name.trim()}” apagado` : 'Grupo apagado';
    setOpen(null);
    setOrdering(null);
    if (!g.id) {
      // never saved: nothing to hold back, "desfazer" puts it where it was
      setDraft((d) => d.filter((_, k) => k !== i));
      toast(name, { undo: () => setDraft((d) => [...d.slice(0, i), g, ...d.slice(i)]) });
      return;
    }
    const id = g.id;
    hold(id, name, () => setDraft((d) => d.filter((x) => x.id !== id)));
  };
  // the groups on screen, with their place in the draft
  const shown = draft.map((g, i) => ({ g, i })).filter(({ g }) => !g.id || !held.has(g.id));
  const step = (pos: number, d: -1 | 1) => {
    const a = shown[pos]!.i;
    const b = shown[pos + d]!.i;
    haptic.tick();
    setOpen(null);
    setOrdering(null);
    setDraft((xs) => {
      const n = [...xs];
      [n[a], n[b]] = [n[b]!, n[a]!];
      return n;
    });
  };
  const paste = (from: string, groups: OptionGroup[]) => {
    const add = groups.map(copyOf);
    setDraft((d) => [...d, ...add]);
    setCopying(false);
    const names = add.map((g) => g.name);
    toast(`${plural(add.length, 'grupo copiado', 'grupos copiados')} de ${from}`, {
      // the copies are the last groups, unless something changed them since
      undo: () =>
        setDraft((d) => {
          const tail = d.slice(-names.length);
          return tail.length === names.length && tail.every((g, k) => g.name === names[k])
            ? d.slice(0, d.length - names.length)
            : d;
        }),
    });
  };
  const room = MAX_GROUPS - shown.length;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="t-body text-muted">Ex.: “Escolha a calda”, “Tamanho”.</p>
        <SaveMark state={state} />
      </div>
      {shown.map(({ g, i }, pos) => {
        const rule = RULES.find((r) => r.value === (g.pricingRule ?? 'sum')) ?? RULES[0]!;
        const counted = g.options.some((o) => (o.maxQty ?? 1) > 1);
        const full = g.options.length >= MAX_OPTIONS;
        const fullHint = `${uid}-full-${i}`;
        const label = g.name.trim() || `grupo ${pos + 1}`;
        return (
          <div key={g.id ?? `n${i}`} className="@container rounded-md bg-sunken p-3">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <TextInput
                  aria-label="nome do grupo"
                  placeholder="Nome do grupo"
                  value={g.name}
                  maxLength={60}
                  onChange={(e) => upd(i, { name: e.target.value })}
                  className="bg-surface"
                />
              </div>
              {shown.length > 1 ? (
                <>
                  <IconButton
                    label={`subir ${label}`}
                    size="sm"
                    disabled={pos === 0}
                    onClick={() => step(pos, -1)}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`descer ${label}`}
                    size="sm"
                    disabled={pos === shown.length - 1}
                    onClick={() => step(pos, 1)}
                  >
                    <ArrowDown />
                  </IconButton>
                </>
              ) : null}
              <IconButton label={`apagar ${label}`} size="sm" onClick={() => remove(i)}>
                <Trash />
              </IconButton>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <Toggle
                checked={g.minSelect > 0}
                onChange={(v) =>
                  upd(i, {
                    minSelect: v ? 1 : 0,
                    maxSelect: Math.max(g.maxSelect, 1),
                  })
                }
                label="Obrigatório"
              />
              <div className="flex items-center gap-2">
                <span className="t-body">Escolhe até</span>
                <Stepper
                  label="máximo de escolhas"
                  value={g.maxSelect}
                  min={Math.max(1, g.minSelect)}
                  max={unitsOf(g)}
                  onChange={(v) => upd(i, { maxSelect: v })}
                />
              </div>
            </div>
            {counted ? (
              <p className="t-caption mt-1 text-muted">
                Conta cada unidade: 2× a mesma opção valem 2 escolhas.
              </p>
            ) : null}
            {g.maxSelect > 1 ? (
              <div className="mt-3 space-y-1.5">
                <p className="t-label">Como cobrar as escolhas</p>
                <Segmented
                  label="como cobrar as escolhas"
                  value={rule.value}
                  onChange={(v) => upd(i, { pricingRule: v })}
                  options={RULES.map((r) => ({
                    value: r.value,
                    label: r.label,
                  }))}
                  className="bg-surface"
                />
                <p className="t-caption text-muted">{rule.help}</p>
              </div>
            ) : null}
            {ordering === i ? (
              <ol
                className="mt-3 divide-y divide-line rounded-sm bg-surface"
                aria-label={`ordem de ${label}`}
              >
                {g.options.map((o, j) => (
                  <li
                    key={o.id ?? `o${j}`}
                    className="flex min-h-12 items-center gap-1 py-1 pl-3 pr-1"
                  >
                    <span className="tnum t-caption w-6 shrink-0 text-muted">{j + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{o.name || 'Opção sem nome'}</span>
                    <IconButton
                      label={`subir ${o.name || 'opção'}`}
                      size="sm"
                      disabled={j === 0}
                      onClick={() => {
                        haptic.tick();
                        upd(i, { options: moved(g.options, j, -1) });
                      }}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      label={`descer ${o.name || 'opção'}`}
                      size="sm"
                      disabled={j === g.options.length - 1}
                      onClick={() => {
                        haptic.tick();
                        upd(i, { options: moved(g.options, j, 1) });
                      }}
                    >
                      <ArrowDown />
                    </IconButton>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="mt-3 space-y-2">
                {g.options.map((o, j) => {
                  const key = `${i}:${j}`;
                  const more = open === key;
                  const qty = o.maxQty ?? 1;
                  const extras = [
                    qty > 1 ? `até ${qty}` : null,
                    o.description ? 'com descrição' : null,
                    o.imageUrl ? 'com foto' : null,
                  ].filter(Boolean);
                  return (
                    <li key={o.id ?? `o${j}`}>
                      <div className="flex flex-wrap items-center gap-2 @md:flex-nowrap">
                        <div className="min-w-0 basis-full @md:basis-auto @md:flex-1">
                          <TextInput
                            aria-label="nome da opção"
                            placeholder="Opção"
                            value={o.name}
                            maxLength={60}
                            className="bg-surface"
                            onChange={(e) => updOpt(i, j, { name: e.target.value })}
                          />
                        </div>
                        <div className="w-32 shrink-0">
                          <MoneyField
                            cents={o.priceDeltaCents}
                            placeholder="+0,00"
                            className="bg-surface"
                            onCommit={(v) => updOpt(i, j, { priceDeltaCents: v ?? 0 })}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updOpt(i, j, {
                              status: o.status === 'sold_out' ? 'active' : 'sold_out',
                            })
                          }
                          className={cn(
                            'press t-caption min-h-11 shrink-0 rounded-full px-2.5 font-semibold ring-1',
                            o.status === 'sold_out'
                              ? 'bg-danger-soft text-danger ring-danger/30'
                              : 'text-muted ring-line',
                          )}
                          aria-pressed={o.status === 'sold_out'}
                        >
                          {o.status === 'sold_out' ? 'esgotado' : 'tem'}
                        </button>
                        <IconButton
                          label={`detalhes de ${o.name || 'opção'}`}
                          size="sm"
                          aria-expanded={more}
                          className={cn('ml-auto @md:ml-0', more && 'bg-press')}
                          onClick={() => setOpen(more ? null : key)}
                        >
                          <SlidersHorizontal />
                        </IconButton>
                        <IconButton
                          label="apagar opção"
                          size="sm"
                          onClick={() => {
                            setOpen(null);
                            upd(i, {
                              options: g.options.filter((_, k) => k !== j),
                            });
                          }}
                        >
                          <Trash />
                        </IconButton>
                      </div>
                      {!more && extras.length ? (
                        <p className="t-caption mt-1 px-1 text-muted">{extras.join(' · ')}</p>
                      ) : null}
                      {more ? (
                        <OptionDetails
                          o={o}
                          onChange={(next) => updOpt(i, j, next)}
                          onClose={() => setOpen(null)}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
              {ordering === i ? (
                <Button variant="secondary" size="sm" onClick={() => setOrdering(null)}>
                  pronto
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Plus />}
                    disabled={full}
                    aria-describedby={full ? fullHint : undefined}
                    onClick={() => upd(i, { options: [...g.options, blankOption()] })}
                  >
                    opção
                  </Button>
                  {g.options.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ArrowsDownUp />}
                      onClick={() => {
                        setOpen(null);
                        setOrdering(i);
                      }}
                    >
                      ordem
                    </Button>
                  ) : null}
                </>
              )}
              {full ? (
                <p id={fullHint} className="t-caption text-muted">
                  Até {MAX_OPTIONS} opções por grupo.
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="grid gap-2 @container sm:grid-cols-2">
        <Button
          variant="secondary"
          block
          icon={<Plus />}
          disabled={room <= 0}
          onClick={() =>
            setDraft((d) => [
              ...d,
              {
                name: '',
                minSelect: 1,
                maxSelect: 1,
                pricingRule: 'sum',
                options: [blankOption()],
              },
            ])
          }
        >
          novo grupo de opções
        </Button>
        <Button
          variant="ghost"
          block
          icon={<CopySimple />}
          disabled={room <= 0}
          onClick={() => setCopying(true)}
        >
          copiar de outro produto
        </Button>
      </div>
      {room <= 0 ? (
        <p className="t-caption text-muted">Dá para ter até {MAX_GROUPS} grupos de opções.</p>
      ) : null}
      <CopyOptionsSheet
        open={copying}
        onOpenChange={setCopying}
        self={p.id}
        cats={cats}
        room={room}
        onCopy={paste}
      />
    </div>
  );
}

/** Pick a product, then which of its option groups come along. */
function CopyOptionsSheet({
  open,
  onOpenChange,
  self,
  cats,
  room,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  self: string;
  cats: Cats;
  room: number;
  onCopy: (from: string, groups: OptionGroup[]) => void;
}) {
  const [from, setFrom] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!open) {
      setFrom(null);
      setQ('');
    }
  }, [open]);
  const src = useQuery({
    queryKey: qk.product(from?.id ?? ''),
    queryFn: () => api.product(from!.id),
    enabled: !!from,
  });
  const groups = src.data?.product.groups ?? [];
  useEffect(() => {
    setPick(new Set(groups.slice(0, room).map((_, k) => k)));
    // a new source picks its first groups, as many as fit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src.data, room]);
  const needle = q.trim().toLocaleLowerCase('pt-BR');
  const sources = cats
    .flatMap((c) => c.products)
    .filter((x) => x.id !== self && (x.groupCount ?? 0) > 0)
    .filter((x) => !needle || x.name.toLocaleLowerCase('pt-BR').includes(needle));
  const any = cats.some((c) => c.products.some((x) => x.id !== self && (x.groupCount ?? 0) > 0));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={from ? `Opções de ${from.name}` : 'Copiar opções de…'}
      description={
        from
          ? 'As cópias ficam só neste produto: mudar uma não muda a outra.'
          : 'Escolha um produto que já tem as opções que você quer.'
      }
      footer={
        from ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setFrom(null)}>
              voltar
            </Button>
            <Button
              block
              disabled={!pick.size || pick.size > room}
              onClick={() =>
                onCopy(
                  from.name,
                  groups.filter((_, k) => pick.has(k)),
                )
              }
            >
              {pick.size ? `copiar ${plural(pick.size, 'grupo', 'grupos')}` : 'escolha os grupos'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {from ? (
        src.isPending ? (
          <RowsSkeleton rows={3} />
        ) : (
          <div className="space-y-2 pt-1">
            {groups.map((g, k) => (
              <Toggle
                key={g.id ?? k}
                checked={pick.has(k)}
                onChange={(v) =>
                  setPick((s) => {
                    const n = new Set(s);
                    if (v) n.add(k);
                    else n.delete(k);
                    return n;
                  })
                }
                label={g.name}
                description={g.options
                  .map((o) => o.name)
                  .slice(0, 6)
                  .join(', ')
                  .concat(g.options.length > 6 ? '…' : '')}
              />
            ))}
            {pick.size > room ? (
              <p className="t-caption text-danger" role="alert">
                Cabem mais {plural(room, 'grupo', 'grupos')} neste produto.
              </p>
            ) : null}
          </div>
        )
      ) : !any ? (
        <p className="t-body pt-2 text-muted">
          Nenhum outro produto tem opções ainda. Crie o grupo aqui e depois copie para os outros.
        </p>
      ) : (
        <div className="space-y-3 pt-1">
          <TextInput
            type="search"
            aria-label="buscar produto"
            placeholder="Buscar produto"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            lead={<MagnifyingGlass className="size-5" />}
          />
          <ul className="-mx-2">
            {sources.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setFrom({ id: x.id, name: x.name })}
                  className="press-row flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-hover"
                >
                  <span className="size-11 shrink-0 overflow-hidden rounded-sm bg-sunken">
                    {x.imageUrl ? (
                      <img
                        src={x.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{x.name}</span>
                    <span className="t-caption block text-muted">
                      {plural(x.groupCount ?? 0, 'grupo de opções', 'grupos de opções')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {!sources.length ? (
              <li className="t-body px-2 py-3 text-muted">Nenhum produto com “{q.trim()}”.</li>
            ) : null}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

function OptionDetails({
  o,
  onChange,
  onClose,
}: {
  o: OptionItem;
  onChange: (o: Partial<OptionItem>) => void;
  onClose: () => void;
}) {
  const id = useId();
  return (
    <div className="mt-2 space-y-4 rounded-sm bg-surface p-3">
      <div className="flex flex-col gap-4 @md:flex-row @md:items-start">
        <div className="w-24 shrink-0">
          <PhotoField
            label={`foto de ${o.name || 'opção'}`}
            aspect="1:1"
            max={1}
            photos={o.imageUrl ? [{ url: o.imageUrl }] : []}
            onChange={(next) => onChange({ imageUrl: next[0]?.url ?? null })}
          />
          {o.imageUrl ? (
            <button
              type="button"
              className="t-caption mt-1 min-h-10 w-full rounded-full font-semibold text-muted hover:bg-press"
              onClick={() => onChange({ imageUrl: null })}
            >
              tirar foto
            </button>
          ) : null}
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <Field
            label="Quantidade máxima"
            helper={
              (o.maxQty ?? 1) > 1
                ? `O cliente pode pedir até ${o.maxQty} desta opção (ex.: 2× bacon).`
                : 'Com 1, o cliente só marca ou desmarca.'
            }
          >
            <Stepper
              label="quantidade máxima"
              value={o.maxQty ?? 1}
              min={1}
              max={20}
              onChange={(v) => onChange({ maxQty: v })}
            />
          </Field>
          <Field label="Descrição" optional htmlFor={`${id}-desc`}>
            <TextInput
              id={`${id}-desc`}
              maxLength={200}
              placeholder="Ex.: fatias finas, bem crocantes"
              value={o.description ?? ''}
              className="bg-sunken"
              onChange={(e) => onChange({ description: e.target.value || null })}
            />
          </Field>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose}>
        pronto
      </Button>
    </div>
  );
}

function KitEditor({
  p,
  cats,
  onSaved,
}: {
  p: ProductDetail;
  cats: {
    name: string;
    products: { id: string; name: string; imageUrl: string | null; kind: string }[];
  }[];
  onSaved: (p: ProductDetail) => void;
}) {
  const choices = cats
    .flatMap((c) => c.products)
    .filter((x) => x.id !== p.id && x.kind !== 'combo');
  const valid = (ss: KitSlot[]) =>
    ss.every((s) => s.name.trim() && s.items.length > 0 && s.minSelect <= s.maxSelect);
  const { draft, setDraft, state } = useAutosave<KitSlot[]>(
    p.comboSlots.map((s) => ({
      ...s,
      items: s.items.map((i) => ({
        productId: i.productId,
        priceDeltaCents: i.priceDeltaCents,
        name: i.name ?? '',
      })),
    })),
    async (ss) => {
      const r = await api.setKit(
        p.id,
        // each step's id goes back: carts and past orders hold it, and Core keeps it on a save
        ss.map(({ id, name, minSelect, maxSelect, qtyPerItem, items }) => ({
          ...(id ? { id } : {}),
          name,
          minSelect,
          maxSelect,
          qtyPerItem,
          items: items.map((i) => ({ productId: i.productId, priceDeltaCents: i.priceDeltaCents })),
        })),
      );
      onSaved(r.product);
      return r.product.comboSlots.map((s) => ({
        ...s,
        items: s.items.map((i) => ({
          productId: i.productId,
          priceDeltaCents: i.priceDeltaCents,
          name: i.name ?? '',
        })),
      }));
    },
    { valid },
  );
  const upd = (i: number, s: Partial<KitSlot>) =>
    setDraft((d) => d.map((x, k) => (k === i ? { ...x, ...s } : x)));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="t-body text-muted">
          O cliente monta o kit escolhendo produtos em cada etapa. Ex.: “Escolha 4 sabores”.
        </p>
        <SaveMark state={state} />
      </div>
      {draft.map((s, i) => (
        <div key={i} className="rounded-md bg-sunken p-3">
          <div className="flex gap-2">
            <TextInput
              aria-label="nome da etapa"
              placeholder="Ex.: Escolha 4 sabores"
              value={s.name}
              maxLength={80}
              className="bg-surface"
              onChange={(e) => upd(i, { name: e.target.value })}
            />
            <IconButton
              label="apagar etapa"
              onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}
            >
              <Trash />
            </IconButton>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="t-body">Escolhe</span>
            <Stepper
              label="quantos no mínimo"
              value={s.minSelect}
              max={99}
              onChange={(v) => upd(i, { minSelect: v, maxSelect: Math.max(v, s.maxSelect) })}
            />
            <span className="t-body">a</span>
            <Stepper
              label="quantos no máximo"
              value={s.maxSelect}
              min={Math.max(1, s.minSelect)}
              max={99}
              onChange={(v) => upd(i, { maxSelect: v })}
            />
          </div>
          <Field label="Produtos que entram" className="mt-3">
            <Chips
              label="produtos do kit"
              multi
              value={s.items.map((x) => x.productId)}
              onChange={(pid) =>
                upd(i, {
                  items: s.items.some((x) => x.productId === pid)
                    ? s.items.filter((x) => x.productId !== pid)
                    : [...s.items, { productId: pid, priceDeltaCents: 0 }],
                })
              }
              options={choices.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
        </div>
      ))}
      <Button
        variant="secondary"
        block
        icon={<Plus />}
        onClick={() =>
          setDraft((d) => [
            ...d,
            { name: '', minSelect: 1, maxSelect: 1, qtyPerItem: 1, items: [] },
          ])
        }
      >
        {draft.length ? 'nova etapa' : 'transformar em kit'}
      </Button>
    </div>
  );
}

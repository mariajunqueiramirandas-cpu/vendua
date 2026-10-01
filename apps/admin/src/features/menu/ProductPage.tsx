import {
  CalendarBlank,
  Clock,
  Copy,
  Eye,
  EyeSlash,
  ListChecks,
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
  type KitSlot,
  type OptionGroup,
  type OptionItem,
  type PricingRule,
  type ProductDetail,
} from '../../lib/api.ts';
import { useAutosave } from '../../lib/autosave.ts';
import { money, plural } from '../../lib/format.ts';
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
import { ProductSkeleton } from '../../ui/skeletons.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { availability } from '../../ui/ProductTile.tsx';
import { toast } from '../../ui/Toast.tsx';
import { PromoEditor } from './PromoEditor.tsx';
import { outsideNow } from './schedule.ts';
import { ScheduleEditor } from './ScheduleEditor.tsx';

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
  cats: {
    id: string;
    name: string;
    products: { id: string; name: string; imageUrl: string | null; kind: string }[];
  }[];
  openPhoto: boolean;
  sharedFile: File | null;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const field = useSaveState();
  const put = (next: ProductDetail) => {
    qc.setQueryData(qk.product(p.id), { product: next });
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
            <OptionsEditor p={p} onSaved={put} />
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
        </div>
      </div>
    </PageBody>
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

function OptionsEditor({ p, onSaved }: { p: ProductDetail; onSaved: (p: ProductDetail) => void }) {
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
  // which option has its details open: "group:option"
  const [open, setOpen] = useState<string | null>(null);
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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="t-body text-muted">Ex.: “Escolha a calda”, “Tamanho”.</p>
        <SaveMark state={state} />
      </div>
      {draft.map((g, i) => {
        const rule = RULES.find((r) => r.value === (g.pricingRule ?? 'sum')) ?? RULES[0]!;
        const counted = g.options.some((o) => (o.maxQty ?? 1) > 1);
        const full = g.options.length >= MAX_OPTIONS;
        const fullHint = `${uid}-full-${i}`;
        return (
          <div key={g.id ?? `n${i}`} className="@container rounded-md bg-sunken p-3">
            <div className="flex gap-2">
              <TextInput
                aria-label="nome do grupo"
                placeholder="Nome do grupo"
                value={g.name}
                maxLength={60}
                onChange={(e) => upd(i, { name: e.target.value })}
                className="bg-surface"
              />
              <IconButton
                label={`apagar grupo ${g.name}`}
                onClick={() => setDraft((d) => d.filter((_, k) => k !== i))}
              >
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
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
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
              {full ? (
                <p id={fullHint} className="t-caption text-muted">
                  Até {MAX_OPTIONS} opções por grupo.
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      <Button
        variant="secondary"
        block
        icon={<Plus />}
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
    </div>
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
        ss.map(({ name, minSelect, maxSelect, qtyPerItem, items }) => ({
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

import {
  CalendarBlank,
  Clock,
  Copy,
  Eye,
  EyeSlash,
  ListChecks,
  Package,
  Plus,
  Stack,
  Trash,
  TrendUp,
  UsersThree,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type KitSlot, type OptionGroup, type ProductDetail } from '../../lib/api.ts';
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
import { outsideNow, scheduleShort } from './schedule.ts';
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
      .catch((e) => toast.error(messageOf(e)));
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
            <Field label="Preço" htmlFor="pprice">
              <MoneyField
                id="pprice"
                cents={p.priceCents}
                onCommit={(v) => void patch({ priceCents: v ?? 0 })}
              />
            </Field>
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
                <p className="tnum mt-1 font-semibold">{money(p.priceCents)}</p>
                {p.availabilitySchedule ? (
                  <p className="t-caption mt-1 inline-flex items-center gap-1 text-muted">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    {outsideNow(p)
                      ? p.availabilitySchedule.outside === 'hidden'
                        ? 'fora do cardápio agora'
                        : 'indisponível agora'
                      : scheduleShort(p.availabilitySchedule)}
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
              p.availabilitySchedule
                ? `${scheduleShort(p.availabilitySchedule)}${outsideNow(p) ? ' · fora do horário agora' : ''}`
                : 'Todos os dias em que a loja abre'
            }
          >
            <ScheduleEditor p={p} onSaved={put} />
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
  const upd = (i: number, g: Partial<OptionGroup>) =>
    setDraft((d) => d.map((x, k) => (k === i ? { ...x, ...g } : x)));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="t-body text-muted">Ex.: “Escolha a calda”, “Tamanho”.</p>
        <SaveMark state={state} />
      </div>
      {draft.map((g, i) => (
        <div key={g.id ?? `n${i}`} className="rounded-md bg-sunken p-3">
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
                upd(i, { minSelect: v ? 1 : 0, maxSelect: Math.max(g.maxSelect, 1) })
              }
              label="Obrigatório"
            />
            <div className="flex items-center gap-2">
              <span className="t-body">Escolhe até</span>
              <Stepper
                label="máximo de escolhas"
                value={g.maxSelect}
                min={Math.max(1, g.minSelect)}
                max={Math.max(1, g.options.length)}
                onChange={(v) => upd(i, { maxSelect: v })}
              />
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {g.options.map((o, j) => (
              <li key={o.id ?? `o${j}`} className="flex items-center gap-2">
                <TextInput
                  aria-label="nome da opção"
                  placeholder="Opção"
                  value={o.name}
                  maxLength={60}
                  className="bg-surface"
                  onChange={(e) =>
                    upd(i, {
                      options: g.options.map((x, k) =>
                        k === j ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
                <div className="w-32 shrink-0">
                  <MoneyField
                    cents={o.priceDeltaCents}
                    placeholder="+0,00"
                    onCommit={(v) =>
                      upd(i, {
                        options: g.options.map((x, k) =>
                          k === j ? { ...x, priceDeltaCents: v ?? 0 } : x,
                        ),
                      })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    upd(i, {
                      options: g.options.map((x, k) =>
                        k === j
                          ? { ...x, status: x.status === 'sold_out' ? 'active' : 'sold_out' }
                          : x,
                      ),
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
                  label="apagar opção"
                  size="sm"
                  onClick={() => upd(i, { options: g.options.filter((_, k) => k !== j) })}
                >
                  <Trash />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            icon={<Plus />}
            onClick={() =>
              upd(i, {
                options: [...g.options, { name: '', priceDeltaCents: 0, status: 'active' }],
              })
            }
          >
            opção
          </Button>
        </div>
      ))}
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
              options: [{ name: '', priceDeltaCents: 0, status: 'active' }],
            },
          ])
        }
      >
        novo grupo de opções
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

import { Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type Category,
  type Pricing,
  type PricingDefaults,
  type Product,
  type ProductDetail,
} from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { moneyInput, parseMoney } from '../../lib/parse.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

// Core's own formulas, integer math: the sheet previews a what-if, Core recomputes on save.
export const suggestedPrice = (cost: number, offBp: number, marginBp: number) =>
  Math.ceil((cost * 10000) / (10000 - offBp - marginBp));
export const profitAt = (price: number, cost: number, offBp: number) =>
  price - cost - Math.round((price * offBp) / 10000);
export const marginAt = (price: number, cost: number, offBp: number) =>
  price > 0 ? Math.round((profitAt(price, cost, offBp) * 10000) / price) : null;
/** the first price ending in ,90 at or above it */
export const nicePrice = (s: number) => Math.ceil((s - 90) / 100) * 100 + 90;
/** 1450 bp → "14,5%" */
export const pct = (bp: number) =>
  `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

type ProductQuery = { product: ProductDetail; pricingDefaults: PricingDefaults | null };
type Line = { id: number; label: string; amount: string };
type Pct = 'feeBp' | 'taxBp' | 'marginBp';

const MAX_LINES = 12;
const FALLBACK: PricingDefaults = { feeBp: 0, taxBp: 0, marginBp: 3000 };
const PCTS: { key: Pct; label: string; helper: string }[] = [
  {
    key: 'feeBp',
    label: 'Taxa da maquininha ou app',
    helper: 'O que a maquininha ou o app de entrega descontam.',
  },
  { key: 'taxBp', label: 'Impostos', helper: 'Simples Nacional, MEI ou o que você paga.' },
  { key: 'marginBp', label: 'Margem que você quer', helper: 'O que sobra para você, no fim.' },
];

const pctInput = (bp: number) =>
  bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, '').replace('.', ',');
/** "12", "4,99", "" (= 0) → bp; null = not a percentage we take */
function parsePct(s: string): number | null {
  const t = s.trim().replace('%', '').replace(',', '.');
  if (!t) return 0;
  if (!/^\d{1,2}(\.\d{0,2})?$/.test(t)) return null;
  const bp = Math.round(Number(t) * 100);
  return bp <= 9900 ? bp : null;
}

let lineSeq = 0;
const line = (label: string, cents: number | null = null): Line => ({
  id: ++lineSeq,
  label,
  amount: moneyInput(cents),
});

function startLines(p: Product): Line[] {
  if (p.pricing?.lines.length) return p.pricing.lines.map((l) => line(l.label, l.cents));
  // a plain cost typed in Estoque: it's the whole cost so far
  if (p.costCents != null) return [line('Custo', p.costCents), line('Embalagem')];
  return [line('Ingredientes'), line('Embalagem')];
}

/**
 * The precificação calculator: what one unit costs, what comes off the price (fee, tax) and the
 * margin wanted → a suggested price, and what's left at the price charged today.
 */
export function PricingSheet({
  product: open,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // the last product stays while the sheet slides away
  const [held, setHeld] = useState(open);
  if (open && open !== held) setHeld(open);
  const id = held?.id ?? '';
  const detail = useQuery({
    queryKey: qk.product(id),
    queryFn: () => api.product(id),
    enabled: !!open,
  });
  const p: Product | null = detail.data?.product ?? held;
  const defaults = detail.data?.pricingDefaults ?? null;

  const [lines, setLines] = useState<Line[]>([]);
  const [pcts, setPcts] = useState<Record<Pct, string>>({ feeBp: '', taxBp: '', marginBp: '' });
  const [pick, setPick] = useState<'exact' | 'nice'>('exact');
  const [err, setErr] = useState<string | null>(null);
  const touched = useRef(false);
  const fresh = useRef<HTMLUListElement>(null);

  const fillPcts = (src: PricingDefaults) =>
    setPcts({
      feeBp: pctInput(src.feeBp),
      taxBp: pctInput(src.taxBp),
      marginBp: pctInput(src.marginBp),
    });

  useEffect(() => {
    if (!open) return;
    setLines(startLines(open));
    fillPcts(open.pricing ?? defaults ?? FALLBACK);
    touched.current = false;
    setPick('exact');
    setErr(null);
    // only on open: a refetch (a new product object) must not wipe what's being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id]);
  // the store's last percentages arrive with the product: prefill, unless already typed over
  const hasPricing = !!open?.pricing;
  useEffect(() => {
    if (defaults && !hasPricing && !touched.current) fillPcts(defaults);
  }, [defaults, hasPricing]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateProduct(id, body),
    onSuccess: (r, body) => {
      const pr = body.pricing as Pricing | null;
      qc.setQueryData<ProductQuery>(qk.product(r.product.id), (d) => ({
        pricingDefaults: d?.pricingDefaults ?? null,
        ...d,
        product: r.product,
        ...(pr
          ? { pricingDefaults: { feeBp: pr.feeBp, taxBp: pr.taxBp, marginBp: pr.marginBp } }
          : {}),
      }));
      qc.setQueryData<{ categories: Category[] }>(qk.catalog, (d) =>
        d
          ? {
              ...d,
              categories: d.categories.map((c) => ({
                ...c,
                products: c.products.map((x) =>
                  x.id === r.product.id ? { ...x, ...r.product } : x,
                ),
              })),
            }
          : d,
      );
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });

  if (!p) return null;

  // ── the numbers ──────────────────────────────────────────────────────────────────────
  const parsed = lines.map((l) => ({
    ...l,
    cents: l.amount.trim() ? parseMoney(l.amount) : null,
    bad: !!l.amount.trim() && parseMoney(l.amount) === null,
  }));
  const cost = parsed.reduce((n, l) => n + (l.cents ?? 0), 0);
  const bp = {
    feeBp: parsePct(pcts.feeBp),
    taxBp: parsePct(pcts.taxBp),
    marginBp: parsePct(pcts.marginBp),
  };
  const pctsOk = bp.feeBp !== null && bp.taxBp !== null && bp.marginBp !== null;
  const off = (bp.feeBp ?? 0) + (bp.taxBp ?? 0);
  const over = pctsOk && off + bp.marginBp! >= 10000;
  const ready = pctsOk && !over;
  const suggested = ready && cost > 0 ? suggestedPrice(cost, off, bp.marginBp!) : null;
  const nice = suggested !== null ? nicePrice(suggested) : null;
  const target = suggested === null ? null : pick === 'nice' && nice !== null ? nice : suggested;
  const price = p.priceCents;
  const nowProfit = ready && cost > 0 && price > 0 ? profitAt(price, cost, off) : null;
  const nowMargin = nowProfit !== null ? marginAt(price, cost, off) : null;
  const canUse = target !== null && target !== price && target <= 10_000_000;

  const priceProblem = (v: number) =>
    p.compareAtPriceCents != null && v >= p.compareAtPriceCents
      ? `Esse preço passa do preço “de” (${money(p.compareAtPriceCents)}). Mude ou apague o preço “de” no produto.`
      : p.promoSchedule && v <= p.promoSchedule.priceCents
        ? `Esse preço fica abaixo do da promoção (${money(p.promoSchedule.priceCents)}). Mude a promoção no produto.`
        : null;

  const build = (): Pricing | null => {
    if (parsed.some((l) => l.bad)) {
      setErr('Confira os valores dos custos: use números como 4,50.');
      return null;
    }
    if (!pctsOk) {
      setErr('Use porcentagens de 0 a 99, como 4,99.');
      return null;
    }
    if (over) {
      setErr('Taxa, impostos e margem somam 100% ou mais. Diminua algum deles.');
      return null;
    }
    return {
      lines: parsed
        .filter((l) => l.cents !== null)
        .map((l) => ({ label: l.label.trim().slice(0, 40) || 'Outro custo', cents: l.cents! })),
      feeBp: bp.feeBp!,
      taxBp: bp.taxBp!,
      marginBp: bp.marginBp!,
    };
  };

  const submit = async (usePrice: boolean) => {
    const pricing = build();
    if (!pricing) return;
    const newPrice = usePrice && target !== null ? target : null;
    if (newPrice !== null) {
      const bad = priceProblem(newPrice);
      if (bad) return setErr(bad);
    }
    try {
      await save.mutateAsync(newPrice !== null ? { pricing, priceCents: newPrice } : { pricing });
      haptic.commit();
      toast(
        newPrice !== null
          ? `${p.name} agora custa ${money(newPrice)}`
          : `Custo de ${p.name} salvo: ${money(cost)}`,
      );
      onClose();
    } catch (e) {
      setErr(
        e instanceof ApiError && e.field === 'compareAtPriceCents'
          ? 'O preço precisa ficar abaixo do preço “de”. Mude ou apague o preço “de” no produto.'
          : e instanceof ApiError && e.field === 'promoSchedule.priceCents'
            ? 'O preço precisa ficar acima do preço da promoção. Mude a promoção no produto.'
            : messageOf(e),
      );
    }
  };

  const clear = async () => {
    try {
      await save.mutateAsync({ pricing: null });
      toast(`Cálculo de ${p.name} apagado`);
      onClose();
    } catch (e) {
      setErr(messageOf(e));
    }
  };

  const edit = (id: number, patch: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    setErr(null);
  };

  return (
    <Sheet
      open={!!open}
      onOpenChange={(v) => !v && onClose()}
      title="Quanto cobrar"
      description={`${p.name} · hoje por ${price > 0 ? money(price) : 'sem preço'}`}
      footer={
        <div className="flex flex-col gap-2">
          {canUse ? (
            <>
              <Button
                block
                size="lg"
                loading={save.isPending && !!save.variables && 'priceCents' in save.variables}
                disabled={save.isPending}
                onClick={() => void submit(true)}
              >
                usar {money(target!)} como preço
              </Button>
              <Button
                block
                variant="secondary"
                loading={save.isPending && !!save.variables && !('priceCents' in save.variables)}
                disabled={save.isPending}
                onClick={() => void submit(false)}
              >
                salvar só o custo
              </Button>
            </>
          ) : (
            <Button block size="lg" loading={save.isPending} onClick={() => void submit(false)}>
              salvar custo
            </Button>
          )}
        </div>
      }
    >
      <form
        className="space-y-6 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <section aria-labelledby="pricing-costs">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 id="pricing-costs" className="t-label">
              Quanto custa fazer 1 unidade
            </h3>
            <span className="tnum t-caption text-muted">{money(cost)}</span>
          </div>
          <ul className="space-y-2" ref={fresh}>
            {parsed.map((l, i) => (
              <li key={l.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput
                    aria-label={`nome do custo ${i + 1}`}
                    placeholder="ex.: Caixinha"
                    maxLength={40}
                    value={l.label}
                    onChange={(e) => edit(l.id, { label: e.target.value })}
                  />
                </div>
                <div className="w-36 shrink-0">
                  <TextInput
                    lead="R$"
                    inputMode="decimal"
                    enterKeyHint="next"
                    aria-label={`valor de ${l.label.trim() || `custo ${i + 1}`}`}
                    aria-invalid={l.bad || undefined}
                    placeholder="0,00"
                    value={l.amount}
                    onChange={(e) => edit(l.id, { amount: e.target.value.slice(0, 14) })}
                    onBlur={() => {
                      if (l.cents !== null) edit(l.id, { amount: moneyInput(l.cents) });
                    }}
                    className="tnum"
                  />
                </div>
                <IconButton
                  label={`tirar ${l.label.trim() || `custo ${i + 1}`}`}
                  className="size-11 shrink-0 text-muted"
                  onClick={() => {
                    haptic.tick();
                    setLines((ls) => ls.filter((x) => x.id !== l.id));
                    setErr(null);
                  }}
                >
                  <Trash className="size-5" />
                </IconButton>
              </li>
            ))}
          </ul>
          {lines.length < MAX_LINES ? (
            <Button
              variant="ghost"
              icon={<Plus />}
              className="-ml-3 mt-1"
              onClick={() => {
                haptic.tick();
                setLines((ls) => [...ls, line('')]);
                // the new line's name, ready to type
                requestAnimationFrame(() =>
                  fresh.current
                    ?.querySelector<HTMLElement>('li:last-child textarea, li:last-child input')
                    ?.focus(),
                );
              }}
            >
              adicionar custo
            </Button>
          ) : null}
        </section>

        <section aria-labelledby="pricing-pcts">
          <h3 id="pricing-pcts" className="t-label">
            O que sai do preço
          </h3>
          <div className="divide-y divide-line">
            {PCTS.map((f) => {
              const bad = bp[f.key] === null;
              return (
                <div key={f.key} className="flex items-center gap-3 py-3">
                  <label htmlFor={`pricing-${f.key}`} className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug">{f.label}</span>
                    <span className="t-caption block text-muted">{f.helper}</span>
                  </label>
                  <div className="w-32 shrink-0">
                    <TextInput
                      id={`pricing-${f.key}`}
                      inputMode="decimal"
                      trail="%"
                      placeholder="0"
                      aria-invalid={bad || undefined}
                      value={pcts[f.key]}
                      onChange={(e) => {
                        touched.current = true;
                        setPcts((s) => ({ ...s, [f.key]: e.target.value.slice(0, 6) }));
                        setErr(null);
                      }}
                      className="tnum text-right"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section
          aria-label="resultado"
          aria-live="polite"
          className="space-y-4 rounded-md bg-sunken p-4"
        >
          {over ? (
            <p className="t-body flex items-start gap-2 text-danger">
              <WarningCircle weight="fill" className="mt-0.5 size-5 shrink-0" aria-hidden />
              Taxa, impostos e margem somam 100% ou mais: nenhum preço cobre isso. Diminua algum
              deles.
            </p>
          ) : suggested === null ? (
            <p className="t-body text-muted">
              Ponha quanto custa fazer uma unidade para ver o preço sugerido.
            </p>
          ) : (
            <div>
              <p className="t-label">Preço sugerido</p>
              <div role="radiogroup" aria-label="preço sugerido" className="mt-2 flex gap-2">
                <PriceChoice
                  on={pick === 'exact' || nice === suggested}
                  cents={suggested}
                  note={`margem de ${pct(bp.marginBp!)}`}
                  onPick={() => setPick('exact')}
                />
                {nice !== null && nice !== suggested ? (
                  <PriceChoice
                    on={pick === 'nice'}
                    cents={nice}
                    note="arredondado"
                    onPick={() => setPick('nice')}
                  />
                ) : null}
              </div>
              {target !== null ? (
                <p className="t-caption mt-2 text-muted">
                  Em {money(target)}, sobra{' '}
                  <span className="tnum font-semibold text-ink">
                    {money(profitAt(target, cost, off))}
                  </span>{' '}
                  por unidade depois de custo, taxa e impostos.
                </p>
              ) : null}
            </div>
          )}
          {nowProfit !== null && nowMargin !== null ? (
            <div className="border-t border-line pt-3">
              <p className="t-label">No preço de agora, {money(price)}</p>
              <p
                className={cn(
                  't-body mt-0.5',
                  nowProfit < 0
                    ? 'font-semibold text-danger'
                    : nowMargin < bp.marginBp!
                      ? 'font-semibold text-warning'
                      : 'text-ink',
                )}
              >
                {nowProfit < 0 ? (
                  <>
                    falta <span className="tnum">{money(-nowProfit)}</span> por unidade: você paga
                    para vender
                  </>
                ) : (
                  <>
                    sobra <span className="tnum">{money(nowProfit)}</span> por unidade (margem{' '}
                    <span className="tnum">{pct(nowMargin)}</span>)
                    {nowMargin < bp.marginBp!
                      ? `, abaixo dos ${pct(bp.marginBp!)} que você quer`
                      : ''}
                  </>
                )}
              </p>
            </div>
          ) : null}
        </section>

        {err ? (
          <p className="t-caption flex items-center gap-1.5 text-danger" role="alert">
            <WarningCircle weight="fill" className="size-4 shrink-0" aria-hidden />
            {err}
          </p>
        ) : null}

        {p.pricing ? (
          <Button
            variant="ghost"
            className="-ml-3 text-muted"
            disabled={save.isPending}
            onClick={() => void clear()}
          >
            limpar o cálculo e o custo
          </Button>
        ) : null}
      </form>
    </Sheet>
  );
}

function PriceChoice({
  on,
  cents,
  note,
  onPick,
}: {
  on: boolean;
  cents: number;
  note: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={() => {
        haptic.tick();
        onPick();
      }}
      className={cn(
        'press flex min-h-16 min-w-0 flex-1 flex-col items-start justify-center rounded-md px-3.5 py-2 text-left transition-[background-color,box-shadow] duration-(--duration-quick)',
        on ? 'bg-surface ring-2 ring-primary depth-1' : 'ring-1 ring-line-strong hover:bg-hover',
      )}
    >
      <span className="tnum text-[1.25rem] font-bold leading-tight">{money(cents)}</span>
      <span className="t-caption text-muted">{note}</span>
    </button>
  );
}

import { Check, Minus, Plus } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { api, type KitSlot, type OptionGroup, type Product } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Field, Stepper, TextInput } from '../../ui/fields.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import type { PickedLine } from './data.ts';

// A product with options or a kit: pick them before it goes on the ticket. The rules shown are
// the ones Core checks (required groups, the most a group takes, a kit slot's count); the price
// of the choice is Core's, in the ticket's quote.

type Picks = Record<string, number>;

const need = (g: OptionGroup) => (g.required ? Math.max(1, g.minSelect) : 0);
const ruleOf = (min: number, max: number) =>
  min && min === max
    ? `escolha ${min}`
    : min
      ? `escolha de ${min} a ${max}`
      : max === 1
        ? 'opcional, até 1'
        : `opcional, até ${max}`;

export function OptionsSheet({
  product,
  onOpenChange,
  onAdd,
}: {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: Omit<PickedLine, 'key'>) => void;
}) {
  return (
    <Sheet
      open={!!product}
      onOpenChange={onOpenChange}
      title={product?.name ?? 'Opções'}
      description="Escolha as opções do cliente."
    >
      {product ? <Options key={product.id} product={product} onAdd={onAdd} /> : null}
    </Sheet>
  );
}

function Options({
  product,
  onAdd,
}: {
  product: Product;
  onAdd: (line: Omit<PickedLine, 'key'>) => void;
}) {
  const q = useQuery({
    queryKey: qk.product(product.id),
    queryFn: () => api.product(product.id),
    select: (d) => d.product,
  });
  const [mods, setMods] = useState<Picks>({});
  const [kit, setKit] = useState<Picks>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const noteId = useId();

  // a group with one choice starts on its only option when it's required
  useEffect(() => {
    if (!q.data) return;
    const start: Picks = {};
    for (const g of q.data.groups) {
      const live = g.options.filter((o) => o.status === 'active' && o.id);
      if (need(g) === 1 && g.maxSelect === 1 && live.length === 1) start[live[0]!.id!] = 1;
    }
    setMods(start);
  }, [q.data]);

  if (q.error) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <div className="space-y-3 py-2" aria-hidden>
        <Bone className="h-6 w-1/2" />
        <Bone className="h-14 w-full" />
        <Bone className="h-14 w-full" />
      </div>
    );

  const p = q.data;
  const groupCount = (g: OptionGroup) =>
    g.options.reduce((n, o) => n + (o.id ? (mods[o.id] ?? 0) : 0), 0);
  const slotKey = (s: KitSlot, productId: string) => `${s.id}:${productId}`;
  const slotCount = (s: KitSlot) =>
    s.items.reduce((n, i) => n + (kit[slotKey(s, i.productId)] ?? 0), 0);
  const missing =
    p.groups.find((g) => groupCount(g) < need(g)) ??
    (p.kind === 'combo' ? p.comboSlots.find((s) => slotCount(s) < s.minSelect) : undefined);

  const add = () => {
    const names = new Map(
      p.groups.flatMap((g) => g.options.map((o) => [o.id ?? '', o.name] as const)),
    );
    onAdd({
      productId: p.id,
      name: p.name,
      qty,
      modifiers: Object.entries(mods)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, qty: n, name: names.get(id) ?? '' })),
      combo:
        p.kind === 'combo'
          ? p.comboSlots.flatMap((s) =>
              s.items
                .filter((i) => (kit[slotKey(s, i.productId)] ?? 0) > 0)
                .map((i) => ({
                  slotId: s.id!,
                  productId: i.productId,
                  qty: kit[slotKey(s, i.productId)]!,
                  name: i.name ?? '',
                })),
            )
          : [],
      note: note.trim(),
    });
  };

  return (
    <div className="space-y-6 pb-2 pt-1">
      {p.groups.map((g, gi) => {
        const n = groupCount(g);
        const radio = g.maxSelect === 1 && g.options.every((o) => (o.maxQty ?? 1) <= 1);
        return (
          <fieldset key={g.id ?? gi} className="space-y-2">
            <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
              <span className="t-label">{g.name}</span>
              <span
                className={cn(
                  't-caption',
                  n < need(g) ? 'font-semibold text-warning' : 'text-muted',
                )}
              >
                {ruleOf(need(g), g.maxSelect)}
              </span>
            </legend>
            {g.options.map((o, oi) => {
              const id = o.id ?? '';
              const cur = mods[id] ?? 0;
              const off = o.status !== 'active' || !o.id;
              const full = n >= g.maxSelect && !cur;
              const max = o.maxQty ?? 1;
              const delta = o.priceDeltaCents ? (
                <span className="tnum t-body text-muted">
                  {o.priceDeltaCents > 0 ? '+' : '−'} {money(Math.abs(o.priceDeltaCents))}
                </span>
              ) : null;
              if (max > 1)
                return (
                  <div
                    key={id || oi}
                    className="flex min-h-14 items-center gap-3 rounded-md bg-sunken px-3 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{o.name}</span>
                      {off ? <span className="t-caption text-muted">esgotado</span> : delta}
                    </span>
                    <Stepper
                      label={o.name}
                      value={cur}
                      min={0}
                      max={off ? 0 : Math.min(max, cur + (g.maxSelect - n))}
                      onChange={(v) => setMods((m) => ({ ...m, [id]: v }))}
                    />
                  </div>
                );
              return (
                <button
                  key={id || oi}
                  type="button"
                  role={radio ? 'radio' : 'checkbox'}
                  aria-checked={cur > 0}
                  disabled={off || (full && !radio)}
                  onClick={() => {
                    haptic.tick();
                    setMods((m) => {
                      if (radio) {
                        const next = { ...m };
                        for (const x of g.options) if (x.id) delete next[x.id];
                        return cur ? next : { ...next, [id]: 1 };
                      }
                      return { ...m, [id]: cur ? 0 : 1 };
                    });
                  }}
                  className={cn(
                    'press-row flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left ring-1 disabled:opacity-45',
                    cur ? 'bg-spark-soft ring-primary' : 'bg-sunken ring-transparent',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-6 shrink-0 place-items-center border-2',
                      radio ? 'rounded-full' : 'rounded-[6px]',
                      cur ? 'border-primary bg-primary text-on-primary' : 'border-line-strong',
                    )}
                  >
                    {cur ? <Check weight="bold" className="size-3.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 font-semibold">{o.name}</span>
                  {off ? <span className="t-caption text-muted">esgotado</span> : delta}
                </button>
              );
            })}
          </fieldset>
        );
      })}

      {p.kind === 'combo'
        ? p.comboSlots.map((s, si) => {
            const n = slotCount(s);
            return (
              <fieldset key={s.id ?? si} className="space-y-2">
                <legend className="mb-2 flex w-full items-baseline justify-between gap-3">
                  <span className="t-label">{s.name}</span>
                  <span
                    className={cn(
                      't-caption tnum',
                      n < s.minSelect ? 'font-semibold text-warning' : 'text-muted',
                    )}
                  >
                    {ruleOf(s.minSelect, s.maxSelect)} · {n} de {s.maxSelect}
                  </span>
                </legend>
                {s.items.map((i) => {
                  const k = slotKey(s, i.productId);
                  const cur = kit[k] ?? 0;
                  return (
                    <div
                      key={i.productId}
                      className="flex min-h-14 items-center gap-3 rounded-md bg-sunken px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{i.name ?? 'Item'}</span>
                        {i.priceDeltaCents ? (
                          <span className="tnum t-body text-muted">
                            + {money(i.priceDeltaCents)}
                          </span>
                        ) : null}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface p-1">
                        <button
                          type="button"
                          aria-label={`menos ${i.name ?? 'item'}`}
                          disabled={!cur}
                          onClick={() => setKit((x) => ({ ...x, [k]: cur - 1 }))}
                          className="press grid size-11 place-items-center rounded-full hover:bg-press disabled:opacity-35"
                        >
                          <Minus weight="bold" className="size-5" />
                        </button>
                        <output className="tnum min-w-8 text-center font-semibold">{cur}</output>
                        <button
                          type="button"
                          aria-label={`mais ${i.name ?? 'item'}`}
                          disabled={cur >= s.qtyPerItem || n >= s.maxSelect}
                          onClick={() => {
                            haptic.tick();
                            setKit((x) => ({ ...x, [k]: cur + 1 }));
                          }}
                          className="press grid size-11 place-items-center rounded-full hover:bg-press disabled:opacity-35"
                        >
                          <Plus weight="bold" className="size-5" />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </fieldset>
            );
          })
        : null}

      <Field label="Observação" optional htmlFor={noteId}>
        <TextInput
          id={noteId}
          value={note}
          maxLength={140}
          placeholder="sem cebola, bem passado…"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Stepper label="quantidade" value={qty} min={1} max={99} onChange={setQty} />
        <Button size="lg" className="flex-1" disabled={!!missing} onClick={add}>
          {missing ? `falta: ${missing.name}` : 'pôr na conta'}
        </Button>
      </div>
    </div>
  );
}

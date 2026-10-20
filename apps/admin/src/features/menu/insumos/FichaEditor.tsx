import { MagnifyingGlass, Plus, Trash, WarningCircle } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import {
  api,
  type FichaLineIn,
  type Insumo,
  type InsumoUnit,
  type InsumosList,
  type OrderMode,
} from '../../../lib/api.ts';
import { money } from '../../../lib/format.ts';
import { haptic } from '../../../lib/haptics.ts';
import { qk, useMutation } from '../../../lib/query.ts';
import { Button, IconButton } from '../../../ui/Button.tsx';
import { cn } from '../../../ui/cn.ts';
import { messageOf } from '../../../ui/feedback.tsx';
import { Segmented, TextInput } from '../../../ui/fields.tsx';
import {
  costLabel,
  INPUT_UNITS,
  inputUnitOf,
  lineCost,
  MODE_LABEL,
  parseQty,
  qtyInput,
  UNIT_LABEL,
  type InputUnit,
} from './units.ts';

// A ficha técnica being edited: which insumos, how much of each and, where the ficha allows it,
// for which kind of order. Shared by products, options, preparos and the per-order packaging.

export type Draft = {
  key: number;
  ingredientId: string;
  qty: string;
  unit: InputUnit;
  mode: OrderMode | null;
};

let seq = 0;
export const draftOf = (
  l: { ingredientId: string; qtyMilli: number; mode?: OrderMode | null },
  insumos: Insumo[],
): Draft => {
  const base = insumos.find((i) => i.id === l.ingredientId)?.unit ?? 'un';
  const unit = inputUnitOf(l.qtyMilli, base);
  return {
    key: ++seq,
    ingredientId: l.ingredientId,
    qty: qtyInput(l.qtyMilli, unit),
    unit,
    mode: l.mode ?? null,
  };
};

/** the lines to send, or the first line that isn't a quantity */
export function linesOf(drafts: Draft[]): { lines: FichaLineIn[] } | { bad: number } {
  const lines: FichaLineIn[] = [];
  for (const d of drafts) {
    const q = parseQty(d.qty, d.unit);
    if (q == null) return { bad: d.key };
    lines.push({ ingredientId: d.ingredientId, qtyMilli: q, mode: d.mode });
  }
  return { lines };
}

/** what the drafts cost in fractional cents (a preparo divides it by its yield before rounding) */
export function draftsExact(drafts: Draft[], insumos: Insumo[]) {
  const by = new Map(insumos.map((i) => [i.id, i]));
  let c = 0;
  for (const d of drafts) {
    const q = parseQty(d.qty, d.unit);
    if (q != null) c += (q * (by.get(d.ingredientId)?.costPerKCents ?? 0)) / 1e6;
  }
  return c;
}

/** what the drafts cost, as a preview (Core's figure arrives on save), per mode when it matters */
export function draftsCost(drafts: Draft[], insumos: Insumo[], mode: OrderMode | null = null) {
  const by = new Map(insumos.map((i) => [i.id, i]));
  let c = 0;
  for (const d of drafts) {
    if (mode && d.mode && d.mode !== mode) continue;
    if (!mode && d.mode) continue;
    const q = parseQty(d.qty, d.unit);
    if (q != null) c += lineCost(q, by.get(d.ingredientId)?.costPerKCents ?? null);
  }
  return c;
}

const MODE_OPTIONS = [
  { value: '', label: 'em todo pedido' },
  { value: 'delivery', label: 'só delivery' },
  { value: 'pickup', label: 'só retirada' },
  { value: 'dine_in', label: 'só na mesa' },
];

export function FichaEditor({
  drafts,
  onChange,
  insumos,
  modes,
  bad,
  exclude,
  empty,
}: {
  drafts: Draft[];
  onChange: (d: Draft[]) => void;
  insumos: Insumo[];
  /** lines may be for one kind of order (packaging) */
  modes: boolean;
  /** the line to point at: its quantity isn't one */
  bad?: number | null;
  /** a preparo can't use itself */
  exclude?: string;
  empty: string;
}) {
  const by = useMemo(() => new Map(insumos.map((i) => [i.id, i])), [insumos]);
  const set = (key: number, patch: Partial<Draft>) =>
    onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <div className="space-y-3">
      {drafts.length ? (
        <ul className="divide-y divide-line rounded-md ring-1 ring-line">
          {drafts.map((d) => {
            const ing = by.get(d.ingredientId);
            const q = parseQty(d.qty, d.unit);
            const cost = q != null && ing ? lineCost(q, ing.costPerKCents) : null;
            const wrong = bad === d.key || (d.qty.trim() !== '' && q == null);
            return (
              <li key={d.key} className="space-y-2 px-3 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 pt-1">
                    <p className="font-semibold leading-snug">
                      {ing?.name ?? 'Insumo apagado'}
                      {ing?.kind === 'preparo' ? (
                        <span className="t-caption ml-1.5 font-medium text-muted">preparo</span>
                      ) : null}
                    </p>
                    <p className="t-caption text-muted">
                      {ing?.costPerKCents == null ? (
                        <span className="font-semibold text-warning">sem custo</span>
                      ) : cost != null ? (
                        <>
                          <span className="tnum font-semibold text-ink">{money(cost)}</span>
                          {' · '}
                          {costLabel(ing.costPerKCents, ing.unit)}
                        </>
                      ) : (
                        costLabel(ing.costPerKCents, ing.unit)
                      )}
                    </p>
                  </div>
                  <IconButton
                    label={`tirar ${ing?.name ?? 'insumo'} da ficha`}
                    onClick={() => {
                      haptic.tick();
                      onChange(drafts.filter((x) => x.key !== d.key));
                    }}
                    className="-mr-1 -mt-1 shrink-0 text-muted"
                  >
                    <Trash />
                  </IconButton>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <QtyInput
                    label={`quanto de ${ing?.name ?? 'insumo'}`}
                    value={d.qty}
                    unit={d.unit}
                    base={ing?.unit ?? 'un'}
                    invalid={wrong}
                    onChange={(qty) => set(d.key, { qty })}
                    onUnit={(unit) => set(d.key, { unit })}
                  />
                  {modes ? (
                    <ModeChip
                      label={`em que pedidos vai ${ing?.name ?? 'o insumo'}`}
                      value={d.mode}
                      onChange={(mode) => set(d.key, { mode })}
                    />
                  ) : null}
                </div>
                {wrong ? (
                  <p className="t-caption flex items-center gap-1.5 text-danger" role="alert">
                    <WarningCircle weight="fill" className="size-4 shrink-0" aria-hidden />
                    Digite quanto vai, como 150 ou 0,5.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">{empty}</p>
      )}
      <AddInsumo
        insumos={insumos.filter((i) => i.id !== exclude)}
        onPick={(i) =>
          onChange([
            ...drafts,
            {
              key: ++seq,
              ingredientId: i.id,
              qty: '',
              unit: i.unit === 'un' ? 'un' : i.unit,
              mode: null,
            },
          ])
        }
      />
    </div>
  );
}

const CARET =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='none' stroke='%236b8177' stroke-width='24' stroke-linecap='round' stroke-linejoin='round' d='M208 96l-80 80-80-80'/%3E%3C/svg%3E\")";

/** which orders a line goes in: quiet while it's every order, marked once it's one kind */
function ModeChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: OrderMode | null;
  onChange: (m: OrderMode | null) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || null) as OrderMode | null)}
      style={{ backgroundImage: CARET }}
      className={cn(
        'press t-label h-11 appearance-none rounded-full bg-[length:16px] bg-[right_12px_center] bg-no-repeat pl-3.5 pr-9 text-[0.875rem] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        value ? 'bg-spark-soft text-ink' : 'bg-sunken text-muted',
      )}
    >
      {MODE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** a quantity and, for weight and volume, which unit it's typed in */
export function QtyInput({
  label,
  value,
  unit,
  base,
  invalid,
  onChange,
  onUnit,
  id,
  autoFocus,
}: {
  label: string;
  value: string;
  unit: InputUnit;
  base: InsumoUnit;
  invalid?: boolean;
  onChange: (v: string) => void;
  onUnit: (u: InputUnit) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  const units = INPUT_UNITS[base];
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-28">
        <TextInput
          id={id}
          aria-label={id ? undefined : label}
          inputMode="decimal"
          enterKeyHint="done"
          autoFocus={autoFocus}
          placeholder="0"
          value={value}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, '').slice(0, 12))}
          trail={units.length === 1 ? units[0] : undefined}
          className="tnum font-semibold"
        />
      </div>
      {units.length > 1 ? (
        <div
          role="radiogroup"
          aria-label={`unidade de ${label}`}
          className="flex rounded-full bg-sunken p-0.5"
        >
          {units.map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              onClick={() => {
                if (unit === u) return;
                haptic.tick();
                // the amount stays the same: 1,5 kg reads 1500 g
                const q = parseQty(value, unit);
                onUnit(u);
                if (q != null) onChange(qtyInput(q, u));
              }}
              className={cn(
                'press t-label grid h-11 min-w-11 place-items-center rounded-full px-2.5',
                unit === u ? 'bg-surface text-ink depth-1' : 'text-muted',
              )}
            >
              {u}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** search the store's insumos to add one, or create it right there */
export function AddInsumo({
  insumos,
  onPick,
  label = 'adicionar insumo',
  createLabel = 'criar e pôr na ficha',
}: {
  insumos: Insumo[];
  onPick: (i: Insumo) => void;
  label?: string;
  createLabel?: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState<InsumoUnit>('g');
  const [err, setErr] = useState<string | null>(null);
  const list = useId();
  const needle = q.trim().toLocaleLowerCase('pt-BR');
  const found = insumos
    .filter((i) => !needle || i.name.toLocaleLowerCase('pt-BR').includes(needle))
    .slice(0, needle ? 8 : 6);
  const exact = insumos.some((i) => i.name.toLocaleLowerCase('pt-BR') === needle);
  const create = useMutation({
    mutationFn: () => api.createInsumo({ name: q.trim(), unit }),
    onSuccess: (r) => {
      qc.setQueryData<InsumosList>(qk.insumos, (d) =>
        d ? { ...d, insumos: [...d.insumos, r.insumo] } : d,
      );
      void qc.invalidateQueries({ queryKey: qk.insumos });
      pick(r.insumo);
    },
    onError: (e) => setErr(messageOf(e)),
  });
  const pick = (i: Insumo) => {
    haptic.tick();
    onPick(i);
    setQ('');
    setErr(null);
    setOpen(false);
  };

  if (!open)
    return (
      <Button variant="secondary" icon={<Plus />} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="space-y-2 rounded-md bg-sunken p-3">
      <TextInput
        type="search"
        aria-label="buscar ou criar insumo"
        aria-controls={list}
        autoFocus
        placeholder="Buscar ou criar, ex.: queijo"
        value={q}
        onChange={(e) => {
          setQ(e.target.value.slice(0, 80));
          setErr(null);
        }}
        lead={<MagnifyingGlass className="size-5" />}
        className="bg-surface"
      />
      <ul id={list} className="divide-y divide-line overflow-hidden rounded-sm bg-surface">
        {found.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => pick(i)}
              className="press-row flex min-h-12 w-full items-center gap-3 px-3 text-left hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{i.name}</span>
              <span className="t-caption shrink-0 text-muted">
                {costLabel(i.costPerKCents, i.unit) ??
                  (i.kind === 'preparo' ? 'preparo' : 'sem custo')}
              </span>
            </button>
          </li>
        ))}
        {!found.length && !needle ? (
          <li className="t-body px-3 py-3 text-muted">Digite o nome do primeiro insumo.</li>
        ) : null}
      </ul>
      {needle && !exact ? (
        <div className="space-y-2 rounded-sm bg-surface p-3">
          <p className="t-label">Criar “{q.trim()}”</p>
          <Segmented
            label="como se mede"
            value={unit}
            onChange={setUnit}
            options={(['g', 'ml', 'un'] as const).map((u) => ({
              value: u,
              label: `${UNIT_LABEL[u]} (${u === 'g' ? 'g, kg' : u === 'ml' ? 'ml, L' : 'un'})`,
            }))}
          />
          {err ? <p className="t-caption text-danger">{err}</p> : null}
          <Button block loading={create.isPending} onClick={() => create.mutate()}>
            {createLabel}
          </Button>
          <p className="t-caption text-muted">O custo você põe depois, em Insumos.</p>
        </div>
      ) : null}
      <Button variant="ghost" className="-ml-2 text-muted" onClick={() => setOpen(false)}>
        cancelar
      </Button>
    </div>
  );
}

/** the modes that cost differently, when any line is for one kind of order */
export const usesModes = (drafts: Draft[]) => drafts.some((d) => d.mode);

export { MODE_LABEL };

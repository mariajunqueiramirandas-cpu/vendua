import {
  CalendarCheck,
  Clock,
  FolderSimple,
  Package,
  Plus,
  Trash,
  type Icon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { AvailabilitySchedule, Category, Product } from '../../lib/api.ts';
import { money, plural } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Chips, Field, MoneyField, Segmented, Stepper, TextInput } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { MAX_WINDOWS, scheduleSentence, windowProblem, type ScheduleWindow } from './schedule.ts';
import { WindowRow } from './ScheduleEditor.tsx';

// The selection bar's sheets. Each one only gathers what to change: Core computes the result
// (prices in integer cents) and answers with what it replaced, which "desfazer" sends back.

export type BulkMore = 'category' | 'stock' | 'schedule' | 'delete';

/** "mais": the changes that don't fit the bar */
export function BulkMoreSheet({
  open,
  onOpenChange,
  count,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  onPick: (what: BulkMore) => void;
}) {
  const rows: { what: BulkMore; icon: Icon; title: string; body: string }[] = [
    {
      what: 'category',
      icon: FolderSimple,
      title: 'Mover de categoria',
      body: 'Todos vão para a mesma categoria.',
    },
    {
      what: 'stock',
      icon: Package,
      title: 'Estoque',
      body: 'Pôr a mesma quantidade em todos, ou parar de contar.',
    },
    {
      what: 'schedule',
      icon: Clock,
      title: 'Dias e horários',
      body: 'Só aos sábados, só no almoço: vale para todos.',
    },
    {
      what: 'delete',
      icon: Trash,
      title: 'Apagar',
      body: 'Somem do cardápio e da loja. Os pedidos antigos continuam com eles.',
    },
  ];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Mudar ${plural(count, 'produto', 'produtos')}`}
    >
      <ul className="-mx-2 pt-1">
        {rows.map(({ what, icon: I, title, body }) => (
          <li key={what}>
            <button
              type="button"
              onClick={() => onPick(what)}
              className="press-row flex min-h-16 w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-hover"
            >
              <span
                className={
                  what === 'delete'
                    ? 'grid size-10 shrink-0 place-items-center rounded-full bg-danger-soft text-danger'
                    : 'grid size-10 shrink-0 place-items-center rounded-full bg-sunken'
                }
              >
                <I className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={
                    what === 'delete' ? 'block font-semibold text-danger' : 'block font-semibold'
                  }
                >
                  {title}
                </span>
                <span className="t-caption block text-muted">{body}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function BulkCategorySheet({
  open,
  onOpenChange,
  count,
  cats,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  cats: Category[];
  onApply: (categoryId: string, name: string) => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Mover ${plural(count, 'produto', 'produtos')} para…`}
    >
      <div className="grid gap-2 pt-1">
        {cats.map((c) => (
          <Button
            key={c.id}
            variant="secondary"
            size="lg"
            block
            onClick={() => onApply(c.id, c.name)}
          >
            {c.name}
          </Button>
        ))}
      </div>
    </Sheet>
  );
}

type PriceMode = 'percent' | 'amount';

/** By a percentage (rounded to 10 cents) or by a fixed amount in R$, up or down. */
export function BulkPriceSheet({
  open,
  onOpenChange,
  products,
  onApply,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: Product[];
  onApply: (v: { percent: number } | { amountCents: number }) => void;
  loading: boolean;
}) {
  const [mode, setMode] = useState<PriceMode>('percent');
  const [dir, setDir] = useState<'up' | 'down'>('up');
  const [pct, setPct] = useState('10');
  const [amount, setAmount] = useState<number | null>(200);
  useEffect(() => {
    if (open) setDir('up');
  }, [open]);
  const n = Math.round(Number(pct.replace(',', '.')));
  const pctOk = Number.isFinite(n) && n > 0 && n <= (dir === 'up' ? 300 : 90);
  const sign = dir === 'up' ? 1 : -1;
  // what Core will refuse, said before the tap: a price that would reach zero
  const zeroed =
    mode === 'amount' && dir === 'down' && amount
      ? products.filter((p) => p.priceCents - amount <= 0)
      : [];
  const ok = mode === 'percent' ? pctOk : !!amount && amount > 0 && !zeroed.length;
  const sample = products.find((p) => p.priceCents > 0) ?? null;
  const example =
    sample && ok
      ? mode === 'percent'
        ? Math.round((sample.priceCents * (100 + sign * n)) / 1000) * 10
        : sample.priceCents + sign * (amount ?? 0)
      : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Ajustar o preço de ${plural(products.length, 'produto', 'produtos')}`}
      description={
        mode === 'percent'
          ? 'Os preços são arredondados para os 10 centavos mais próximos. O preço “de” e a promoção por horário acompanham.'
          : 'O mesmo valor em todos. O preço “de” e a promoção por horário acompanham.'
      }
      footer={
        <Button
          size="lg"
          block
          disabled={!ok}
          loading={loading}
          onClick={() =>
            onApply(
              mode === 'percent' ? { percent: sign * n } : { amountCents: sign * (amount ?? 0) },
            )
          }
        >
          {dir === 'up' ? 'aumentar' : 'baixar'}{' '}
          {ok ? (mode === 'percent' ? `${n}%` : money(amount ?? 0)) : ''}
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <Segmented
          label="ajustar por"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'percent', label: 'porcentagem' },
            { value: 'amount', label: 'valor em R$' },
          ]}
        />
        <Chips
          label="direção"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'up', label: 'aumentar' },
            { value: 'down', label: 'baixar' },
          ]}
        />
        {mode === 'percent' ? (
          <Field label="Quanto?" htmlFor="bp">
            <TextInput
              id="bp"
              inputMode="numeric"
              trail="%"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
            />
          </Field>
        ) : (
          <Field label="Quanto?" htmlFor="bp-amount">
            <MoneyField id="bp-amount" cents={amount} min={1} onCommit={setAmount} />
          </Field>
        )}
        {zeroed.length ? (
          <Notice tone="warning" title="Esse valor zera o preço" role="alert">
            {zeroed.length === 1
              ? `${zeroed[0]!.name} custa ${money(zeroed[0]!.priceCents)}. Baixe menos, ou tire ele da seleção.`
              : `${zeroed
                  .slice(0, 3)
                  .map((p) => p.name)
                  .join(
                    ', ',
                  )}${zeroed.length > 3 ? ' e outros' : ''} ficariam sem preço. Baixe menos, ou tire eles da seleção.`}
          </Notice>
        ) : sample && example !== null ? (
          <p className="t-body text-muted">
            Ex.: {sample.name}, de {money(sample.priceCents)}, fica{' '}
            <strong className="tnum text-ink">{money(example)}</strong>.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** The same count in every selected product, or stop counting. */
export function BulkStockSheet({
  open,
  onOpenChange,
  count,
  onApply,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  onApply: (stockQuantity: number | null) => void;
  loading: boolean;
}) {
  const [mode, setMode] = useState<'count' | 'off'>('count');
  const [qty, setQty] = useState(10);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Estoque de ${plural(count, 'produto', 'produtos')}`}
      footer={
        <Button
          size="lg"
          block
          loading={loading}
          onClick={() => onApply(mode === 'count' ? qty : null)}
        >
          {mode === 'count' ? `pôr ${qty} em cada um` : 'parar de contar'}
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <Segmented
          label="estoque"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'count', label: 'contar estoque' },
            { value: 'off', label: 'feito sob pedido' },
          ]}
        />
        {mode === 'count' ? (
          <>
            <Field label="Quantidade em cada um">
              <Stepper
                label="quantidade em estoque"
                value={qty}
                min={0}
                max={100000}
                onChange={setQty}
              />
            </Field>
            <p className="t-body text-muted">
              Cada venda desconta sozinha. No zero, o produto aparece como esgotado.
            </p>
          </>
        ) : (
          <p className="t-body text-muted">
            Sem contar estoque, o produto não esgota sozinho. Você marca “esgotado” quando precisar.
          </p>
        )}
      </div>
    </Sheet>
  );
}

const FRESH: ScheduleWindow = { days: [6], from: '09:00', to: '13:00' };

/** The days and hours the selected products are sold, or none (whenever the store is open). */
export function BulkScheduleSheet({
  open,
  onOpenChange,
  count,
  onApply,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  onApply: (s: AvailabilitySchedule | null) => void;
  loading: boolean;
}) {
  const [on, setOn] = useState<'some' | 'always'>('some');
  const [s, setS] = useState<AvailabilitySchedule>({ windows: [FRESH], outside: 'unavailable' });
  const valid = s.windows.length > 0 && s.windows.every((w) => !windowProblem(w));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Dias e horários de ${plural(count, 'produto', 'produtos')}`}
      footer={
        <Button
          size="lg"
          block
          disabled={on === 'some' && !valid}
          loading={loading}
          onClick={() => onApply(on === 'some' ? s : null)}
        >
          {on === 'some' ? 'aplicar esse horário' : 'vender sempre que a loja abrir'}
        </Button>
      }
    >
      <div className="space-y-4 pt-2">
        <Segmented
          label="quando vender"
          value={on}
          onChange={setOn}
          options={[
            { value: 'some', label: 'só em alguns dias' },
            { value: 'always', label: 'sempre' },
          ]}
        />
        {on === 'some' ? (
          <>
            <div
              className="flex items-start gap-3 rounded-md bg-spark-soft px-4 py-3"
              aria-live="polite"
            >
              <CalendarCheck weight="duotone" className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p className="t-body min-w-0 flex-1">
                {valid ? scheduleSentence(s) : 'Termine de preencher os horários.'}
              </p>
            </div>
            <ol className="space-y-3">
              {s.windows.map((w, i) => (
                <WindowRow
                  key={i}
                  n={i}
                  w={w}
                  many={s.windows.length > 1}
                  onChange={(x) =>
                    setS((d) => ({ ...d, windows: d.windows.map((y, k) => (k === i ? x : y)) }))
                  }
                  onRemove={() =>
                    setS((d) => ({ ...d, windows: d.windows.filter((_, k) => k !== i) }))
                  }
                />
              ))}
            </ol>
            {s.windows.length < MAX_WINDOWS ? (
              <Button
                variant="ghost"
                icon={<Plus />}
                className="-ml-2"
                onClick={() => setS((d) => ({ ...d, windows: [...d.windows, FRESH] }))}
              >
                adicionar outro horário
              </Button>
            ) : null}
            <Field label="Fora desses horários">
              <Chips
                label="fora desses horários"
                value={s.outside}
                onChange={(v) => setS((d) => ({ ...d, outside: v }))}
                options={[
                  { value: 'unavailable', label: 'aparece como indisponível' },
                  { value: 'hidden', label: 'some do cardápio' },
                ]}
              />
            </Field>
          </>
        ) : (
          <p className="t-body text-muted">
            Tira o horário próprio: os produtos aparecem sempre que a loja estiver aberta.
          </p>
        )}
      </div>
    </Sheet>
  );
}

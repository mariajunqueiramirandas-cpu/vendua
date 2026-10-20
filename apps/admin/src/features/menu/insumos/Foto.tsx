import { Camera, Images, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type Insumo,
  type InsumoImportItem,
  type InsumoPhotoRow,
  type InsumoUnit,
} from '../../../lib/api.ts';
import { money, num } from '../../../lib/format.ts';
import { haptic } from '../../../lib/haptics.ts';
import { moneyInput, parseMoney } from '../../../lib/parse.ts';
import { useMutation } from '../../../lib/query.ts';
import { Button, IconButton } from '../../../ui/Button.tsx';
import { cn } from '../../../ui/cn.ts';
import { messageOf } from '../../../ui/feedback.tsx';
import { Field, Select, TextInput } from '../../../ui/fields.tsx';
import { Notice } from '../../../ui/Notice.tsx';
import { Sheet } from '../../../ui/Sheet.tsx';
import { Spinner } from '../../../ui/Spinner.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { base64, shrinkPhoto } from '../../copilot/media.ts';
import { QtyInput } from './FichaEditor.tsx';
import {
  costLabel,
  inputUnitOf,
  parseQty,
  qty,
  qtyInput,
  UNIT_LABEL,
  type InputUnit,
} from './units.ts';

// "Foto ou print": a nota, a receipt, a supplier's order or a price list. Each photo goes to Core
// on its own and comes back as lines matched to the store's insumos; the owner checks each one,
// and one save creates what's new, registers what was bought and sets the list's prices.

const MAX_PHOTOS = 6;
const NEW = '';
/** a price is for 1 kg, 1 L or 1 un unless the photo said otherwise */
const ONE: Record<InsumoUnit, number> = { g: 1_000_000, ml: 1_000_000, un: 1000 };

type Row = {
  key: number;
  printed: string | null;
  /** the insumo it goes to, or NEW */
  target: string;
  name: string;
  unit: InsumoUnit;
  /** a line of what was bought; otherwise a price */
  buy: boolean;
  qty: string;
  qUnit: InputUnit;
  paid: string;
  price: string;
  perMilli: number;
  packMilli: number | null;
  packName: string | null;
};
let seq = 0;

/** a row whose insumo counts in another unit: what was read in the old one is dropped */
function inUnit(r: Row, unit: InsumoUnit): Row {
  if (unit === r.unit) return r;
  return {
    ...r,
    unit,
    qty: '',
    qUnit: inputUnitOf(null, unit),
    price: '',
    perMilli: ONE[unit],
    packMilli: null,
    packName: null,
  };
}

function rowOf(r: InsumoPhotoRow, by: Map<string, Insumo>): Row {
  const qUnit = inputUnitOf(r.qtyMilli, r.unit);
  const row: Row = {
    key: ++seq,
    printed: r.printed,
    target: NEW,
    name: r.name,
    unit: r.unit,
    buy: r.qtyMilli != null,
    qty: qtyInput(r.qtyMilli, qUnit),
    qUnit,
    paid: r.costCents != null ? moneyInput(r.costCents) : '',
    price: r.price ? moneyInput(r.price.cents) : '',
    perMilli: r.price?.milli ?? ONE[r.unit],
    packMilli: r.packMilli,
    packName: r.packName,
  };
  const match = r.matchId ? by.get(r.matchId) : undefined;
  return match ? { ...inUnit(row, match.unit), target: match.id } : row;
}

function photoError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === 'IMAGE_UNREAD') return 'não deu para ler';
    if (e.code === 'RATE_LIMITED') return 'o limite de fotos de hoje acabou';
    if (e.code === 'UNSUPPORTED_MEDIA') return 'não é uma foto que a gente abre';
    if (e.code === 'MEDIA_UNAVAILABLE') return 'a leitura de fotos está desligada agora';
  }
  return e instanceof Error && e.message ? e.message : 'não deu certo';
}

export function PhotoSheet({
  open,
  all,
  onClose,
}: {
  open: boolean;
  all: Insumo[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, setReading] = useState<{ at: number; of: number } | null>(null);
  const [misses, setMisses] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [bad, setBad] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const bought = all
    .filter((i) => i.kind === 'insumo')
    .sort((a, b) => a.name.localeCompare(b.name));
  const by = new Map(bought.map((i) => [i.id, i]));

  // a refused line may be far down a long nota
  useEffect(() => {
    if (bad != null)
      document
        .querySelector(`[data-photo-row="${bad}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [bad]);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setMisses([]);
    setNote('');
    setBad(null);
    setErr(null);
  }, [open]);

  const read = async (files: File[]) => {
    const list = files.slice(0, MAX_PHOTOS);
    const missed: string[] = [];
    for (const [i, f] of list.entries()) {
      setReading({ at: i + 1, of: list.length });
      try {
        const p = await shrinkPhoto(f);
        const r = await api.insumosPhoto({ mime: p.mime, data: await base64(p.blob) });
        URL.revokeObjectURL(p.url);
        if (!r.rows.length) missed.push(`A foto ${i + 1} não mostrou insumos.`);
        setRows((prev) => [...prev, ...r.rows.map((x) => rowOf(x, by))]);
      } catch (e) {
        missed.push(`A foto ${i + 1}: ${photoError(e)}.`);
        if (e instanceof ApiError && ['RATE_LIMITED', 'MEDIA_UNAVAILABLE'].includes(e.code)) break;
      }
    }
    if (files.length > MAX_PHOTOS)
      missed.push(`Lemos as ${MAX_PHOTOS} primeiras. Mande o resto depois de salvar.`);
    setMisses(missed);
    setReading(null);
  };

  const set = (key: number, patch: Partial<Row> | ((r: Row) => Row)) => {
    setRows((xs) =>
      xs.map((x) =>
        x.key === key ? (typeof patch === 'function' ? patch(x) : { ...x, ...patch }) : x,
      ),
    );
    setBad(null);
    setErr(null);
  };

  const save = useMutation({
    mutationFn: () => {
      const items = rows.map((r): InsumoImportItem => {
        const fail = (msg: string) => {
          setBad(r.key);
          return new Error(msg);
        };
        const name = r.name.trim();
        if (r.target === NEW && !name) throw fail('Dê um nome ao insumo novo.');
        const who = r.target === NEW ? name : (by.get(r.target)?.name ?? name);
        const base: InsumoImportItem = {
          ...(r.target === NEW ? { name } : { id: r.target }),
          unit: r.unit,
          ...(r.packMilli ? { packMilli: r.packMilli, packName: r.packName } : {}),
        };
        if (r.buy) {
          const q = parseQty(r.qty, r.qUnit);
          const c = parseMoney(r.paid);
          if (q == null || c == null) throw fail(`${who}: diga quanto chegou e quanto pagou.`);
          return { ...base, qtyMilli: q, costCents: c };
        }
        if (!r.price.trim()) return base;
        const c = parseMoney(r.price);
        if (c == null) throw fail(`${who}: o preço não é um valor.`);
        return { ...base, cost: { cents: c, milli: r.perMilli } };
      });
      return api.importInsumos(items, note.trim() || null);
    },
    onSuccess: (r) => {
      haptic.commit();
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(
        [
          r.bought ? `Compra de ${money(r.totalCents)} registrada` : null,
          r.priced
            ? `${num(r.priced)} ${r.priced === 1 ? 'custo atualizado' : 'custos atualizados'}`
            : null,
          r.created
            ? `${num(r.created)} ${r.created === 1 ? 'insumo novo' : 'insumos novos'}`
            : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Nada mudou',
      );
      onClose();
    },
    onError: (e) => {
      // Core names the line: items[3].unit
      const at = e instanceof ApiError ? /^items\[(\d+)\]/.exec(e.field ?? '') : null;
      if (at) setBad(rows[Number(at[1])]?.key ?? null);
      setErr(messageOf(e));
    },
  });

  const buys = rows.filter((r) => r.buy);
  const total = buys.reduce((s, r) => s + (parseMoney(r.paid) ?? 0), 0);
  const fresh = rows.filter((r) => r.target === NEW).length;

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/jpeg,image/png,image/webp,image/*"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (files.length) void read(files);
      }}
    />
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && !reading && onClose()}
      title="Foto ou print"
      description="Da nota, do cupom, do pedido do fornecedor ou de uma lista de preços."
      footer={
        reading ? null : rows.length ? (
          <Button block size="lg" loading={save.isPending} onClick={() => save.mutate()}>
            {buys.length
              ? `registrar compra${total ? ` · ${money(total)}` : ''}`
              : `salvar ${num(rows.length)} ${rows.length === 1 ? 'insumo' : 'insumos'}`}
          </Button>
        ) : (
          <Button block size="lg" icon={<Camera />} onClick={() => input.current?.click()}>
            escolher fotos
          </Button>
        )
      }
    >
      {picker}
      {reading ? (
        <div className="flex flex-col items-center gap-4 py-10 text-center" role="status">
          <Spinner className="size-8" />
          <p className="t-title-2">
            Lendo a foto {reading.at} de {reading.of}…
          </p>
          <p className="t-body max-w-sm text-muted">
            Cada foto leva alguns segundos. Fique nesta tela até terminar.
          </p>
        </div>
      ) : !rows.length ? (
        <div className="space-y-4 pt-1">
          <p className="t-body">
            A Venduá lê cada foto e você confere antes de salvar. Uma nota vira uma compra: o
            estoque sobe e o custo médio se ajusta. Uma lista de preços atualiza o custo. O que
            ainda não é insumo é cadastrado junto.
          </p>
          <ul className="t-body list-disc space-y-1.5 pl-5 text-muted">
            <li>Até {MAX_PHOTOS} fotos de cada vez, com o texto nítido e sem cortar valores.</li>
            <li>Prints do app do atacado ou do pedido no WhatsApp também valem.</li>
          </ul>
          {misses.length ? (
            <Notice tone="warning" title="Algumas fotos não deram certo">
              {misses.join(' ')}
            </Notice>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <p className="t-body text-muted">
            {[
              buys.length
                ? `${num(buys.length)} ${buys.length === 1 ? 'comprado' : 'comprados'}`
                : null,
              rows.length - buys.length
                ? `${num(rows.length - buys.length)} com preço de lista`
                : null,
              fresh ? `${num(fresh)} ${fresh === 1 ? 'novo' : 'novos'}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            . Confira com a foto e tire o que não for insumo.
          </p>
          {misses.length ? (
            <Notice tone="warning" title="Algumas fotos não deram certo">
              {misses.join(' ')}
            </Notice>
          ) : null}
          <ul className="divide-y divide-line rounded-md ring-1 ring-line">
            {rows.map((r) => (
              <PhotoRowItem
                key={r.key}
                r={r}
                bought={bought}
                bad={bad === r.key}
                onChange={(p) => set(r.key, p)}
                onDrop={() => setRows((xs) => xs.filter((x) => x.key !== r.key))}
              />
            ))}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            icon={<Images />}
            className="h-11"
            onClick={() => input.current?.click()}
          >
            mais fotos
          </Button>
          {buys.length ? (
            <Field label="Fornecedor ou nota" optional htmlFor="photo-note">
              <TextInput
                id="photo-note"
                maxLength={120}
                placeholder="ex.: Atacadão, nota 1234"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          ) : null}
          {err ? (
            <p className="t-caption text-danger" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

const UNITS: InsumoUnit[] = ['g', 'ml', 'un'];

function PhotoRowItem({
  r,
  bought,
  bad,
  onChange,
  onDrop,
}: {
  r: Row;
  bought: Insumo[];
  bad: boolean;
  onChange: (p: Partial<Row> | ((r: Row) => Row)) => void;
  onDrop: () => void;
}) {
  const mine = bought.find((i) => i.id === r.target);
  const who = mine?.name ?? (r.name.trim() || 'insumo novo');
  const q = r.buy ? parseQty(r.qty, r.qUnit) : null;
  const c = r.buy ? parseMoney(r.paid) : null;
  return (
    <li data-photo-row={r.key} className={cn('space-y-2 px-3 py-3', bad && 'bg-danger-soft')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Select
            label={`insumo da linha ${r.printed ?? r.name}`}
            value={r.target}
            onChange={(id) =>
              onChange((x) => {
                const i = bought.find((y) => y.id === id);
                return i ? { ...inUnit(x, i.unit), target: id } : { ...x, target: NEW };
              })
            }
            options={[
              { value: NEW, label: `Novo: ${r.name.trim() || 'insumo'}` },
              ...bought.map((i) => ({ value: i.id, label: i.name })),
            ]}
          />
        </div>
        <IconButton label={`tirar ${who}`} className="-mr-1 shrink-0 text-muted" onClick={onDrop}>
          <Trash />
        </IconButton>
      </div>
      {r.printed ? (
        <p className="t-caption line-clamp-2 break-words text-muted">na foto: {r.printed}</p>
      ) : null}
      {r.target === NEW ? (
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
          <TextInput
            aria-label="nome do insumo novo"
            maxLength={80}
            value={r.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <Select
            label={`${who} conta em`}
            value={r.unit}
            onChange={(u) => onChange((x) => inUnit(x, u as InsumoUnit))}
            options={UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))}
          />
        </div>
      ) : null}
      {r.buy ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <QtyInput
              label={`quanto chegou de ${who}`}
              value={r.qty}
              unit={r.qUnit}
              base={r.unit}
              invalid={bad && q == null}
              onChange={(v) => onChange({ qty: v })}
              onUnit={(u) => onChange({ qUnit: u })}
            />
            <div className="w-36">
              <TextInput
                aria-label={`quanto pagou por ${who}`}
                lead="R$"
                inputMode="decimal"
                placeholder="pagou"
                value={r.paid}
                aria-invalid={(bad && c == null) || undefined}
                onChange={(e) => onChange({ paid: e.target.value.slice(0, 14) })}
                onBlur={() => c != null && onChange({ paid: moneyInput(c) })}
                className="tnum"
              />
            </div>
          </div>
          <p className="t-caption text-muted">
            {q != null && c != null
              ? `sai a ${costLabel(Math.round((c * 1e6) / q), r.unit)}`
              : !r.qty
                ? `Digite quanto chegou, em ${r.unit === 'un' ? 'unidades' : UNIT_LABEL[r.unit].toLowerCase()}.`
                : null}
            {mine?.costPerKCents != null ? ` · hoje ${costLabel(mine.costPerKCents, r.unit)}` : ''}
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
            <TextInput
              aria-label={`preço de ${who}`}
              lead="R$"
              inputMode="decimal"
              placeholder="preço"
              value={r.price}
              onChange={(e) => onChange({ price: e.target.value.slice(0, 14) })}
              onBlur={() => {
                const p = parseMoney(r.price);
                if (p != null) onChange({ price: moneyInput(p) });
              }}
              className="tnum"
            />
          </div>
          <span className="t-body text-muted">por {qty(r.perMilli, r.unit)}</span>
          {mine?.costPerKCents != null ? (
            <span className="t-caption text-muted">
              · hoje {costLabel(mine.costPerKCents, r.unit)}
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}

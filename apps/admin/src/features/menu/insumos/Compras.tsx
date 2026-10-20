import {
  CheckSquare,
  Copy,
  ShoppingCart,
  Square,
  Trash,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Insumo, type InsumosList, type OrderMode } from '../../../lib/api.ts';
import { money } from '../../../lib/format.ts';
import { haptic } from '../../../lib/haptics.ts';
import { moneyInput, parseMoney } from '../../../lib/parse.ts';
import { qk, useMutation } from '../../../lib/query.ts';
import { Button, IconButton } from '../../../ui/Button.tsx';
import { cn } from '../../../ui/cn.ts';
import { copyText } from '../../../ui/CopyValue.tsx';
import { messageOf } from '../../../ui/feedback.tsx';
import { Field, TextInput } from '../../../ui/fields.tsx';
import { Sheet } from '../../../ui/Sheet.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { stockStatus } from './status.tsx';
import {
  AddInsumo,
  draftOf,
  draftsCost,
  FichaEditor,
  linesOf,
  QtyInput,
  type Draft,
} from './FichaEditor.tsx';
import {
  costLabel,
  inputUnitOf,
  MODE_LABEL,
  packsLabel,
  parseQty,
  qty,
  qtyInput,
  type InputUnit,
} from './units.ts';

/** what a purchase sheet opens with: from the shopping list, or one insumo */
export type Prefill = { items: { id: string; qtyMilli?: number | null }[] };

type Item = { key: number; id: string; qty: string; unit: InputUnit; paid: string };
let seq = 0;

/** What arrived and what it cost, several insumos at once: each one's average cost moves. */
export function PurchaseSheet({
  prefill,
  all,
  onClose,
}: {
  prefill: Prefill | null;
  all: Insumo[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [note, setNote] = useState('');
  const [bad, setBad] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const bought = all.filter((i) => i.kind === 'insumo');
  const by = new Map(all.map((i) => [i.id, i]));
  useEffect(() => {
    if (!prefill) return;
    setItems(
      prefill.items.flatMap((p) => {
        const i = all.find((x) => x.id === p.id && x.kind === 'insumo');
        if (!i) return [];
        const unit = inputUnitOf(p.qtyMilli ?? null, i.unit);
        return [{ key: ++seq, id: i.id, qty: qtyInput(p.qtyMilli ?? null, unit), unit, paid: '' }];
      }),
    );
    setNote('');
    setBad(null);
    setErr(null);
    // only on open: a refetch of the list must not wipe what's being typed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  const set = (key: number, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const total = items.reduce((s, x) => s + (parseMoney(x.paid) ?? 0), 0);

  const save = useMutation({
    mutationFn: () => {
      if (!items.length) throw new Error('Adicione o que chegou.');
      const body = items.map((x) => {
        const q = parseQty(x.qty, x.unit);
        const c = parseMoney(x.paid);
        if (q == null || c == null) {
          setBad(x.key);
          throw new Error(`${by.get(x.id)?.name ?? 'Insumo'}: diga quanto chegou e quanto pagou.`);
        }
        return { id: x.id, qtyMilli: q, costCents: c };
      });
      return api.purchaseInsumos(body, note.trim() || null);
    },
    onSuccess: (r) => {
      haptic.commit();
      const fresh = new Map(r.insumos.map((i) => [i.id, i]));
      qc.setQueryData<InsumosList>(qk.insumos, (d) =>
        d ? { ...d, insumos: d.insumos.map((i) => fresh.get(i.id) ?? i) } : d,
      );
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(
        r.insumos.length === 1
          ? 'Compra registrada'
          : `Compra de ${r.insumos.length} insumos registrada`,
      );
      onClose();
    },
    onError: (e) => setErr(messageOf(e)),
  });

  return (
    <Sheet
      open={!!prefill}
      onOpenChange={(o) => !o && onClose()}
      title="Registrar compra"
      description="O que chegou e quanto pagou. O estoque sobe e o custo médio de cada insumo se ajusta."
      footer={
        <Button
          block
          size="lg"
          icon={<ShoppingCart />}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          registrar{total ? ` · ${money(total)}` : ''}
        </Button>
      }
    >
      <div className="space-y-4 pt-1">
        {items.length ? (
          <ul className="divide-y divide-line rounded-md ring-1 ring-line">
            {items.map((x) => {
              const i = by.get(x.id);
              const q = parseQty(x.qty, x.unit);
              const c = parseMoney(x.paid);
              return (
                <li
                  key={x.key}
                  className={cn('space-y-2 px-3 py-3', bad === x.key && 'bg-danger-soft')}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="font-semibold leading-snug">{i?.name}</p>
                      <p className="t-caption text-muted">
                        {q != null && c != null && i
                          ? `sai a ${costLabel(Math.round((c * 1e6) / q), i.unit)}`
                          : i?.costPerKCents != null
                            ? `hoje ${costLabel(i.costPerKCents, i.unit)}`
                            : 'sem custo ainda'}
                      </p>
                    </div>
                    <IconButton
                      label={`tirar ${i?.name ?? 'insumo'} da compra`}
                      className="-mr-1 -mt-1 shrink-0 text-muted"
                      onClick={() => setItems((xs) => xs.filter((y) => y.key !== x.key))}
                    >
                      <Trash />
                    </IconButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <QtyInput
                      label={`quanto chegou de ${i?.name ?? 'insumo'}`}
                      value={x.qty}
                      unit={x.unit}
                      base={i?.unit ?? 'un'}
                      onChange={(v) => {
                        set(x.key, { qty: v });
                        setBad(null);
                      }}
                      onUnit={(u) => set(x.key, { unit: u })}
                    />
                    <div className="w-36">
                      <TextInput
                        aria-label={`quanto pagou por ${i?.name ?? 'insumo'}`}
                        lead="R$"
                        inputMode="decimal"
                        placeholder="pagou"
                        value={x.paid}
                        onChange={(e) => {
                          set(x.key, { paid: e.target.value.slice(0, 14) });
                          setBad(null);
                        }}
                        onBlur={() => c != null && set(x.key, { paid: moneyInput(c) })}
                        className="tnum"
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="t-body rounded-md bg-sunken px-4 py-3 text-muted">
            Adicione cada insumo que chegou, com quanto veio e quanto pagou.
          </p>
        )}
        <AddInsumo
          insumos={bought.filter((i) => !items.some((x) => x.id === i.id))}
          label="adicionar o que chegou"
          createLabel="criar e pôr na compra"
          onPick={(i) =>
            setItems((xs) => [
              ...xs,
              { key: ++seq, id: i.id, qty: '', unit: inputUnitOf(null, i.unit), paid: '' },
            ])
          }
        />
        <Field label="Fornecedor ou nota" optional htmlFor="purchase-note">
          <TextInput
            id="purchase-note"
            maxLength={120}
            placeholder="ex.: Atacadão, nota 1234"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {err ? (
          <p className="t-caption text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** What's at zero, below it or in its aviso, as a list to send whoever supplies it. */
export function ShoppingSheet({
  open,
  items,
  store,
  onClose,
  onArrived,
}: {
  open: boolean;
  items: Insumo[];
  store: string;
  onClose: () => void;
  onArrived: (items: Prefill['items']) => void;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setOff(new Set());
  }, [open]);
  const chosen = items.filter((i) => !off.has(i.id));
  const buy = (i: Insumo) =>
    i.buyPacks && i.packMilli
      ? packsLabel(i.buyPacks, i.packName, i.packMilli, i.unit)
      : i.buyMilli
        ? qty(i.buyMilli, i.unit)
        : 'repor';
  const text = [
    `Lista de compras${store ? ` — ${store}` : ''}`,
    ...chosen.map((i) => `• ${i.name}: ${buy(i)}`),
  ].join('\n');

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Lista de compras"
      description="Os insumos que acabaram ou chegaram no aviso, com quanto comprar para voltar ao estoque ideal."
      footer={
        <div className="flex flex-col gap-2">
          <a
            href={chosen.length ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!chosen.length || undefined}
            className={cn(
              'press t-label inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-whatsapp px-6 text-[1rem] text-on-whatsapp depth-1',
              !chosen.length && 'pointer-events-none opacity-45',
            )}
          >
            <WhatsappLogo weight="fill" className="size-6" /> enviar no WhatsApp
          </a>
          <div className="flex gap-2">
            <Button
              block
              variant="secondary"
              icon={<Copy />}
              disabled={!chosen.length}
              onClick={() =>
                void copyText(text).then((ok) =>
                  ok
                    ? toast('Lista copiada')
                    : toast.error('Não deu para copiar. Tente o WhatsApp.'),
                )
              }
            >
              copiar
            </Button>
            <Button
              block
              variant="secondary"
              icon={<ShoppingCart />}
              disabled={!chosen.some((i) => i.kind === 'insumo')}
              onClick={() =>
                onArrived(
                  chosen
                    .filter((i) => i.kind === 'insumo')
                    .map((i) => ({ id: i.id, qtyMilli: i.buyMilli })),
                )
              }
            >
              chegou
            </Button>
          </div>
        </div>
      }
    >
      {items.length ? (
        <ul className="divide-y divide-line pt-1">
          {items.map((i) => {
            const on = !off.has(i.id);
            return (
              <li key={i.id} className="flex min-h-16 items-center gap-2 py-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={`${i.name} na lista`}
                  onClick={() => {
                    haptic.tick();
                    setOff((s) => {
                      const n = new Set(s);
                      if (on) n.add(i.id);
                      else n.delete(i.id);
                      return n;
                    });
                  }}
                  className="press -ml-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-press"
                >
                  {on ? (
                    <CheckSquare weight="fill" className="size-7 text-ink" />
                  ) : (
                    <Square weight="bold" className="size-7 text-muted" />
                  )}
                </button>
                <div className={cn('min-w-0 flex-1', !on && 'opacity-50')}>
                  <p className="line-clamp-2 font-semibold leading-snug">{i.name}</p>
                  <p className="t-caption text-muted">
                    {stockStatus(i)}
                    {i.sold7dMilli ? ` · saiu ${qty(i.sold7dMilli, i.unit)} em 7 dias` : ''}
                  </p>
                </div>
                <p className={cn('tnum shrink-0 text-right font-bold', !on && 'opacity-50')}>
                  {buy(i)}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="t-body py-4 text-muted">Nada para repor agora.</p>
      )}
    </Sheet>
  );
}

const MODES: OrderMode[] = ['delivery', 'pickup', 'dine_in'];

/** The packaging every order takes, per kind of order. */
export function PerOrderSheet({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: InsumosList | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const all = data?.insumos ?? [];
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [bad, setBad] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !data) return;
    setDrafts(data.perOrder.map((l) => draftOf(l, data.insumos)));
    setBad(null);
    setErr(null);
    // only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const save = useMutation({
    mutationFn: () => {
      const l = linesOf(drafts);
      if ('bad' in l) {
        setBad(l.bad);
        throw new Error('Digite quanto vai de cada um.');
      }
      return api.setPerOrder(l.lines);
    },
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData<InsumosList>(qk.insumos, (d) => (d ? { ...d, ...r } : d));
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast('Embalagem de cada pedido salva');
      onClose();
    },
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Embalagem de cada pedido"
      description="Uma vez por pedido, além da ficha de cada produto. Escolha em que pedidos cada item vai."
      footer={
        <Button block size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          salvar
        </Button>
      }
    >
      <div className="space-y-4 pt-1">
        <FichaEditor
          drafts={drafts}
          onChange={(d) => {
            setDrafts(d);
            setBad(null);
          }}
          insumos={all}
          modes
          bad={bad}
          empty="Nada ainda. Adicione a sacola, o guardanapo ou o que mais sai em todo pedido."
        />
        <p className="t-caption flex flex-wrap gap-x-3 rounded-md bg-sunken px-4 py-3 text-muted">
          {MODES.map((m) => (
            <span key={m}>
              {MODE_LABEL[m]}{' '}
              <span className="tnum font-semibold text-ink">
                {money(draftsCost(drafts, all, m))}
              </span>
            </span>
          ))}
        </p>
        {err ? (
          <p className="t-caption text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

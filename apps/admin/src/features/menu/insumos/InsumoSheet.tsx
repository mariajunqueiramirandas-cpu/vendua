import { CaretDown, ClockCounterClockwise } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type Insumo,
  type InsumoMovement,
  type InsumosList,
  type InsumoUnit,
} from '../../../lib/api.ts';
import { ago, money, when } from '../../../lib/format.ts';
import { haptic } from '../../../lib/haptics.ts';
import { moneyInput, parseMoney } from '../../../lib/parse.ts';
import { qk, useMutation } from '../../../lib/query.ts';
import { Button } from '../../../ui/Button.tsx';
import { cn } from '../../../ui/cn.ts';
import { messageOf } from '../../../ui/feedback.tsx';
import { Field, Segmented, TextInput } from '../../../ui/fields.tsx';
import { HoldButton } from '../../../ui/HoldButton.tsx';
import { Sheet } from '../../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../../ui/skeletons.tsx';
import { toast } from '../../../ui/Toast.tsx';
import {
  draftOf,
  draftsCost,
  draftsExact,
  FichaEditor,
  linesOf,
  QtyInput,
  type Draft,
} from './FichaEditor.tsx';
import {
  costLabel,
  defaultCostUnit,
  inputUnitOf,
  parseQty,
  qty,
  qtyInput,
  UNIT_LABEL,
  type InputUnit,
} from './units.ts';

type Tab = 'estoque' | 'cadastro' | 'ficha';
type Act = 'comprei' | 'contei' | 'perdi' | 'fiz';

/** replaces one insumo in the list Core sent, until the refetch lands */
function useSaved() {
  const qc = useQueryClient();
  return (i: Insumo) => {
    qc.setQueryData<InsumosList>(qk.insumos, (d) =>
      d ? { ...d, insumos: d.insumos.map((x) => (x.id === i.id ? i : x)) } : d,
    );
    void qc.invalidateQueries({ queryKey: ['catalog'] });
  };
}

export function InsumoSheet({
  insumo: open,
  all,
  onClose,
  onBuy,
}: {
  insumo: Insumo | null;
  all: Insumo[];
  onClose: () => void;
  onBuy: (i: Insumo) => void;
}) {
  // the last insumo stays while the sheet slides away
  const [held, setHeld] = useState(open);
  if (open && open !== held) setHeld(open);
  const [tab, setTab] = useState<Tab>('estoque');
  const openId = open?.id;
  useEffect(() => {
    if (!openId) return;
    const o = all.find((x) => x.id === openId);
    // a preparo with no ficha yet opens on it
    setTab(o?.kind === 'preparo' && !o.lines.length ? 'ficha' : 'estoque');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  const i = held;
  if (!i) return null;
  const cost = costLabel(i.costPerKCents, i.unit);

  return (
    <Sheet
      open={!!open}
      onOpenChange={(o) => !o && onClose()}
      title={i.name}
      description={
        <>
          {i.stockMilli != null ? `tem ${qty(i.stockMilli, i.unit)}` : 'não conta estoque'}
          {cost ? ` · ${cost}` : ''}
        </>
      }
    >
      <Segmented
        label="o que ver"
        value={tab}
        onChange={setTab}
        className="mb-5"
        options={[
          { value: 'estoque', label: 'Estoque' },
          ...(i.kind === 'preparo' ? [{ value: 'ficha' as const, label: 'Ficha' }] : []),
          { value: 'cadastro', label: 'Cadastro' },
        ]}
      />
      {tab === 'estoque' ? (
        <StockTab key={i.id} i={i} onDone={onClose} onBuy={() => onBuy(i)} />
      ) : tab === 'ficha' ? (
        <PreparoFicha key={i.id} i={i} all={all} />
      ) : (
        <Cadastro key={i.id} i={i} onDeleted={onClose} />
      )}
    </Sheet>
  );
}

function StockTab({ i, onDone, onBuy }: { i: Insumo; onDone: () => void; onBuy: () => void }) {
  const saved = useSaved();
  const counted = i.stockMilli != null;
  const preparo = i.kind === 'preparo';
  const [act, setAct] = useState<Act>(
    counted ? (preparo ? 'fiz' : 'comprei') : preparo ? 'contei' : 'comprei',
  );
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<InputUnit>(inputUnitOf(i.stockMilli, i.unit));
  const [paid, setPaid] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const q = parseQty(amount, unit);
  const paidCents = paid.trim() ? parseMoney(paid) : null;

  const run = useMutation({
    mutationFn: async (): Promise<Insumo | null> => {
      if (q == null && !(act === 'contei' && amount.trim() === '0')) throw new Error('qty');
      const n = q ?? 0;
      if (act === 'comprei') {
        if (paidCents == null) throw new Error('paid');
        return (await api.purchaseInsumos([{ id: i.id, qtyMilli: n, costCents: paidCents }]))
          .insumos[0]!;
      }
      if (act === 'fiz') return (await api.madeInsumo(i.id, n)).insumo;
      if (act === 'contei') return (await api.updateInsumo(i.id, { stockMilli: n })).insumo;
      await api.adjustInsumos([{ id: i.id, addMilli: -n, reason: 'loss' }]);
      return null;
    },
    onSuccess: (r) => {
      haptic.commit();
      if (r) saved(r);
      else saved({ ...i, stockMilli: (i.stockMilli ?? 0) - (q ?? 0) });
      toast(
        act === 'comprei'
          ? `${i.name}: compra registrada`
          : act === 'fiz'
            ? `${i.name}: ${qty(q!, i.unit)} feitos`
            : act === 'perdi'
              ? `${i.name}: perda registrada`
              : `${i.name}: ${qty(q ?? 0, i.unit)} agora`,
      );
      onDone();
    },
    onError: (e) =>
      setErr(
        e instanceof Error && e.message === 'qty'
          ? 'Digite uma quantidade, como 2 ou 0,5.'
          : e instanceof Error && e.message === 'paid'
            ? 'Diga quanto pagou, como 32,90.'
            : messageOf(e),
      ),
  });

  const now = i.stockMilli ?? 0;
  const after = q == null ? null : act === 'contei' ? q : act === 'perdi' ? now - q : now + q;
  const options: { value: Act; label: string }[] = preparo
    ? [
        ...(counted ? [{ value: 'fiz' as const, label: 'Fiz' }] : []),
        { value: 'contei', label: counted ? 'Contei' : 'Começar a contar' },
        ...(counted ? [{ value: 'perdi' as const, label: 'Perdi' }] : []),
      ]
    : [
        { value: 'comprei', label: 'Comprei' },
        { value: 'contei', label: counted ? 'Contei' : 'Começar a contar' },
        ...(counted ? [{ value: 'perdi' as const, label: 'Perdi' }] : []),
      ];
  const label =
    act === 'comprei'
      ? 'Quanto chegou?'
      : act === 'fiz'
        ? 'Quanto fez?'
        : act === 'perdi'
          ? 'Quanto perdeu?'
          : 'Quanto tem agora?';
  const helper =
    act === 'comprei'
      ? counted
        ? after != null
          ? `Fica com ${qty(after, i.unit)}. O custo médio se ajusta com o preço desta compra.`
          : 'Somamos ao que tem, e o custo médio se ajusta com o preço desta compra.'
        : 'Não conta estoque: a compra só atualiza o custo.'
      : act === 'fiz'
        ? `Sai da conta o que a ficha usa para essa quantidade.${after != null ? ` Fica com ${qty(after, i.unit)}.` : ''}`
        : act === 'perdi'
          ? `Estragou, venceu, caiu: sai sem contar como venda.${after != null ? ` Fica com ${qty(after, i.unit)}.` : ''}`
          : counted && after != null
            ? `Era ${qty(now, i.unit)}, fica ${qty(after, i.unit)}.`
            : 'O número que vale a partir de agora. Cada venda desconta sozinha.';

  return (
    <>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        {options.length > 1 ? (
          <Segmented
            label="o que aconteceu"
            value={act}
            onChange={(a) => {
              setAct(a);
              setErr(null);
            }}
            options={options}
          />
        ) : null}
        {preparo && !counted ? (
          <p className="t-body text-muted">
            Sem contar, cada venda desconta direto os insumos da ficha. Contando, você registra
            quando faz uma leva, e as vendas descontam o preparo.
          </p>
        ) : null}
        <Field label={label} htmlFor="insumo-qty" error={err} helper={helper}>
          <QtyInput
            id="insumo-qty"
            label={label}
            value={amount}
            unit={unit}
            base={i.unit}
            invalid={!!err}
            autoFocus
            onChange={(v) => {
              setAmount(v);
              setErr(null);
            }}
            onUnit={setUnit}
          />
        </Field>
        {act === 'comprei' ? (
          <Field
            label="Quanto pagou por tudo?"
            htmlFor="insumo-paid"
            helper={
              q != null && paidCents != null
                ? `Sai a ${costLabel(Math.round((paidCents * 1e6) / q), i.unit)}.`
                : 'Com frete e o que mais veio na nota.'
            }
          >
            <div className="w-44">
              <TextInput
                id="insumo-paid"
                lead="R$"
                inputMode="decimal"
                enterKeyHint="done"
                placeholder="0,00"
                value={paid}
                onChange={(e) => {
                  setPaid(e.target.value.slice(0, 14));
                  setErr(null);
                }}
                onBlur={() => paidCents != null && setPaid(moneyInput(paidCents))}
                className="tnum"
              />
            </div>
          </Field>
        ) : null}
        <Button type="submit" block size="lg" loading={run.isPending}>
          {act === 'comprei'
            ? 'registrar compra'
            : act === 'fiz'
              ? 'registrar o que fez'
              : act === 'perdi'
                ? 'registrar perda'
                : counted
                  ? 'salvar contagem'
                  : 'começar a contar'}
        </Button>
        {act === 'comprei' && !preparo ? (
          <Button variant="ghost" className="-ml-3 text-primary" onClick={onBuy}>
            chegou mais coisa? registrar a compra inteira
          </Button>
        ) : null}
      </form>
      {counted || i.kind === 'insumo' ? <History id={i.id} unit={i.unit} /> : null}
    </>
  );
}

function PreparoFicha({ i, all }: { i: Insumo; all: Insumo[] }) {
  const saved = useSaved();
  const [drafts, setDrafts] = useState<Draft[]>(() => i.lines.map((l) => draftOf(l, all)));
  const [yieldU, setYieldU] = useState<InputUnit>(inputUnitOf(i.yieldMilli, i.unit));
  const [yieldS, setYieldS] = useState(qtyInput(i.yieldMilli, yieldU));
  const [bad, setBad] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const y = parseQty(yieldS, yieldU);
  const batch = draftsCost(drafts, all);
  const perK = y ? Math.round((draftsExact(drafts, all) * 1e6) / y) : null;
  const save = useMutation({
    mutationFn: () => {
      const l = linesOf(drafts);
      if ('bad' in l) {
        setBad(l.bad);
        throw new Error('bad');
      }
      if (y == null) throw new Error('yield');
      return api.setPreparoFicha(i.id, { lines: l.lines, yieldMilli: y });
    },
    onSuccess: (r) => {
      haptic.commit();
      saved(r.insumo);
      toast(`Ficha de ${i.name} salva`);
    },
    onError: (e) =>
      setErr(
        e instanceof Error && e.message === 'bad'
          ? null
          : e instanceof Error && e.message === 'yield'
            ? 'Diga quanto uma leva rende.'
            : messageOf(e),
      ),
  });
  return (
    <div className="space-y-5">
      <Field
        label="Uma leva rende"
        htmlFor="preparo-yield"
        helper="O custo do preparo é o da ficha dividido pelo que ela rende."
      >
        <QtyInput
          id="preparo-yield"
          label="quanto rende"
          value={yieldS}
          unit={yieldU}
          base={i.unit}
          onChange={setYieldS}
          onUnit={setYieldU}
        />
      </Field>
      <div>
        <p className="t-label mb-2">O que vai numa leva</p>
        <FichaEditor
          drafts={drafts}
          onChange={(d) => {
            setDrafts(d);
            setBad(null);
          }}
          insumos={all}
          modes={false}
          bad={bad}
          exclude={i.id}
          empty="Nenhum insumo ainda. Adicione o que vai no preparo."
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-sunken px-4 py-3">
        <span className="t-caption text-muted">Uma leva custa</span>
        <span className="tnum font-bold">
          {money(batch)}
          {perK != null ? (
            <span className="t-caption ml-2 font-semibold text-muted">
              {costLabel(perK, i.unit)}
            </span>
          ) : null}
        </span>
      </div>
      {err ? <p className="t-caption text-danger">{err}</p> : null}
      <Button block size="lg" loading={save.isPending} onClick={() => save.mutate()}>
        salvar ficha
      </Button>
    </div>
  );
}

function Cadastro({ i, onDeleted }: { i: Insumo; onDeleted: () => void }) {
  const qc = useQueryClient();
  const saved = useSaved();
  const [name, setName] = useState(i.name);
  const [unit, setUnit] = useState<InsumoUnit>(i.unit);
  const [costS, setCostS] = useState('');
  const [costQ, setCostQ] = useState('1');
  const [costU, setCostU] = useState<InputUnit>(defaultCostUnit(i.unit));
  const [lowU, setLowU] = useState<InputUnit>(inputUnitOf(i.lowMilli, i.unit));
  const [lowS, setLowS] = useState(qtyInput(i.lowMilli, lowU));
  const [parU, setParU] = useState<InputUnit>(inputUnitOf(i.parMilli, i.unit));
  const [parS, setParS] = useState(qtyInput(i.parMilli, parU));
  const [packName, setPackName] = useState(i.packName ?? '');
  const [packU, setPackU] = useState<InputUnit>(inputUnitOf(i.packMilli, i.unit));
  const [packS, setPackS] = useState(qtyInput(i.packMilli, packU));
  const [err, setErr] = useState<string | null>(null);
  const uses = useQuery({ queryKey: qk.insumoUses(i.id), queryFn: () => api.insumoUses(i.id) });
  // the unit is fixed once fichas use it or it's counted: their quantities are in it
  const unitLocked = i.uses > 0 || i.stockMilli != null;

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (name.trim() !== i.name) body.name = name.trim();
      if (unit !== i.unit) body.unit = unit;
      if (i.kind === 'insumo' && costS.trim()) {
        const cents = parseMoney(costS);
        const milli = parseQty(costQ, costU);
        if (cents == null || milli == null)
          throw new Error('Diga quanto custa e por quanto, como 32,90 por 1 kg.');
        body.cost = { cents, milli };
      }
      const opt = (s: string, u: InputUnit, label: string) => {
        if (!s.trim()) return null;
        const v = parseQty(s, u);
        if (v == null) throw new Error(`${label}: digite uma quantidade, como 2 ou 0,5.`);
        return v;
      };
      const low = opt(lowS, lowU, 'Aviso');
      const par = opt(parS, parU, 'Estoque ideal');
      const pack = opt(packS, packU, 'Embalagem');
      if (low !== i.lowMilli) body.lowMilli = low;
      if (par !== i.parMilli) body.parMilli = par;
      if (pack !== i.packMilli) body.packMilli = pack;
      if ((packName.trim() || null) !== i.packName) body.packName = packName.trim() || null;
      if (!Object.keys(body).length) throw new Error('Nada mudou.');
      return api.updateInsumo(i.id, body);
    },
    onSuccess: (r) => {
      haptic.commit();
      saved(r.insumo);
      setCostS('');
      toast(`${r.insumo.name} salvo`);
    },
    onError: (e) => setErr(messageOf(e)),
  });
  const stop = useMutation({
    mutationFn: () => api.updateInsumo(i.id, { stockMilli: null }),
    onSuccess: (r) => {
      saved(r.insumo);
      toast(`${i.name} não conta mais estoque`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const del = useMutation({
    mutationFn: () => api.deleteInsumo(i.id),
    onSuccess: () => {
      qc.setQueryData<InsumosList>(qk.insumos, (d) =>
        d ? { ...d, insumos: d.insumos.filter((x) => x.id !== i.id) } : d,
      );
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast(`${i.name} apagado`);
      onDeleted();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const u = uses.data;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        save.mutate();
      }}
    >
      <Field label="Nome" htmlFor="insumo-name">
        <TextInput
          id="insumo-name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label="Como se mede"
        helper={
          unitLocked
            ? 'Fica assim enquanto alguma ficha usa ou o estoque está contando.'
            : undefined
        }
      >
        {unitLocked ? (
          <p className="t-body font-semibold">{UNIT_LABEL[i.unit]}</p>
        ) : (
          <Segmented
            label="como se mede"
            value={unit}
            onChange={(v) => {
              setUnit(v);
              setCostU(defaultCostUnit(v));
              setLowU(inputUnitOf(null, v));
              setParU(inputUnitOf(null, v));
              setPackU(inputUnitOf(null, v));
            }}
            options={(['g', 'ml', 'un'] as const).map((v) => ({ value: v, label: UNIT_LABEL[v] }))}
          />
        )}
      </Field>
      {i.kind === 'insumo' ? (
        <Field
          label="Quanto custa"
          helper={
            i.costPerKCents != null
              ? `Hoje: ${costLabel(i.costPerKCents, i.unit)}, a média das compras. Digite só para corrigir.`
              : 'Ou registre uma compra no Estoque: o custo vem dela.'
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <TextInput
                aria-label="custo"
                lead="R$"
                inputMode="decimal"
                placeholder="0,00"
                value={costS}
                onChange={(e) => setCostS(e.target.value.slice(0, 14))}
                className="tnum"
              />
            </div>
            <span className="t-body text-muted">por</span>
            <QtyInput
              label="a quantidade que custa isso"
              value={costQ}
              unit={costU}
              base={unit}
              onChange={setCostQ}
              onUnit={setCostU}
            />
          </div>
        </Field>
      ) : null}
      <Field
        label="Me avise quando tiver só"
        optional
        helper="Aparece em “Para repor” e no Início."
      >
        <QtyInput
          label="aviso de estoque baixo"
          value={lowS}
          unit={lowU}
          base={unit}
          onChange={setLowS}
          onUnit={setLowU}
        />
      </Field>
      <Field label="Estoque ideal" optional helper="A lista de compras sugere comprar até ele.">
        <QtyInput
          label="estoque ideal"
          value={parS}
          unit={parU}
          base={unit}
          onChange={setParS}
          onUnit={setParU}
        />
      </Field>
      {i.kind === 'insumo' ? (
        <Field
          label="Compra em embalagem"
          optional
          helper="Caixa de 24, saco de 5 kg: a lista de compras arredonda para embalagens inteiras."
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36">
              <TextInput
                aria-label="nome da embalagem"
                placeholder="caixa"
                maxLength={24}
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
              />
            </div>
            <span className="t-body text-muted">de</span>
            <QtyInput
              label="quanto vem na embalagem"
              value={packS}
              unit={packU}
              base={unit}
              onChange={setPackS}
              onUnit={setPackU}
            />
          </div>
        </Field>
      ) : null}
      {err ? (
        <p className="t-caption text-danger" role="alert">
          {err}
        </p>
      ) : null}
      <Button type="submit" block size="lg" loading={save.isPending}>
        salvar
      </Button>

      <section className="space-y-2 border-t border-line pt-4" aria-label="onde é usado">
        <p className="t-label">Onde é usado</p>
        {!u ? (
          <RowsSkeleton rows={2} avatar={false} />
        ) : !u.products.length && !u.preparos.length && !u.perOrder ? (
          <p className="t-body text-muted">
            Em nenhuma ficha ainda. Abra um produto e monte a ficha técnica dele.
          </p>
        ) : (
          <ul className="t-body space-y-1">
            {u.products.map((p) => (
              <li key={`${p.id}-${p.option ?? ''}`}>
                <Link to={`/cardapio/produto/${p.id}`} className="font-semibold text-primary">
                  {p.name}
                </Link>
                {p.option ? <span className="text-muted"> · opção {p.option}</span> : null}
              </li>
            ))}
            {u.preparos.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.name}</span>
                <span className="text-muted"> · preparo</span>
              </li>
            ))}
            {u.perOrder ? <li className="text-muted">Embalagem de cada pedido</li> : null}
          </ul>
        )}
      </section>

      <div className="flex flex-col items-start gap-3 border-t border-line pt-4">
        {i.stockMilli != null ? (
          <Button
            variant="ghost"
            className="-ml-3 text-muted"
            loading={stop.isPending}
            onClick={() => stop.mutate()}
          >
            parar de contar o estoque
          </Button>
        ) : null}
        <HoldButton onConfirm={() => del.mutate()} disabled={del.isPending}>
          segure para apagar {i.kind === 'preparo' ? 'o preparo' : 'o insumo'}
        </HoldButton>
        <p className="t-caption text-muted">
          {i.uses
            ? `Sai também das ${i.uses} ${i.uses === 1 ? 'ficha que o usa' : 'fichas que o usam'}. Os pedidos antigos guardam o custo da época.`
            : 'Os pedidos antigos guardam o custo da época.'}
        </p>
      </div>
    </form>
  );
}

const REASON: Record<InsumoMovement['reason'], string> = {
  sale: 'Venda',
  cancel: 'Cancelado',
  purchase: 'Compra',
  count: 'Contagem',
  adjust: 'Ajuste',
  loss: 'Perda',
  made: 'Fez uma leva',
  used: 'Usado num preparo',
  start: 'Começou a contar',
  stop: 'Parou de contar',
};

/** every move of one insumo, newest first, 30 at a time — fetched once opened */
function History({ id, unit }: { id: string; unit: InsumoUnit }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const list = useInfiniteQuery({
    queryKey: qk.insumoMoves(id),
    queryFn: ({ pageParam }) => api.insumoMovements(id, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (p) => p.next ?? undefined,
    enabled: open,
  });
  const rows = list.data?.pages.flatMap((p) => p.movements) ?? [];
  return (
    <section className="mt-6 border-t border-line pt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((o) => !o)}
        className="press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 text-left hover:bg-hover"
      >
        <ClockCounterClockwise className="size-5 shrink-0 text-muted" aria-hidden />
        <span className="t-label flex-1">Histórico</span>
        <CaretDown
          className={cn('size-5 shrink-0 text-muted transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      <div id={panel} hidden={!open}>
        {!open ? null : list.isPending ? (
          <RowsSkeleton rows={3} avatar={false} />
        ) : list.error && !rows.length ? (
          <p className="t-body py-2 text-muted">
            Não deu para abrir o histórico.{' '}
            <button
              type="button"
              className="font-semibold text-primary"
              onClick={() => void list.refetch()}
            >
              tentar de novo
            </button>
          </p>
        ) : !rows.length ? (
          <p className="t-body py-2 text-muted">Nada registrado ainda.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((m) => (
              <li key={m.id} className="flex min-h-14 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">
                    {(m.reason === 'sale' || m.reason === 'cancel') && m.order ? (
                      <Link
                        to={`/pedidos/${m.order.id}`}
                        className="underline decoration-line-strong underline-offset-4"
                      >
                        {REASON[m.reason]} #{m.order.number}
                      </Link>
                    ) : (
                      REASON[m.reason]
                    )}
                  </p>
                  <p className="t-caption truncate text-muted">
                    <time dateTime={m.at} title={when(m.at)}>
                      {ago(m.at)}
                    </time>
                    {m.by ? ` · ${m.by}` : ''}
                    {m.note ? ` · ${m.note}` : ''}
                    {m.reason === 'purchase' && m.costCents != null
                      ? ` · pagou ${money(m.costCents)}`
                      : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {m.deltaMilli ? (
                    <p
                      className={cn(
                        'tnum font-bold',
                        m.deltaMilli > 0 ? 'text-success' : 'text-ink',
                      )}
                    >
                      {m.deltaMilli > 0 ? '+' : ''}
                      {qty(m.deltaMilli, unit)}
                    </p>
                  ) : null}
                  {m.afterMilli !== null ? (
                    <p className="tnum t-caption text-muted">fica {qty(m.afterMilli, unit)}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {open && list.hasNextPage ? (
          <Button
            variant="ghost"
            block
            className="mt-1"
            loading={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            ver mais
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function NewInsumoSheet({
  kind: open,
  all,
  onClose,
  onCreated,
}: {
  kind: 'insumo' | 'preparo' | null;
  all: Insumo[];
  onClose: () => void;
  onCreated: (i: Insumo) => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'insumo' | 'preparo'>('insumo');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<InsumoUnit>('g');
  const [costS, setCostS] = useState('');
  const [costQ, setCostQ] = useState('1');
  const [costU, setCostU] = useState<InputUnit>('kg');
  const [yieldS, setYieldS] = useState('');
  const [yieldU, setYieldU] = useState<InputUnit>('kg');
  const [stockS, setStockS] = useState('');
  const [stockU, setStockU] = useState<InputUnit>('kg');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setKind(open);
    setName('');
    setUnit('g');
    setCostS('');
    setCostQ('1');
    setCostU('kg');
    setYieldS('');
    setYieldU('kg');
    setStockS('');
    setStockU('kg');
    setErr(null);
  }, [open]);
  const pickUnit = (v: InsumoUnit) => {
    setUnit(v);
    const big = defaultCostUnit(v);
    setCostU(big);
    setYieldU(big);
    setStockU(big);
  };
  const twin = all.some(
    (i) => i.name.toLocaleLowerCase('pt-BR') === name.trim().toLocaleLowerCase('pt-BR'),
  );

  const create = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Dê um nome, como “Queijo muçarela”.');
      const body: Record<string, unknown> = { kind, name: name.trim(), unit };
      if (kind === 'insumo' && costS.trim()) {
        const cents = parseMoney(costS);
        const milli = parseQty(costQ, costU);
        if (cents == null || milli == null)
          throw new Error('Diga quanto custa e por quanto, como 32,90 por 1 kg.');
        body.cost = { cents, milli };
      }
      if (kind === 'preparo') {
        const y = parseQty(yieldS, yieldU);
        if (y == null) throw new Error('Diga quanto uma leva rende, como 2 kg.');
        body.yieldMilli = y;
      }
      if (stockS.trim()) {
        const s = stockS.trim() === '0' ? 0 : parseQty(stockS, stockU);
        if (s == null) throw new Error('Quanto tem agora: digite uma quantidade, como 2 ou 0,5.');
        body.stockMilli = s;
      }
      return api.createInsumo(body);
    },
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData<InsumosList>(qk.insumos, (d) =>
        d ? { ...d, insumos: [...d.insumos, r.insumo] } : d,
      );
      void qc.invalidateQueries({ queryKey: qk.insumos });
      toast(`${r.insumo.name} criado`);
      onCreated(r.insumo);
    },
    onError: (e) => setErr(messageOf(e)),
  });

  return (
    <Sheet
      open={!!open}
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'preparo' ? 'Novo preparo' : 'Novo insumo'}
      description={
        kind === 'preparo'
          ? 'Feito aí, de outros insumos: um molho, uma massa, um recheio. A ficha dele vem em seguida.'
          : 'O que você compra para fazer os produtos: pão, queijo, caixa, sacola.'
      }
      footer={
        <Button block size="lg" loading={create.isPending} onClick={() => create.mutate()}>
          {kind === 'preparo' ? 'criar e montar a ficha' : 'criar insumo'}
        </Button>
      }
    >
      <form
        className="space-y-5 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Segmented
          label="tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'insumo', label: 'Comprado' },
            { value: 'preparo', label: 'Preparo da casa' },
          ]}
        />
        <Field
          label="Nome"
          htmlFor="new-insumo-name"
          error={twin ? 'Já tem um insumo com esse nome.' : null}
        >
          <TextInput
            id="new-insumo-name"
            autoFocus
            maxLength={80}
            placeholder={kind === 'preparo' ? 'ex.: Molho da casa' : 'ex.: Queijo muçarela'}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr(null);
            }}
          />
        </Field>
        <Field label="Como se mede">
          <Segmented
            label="como se mede"
            value={unit}
            onChange={pickUnit}
            options={(['g', 'ml', 'un'] as const).map((v) => ({
              value: v,
              label: `${UNIT_LABEL[v]} (${v === 'g' ? 'kg, g' : v === 'ml' ? 'L, ml' : 'un'})`,
            }))}
          />
        </Field>
        {kind === 'insumo' ? (
          <Field label="Quanto custa" optional helper="Pode deixar para a primeira compra.">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-36">
                <TextInput
                  aria-label="custo"
                  lead="R$"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={costS}
                  onChange={(e) => setCostS(e.target.value.slice(0, 14))}
                  className="tnum"
                />
              </div>
              <span className="t-body text-muted">por</span>
              <QtyInput
                label="a quantidade que custa isso"
                value={costQ}
                unit={costU}
                base={unit}
                onChange={setCostQ}
                onUnit={setCostU}
              />
            </div>
          </Field>
        ) : (
          <Field label="Uma leva rende" htmlFor="new-preparo-yield">
            <QtyInput
              id="new-preparo-yield"
              label="quanto rende"
              value={yieldS}
              unit={yieldU}
              base={unit}
              onChange={setYieldS}
              onUnit={setYieldU}
            />
          </Field>
        )}
        <Field
          label="Quanto tem agora"
          optional
          helper={
            kind === 'preparo'
              ? 'Vazio: não conta estoque, e cada venda desconta direto os insumos da ficha.'
              : 'Vazio: não conta estoque, só entra no custo das fichas.'
          }
        >
          <QtyInput
            label="quanto tem agora"
            value={stockS}
            unit={stockU}
            base={unit}
            onChange={setStockS}
            onUnit={setStockU}
          />
        </Field>
        {err ? (
          <p className="t-caption text-danger" role="alert">
            {err}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

import { ArrowsSplit, Copy, LockSimple, Moped, Trash, WifiSlash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type PdvMethod, type PdvPaymentIn } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { copyText } from '../../ui/CopyValue.tsx';
import { Field, MoneyField, Segmented, Toggle } from '../../ui/fields.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { PDV_METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { Keypad, QuickAmount } from '../../ui/pdv/Keypad.tsx';
import { MethodPicker } from '../../ui/pdv/MethodPicker.tsx';
import { PDV_METHOD_ICON } from '../../ui/pdv/methods.ts';
import { PixQr } from '../../ui/PixCode.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

// Taking the money: pick the method (or split across several), count the notes for cash, show
// the store's Pix for the amount. Core checks that it adds up and works out the change; the
// screen only says what's still missing from the total Core gave it.

interface Entry {
  id: number;
  method: PdvMethod;
  amountCents: number;
  /** cash: the notes handed over (0 = exact) */
  tenderedCents: number;
}

const BILLS = [500, 1000, 2000, 5000, 10000, 20000];

export function PaySheet({
  open,
  onOpenChange,
  title,
  totalCents,
  single,
  serveNow,
  caixaOpen,
  busy,
  paused,
  onSubmit,
  before,
  submitLabel = 'confirmar',
  later,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Core's total (a comanda: what remains) */
  totalCents: number;
  /** one payment at a time (a comanda): the amount is editable up to the total */
  single?: { initialCents: number; shares?: number[] | undefined };
  serveNow?: { value: boolean; onChange: (v: boolean) => void };
  caixaOpen: boolean;
  busy: boolean;
  /** the write is waiting for the connection */
  paused?: boolean;
  onSubmit: (payments: PdvPaymentIn[]) => void;
  before?: ReactNode;
  submitLabel?: string;
  /** a delivery may go out unpaid: "cobrar na entrega", with the method and the change */
  later?: { onSubmit: (p: { method: PdvMethod; changeForCents?: number }) => void };
}) {
  const seq = useRef(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [split, setSplit] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [amount, setAmount] = useState(single?.initialCents ?? totalCents);
  const amountId = useId();
  const manager = useCan('manager');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [laterMethod, setLaterMethod] = useState<PdvMethod | null>(null);
  const [changeFor, setChangeFor] = useState(0);
  const atDoor = !!later && when === 'later';

  useEffect(() => {
    if (!open) return;
    setWhen('now');
    setLaterMethod(null);
    setChangeFor(0);
    setEntries([]);
    setSplit(false);
    setActive(null);
    setAmount(single?.initialCents ?? totalCents);
    // a fresh start every time the sheet opens; the totals it was opened with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the total moved (Core re-priced the ticket): one method follows it
  useEffect(() => {
    if (single) return;
    setEntries((es) => (es.length === 1 ? [{ ...es[0]!, amountCents: totalCents }] : es));
  }, [totalCents, single]);

  const target = single ? amount : totalCents;
  const paid = entries.reduce((n, e) => n + e.amountCents, 0);
  // display only: the gap between Core's total and what was typed in
  const rest = target - paid;

  const pick = (m: PdvMethod) => {
    const id = ++seq.current;
    if (!split || entries.length === 0) {
      setEntries([{ id, method: m, amountCents: target, tenderedCents: 0 }]);
      setActive(id);
      return;
    }
    setEntries((es) => [
      ...es,
      { id, method: m, amountCents: Math.max(0, rest), tenderedCents: 0 },
    ]);
    setActive(id);
  };
  const patch = (id: number, p: Partial<Entry>) =>
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));

  useEffect(() => {
    if (single && entries.length === 1) patch(entries[0]!.id, { amountCents: amount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  const valid =
    entries.length > 0 &&
    target > 0 &&
    entries.every(
      (e) =>
        e.amountCents > 0 &&
        (e.method !== 'cash' || !e.tenderedCents || e.tenderedCents >= e.amountCents),
    ) &&
    (single ? amount <= totalCents && paid === amount : rest === 0);

  const laterValid =
    !!laterMethod && (laterMethod !== 'cash' || changeFor === 0 || changeFor >= totalCents);

  const submit = () => {
    if (busy) return;
    if (atDoor) {
      if (!laterValid) return;
      later.onSubmit({
        method: laterMethod!,
        ...(laterMethod === 'cash' && changeFor ? { changeForCents: changeFor } : {}),
      });
      return;
    }
    if (!valid || !caixaOpen) return;
    onSubmit(
      entries.map((e) => ({
        method: e.method,
        amountCents: e.amountCents,
        ...(e.method === 'cash' && e.tenderedCents ? { tenderedCents: e.tenderedCents } : {}),
      })),
    );
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, button, a')) return;
      e.preventDefault();
      submitRef.current();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open]);

  const cashEntries = entries.filter((e) => e.method === 'cash');

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <div className="space-y-2">
          {atDoor ? null : !caixaOpen ? null : !single && entries.length > 0 && rest !== 0 ? (
            <p
              className={cn('t-label tnum text-center', rest > 0 ? 'text-warning' : 'text-danger')}
              role="status"
            >
              {rest > 0 ? `Falta ${money(rest)}` : `Passou ${money(-rest)} do total`}
            </p>
          ) : null}
          <Button
            size="lg"
            block
            loading={busy && !paused}
            disabled={(atDoor ? !laterValid : !valid || !caixaOpen) || busy}
            onClick={submit}
            icon={paused ? <WifiSlash /> : atDoor && laterMethod ? <Moped /> : undefined}
          >
            {paused
              ? 'esperando a conexão…'
              : atDoor
                ? laterMethod
                  ? 'enviar o pedido'
                  : 'escolha como vai pagar'
                : entries.length
                  ? `${submitLabel} ${money(single ? amount : totalCents)}`
                  : 'escolha como vai pagar'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <div className="rounded-lg bg-sunken px-4 py-3">
          <p className="t-caption text-muted">{single ? 'Falta receber' : 'Total'}</p>
          <p className="tnum t-display">{money(totalCents)}</p>
        </div>

        {later ? (
          <Segmented
            label="quando o cliente paga"
            value={when}
            onChange={setWhen}
            options={[
              { value: 'now', label: 'Pagar agora' },
              { value: 'later', label: 'Cobrar na entrega' },
            ]}
          />
        ) : null}

        {atDoor ? (
          <PayAtDoor
            totalCents={totalCents}
            method={laterMethod}
            onMethod={(m) => {
              setLaterMethod(m);
              if (m !== 'cash') setChangeFor(0);
            }}
            changeFor={changeFor}
            onChangeFor={setChangeFor}
          />
        ) : null}

        {atDoor ? null : !caixaOpen ? (
          <Notice
            tone="warning"
            icon={<LockSimple weight="fill" />}
            title="O caixa está fechado"
            action={
              <ButtonLink to="/pdv/caixa" variant="primary" state={{ from: 'pay' }}>
                abrir o caixa
              </ButtonLink>
            }
          >
            Para receber, abra o caixa com o troco da gaveta. A conta fica esperando aqui.
          </Notice>
        ) : null}

        {atDoor ? null : before}

        {!atDoor && single ? (
          <Field label="Quanto recebe agora" htmlFor={amountId}>
            <MoneyField
              id={amountId}
              cents={amount}
              min={1}
              validate={(v) =>
                v > totalCents ? `Falta só ${money(totalCents)} nessa comanda.` : null
              }
              onCommit={(v) => setAmount(v ?? 0)}
            />
            {single.shares?.length || amount !== totalCents ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <QuickAmount on={amount === totalCents} onClick={() => setAmount(totalCents)}>
                  tudo · {money(totalCents)}
                </QuickAmount>
                {[...new Set(single.shares ?? [])].map((s) => (
                  <QuickAmount key={s} on={amount === s} onClick={() => setAmount(s)}>
                    uma parte · {money(s)}
                  </QuickAmount>
                ))}
              </div>
            ) : null}
          </Field>
        ) : null}

        <div hidden={atDoor}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="t-label">Como vai pagar?</p>
            {!single ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<ArrowsSplit />}
                aria-pressed={split}
                onClick={() => setSplit((v) => !v)}
                className="-mr-2"
              >
                {split ? 'uma forma só' : 'dividir em formas'}
              </Button>
            ) : null}
          </div>
          <MethodPicker
            value={entries.map((e) => e.method)}
            onPick={(m) =>
              split || !entries.length || entries[0]!.method !== m
                ? pick(m)
                : setActive(entries[0]!.id)
            }
          />
          {split ? (
            <p className="t-caption mt-2 text-muted">
              Toque nas formas na ordem em que o cliente paga e ajuste cada valor.
            </p>
          ) : null}
        </div>

        {!atDoor && split && entries.length ? (
          <ul className="space-y-2" aria-label="pagamentos">
            {entries.map((e) => {
              const Icon = PDV_METHOD_ICON[e.method];
              return (
                <li key={e.id} className="flex items-center gap-2 rounded-md bg-sunken p-2 pl-3">
                  <Icon weight="duotone" className="size-6 shrink-0" aria-hidden />
                  <span className="t-label w-24 shrink-0 truncate">
                    {PDV_METHOD_LABEL[e.method]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <MoneyField
                      cents={e.amountCents}
                      min={1}
                      onCommit={(v) => patch(e.id, { amountCents: v ?? 0 })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`tirar ${PDV_METHOD_LABEL[e.method]}`}
                    onClick={() => setEntries((es) => es.filter((x) => x.id !== e.id))}
                    className="press grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-press"
                  >
                    <Trash className="size-5" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {cashEntries.map((e) =>
          !atDoor && (active === e.id || cashEntries.length === 1) ? (
            <CashBox
              key={e.id}
              entry={e}
              keys={cashEntries.length === 1}
              onTendered={(c) => patch(e.id, { tenderedCents: c })}
            />
          ) : null,
        )}
        {entries
          .filter((e) => !atDoor && e.method === 'pix' && e.amountCents > 0)
          .map((e) => (
            <PixBox key={e.id} cents={e.amountCents} manager={manager} />
          ))}

        {serveNow ? (
          <Toggle
            checked={serveNow.value}
            onChange={serveNow.onChange}
            label="Entregar agora"
            description="Para o que sai na hora, sem passar pela cozinha."
          />
        ) : null}
      </div>
    </Sheet>
  );
}

/** "Cobrar na entrega": how the customer will pay at the door, and the change to bring. */
function PayAtDoor({
  totalCents,
  method,
  onMethod,
  changeFor,
  onChangeFor,
}: {
  totalCents: number;
  method: PdvMethod | null;
  onMethod: (m: PdvMethod) => void;
  changeFor: number;
  onChangeFor: (c: number) => void;
}) {
  const short = changeFor > 0 && changeFor < totalCents;
  const bills = BILLS.filter((b) => b > totalCents).slice(0, 3);
  return (
    <>
      <div>
        <p className="t-label mb-2">Como vai pagar na entrega?</p>
        <MethodPicker value={method ? [method] : []} onPick={onMethod} />
        <p className="t-caption mt-2 text-muted">
          O pedido vai para a cozinha sem pagamento. Quando o dinheiro voltar, receba pelo pedido,
          no caixa.
        </p>
      </div>
      {method === 'cash' ? (
        <Keypad
          label="Troco para quanto?"
          cents={changeFor}
          onChange={onChangeFor}
          keys
          hint={
            short ? (
              <span className="font-semibold text-danger">Menos que o total do pedido.</span>
            ) : changeFor === 0 ? (
              <span className="text-muted">Sem valor, o cliente paga o valor exato.</span>
            ) : (
              <span className="text-muted">O entregador leva o troco.</span>
            )
          }
        >
          <QuickAmount on={changeFor === 0} onClick={() => onChangeFor(0)}>
            não precisa
          </QuickAmount>
          {bills.map((b) => (
            <QuickAmount key={b} on={changeFor === b} onClick={() => onChangeFor(b)}>
              {money(b)}
            </QuickAmount>
          ))}
        </Keypad>
      ) : null}
    </>
  );
}

function CashBox({
  entry,
  keys,
  onTendered,
}: {
  entry: Entry;
  keys: boolean;
  onTendered: (cents: number) => void;
}) {
  const t = entry.tenderedCents;
  const short = t > 0 && t < entry.amountCents;
  const bills = BILLS.filter((b) => b > entry.amountCents).slice(0, 3);
  return (
    <Keypad
      label={`Dinheiro recebido (de ${money(entry.amountCents)})`}
      cents={t}
      onChange={onTendered}
      keys={keys}
      hint={
        short ? (
          <span className="font-semibold text-danger">Menos que o valor a pagar.</span>
        ) : t === 0 ? (
          <span className="text-muted">Sem valor, conta como o valor exato.</span>
        ) : (
          <span className="text-muted">O troco sai no recibo, calculado pela loja.</span>
        )
      }
    >
      <QuickAmount on={t === 0} onClick={() => onTendered(0)}>
        exato
      </QuickAmount>
      {bills.map((b) => (
        <QuickAmount key={b} on={t === b} onClick={() => onTendered(b)}>
          {money(b)}
        </QuickAmount>
      ))}
    </Keypad>
  );
}

function PixBox({ cents, manager }: { cents: number; manager: boolean }) {
  const q = useQuery({
    queryKey: qk.pdvPix(cents),
    queryFn: () => api.pdv.pix(cents),
    staleTime: Infinity,
  });
  const code = q.data?.copyPaste;
  const box = useRef<HTMLDivElement>(null);
  const label = useMemo(() => `Pix de ${money(cents)}`, [cents]);
  if (q.isPending)
    return (
      <div className="flex items-center gap-4 rounded-lg bg-sunken p-4" aria-hidden>
        <Bone className="size-40 shrink-0 rounded-md" />
        <Bone className="h-5 w-32" />
      </div>
    );
  if (!code)
    return (
      <Notice
        tone="info"
        title="A loja ainda não tem chave Pix"
        action={
          manager ? (
            <ButtonLink to="/pagamentos" variant="secondary">
              cadastrar a chave
            </ButtonLink>
          ) : undefined
        }
      >
        {q.error
          ? 'Não conseguimos montar o QR agora. O cliente pode pagar na chave da loja.'
          : 'Sem a chave, o QR não aparece. Confira o Pix no banco antes de confirmar.'}
      </Notice>
    );
  return (
    <div
      ref={box}
      className="flex flex-col items-center gap-3 rounded-lg bg-sunken p-4 sm:flex-row"
    >
      <PixQr code={code} alt={`QR code do ${label}`} className="size-44 shrink-0" />
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="t-label">{label}</p>
        <p className="t-caption mt-1 text-muted">
          O cliente aponta a câmera do banco. Confira no seu banco antes de confirmar.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          icon={<Copy />}
          onClick={() =>
            void copyText(code, box.current).then((ok) => ok && toast('Pix copia e cola copiado.'))
          }
        >
          copiar o código
        </Button>
      </div>
    </div>
  );
}

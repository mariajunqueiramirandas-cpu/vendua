import { WifiSlash } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { Order, OrderPayment } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { useLiveState } from '../../lib/live.ts';
import { Chips, Field, MoneyField, Segmented, TextArea } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { REFUND_REASONS, useRefund } from './actions.ts';
import { paymentTotals, refundable, refundAmount } from './payment-totals.ts';

/**
 * Online refund: all of what's left, or part of it; a reason; hold to confirm (§2.2.1).
 * Money actions wait for the connection and say so (§2.2.10).
 */
export function RefundSheet({
  order,
  payments,
  open,
  onOpenChange,
}: {
  order: Order;
  payments: OrderPayment[] | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const refund = useRefund();
  const { online } = useLiveState();
  const captured = (payments ?? []).filter((p) => refundable(p) > 0 || p.refundedCents > 0);
  const totals = paymentTotals(captured);
  const left = totals.refundable;
  const methods = new Set(captured.filter((p) => refundable(p) > 0).map((p) => p.kind));
  const [mode, setMode] = useState<'all' | 'part'>('all');
  const [cents, setCents] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  useEffect(() => {
    if (!open) return;
    setMode('all');
    setCents(null);
    setReason('');
    setOther('');
  }, [open, order.id]);

  const amount = mode === 'all' ? left : (cents ?? 0);
  const tooMuch = mode === 'part' && cents !== null && cents > left;
  const text = reason === 'outro' ? other.trim() : reason;
  const ready = !!text && amount > 0 && !tooMuch && online && !refund.isPending;
  const inProgress = !['delivered', 'cancelled', 'refunded'].includes(order.state);
  const go = () =>
    refund.mutate(
      {
        order,
        amountCents: refundAmount(amount, left),
        reason: text,
        shown: amount,
      },
      { onSuccess: () => onOpenChange(false) },
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Devolver dinheiro do pedido #${order.number}`}
      description={
        methods.size > 1
          ? 'O Mercado Pago devolve cada valor pelo meio que o cliente usou.'
          : methods.has('card')
            ? 'O Mercado Pago estorna no cartão que o cliente usou.'
            : 'O Mercado Pago devolve o Pix para a conta de quem pagou.'
      }
      footer={
        <div className="space-y-2">
          {!online ? (
            <p className="t-caption flex items-center gap-1.5 text-warning" role="status">
              <WifiSlash weight="bold" className="size-4" /> Sem conexão. A devolução espera a
              internet voltar.
            </p>
          ) : null}
          <HoldButton disabled={!ready} onConfirm={go}>
            {refund.isPending
              ? 'devolvendo…'
              : amount > 0 && !tooMuch
                ? `segure para devolver ${money(amount)}`
                : 'segure para devolver'}
          </HoldButton>
        </div>
      }
    >
      <div className="space-y-6 pt-2">
        <div className="rounded-md bg-sunken px-4 py-3">
          <p className="t-caption text-muted">Dá para devolver até</p>
          <p className="t-title-2 tnum">{money(left)}</p>
          {totals.refunded > 0 ? (
            <p className="t-caption text-muted">
              de {money(totals.amount)} pagos · {money(totals.refunded)} já devolvido
            </p>
          ) : null}
        </div>

        <Field label="Quanto">
          <Segmented
            label="quanto devolver"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'all', label: `tudo · ${money(left)}` },
              { value: 'part', label: 'uma parte' },
            ]}
          />
        </Field>
        {mode === 'part' ? (
          <Field
            label="Valor a devolver"
            htmlFor="refund-amount"
            helper={tooMuch ? undefined : `Até ${money(left)}.`}
            error={tooMuch ? `O máximo é ${money(left)}.` : null}
          >
            <MoneyField id="refund-amount" cents={cents} min={1} onCommit={setCents} autoFocus />
          </Field>
        ) : null}

        <Field label="Motivo">
          <Chips
            label="motivo da devolução"
            value={reason}
            onChange={setReason}
            options={[...REFUND_REASONS, 'outro'].map((r) => ({
              value: r,
              label: r === 'outro' ? 'outro motivo' : r,
            }))}
          />
        </Field>
        {reason === 'outro' ? (
          <Field label="Qual?" htmlFor="refund-other">
            <TextArea
              id="refund-other"
              maxLength={200}
              value={other}
              onChange={(e) => setOther(e.target.value)}
              className="min-h-20"
              autoFocus
            />
          </Field>
        ) : null}

        {inProgress && mode === 'all' ? (
          <p className="t-caption text-muted">
            O pedido continua aberto. Se não vai mais entregar, use “cancelar pedido”. O sinal,
            quando já recebido, fica com a loja.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

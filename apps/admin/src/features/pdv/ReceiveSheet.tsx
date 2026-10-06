import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Order, type PdvPaymentIn } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { toast } from '../../ui/Toast.tsx';
import { isCode, pdvError, usePdvState } from './data.ts';
import { PaySheet } from './PaySheet.tsx';

/**
 * An order from the storefront, paid at the counter (the kitchen's ready rail says when to
 * charge): its whole total through the caixa, so the money lands in today's count.
 */
export default function ReceiveSheet({ order, onClose }: { order: Order; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const state = usePdvState();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(true), []);
  const close = () => {
    setOpen(false);
    setTimeout(onClose, 300);
  };
  const receive = useMutation({
    mutationFn: (payments: PdvPaymentIn[]) => api.pdv.receive(order.id, payments),
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData<{ order: Order }>(qk.order(order.id), (d) =>
        d ? { ...d, order: r.order } : d,
      );
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['pdv'] });
      toast(
        r.changeCents > 0
          ? `Recebido. Troco: ${money(r.changeCents)}.`
          : `Pedido #${order.number} recebido no caixa.`,
        { ms: r.changeCents > 0 ? 12_000 : 3500 },
      );
      close();
    },
    onError: (e) => {
      haptic.error();
      if (isCode(e, 'CAIXA_CLOSED')) {
        void qc.invalidateQueries({ queryKey: ['pdv'] });
        toast(pdvError(e), {
          tone: 'error',
          ms: 8000,
          action: { label: 'abrir o caixa', run: () => nav('/pdv/caixa') },
        });
        return;
      }
      if (isCode(e, 'ALREADY_PAID') || isCode(e, 'PAYMENT_ONLINE'))
        void qc.invalidateQueries({ queryKey: qk.order(order.id) });
      toast.error(pdvError(e));
    },
  });
  return (
    <PaySheet
      open={open}
      onOpenChange={(o) => !o && close()}
      title={`Receber o pedido #${order.number}`}
      totalCents={order.totalCents}
      caixaOpen={!state.data || !!state.data.caixa}
      busy={receive.isPending}
      paused={receive.isPaused}
      submitLabel="receber"
      onSubmit={(p) => receive.mutate(p)}
    />
  );
}

import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { money, ORDER_STATE_LABEL } from '@vendua/ui-defaults';
import { useCart, useLoyalty, useOrder, useOrderHistory, useOrders, useStore } from '../hooks.ts';
import { Slot } from '../slot.tsx';
import { KLink } from '../sdk/sections.tsx';
import { KERNEL_PATHS } from '../config.ts';
import { errorCode, errorCopy, showError, showInfo } from '../errors.ts';
import { useNavigateTo } from '../primitives.tsx';
import type { ImportReport } from '../api.ts';

// /pedido/:id and /pedidos — Kernel pages. Order history is the first Kernel
// page that exists purely as platform surface (roadmap 1b-iii): every store gets
// it on its next rebuild, no store code involved. Kernel 1.2 adds live status,
// the purchased items, Pix copia e cola, "pedir de novo", orders from other
// devices (phone + order number) and the loyalty card.

const KEY_LABEL: Record<string, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  email: 'e-mail',
  phone: 'celular',
  random: 'chave aleatória',
};

function useReorder() {
  const { mutations } = useCart();
  const go = useNavigateTo();
  const [pending, setPending] = useState<string | null>(null);
  const reorder = async (orderId: string) => {
    setPending(orderId);
    try {
      const { report } = await mutations.reorder(orderId);
      announce(report);
      go(KERNEL_PATHS.cart);
    } catch (err) {
      showError(err);
    } finally {
      setPending(null);
    }
  };
  return { reorder, pending };
}

function announce(report: ImportReport) {
  if (report.skipped.length === 0) showInfo('reorder', 'Itens de volta na sacola');
  else
    showInfo(
      'reorder',
      report.added ? 'Parte do pedido voltou para a sacola' : 'Nenhum item está disponível agora',
      report.skipped.map((s) => errorCopy(s.code).title).join(' · '),
    );
}

export function OrderPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  // live: the Kernel holds a long poll open while the tab is visible (Kernel 1.2)
  const { order, loading, error, refetch } = useOrder(id);
  const { store } = useStore();
  const { reorder, pending } = useReorder();
  const currency = store?.currency ?? 'BRL';
  const isNew = new URLSearchParams(search).has('novo');
  const pix = order?.payment.pix;
  const payPix =
    pix &&
    order.payment.method === 'pix' &&
    order.payment.status === 'pending' &&
    order.state !== 'cancelled';

  return (
    <main id="main" className="v-page" data-vendua-page="order">
      {loading && !order ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedido" />
      ) : !order ? (
        <Slot
          name="system.ErrorFallback"
          error={{
            code: error?.code ?? 'ORDER_NOT_FOUND',
            message:
              error?.code === 'ORDER_NOT_FOUND' || error?.status === 400
                ? 'Pedido não encontrado neste aparelho.'
                : 'O pedido não carregou.',
          }}
          retry={refetch}
        />
      ) : (
        <>
          {isNew ? <Slot name="checkout.SuccessPage" order={order} currency={currency} /> : null}
          {payPix ? (
            <Slot
              name="checkout.PixPayment"
              copyPaste={pix.copyPaste}
              beneficiary={pix.beneficiary}
              {...(pix.keyType ? { keyLabel: KEY_LABEL[pix.keyType] ?? pix.keyType } : {})}
              amountCents={order.totalCents}
              currency={currency}
            />
          ) : null}
          <Slot
            name="order.StatusPage"
            order={order}
            currency={currency}
            timeline={<Slot name="order.Timeline" events={order.timeline} />}
          />
          {order.items?.length ? (
            <Slot
              name="order.Items"
              items={order.items}
              currency={currency}
              notes={order.notes ?? null}
              scheduledFor={order.scheduledFor ?? null}
              discountCents={order.discountCents ?? 0}
              couponCode={order.coupon?.code ?? null}
              onReorder={() => void reorder(order.id)}
              reorderPending={pending === order.id}
            />
          ) : null}
          <p style={{ marginTop: 24 }}>
            <KLink href={KERNEL_PATHS.orders} className="v-btn v-btn-ghost">
              Meus pedidos
            </KLink>
          </p>
        </>
      )}
    </main>
  );
}

export function OrderHistoryPage() {
  const local = useOrderHistory();
  const phone = useOrders();
  const loyalty = useLoyalty(phone.phone);
  const { store } = useStore();
  const { reorder, pending } = useReorder();
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string>();
  const currency = store?.currency ?? 'BRL';

  // one list: this device's full orders, plus the phone's orders placed elsewhere
  const localIds = new Set(local.orders.map((o) => o.id));
  const rows = [
    ...local.orders.map((o) => ({
      id: o.id,
      number: o.number,
      state: o.state,
      placedAt: o.placedAt,
      totalCents: o.totalCents,
      items: (o.items ?? []).map((i) => ({ name: i.name, qty: i.qty })),
      here: true,
    })),
    ...phone.orders.filter((o) => !localIds.has(o.id)).map((o) => ({ ...o, here: false })),
  ].sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt));
  const loading = (local.loading || phone.loading) && rows.length === 0;

  const verify = async (p: string, orderNumber: number) => {
    setVerifying(true);
    setVerifyError(undefined);
    try {
      await phone.verify(orderNumber, p);
      loyalty.refetch();
    } catch (err) {
      setVerifyError(errorCopy(errorCode(err)).title);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <main id="main" className="v-page" data-vendua-page="orders">
      <h1 className="v-page-title">Meus pedidos</h1>
      <p className="v-muted">
        {phone.needsVerification
          ? 'Pedidos feitos neste aparelho.'
          : 'Pedidos deste aparelho e do seu WhatsApp.'}
      </p>
      {loyalty.card?.enabled ? (
        <Slot name="customer.LoyaltyCard" card={loyalty.card} currency={currency} />
      ) : null}
      {loading ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedidos" />
      ) : rows.length === 0 ? (
        <div className="v-panel v-empty" data-part="empty">
          <p className="v-panel-title">Nenhum pedido por aqui ainda.</p>
          <KLink href="/" className="v-btn v-btn-accent">
            Fazer um pedido
          </KLink>
        </div>
      ) : (
        <ol className="v-order-list" data-part="list">
          {rows.map((o) => {
            const head = (
              <>
                <span>
                  <strong>Pedido #{o.number}</strong>{' '}
                  <span className="v-muted">
                    {new Date(o.placedAt).toLocaleDateString('pt-BR')}
                  </span>
                  {o.items.length ? (
                    <span className="v-muted v-line-mods">
                      {' '}
                      · {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                    </span>
                  ) : null}
                </span>
                <span>
                  {ORDER_STATE_LABEL[o.state] ?? o.state} ·{' '}
                  <span className="v-num">{money(o.totalCents, currency)}</span>
                </span>
              </>
            );
            return (
              <li key={o.id} data-origin={o.here ? 'device' : 'phone'}>
                {o.here ? (
                  <KLink href={KERNEL_PATHS.order.replace(':id', o.id)} data-state={o.state}>
                    {head}
                  </KLink>
                ) : (
                  <div className="v-order-row" data-state={o.state}>
                    {head}
                  </div>
                )}
                {o.items.length ? (
                  <button
                    type="button"
                    className="v-link-btn"
                    data-part="reorder"
                    disabled={pending === o.id}
                    onClick={() => void reorder(o.id)}
                  >
                    {pending === o.id ? 'Colocando na sacola…' : 'Pedir de novo'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {phone.needsVerification ? (
        <Slot
          name="customer.PhoneVerify"
          phone=""
          pending={verifying}
          {...(verifyError ? { error: verifyError } : {})}
          onSubmit={(p, n) => void verify(p, n)}
        />
      ) : (
        <p className="v-muted" style={{ marginTop: 16 }}>
          <button type="button" className="v-link-btn" onClick={phone.forget}>
            Esquecer meu WhatsApp neste aparelho
          </button>
        </p>
      )}
    </main>
  );
}

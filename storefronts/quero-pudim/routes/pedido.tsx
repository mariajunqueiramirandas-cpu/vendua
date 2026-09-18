import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  MapPin,
  MessageCircle,
  RefreshCw,
  Store,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useKernel, useStore } from '@vendua/kernel';
import type { Order } from '@vendua/kernel';
import { Skeleton } from './_components/Skeleton.tsx';
import { formatBRL, formatDateTime, formatTime } from './_lib/format.ts';
import { getContinueShoppingUrl } from './_lib/lastSeen.ts';
import { findOrder, rememberOrder, type StoredOrder } from './_lib/orders.ts';
import { orderWhatsAppMessage, waLink } from './_lib/whatsapp.ts';

/**
 * Pedido — confirmation + tracking. Core's order view has no items, and
 * `api.order(id)` currently ships no Bearer token (it 401s), so the items and
 * the fallback order come from the session snapshot written at checkout
 * (OBSERVATIONS.md). The refetch path is kept for forward compatibility: the
 * moment the Kernel sends auth, "Atualizar" just works.
 */

const STATE_INFO: Record<string, { label: string; description: string; tone: string }> = {
  placed: { label: 'Recebido', description: 'Aguardando a cozinha confirmar.', tone: 'warn' },
  confirmed: { label: 'Confirmado', description: 'Confirmado pela cozinha.', tone: 'brand' },
  preparing: { label: 'Em preparo', description: 'Sendo embalado com carinho.', tone: 'warn' },
  ready: { label: 'Pronto', description: 'Pronto para retirada ou saída.', tone: 'ok' },
  out_for_delivery: { label: 'A caminho', description: 'Saiu para entrega.', tone: 'brand' },
  delivered: { label: 'Entregue', description: 'Entregue. Bom apetite!', tone: 'ok' },
  cancelled: { label: 'Cancelado', description: 'Este pedido foi cancelado.', tone: 'bad' },
  refunded: { label: 'Estornado', description: 'O valor foi devolvido.', tone: 'bad' },
};

const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
};

const PAYMENT_WHERE: Record<string, string> = {
  pix: 'Combinado com a loja',
  card_on_delivery: 'Na entrega/retirada',
  cash: 'Na entrega/retirada',
};

function firstName(n: string) {
  return n.trim().split(/\s+/)[0] ?? n;
}

export function OrderPage() {
  const { id = '' } = useParams();
  const { api } = useKernel();
  const { store } = useStore();
  const [entry, setEntry] = useState<StoredOrder | null>(() => findOrder(id) ?? null);
  const [loading, setLoading] = useState(entry === null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(
    async (manual: boolean) => {
      if (!id) return;
      if (manual) setRefreshing(true);
      try {
        const live = await api.order(id);
        setEntry((prev) => {
          const next: StoredOrder = prev
            ? { ...prev, order: live }
            : { order: live, items: [], savedAt: new Date().toISOString() };
          return next;
        });
        // Keep the session cache in sync if this order was placed here.
        const cached = findOrder(id);
        if (cached) rememberOrder(live, cached.items, cached.notes);
        setRefreshNote(null);
      } catch {
        if (manual) setRefreshNote('Não foi possível atualizar agora — mostrando o último estado conhecido.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [api, id],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (loading) {
    return (
      <main className="container" style={{ paddingBlock: '48px 96px', maxWidth: '40rem' }} aria-busy="true" aria-label="Carregando pedido">
        <Skeleton style={{ height: 160, borderRadius: 12 }} />
        <Skeleton style={{ height: 280, borderRadius: 12, marginTop: 24 }} />
      </main>
    );
  }

  if (!entry) {
    return (
      <main className="container">
        <div className="empty-state" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
          <h1 className="display display-lg">Pedido não encontrado.</h1>
          <p>Confira o link ou busque o pedido em “Meus pedidos”.</p>
          <Link to="/meus-pedidos" className="btn">
            <ArrowLeft size={16} aria-hidden="true" /> Meus pedidos
          </Link>
        </div>
      </main>
    );
  }

  const order: Order = entry.order;
  const info = STATE_INFO[order.state] ?? { label: order.state, description: 'Atualizando.', tone: 'muted' };
  const waUrl = waLink(store?.whatsapp, orderWhatsAppMessage(order, entry.items, store?.name ?? 'loja', entry.notes));
  const eta =
    order.delivery.etaMin != null && order.delivery.etaMax != null
      ? `${order.delivery.etaMin}–${order.delivery.etaMax} min`
      : null;

  return (
    <main className="container" style={{ paddingBlock: '40px 96px', maxWidth: '40rem' }}>
      <section className="order-hero">
        <div className="order-hero-check">
          <Check size={20} aria-hidden="true" />
        </div>
        <p className="order-head-num tnum">Pedido #{order.number}</p>
        <h1 className="display display-lg" style={{ marginTop: 8 }}>
          Obrigado, {firstName(order.customer.name)}.
        </h1>
        <p className="state-chip" data-tone={info.tone} role="status" aria-live="polite">
          <span className="state-chip-dot" aria-hidden="true" />
          {info.label}
        </p>
        <p className="small muted" style={{ maxWidth: '24rem', margin: '8px auto 0' }}>{info.description}</p>
        {eta ? <p className="small muted" style={{ marginTop: 8 }}>Previsão: {eta}</p> : null}
        <button
          type="button"
          className="back-link"
          style={{ marginTop: 16, border: 0, background: 'none' }}
          onClick={() => void load(true)}
          disabled={refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : undefined} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} aria-hidden="true" />
          Atualizar
        </button>
        {refreshNote ? <p className="small muted" role="status" style={{ marginTop: 4 }}>{refreshNote}</p> : null}
      </section>

      {order.payment.method === 'pix' && order.payment.instructions ? (
        <section className="summary-card" style={{ marginTop: 24 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MessageCircle size={16} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" /> Pague com Pix
          </h2>
          <p className="small" style={{ marginTop: 8, lineHeight: 1.6 }}>{order.payment.instructions}</p>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: 12, height: 44 }}
            onClick={() => {
              void navigator.clipboard?.writeText(order.payment.instructions ?? '').then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />}
            {copied ? 'Copiado!' : 'Copiar instruções'}
          </button>
        </section>
      ) : null}

      {waUrl ? (
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-block"
          style={{ marginTop: 24, height: 52 }}
        >
          <MessageCircle size={16} aria-hidden="true" /> Enviar no WhatsApp
        </a>
      ) : null}

      <section className="summary-card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <h2>Resumo</h2>
          <time dateTime={order.placedAt} className="small muted tnum">{formatDateTime(order.placedAt)}</time>
        </div>
        <div className="order-meta">
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: '0.875rem' }}>
            {order.delivery.mode === 'delivery' ? (
              <><Truck size={16} style={{ color: 'var(--zinc-400)' }} aria-hidden="true" /> Entrega</>
            ) : (
              <><Store size={16} style={{ color: 'var(--zinc-400)' }} aria-hidden="true" /> Retirada</>
            )}
          </p>
          {order.delivery.mode === 'delivery' && typeof order.delivery.address === 'string' ? (
            <p className="small muted" style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <MapPin size={14} style={{ color: 'var(--zinc-400)', flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
              {order.delivery.address}
              {order.delivery.neighborhood ? ` — ${order.delivery.neighborhood}` : ''}
            </p>
          ) : null}
          <p className="small muted ficha-hairline" style={{ marginTop: 12, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Pagamento: <strong style={{ color: 'var(--zinc-950)', fontWeight: 500 }}>{PAYMENT_LABEL[order.payment.method] ?? order.payment.method}</strong></span>
            <span style={{ fontWeight: 500 }}>{order.payment.status === 'paid' ? 'Pago' : PAYMENT_WHERE[order.payment.method] ?? ''}</span>
          </p>
          {entry.notes ? <p className="small muted" style={{ marginTop: 8 }}>Obs: {entry.notes}</p> : null}
        </div>

        {entry.items.length > 0 ? (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }} className="ficha-hairline">
            {entry.items.map((item) => (
              <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBlock: 14 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 500, fontSize: '0.875rem' }}>{item.name}</p>
                  <p className="small muted tnum" style={{ margin: '2px 0 0' }}>
                    {item.qty} × {formatBRL(item.unitPriceCents)}
                  </p>
                  {item.modifiers.length > 0 ? (
                    <p className="small muted" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
                      {item.modifiers.map((m) => m.name).join(', ')}
                    </p>
                  ) : null}
                </div>
                <span className="tnum" style={{ fontWeight: 500, fontSize: '0.875rem' }}>{formatBRL(item.lineTotalCents)}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <dl className="ficha-hairline" style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
          <div className="summary-row">
            <dt className="lbl">Subtotal</dt>
            <dd className="val">{formatBRL(order.subtotalCents)}</dd>
          </div>
          {order.deliveryFeeCents > 0 ? (
            <div className="summary-row">
              <dt className="lbl">Entrega</dt>
              <dd className="val">{formatBRL(order.deliveryFeeCents)}</dd>
            </div>
          ) : null}
          <div className="summary-row summary-total">
            <dt className="lbl" style={{ color: 'var(--zinc-950)', fontWeight: 500 }}>Total</dt>
            <dd className="val">{formatBRL(order.totalCents)}</dd>
          </div>
        </dl>
      </section>

      {order.timeline.length > 0 ? (
        <section className="summary-card" style={{ marginTop: 24 }}>
          <h2>Acompanhamento</h2>
          <ol className="timeline" style={{ marginTop: 16 }}>
            {order.timeline.map((ev, i) => (
              <li key={i}>
                <span className="timeline-dot" aria-hidden="true" />
                <div>
                  <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>
                    {STATE_INFO[ev.to]?.label ?? ev.to}
                  </p>
                  <p className="small muted tnum" style={{ margin: 0 }}>{formatTime(ev.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p style={{ textAlign: 'center', marginTop: 32 }}>
        <Link to={getContinueShoppingUrl()} className="back-link" style={{ display: 'inline-flex' }}>
          <ArrowLeft size={14} aria-hidden="true" /> Voltar ao cardápio
        </Link>
      </p>
    </main>
  );
}

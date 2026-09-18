import { ArrowLeft, Package, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatBRL, formatDateTime } from './_lib/format.ts';
import { getContinueShoppingUrl } from './_lib/lastSeen.ts';
import { listOrders } from './_lib/orders.ts';
import { maskPhone, phoneDigits } from './_lib/profile.ts';

/**
 * Meus pedidos — sem senha, sem cadastro. The reference app fetched orders by
 * WhatsApp number from `GET /customer/orders?phone=`; Core has no such route
 * (and `api.order` 401s without session auth), so the search honestly filters
 * this device's session order log instead (OBSERVATIONS.md FEATURE-GAP).
 */

const STATE_CHIP: Record<string, { label: string; tone: string }> = {
  placed: { label: 'Recebido', tone: 'warn' },
  confirmed: { label: 'Confirmado', tone: 'brand' },
  preparing: { label: 'Em preparo', tone: 'warn' },
  ready: { label: 'Pronto', tone: 'ok' },
  out_for_delivery: { label: 'A caminho', tone: 'brand' },
  delivered: { label: 'Entregue', tone: 'ok' },
  cancelled: { label: 'Cancelado', tone: 'bad' },
  refunded: { label: 'Estornado', tone: 'bad' },
};

export function MyOrdersPage() {
  const orders = useMemo(() => listOrders(), []);
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const digits = phoneDigits(phone);
  const filtered = useMemo(() => {
    if (!searched || digits.length < 10) return orders;
    return orders.filter(({ order }) => phoneDigits(order.customer.phone) === digits);
  }, [orders, searched, digits]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (digits.length > 0 && digits.length < 10) {
      setPhoneError('Informe o WhatsApp com DDD e 10 ou 11 dígitos.');
      return;
    }
    setPhoneError(null);
    setSearched(true);
  }

  const continueUrl = getContinueShoppingUrl();

  return (
    <main className="container" style={{ paddingBlock: '32px 96px', maxWidth: '46rem' }}>
      <Link to={continueUrl} className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Voltar ao cardápio
      </Link>
      <header className="ficha-hairline" style={{ marginTop: 16, paddingBottom: 32, borderBottom: '1px solid var(--zinc-200)', borderTop: 0 }}>
        <p className="eyebrow">Sem senha, sem cadastro</p>
        <h1 className="display display-lg" style={{ marginTop: 8 }}>Meus pedidos.</h1>
        <p className="small muted" style={{ marginTop: 12, maxWidth: '32rem', lineHeight: 1.6 }}>
          Acompanhe os pedidos feitos neste aparelho ou busque pelo WhatsApp usado na compra.
        </p>
      </header>

      <form onSubmit={onSearch} className="phone-search" style={{ marginTop: 24 }}>
        <label htmlFor="my-orders-phone" className="small" style={{ fontWeight: 500 }}>
          WhatsApp do pedido
        </label>
        <p id="my-orders-phone-hint" className="small muted" style={{ marginTop: 4 }}>
          Use o mesmo número informado ao finalizar o pedido, incluindo o DDD.
        </p>
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <input
            id="my-orders-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            enterKeyHint="search"
            placeholder="(00) 00000-0000"
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            value={phone}
            onChange={(e) => { setPhone(maskPhone(e.target.value)); setPhoneError(null); }}
            aria-invalid={Boolean(phoneError)}
            aria-describedby={`my-orders-phone-hint${phoneError ? ' my-orders-phone-error' : ''}`}
          />
          <button type="submit" className="btn" style={{ height: 48 }}>
            <Search size={16} aria-hidden="true" /> Buscar pedidos
          </button>
        </div>
        {phoneError ? (
          <p id="my-orders-phone-error" className="field-error" role="alert" style={{ marginTop: 8 }}>{phoneError}</p>
        ) : null}
      </form>

      <section aria-label="Histórico de pedidos" style={{ marginTop: 32 }}>
        <h2 className="step-heading" style={{ marginBottom: 16 }}>Histórico de pedidos</h2>
        {filtered.length === 0 ? (
          searched && digits.length >= 10 ? (
            <p className="small muted" role="status" style={{ padding: '24px 0' }}>
              Nenhum pedido encontrado para este WhatsApp neste aparelho. Confira o número e o DDD e busque novamente.
            </p>
          ) : (
            <div className="empty-state" style={{ border: '1px dashed var(--zinc-300)', borderRadius: 12, background: 'var(--zinc-50)' }}>
              <Package size={32} style={{ color: 'var(--zinc-300)' }} aria-hidden="true" />
              <h3 style={{ fontSize: '1.125rem' }}>Nenhum pedido por aqui ainda</h3>
              <p>Seus próximos pedidos neste aparelho aparecem aqui automaticamente.</p>
              <Link to={continueUrl} className="btn btn-ghost">Ver cardápio</Link>
            </div>
          )
        ) : (
          <ol className="order-list">
            {filtered.map(({ order, items }) => {
              const chip = STATE_CHIP[order.state] ?? { label: order.state, tone: 'muted' };
              return (
                <li key={order.id} className="order-row">
                  <div className="order-row-head">
                    <div>
                      <h3 className="order-row-title">
                        Pedido #{order.number} · {order.customer.name}
                      </h3>
                      <p className="small muted tnum" style={{ marginTop: 4 }}>
                        {formatDateTime(order.placedAt)} · {formatBRL(order.totalCents)}
                      </p>
                    </div>
                    <span className="state-chip" data-tone={chip.tone}>
                      <span className="state-chip-dot" aria-hidden="true" />
                      {chip.label}
                    </span>
                  </div>
                  {items.length > 0 ? (
                    <ul className="order-row-items">
                      {items.map((item) => (
                        <li key={item.id} className="tnum">{item.qty}x {item.name}</li>
                      ))}
                    </ul>
                  ) : null}
                  <Link to={`/pedido/${order.id}`} className="order-row-link" aria-label={`Ver detalhes do pedido ${order.number}`}>
                    Ver detalhes
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}

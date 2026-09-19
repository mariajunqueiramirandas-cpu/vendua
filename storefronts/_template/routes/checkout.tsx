import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ApiError,
  formatCents,
  useCart,
  useCheckout,
  useDeliveryZones,
  useStore,
} from '@vendua/kernel';

/**
 * Checkout — the minimal real flow: customer + delivery mode + payment,
 * `mutations.setDelivery` keeps the server cart's zone/fee in sync, and
 * `useCheckout().submit` places the order. Core owns all the math.
 */

type Mode = 'pickup' | 'delivery';
type Pay = 'pix' | 'card_on_delivery' | 'cash';

const ERROR_COPY: Record<string, string> = {
  OUT_OF_ZONE: 'Esse bairro está fora da área de entrega — retirada continua disponível.',
  EMPTY_CART: 'Sua sacola ficou vazia — escolha um item para continuar.',
  STORE_PAUSED: 'A loja está pausada agora — volte em instantes.',
  STORE_CLOSED: 'A loja está fechada agora.',
  INVALID_CUSTOMER: 'Confira seu nome e telefone.',
  INVALID_DELIVERY: 'Confira os dados de entrega.',
  INVALID_PAYMENT: 'Escolha uma forma de pagamento válida.',
};

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  const { zones } = useDeliveryZones();
  const { submit } = useCheckout();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<Mode>('delivery');
  const [neighborhood, setNeighborhood] = useState('');
  const [address, setAddress] = useState('');
  const [pay, setPay] = useState<Pay>('pix');

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = cart?.items ?? [];
  const totals = cart?.totals;
  const neighborhoods = zones.flatMap((z) => z.neighborhoods);

  // Keep the server cart's delivery in sync so zone fee / min-order land in
  // cart.totals. The seq guard drops superseded responses.
  const syncSeq = useRef(0);
  const [deliverySync, setDeliverySync] = useState<'syncing' | 'ok' | 'error'>('ok');
  useEffect(() => {
    if (items.length === 0) return;
    if (mode === 'delivery' && neighborhood.trim() === '') return;
    const seq = ++syncSeq.current;
    setDeliverySync('syncing');
    void mutations
      .setDelivery(
        mode === 'pickup'
          ? { mode: 'pickup' }
          : { mode: 'delivery', neighborhood: neighborhood.trim() },
      )
      .then(() => {
        if (seq === syncSeq.current) setDeliverySync('ok');
      })
      .catch(() => {
        if (seq === syncSeq.current) setDeliverySync('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, neighborhood, items.length]);

  const canPlace =
    !pending &&
    deliverySync === 'ok' &&
    items.length > 0 &&
    !totals?.belowMinOrder &&
    name.trim().length >= 2 &&
    phone.trim().length >= 8 &&
    (mode === 'pickup' || (neighborhood.trim() !== '' && address.trim() !== ''));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canPlace) return;
    setPending(true);
    setError(null);
    try {
      const order = await submit({
        customer: { name: name.trim(), phone: phone.trim() },
        delivery:
          mode === 'pickup'
            ? { mode: 'pickup' }
            : { mode: 'delivery', neighborhood: neighborhood.trim(), address: address.trim() },
        payment: { method: pay },
      });
      navigate(`/pedido/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ORDER_MIN_NOT_MET' && typeof err.details?.minOrderCents === 'number') {
          setError(
            `O pedido mínimo é ${formatCents(err.details.minOrderCents, store?.currency)} para essa entrega.`,
          );
        } else {
          setError(ERROR_COPY[err.code] ?? `Não foi possível enviar (${err.message}).`);
        }
        if (err.code === 'EMPTY_CART') window.setTimeout(() => navigate('/'), 1200);
      } else {
        setError('Erro de conexão. Tente novamente.');
      }
      setPending(false);
    }
  }

  if (loading && !cart) {
    return (
      <main id="main" className="container page" aria-busy="true" aria-label="Carregando checkout">
        <p className="sk-line" />
        <p className="sk-line" />
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main id="main" className="container page">
        <div className="empty">
          <h1>Sua sacola está vazia.</h1>
          <p>Escolha um item no cardápio antes de fechar o pedido.</p>
          <Link to="/" className="btn">
            Ver cardápio
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="container page page--narrow">
      <Link to="/cart" className="back-link">
        ← Voltar à sacola
      </Link>
      <header className="page-head">
        <h1>Fechar pedido</h1>
      </header>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}
      {deliverySync === 'error' ? (
        <p className="alert" role="alert">
          Não foi possível confirmar a taxa desse bairro — ajuste a entrega para tentar de novo.
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <section aria-labelledby="ck-dados" className="ck-section">
          <h2 id="ck-dados">Seus dados</h2>
          <label className="field">
            <span>Nome</span>
            <input
              className="input"
              required
              minLength={2}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Telefone / WhatsApp</span>
            <input
              className="input"
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
        </section>

        <section aria-labelledby="ck-entrega" className="ck-section">
          <h2 id="ck-entrega">Entrega ou retirada</h2>
          <div className="choices" role="radiogroup" aria-label="Modo de recebimento">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'delivery'}
              className="choice"
              disabled={!store?.deliveryEnabled}
              onClick={() => setMode('delivery')}
            >
              Entrega{store?.city ? ` — ${store.city}` : ''}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'pickup'}
              className="choice"
              disabled={!store?.pickupEnabled}
              onClick={() => setMode('pickup')}
            >
              Retirada{store?.address ? ` — ${store.address}` : ''}
            </button>
          </div>

          {mode === 'delivery' ? (
            <div className="field-grid">
              <label className="field">
                <span>Bairro</span>
                <input
                  className="input"
                  required
                  list="vendua-bairros"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                />
                <datalist id="vendua-bairros">
                  {neighborhoods.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Endereço</span>
                <input
                  className="input"
                  required
                  autoComplete="street-address"
                  placeholder="Rua, número, complemento"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </label>
              {neighborhood.trim() !== '' ? (
                <p className="muted" role="status">
                  {deliverySync === 'syncing'
                    ? 'Calculando a taxa de entrega…'
                    : cart?.delivery?.zoneId
                      ? (totals?.deliveryFeeCents ?? 0) > 0
                        ? `Taxa: ${formatCents(totals?.deliveryFeeCents ?? 0, store?.currency)}`
                        : 'Entrega grátis nesse bairro.'
                      : 'Bairro sem taxa calculada — fora da área, o pedido avisa na confirmação.'}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted">
              Retire na loja — preparo em ~{store?.prepTimeMinutes ?? 30} min, sem taxa.
            </p>
          )}
        </section>

        <section aria-labelledby="ck-pagamento" className="ck-section">
          <h2 id="ck-pagamento">Pagamento</h2>
          <div className="choices" role="radiogroup" aria-label="Forma de pagamento">
            {(
              [
                ['pix', 'Pix'],
                ['card_on_delivery', 'Cartão na entrega/retirada'],
                ['cash', 'Dinheiro'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={pay === value}
                className="choice"
                onClick={() => setPay(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Resumo" className="summary">
          <div className="summary-row">
            <span>Subtotal</span>
            <span>{formatCents(totals?.subtotalCents ?? 0, store?.currency)}</span>
          </div>
          <div className="summary-row">
            <span>Entrega</span>
            <span>
              {mode !== 'delivery'
                ? 'grátis'
                : cart?.delivery?.zoneId
                  ? formatCents(totals?.deliveryFeeCents ?? 0, store?.currency)
                  : '—'}
            </span>
          </div>
          <div className="summary-row summary-total">
            <span>Total</span>
            <span>{formatCents(totals?.totalCents ?? 0, store?.currency)}</span>
          </div>

          {totals?.belowMinOrder ? (
            <p className="alert" role="status">
              Pedido mínimo de {formatCents(totals.minOrderCents, store?.currency)} para essa
              entrega.
            </p>
          ) : null}

          <button type="submit" className="btn btn-block" disabled={!canPlace}>
            {pending ? 'Enviando…' : 'Confirmar pedido'}
          </button>
        </section>
      </form>
    </main>
  );
}

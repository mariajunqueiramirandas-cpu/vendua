import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart, useCheckout, useStore } from '@vendua/kernel';
import type { Order } from '@vendua/kernel';
import { cents, ErrorPlate } from './_ui';

/**
 * Fechar — checkout as a dispatch manifest: identification, route (retirada /
 * entrega), payment plate. Delivery choice syncs through setDelivery so Core
 * prices the fee into cart.totals; submit() lets Core validate for real.
 * '/checkout' is a reserved API prefix — this page lives at /fechar.
 */
const BAIRROS = ['Centro', 'Gamboa', 'Saúde', 'Santo Cristo', 'Caju'];

type Pay = 'pix' | 'card_on_delivery' | 'cash';

const PAY: { id: Pay; title: string; sub: string }[] = [
  { id: 'pix', title: 'Pix', sub: 'chave combinada na entrega' },
  { id: 'card_on_delivery', title: 'Cartão', sub: 'maquininha na entrega/retirada' },
  { id: 'cash', title: 'Dinheiro', sub: 'troco combinado na hora' },
];

export function Fechar() {
  const { cart, mutations } = useCart();
  const { store } = useStore();
  const { submit } = useCheckout();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'pickup' | 'delivery'>('pickup');
  const [bairro, setBairro] = useState('');
  const [address, setAddress] = useState('');
  const [pay, setPay] = useState<Pay>('pix');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<{
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }>();
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const items = cart?.status === 'open' ? cart.items : [];
  const totals = cart?.totals;

  // Sync delivery choice into the server cart so the fee is Core-priced.
  // Track it: a failed setDelivery leaves totals priced for the OLD bairro —
  // block submit while a sync is in flight or errored (editing the field
  // retries), and let the sequence guard ignore superseded responses.
  const syncSeq = useRef(0);
  const [deliverySync, setDeliverySync] = useState<'syncing' | 'ok' | 'error'>('ok');
  useEffect(() => {
    if (!items.length) return;
    if (mode === 'delivery' && !bairro.trim()) return;
    setErr(undefined);
    const seq = ++syncSeq.current;
    setDeliverySync('syncing');
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      void mutations
        .setDelivery(mode === 'pickup' ? { mode } : { mode, neighborhood: bairro.trim() })
        .then(() => {
          if (seq === syncSeq.current) setDeliverySync('ok');
        })
        .catch(() => {
          if (seq !== syncSeq.current) return;
          setDeliverySync('error');
          setErr({
            code: 'DELIVERY_SYNC',
            message:
              'Não conseguimos confirmar a entrega nesse bairro — ajuste para tentar de novo.',
          });
        });
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [mode, bairro, items.length, mutations]);

  const canSubmit = items.length > 0 && !pending && deliverySync === 'ok';

  const onSubmit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setErr(undefined);
    try {
      const order: Order = await submit({
        customer: { name: name.trim(), phone: phone.trim() },
        delivery:
          mode === 'pickup'
            ? { mode }
            : { mode, neighborhood: bairro.trim(), address: address.trim() },
        payment: { method: pay },
      });
      // submit() already invalidates 'cart' — the completed cart drops out
      // of the badge without storefront plumbing.
      navigate(`/pedido/${order.id}`, { state: { order } });
    } catch (e) {
      setErr(e as { code: string; message: string; details?: Record<string, unknown> });
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="page">
      <header className="pagehead">
        <span className="code">DESPACHO · FECHAR</span>
        <h1>Fechar pedido</h1>
      </header>

      {!items.length ? (
        <div className="ticket">
          <div className="empty">
            <div className="big">Nada no gancho</div>
            <p>a chapa não despacha comanda vazia.</p>
            <Link
              to="/"
              className="cta ghost"
              style={{
                display: 'inline-block',
                padding: '10px 22px',
                textDecoration: 'none',
                marginTop: 8,
              }}
            >
              Ao quadro →
            </Link>
          </div>
        </div>
      ) : (
        <div className="ck-grid">
          <div>
            <section className="ck-section">
              <div className="sechead">
                <span className="idx">01</span>
                <h2>Quem retira</h2>
              </div>
              <div className="field">
                <label htmlFor="f-name">Nome</label>
                <input
                  id="f-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Seu nome"
                  autoComplete="name"
                />
              </div>
              <div className="field">
                <label htmlFor="f-phone">WhatsApp / telefone</label>
                <input
                  id="f-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(21) 9…"
                  inputMode="tel"
                  autoComplete="tel"
                />
              </div>
            </section>

            <section className="ck-section">
              <div className="sechead">
                <span className="idx">02</span>
                <h2>Rota</h2>
              </div>
              <div className="modegrid" role="group" aria-label="modo de entrega">
                <button
                  type="button"
                  className="mode"
                  aria-pressed={mode === 'pickup'}
                  onClick={() => setMode('pickup')}
                >
                  <span className="mtitle">Retirada</span>
                  <span className="msub">{store?.address ?? 'no balcão'}</span>
                </button>
                <button
                  type="button"
                  className="mode"
                  aria-pressed={mode === 'delivery'}
                  onClick={() => setMode('delivery')}
                >
                  <span className="mtitle">Entrega</span>
                  <span className="msub">centro + zona portuária</span>
                </button>
              </div>

              {mode === 'delivery' ? (
                <>
                  <div className="field" style={{ marginTop: 14 }}>
                    <label htmlFor="f-bairro">Bairro</label>
                    <input
                      id="f-bairro"
                      value={bairro}
                      onChange={(e) => setBairro(e.target.value)}
                      placeholder="Gamboa, Saúde, Santo Cristo…"
                      autoComplete="address-level2"
                    />
                    <p className="fieldhint">chega em: {BAIRROS.join(' · ')}</p>
                  </div>
                  <div className="field">
                    <label htmlFor="f-addr">Endereço</label>
                    <input
                      id="f-addr"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Rua, número, complemento"
                      autoComplete="street-address"
                    />
                  </div>
                  {bairro.trim() && totals && !totals.deliveryFeeCents ? (
                    <p className="zonehint warn">
                      bairro ainda não confirmou frete — Core valida no despacho
                    </p>
                  ) : null}
                  {totals?.deliveryFeeCents ? (
                    <p className="zonehint">frete confirmado: {cents(totals.deliveryFeeCents)}</p>
                  ) : null}
                </>
              ) : null}
            </section>

            <section className="ck-section">
              <div className="sechead">
                <span className="idx">03</span>
                <h2>Pagamento</h2>
              </div>
              <div className="paygrid" role="radiogroup" aria-label="pagamento">
                {PAY.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={pay === p.id}
                    className="pay"
                    onClick={() => setPay(p.id)}
                  >
                    <span className="dot" aria-hidden="true" />
                    <span>
                      <span className="ptitle">{p.title}</span>
                      <span className="psub">{p.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {err ? <ErrorPlate error={err} /> : null}

            <button
              type="button"
              className="cta"
              style={{ width: '100%' }}
              disabled={!canSubmit}
              onClick={onSubmit}
            >
              {pending ? 'Na chapa…' : 'Despachar pedido →'}
            </button>
          </div>

          <aside className="side">
            <div className="ticket">
              <div className="ticket-head">
                <div className="brand">Resumo</div>
                <div className="meta">{totals?.itemCount ?? 0} itens</div>
              </div>
              {items.map((it) => (
                <div className="tline" key={it.id}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {it.qty}×
                  </span>
                  <span>
                    <span className="tname">{it.name}</span>
                    {it.modifiers.length ? (
                      <div className="tmods">{it.modifiers.map((m) => m.name).join(' · ')}</div>
                    ) : null}
                  </span>
                  <span className="tprice">{cents(it.lineTotalCents)}</span>
                </div>
              ))}
              {totals ? (
                <div className="totals">
                  <div className="trow">
                    <span>subtotal</span>
                    <span>{cents(totals.subtotalCents)}</span>
                  </div>
                  <div className="trow">
                    <span>entrega</span>
                    <span>{totals.deliveryFeeCents ? cents(totals.deliveryFeeCents) : '—'}</span>
                  </div>
                  <div className="trow grand">
                    <span>total</span>
                    <span>{cents(totals.totalCents)}</span>
                  </div>
                </div>
              ) : null}
              {totals?.belowMinOrder ? (
                <div className="minbar" role="status">
                  faltam {cents(totals.minOrderCents - totals.subtotalCents)} pro mínimo
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

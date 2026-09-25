import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, useCart, useCheckout, useStore } from '@vendua/kernel';
import type { CheckoutInput } from '@vendua/kernel';
import { Shell } from '../components/shell.tsx';
import { brl, PAYMENT_LABELS } from '../components/format.ts';
import { getLastOrder, setLastOrder } from '../components/last-order.ts';

type Pay = CheckoutInput['payment']['method'];

function friendlyError(err: unknown): { msg: string; field?: 'name' | 'phone' } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'EMPTY_CART':
        return { msg: 'A sacola esvaziou no caminho — bota um pão nela e volta.' };
      case 'STORE_PAUSED':
        return { msg: 'A forn pausou agora mesmo. Tenta de novo em instantes.' };
      case 'STORE_CLOSED':
        return { msg: 'A forn já fechou por hoje e não está aceitando pedidos agora.' };
      case 'OUT_OF_ZONE':
        return { msg: 'Esse bairro está fora da nossa rota — dá pra retirar no balcão.' };
      case 'ORDER_MIN_NOT_MET': {
        const min = err.details?.minOrderCents;
        return {
          msg: `Pedido mínimo é ${typeof min === 'number' ? brl(min) : 'maior'} — bota mais um pão.`,
        };
      }
      case 'INVALID_CUSTOMER':
        return {
          msg: 'Confere seu nome e telefone — a gente chama por eles no balcão.',
          field: 'name',
        };
      case 'INVALID_DELIVERY':
        return { msg: 'Escolhe como quer receber: balcão ou entrega.' };
      case 'INVALID_PAYMENT':
        return { msg: 'Escolhe como vai pagar.' };
      case 'SOLD_OUT':
        return { msg: 'Alguma coisa acabou enquanto você fechava — dá uma olhada na sacola.' };
      default:
        return { msg: err.message || 'Algo deu errado no balcão. Tenta de novo.' };
    }
  }
  return { msg: 'Sem sinal com o balcão. Confere a internet e tenta de novo.' };
}

function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export default function CheckoutPage() {
  const { cart, mutations } = useCart();
  const { store, status } = useStore();
  const { submit } = useCheckout();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pay, setPay] = useState<Pay>('pix');
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<{ msg: string; field?: 'name' | 'phone' } | null>(null);

  // Core 409s a second checkout on a completed cart — the tab-local flag is the friendlier guard
  const alreadyOrdered = !!getLastOrder();
  const open = !alreadyOrdered && cart?.status === 'open' && cart.items.length > 0;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!open || pending) return;
    if (name.trim().length < 2) {
      setErr({ msg: 'Falta seu nome — a gente chama por ele no balcão.', field: 'name' });
      return;
    }
    if (phone.replace(/\D/g, '').length < 8) {
      setErr({ msg: 'Falta um telefone pra gente avisar quando sair do forno.', field: 'phone' });
      return;
    }
    setErr(null);
    setPending(true);
    try {
      await mutations.setDelivery({ mode: 'pickup' });
      const order = await submit({
        customer: { name: name.trim(), phone: phone.replace(/\D/g, '') },
        delivery: { mode: 'pickup' },
        payment: { method: pay },
      });
      setLastOrder(order);
      // submit() invalidates 'cart' itself — no extra plumbing needed
      navigate(`/pedido/${order.id}`, { state: { order } });
    } catch (e2) {
      setErr(friendlyError(e2));
      setPending(false);
    }
  };

  return (
    <Shell>
      {!open ? (
        <div className="empty-panel">
          <h2>
            {alreadyOrdered || cart?.status === 'completed'
              ? 'pedido já anotado'
              : 'nada na sacola'}
          </h2>
          <p>
            {alreadyOrdered || cart?.status === 'completed'
              ? 'Essa sacola já virou pedido — a comanda tá na cozinha.'
              : 'Fecha o olho, escolhe um pão, e volta aqui.'}
          </p>
          <Link to="/" className="link-btn">
            {alreadyOrdered || cart?.status === 'completed' ? 'ver a vitrine' : 'montar a sacola'}
          </Link>
        </div>
      ) : (
        <form className="checkout-grid" onSubmit={onSubmit} noValidate>
          <div>
            <div className="form-sec">
              <div className="sec-label mono microcaps">01 · quem retira</div>
              <div className="field">
                <label htmlFor="f-name">seu nome</label>
                <input
                  id="f-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={err?.field === 'name'}
                  autoComplete="name"
                  placeholder="Maria do pão"
                />
                {err?.field === 'name' ? <div className="err mono">{err.msg}</div> : null}
              </div>
              <div className="field">
                <label htmlFor="f-phone">whatsapp / telefone</label>
                <input
                  id="f-phone"
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                  aria-invalid={err?.field === 'phone'}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(24) 99999-0000"
                />
                {err?.field === 'phone' ? <div className="err mono">{err.msg}</div> : null}
              </div>
            </div>

            <div className="form-sec">
              <div className="sec-label mono microcaps">02 · como paga</div>
              <div className="pay-options" role="radiogroup" aria-label="pagamento">
                {(['pix', 'card_on_delivery', 'cash'] as Pay[]).map((m) => (
                  <label className="pay-opt" key={m}>
                    <input
                      type="radio"
                      name="pay"
                      value={m}
                      checked={pay === m}
                      onChange={() => setPay(m)}
                    />
                    <span className="tick" aria-hidden="true" />
                    <span className="lbl">
                      {PAYMENT_LABELS[m]}
                      <small>
                        {m === 'pix'
                          ? 'na hora da retirada — chave no balcão'
                          : m === 'card_on_delivery'
                            ? 'débito ou crédito na maquininha'
                            : 'em espécie, a gente tem troco'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-sec">
              <div className="sec-label mono microcaps">03 · onde</div>
              <p style={{ margin: 0, color: 'var(--mute)', fontSize: 14.5 }}>
                {store?.deliveryEnabled
                  ? 'Retirada no balcão — entrega indisponível nesta fornada.'
                  : `Retirada no balcão — ${store?.address ?? 'no balcão'}.`}
                {status === 'closed'
                  ? ' Como a forn está fechada, o pedido entra na fila da próxima fornada.'
                  : ` Fica pronto em ~${store?.prepTimeMinutes ?? 15} min.`}
              </p>
            </div>

            {err && !err.field ? <div className="form-error mono">{err.msg}</div> : null}

            <button type="submit" className="big-cta" disabled={pending}>
              {pending ? 'anotando…' : 'anotar pedido'}
            </button>
          </div>

          <aside className="mini-summary mono" aria-label="resumo">
            <h3>na sacola</h3>
            {cart!.items.map((it) => (
              <div className="s-line" key={it.id}>
                <span>
                  {it.qty}× {it.name}
                </span>
                <span>{brl(it.lineTotalCents)}</span>
              </div>
            ))}
            <div className="s-line">
              <span>retirada</span>
              <span>
                {cart!.totals.deliveryFeeCents === 0
                  ? 'sem taxa'
                  : brl(cart!.totals.deliveryFeeCents)}
              </span>
            </div>
            <div className="s-total">
              <span>total</span>
              <span>{brl(cart!.totals.totalCents)}</span>
            </div>
          </aside>
        </form>
      )}
    </Shell>
  );
}

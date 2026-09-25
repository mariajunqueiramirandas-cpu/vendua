import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Calendar,
  Check,
  CreditCard,
  Loader2,
  MessageCircle,
  QrCode,
  Store,
  Ticket,
  Truck,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, useCart, useCheckout, useDeliveryZones, useStore } from '@vendua/kernel';
import { ProductFigure } from './_components/ProductFigure.tsx';
import { Skeleton } from './_components/Skeleton.tsx';
import { formatBRL } from './_lib/format.ts';
import { rememberOrder } from './_lib/orders.ts';
import { loadProfile, maskCep, maskPhone, phoneDigits, saveProfile } from './_lib/profile.ts';
import { waLink } from './_lib/whatsapp.ts';

// 3-step wizard on Kernel primitives; `setDelivery` keeps the server cart's
// zone/fee in sync. Unsupported reference features (OBSERVATIONS.md): CEP lookup,
// scheduled encomendas, coupons, order notes — notes stay local, folded into the
// confirmation WhatsApp message. Neighborhoods come from Core's /zones.

type Mode = 'pickup' | 'delivery';
type Pay = 'pix' | 'card_on_delivery' | 'cash';

const ERROR_COPY: Record<string, string> = {
  OUT_OF_ZONE: 'Esse bairro está fora da nossa área de entrega. Retirada continua disponível.',
  EMPTY_CART: 'Sua sacola ficou vazia — escolha um doce para continuar.',
  STORE_PAUSED: 'Estamos pausados agora — volte em instantes.',
  STORE_CLOSED: 'A cozinha está fechada agora.',
  INVALID_CUSTOMER: 'Confira seu nome e WhatsApp — precisamos dos dois para o pedido.',
  INVALID_DELIVERY: 'Confira os dados de entrega.',
  INVALID_PAYMENT: 'Escolha uma forma de pagamento válida.',
};

const STEPS = [
  { label: 'Seus dados', short: 'Dados' },
  { label: 'Entrega', short: 'Entrega' },
  { label: 'Pagamento', short: 'Pagar' },
];

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  const { zones } = useDeliveryZones();
  const bairros = zones.flatMap((z) => z.neighborhoods);
  const { submit } = useCheckout();

  const [name, setName] = useState(() => loadProfile().name);
  const [phone, setPhone] = useState(() => loadProfile().phone);
  const [mode, setMode] = useState<Mode>('delivery');
  const [street, setStreet] = useState(() => loadProfile().street);
  const [number, setNumber] = useState(() => loadProfile().number);
  const [neighborhood, setNeighborhood] = useState(() => loadProfile().neighborhood);
  const [complement, setComplement] = useState(() => loadProfile().complement);
  const [cep, setCep] = useState(() => loadProfile().cep);
  const [pay, setPay] = useState<Pay>('pix');
  const [notes, setNotes] = useState('');
  const [wantsSchedule, setWantsSchedule] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const items = cart?.items ?? [];
  const totals = cart?.totals;
  // display follows the SYNCED server cart: during a setDelivery call totals
  // still reflect the previous mode — confirm stays disabled until it lands
  const syncedMode = cart?.delivery?.mode ?? mode;
  const feeCents = syncedMode === 'delivery' ? (totals?.deliveryFeeCents ?? 0) : 0;
  const totalCents = totals?.totalCents ?? 0;
  const zoneMin = totals?.minOrderCents ?? store?.minOrderCents ?? 0;

  // sync the server cart so Core's zone fee/min-order lands in totals; a
  // failed setDelivery leaves totals priced for the OLD neighborhood — block
  // placing until the latest lands; seq drops superseded responses
  const syncSeq = useRef(0);
  const [deliverySync, setDeliverySync] = useState<'syncing' | 'ok' | 'error'>('ok');
  useEffect(() => {
    if (items.length === 0) return;
    if (mode === 'delivery' && neighborhood.trim().length === 0) return;
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

  const stepOk = (s: number): boolean => {
    if (s === 0) return name.trim().length >= 2 && phoneDigits(phone).length >= 10;
    if (s === 1) {
      if (mode === 'pickup') return true;
      return street.trim() !== '' && number.trim() !== '' && neighborhood.trim() !== '';
    }
    return true;
  };

  const addressLine =
    [street.trim(), number.trim()].filter(Boolean).join(', ') +
    (complement.trim() ? ` (${complement.trim()})` : '') +
    (cep.trim() ? ` · CEP ${cep.trim()}` : '');

  const canPlace =
    !pending &&
    deliverySync === 'ok' &&
    items.length > 0 &&
    !totals?.belowMinOrder &&
    stepOk(0) &&
    stepOk(1);

  function goNext() {
    if (!stepOk(step)) return;
    const next = Math.min(step + 1, 2);
    setStep(next);
    setMaxStep((m) => Math.max(m, next));
    scrollTop();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step < 2) {
      goNext();
      return;
    }
    if (!canPlace) return;
    setPending(true);
    setError(null);
    try {
      const order = await submit({
        customer: { name: name.trim(), phone: phone.trim() },
        delivery:
          mode === 'pickup'
            ? { mode: 'pickup' }
            : { mode: 'delivery', neighborhood: neighborhood.trim(), address: addressLine },
        payment: { method: pay },
      });
      saveProfile({ name: name.trim(), phone, street, number, neighborhood, complement, cep });
      rememberOrder(order, items, notes.trim() || undefined);
      // submit() already invalidates 'cart'
      navigate(`/pedido/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ORDER_MIN_NOT_MET' && typeof err.details?.minOrderCents === 'number') {
          setError(`O pedido mínimo é ${formatBRL(err.details.minOrderCents)} para essa entrega.`);
        } else {
          setError(ERROR_COPY[err.code] ?? `Não foi possível enviar (${err.message}).`);
        }
        if (err.code === 'EMPTY_CART') window.setTimeout(() => navigate('/catalog'), 1200);
      } else {
        setError('Erro de conexão. Tente novamente.');
      }
      setPending(false);
      scrollTop();
    }
  }

  if (loading && !cart) {
    return (
      <main
        className="container"
        style={{ paddingBlock: '32px 96px' }}
        aria-busy="true"
        aria-label="Carregando checkout"
      >
        <Skeleton style={{ height: 40, width: 220 }} />
        <div className="two-col" style={{ marginTop: 32 }}>
          <div style={{ display: 'grid', gap: 16 }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 120 }} />
          </div>
          <Skeleton style={{ height: 280, borderRadius: 12 }} />
        </div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="container">
        <div className="empty-state" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
          <h1 className="display display-lg">Sua sacola está vazia.</h1>
          <p>Escolha um doce no cardápio antes de fechar o pedido.</p>
          <Link to="/catalog" className="btn">
            <ArrowLeft size={16} aria-hidden="true" /> Ver cardápio
          </Link>
        </div>
      </main>
    );
  }

  const waScheduleLink = waLink(
    store?.whatsapp,
    `Oi! Quero agendar uma encomenda: ${items.map((i) => `${i.qty}x ${i.name}`).join(', ')}.`,
  );

  return (
    <main className="container" style={{ paddingBlock: '24px 96px', maxWidth: '46rem' }}>
      <div ref={topRef} />
      <Link to="/cart" className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Voltar à sacola
      </Link>
      <header style={{ marginTop: 16 }}>
        <p className="eyebrow">Quase à mesa</p>
        <h1 className="display display-lg" style={{ marginTop: 8 }}>
          Finalize seu pedido.
        </h1>
      </header>

      <nav aria-label="Etapas do pedido" style={{ marginTop: 24 }}>
        <ol className="step-nav" aria-live="polite">
          {STEPS.map((item, idx) => {
            const done = idx < step;
            const current = idx === step;
            return (
              <li key={item.label}>
                <button
                  type="button"
                  disabled={idx > maxStep}
                  onClick={() => {
                    setStep(Math.min(idx, maxStep));
                    scrollTop();
                  }}
                  aria-current={current ? 'step' : undefined}
                  aria-label={`${idx + 1}. ${item.label}${done ? ' (concluída)' : current ? ' (etapa atual)' : ''}`}
                  className="step-nav-btn"
                  data-state={current ? 'current' : done ? 'done' : 'todo'}
                >
                  <span className="step-nav-dot" aria-hidden="true">
                    {done ? <Check size={12} strokeWidth={3} /> : idx + 1}
                  </span>
                  <span className="step-nav-label">
                    <span className="step-nav-short">{item.short}</span>
                    <span className="step-nav-full">{item.label}</span>
                  </span>
                </button>
                {idx < STEPS.length - 1 ? (
                  <span className="step-nav-join" data-done={done || undefined} />
                ) : null}
              </li>
            );
          })}
        </ol>
      </nav>

      {error ? (
        <p className="inline-alert error" role="alert" style={{ marginTop: 24 }}>
          {error}
        </p>
      ) : null}
      {deliverySync === 'error' ? (
        <p className="inline-alert error" role="alert">
          Não conseguimos confirmar a taxa desse bairro — ajuste a entrega para tentar de novo.
        </p>
      ) : null}

      <form onSubmit={onSubmit} noValidate style={{ marginTop: 32 }}>
        {step === 0 ? (
          <section aria-labelledby="step-dados">
            <h2 id="step-dados" className="step-heading">
              <span className="step-num" aria-hidden="true">
                1
              </span>{' '}
              Seus dados
            </h2>
            <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
              <label className="field">
                <span>Seu nome</span>
                <input
                  className="input"
                  required
                  minLength={2}
                  autoComplete="name"
                  placeholder="Como a gente te chama?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-invalid={name.length > 0 && name.trim().length < 2 ? '' : undefined}
                />
                {name.length > 0 && name.trim().length < 2 ? (
                  <span className="field-error" role="alert">
                    Conta pra gente seu nome.
                  </span>
                ) : null}
              </label>
              <label className="field">
                <span>WhatsApp</span>
                <input
                  className="input"
                  required
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  placeholder="(22) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(maskPhone(e.target.value))}
                  data-invalid={phone.length > 0 && phoneDigits(phone).length < 10 ? '' : undefined}
                />
                {phone.length > 0 && phoneDigits(phone).length < 10 ? (
                  <span className="field-error" role="alert">
                    Informe o WhatsApp com DDD.
                  </span>
                ) : null}
              </label>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section aria-labelledby="step-entrega">
            <h2 id="step-entrega" className="step-heading">
              <span className="step-num" aria-hidden="true">
                2
              </span>{' '}
              Entrega ou retirada
            </h2>
            <div
              className="choices"
              role="radiogroup"
              aria-label="Modo de recebimento"
              style={{ marginTop: 20 }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'delivery'}
                className="choice"
                disabled={!store?.deliveryEnabled}
                onClick={() => setMode('delivery')}
              >
                <span className="choice-dot" aria-hidden="true" />
                <span>
                  <span className="choice-title">
                    <Truck size={15} aria-hidden="true" />
                    Entrega
                  </span>
                  <span className="choice-sub">
                    A gente leva geladinho até você{store?.city ? ` — ${store.city}` : ''}.
                  </span>
                </span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'pickup'}
                className="choice"
                disabled={!store?.pickupEnabled}
                onClick={() => setMode('pickup')}
              >
                <span className="choice-dot" aria-hidden="true" />
                <span>
                  <span className="choice-title">
                    <Store size={15} aria-hidden="true" />
                    Retirada
                  </span>
                  <span className="choice-sub">{store?.address ?? 'Na loja'} — sem taxa.</span>
                </span>
              </button>
            </div>

            {mode === 'delivery' ? (
              <div style={{ marginTop: 20, display: 'grid', gap: 16 }}>
                <label className="field">
                  <span>Bairro</span>
                  <input
                    className="input"
                    required
                    list="qp-bairros"
                    autoComplete="address-level3"
                    placeholder="Centro, Bacaxá, Itaúna…"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                  />
                  <datalist id="qp-bairros">
                    {bairros.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 96px', gap: 12 }}>
                  <label className="field">
                    <span>Rua</span>
                    <input
                      className="input"
                      required
                      autoComplete="address-line1"
                      placeholder="Rua das Amendoeiras"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Número</span>
                    <input
                      className="input"
                      required
                      inputMode="numeric"
                      autoComplete="address-line2"
                      placeholder="120"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                    />
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
                  <label className="field">
                    <span>
                      Complemento <em className="field-opt">(opcional)</em>
                    </span>
                    <input
                      className="input"
                      placeholder="Apto, bloco, referência"
                      value={complement}
                      onChange={(e) => setComplement(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>
                      CEP <em className="field-opt">(opcional)</em>
                    </span>
                    <input
                      className="input"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="28990-000"
                      value={cep}
                      onChange={(e) => setCep(maskCep(e.target.value))}
                    />
                  </label>
                </div>
                <p className="inline-alert info" role="status">
                  {feeCents > 0
                    ? `Taxa para ${neighborhood.trim()}: ${formatBRL(feeCents)}${zoneMin > (totals?.subtotalCents ?? 0) ? ` · pedido mínimo nessa área: ${formatBRL(zoneMin)}` : ''}.`
                    : neighborhood.trim()
                      ? 'Bairro ainda sem taxa calculada — se estiver fora da área, o pedido avisa na confirmação.'
                      : 'Informe o bairro para calcular a taxa de entrega.'}
                </p>
              </div>
            ) : (
              <p className="small muted" style={{ marginTop: 16 }}>
                Retire em {store?.address ?? 'nossa loja'} · preparo em ~
                {store?.prepTimeMinutes ?? 40} min.
              </p>
            )}

            <div className="ficha-hairline" style={{ marginTop: 24, paddingTop: 20 }}>
              <span className="field">
                <span>Quando quer receber?</span>
              </span>
              <div
                className="choices"
                role="radiogroup"
                aria-label="Quando quer receber"
                style={{ marginTop: 8 }}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={!wantsSchedule}
                  className="choice"
                  onClick={() => setWantsSchedule(false)}
                >
                  <span className="choice-dot" aria-hidden="true" />
                  <span>
                    <span className="choice-title">Receber agora</span>
                    <span className="choice-sub">
                      Preparo em ~{store?.prepTimeMinutes ?? 40} min.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={wantsSchedule}
                  className="choice"
                  onClick={() => setWantsSchedule(true)}
                >
                  <span className="choice-dot" aria-hidden="true" />
                  <span>
                    <span className="choice-title">
                      <Calendar size={15} aria-hidden="true" />
                      Agendar encomenda
                    </span>
                    <span className="choice-sub">
                      Pra festa ou data especial, a gente combina pelo WhatsApp.
                    </span>
                  </span>
                </button>
              </div>
              {wantsSchedule ? (
                <p className="inline-alert info" role="status" style={{ marginTop: 12 }}>
                  Encomendas agendadas são combinadas direto com a loja.{' '}
                  {waScheduleLink ? (
                    <a
                      href={waScheduleLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontWeight: 500, textDecoration: 'underline' }}
                    >
                      <MessageCircle
                        size={13}
                        style={{ verticalAlign: '-2px' }}
                        aria-hidden="true"
                      />{' '}
                      Agendar no WhatsApp
                    </a>
                  ) : null}{' '}
                  Você pode concluir este pedido para agora normalmente.
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="step-pagamento">
            <h2 id="step-pagamento" className="step-heading">
              <span className="step-num" aria-hidden="true">
                3
              </span>{' '}
              Pagamento
            </h2>
            <div
              className="choices"
              role="radiogroup"
              aria-label="Forma de pagamento"
              style={{ marginTop: 20 }}
            >
              {(
                [
                  ['pix', 'Pix', 'O jeito mais rápido — combinamos na entrega.', QrCode],
                  ['card_on_delivery', 'Cartão', 'Maquininha na porta ou na retirada.', CreditCard],
                  ['cash', 'Dinheiro', 'Troco? Conta pra gente no WhatsApp.', Banknote],
                ] as const
              ).map(([value, title, sub, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={pay === value}
                  className="choice"
                  onClick={() => setPay(value)}
                >
                  <span className="choice-dot" aria-hidden="true" />
                  <span>
                    <span className="choice-title">
                      <Icon size={15} aria-hidden="true" />
                      {title}
                    </span>
                    <span className="choice-sub">{sub}</span>
                  </span>
                </button>
              ))}
            </div>

            <label className="field" style={{ marginTop: 20 }}>
              <span>
                Observações <em className="field-opt">(opcional)</em>
              </span>
              <textarea
                className="input"
                rows={2}
                enterKeyHint="done"
                placeholder="Sem observações"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{ height: 'auto', paddingBlock: 12, resize: 'vertical' }}
              />
            </label>

            {waLink(store?.whatsapp) ? (
              <p
                className="small muted"
                style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <Ticket size={14} style={{ color: 'var(--caramel-700)' }} aria-hidden="true" />
                Tem cupom?{' '}
                <a
                  href={waLink(store?.whatsapp)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'underline' }}
                >
                  Fale com a loja no WhatsApp
                </a>
                .
              </p>
            ) : null}
          </section>
        ) : null}

        <div className="ficha-hairline" style={{ marginTop: 28, paddingTop: 20 }}>
          <details className="order-details">
            <summary>
              Resumo · {totals?.itemCount ?? 0} {(totals?.itemCount ?? 0) === 1 ? 'doce' : 'doces'}{' '}
              · <span className="tnum">{formatBRL(totalCents)}</span>
            </summary>
            <ol
              style={{
                listStyle: 'none',
                margin: '16px 0 0',
                padding: 0,
                display: 'grid',
                gap: 12,
              }}
            >
              {items.map((item) => (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="cart-thumb" style={{ width: 40, height: 48, borderRadius: 6 }}>
                    <ProductFigure title={item.name} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>
                      {item.qty}× {item.name}
                    </p>
                    {item.modifiers.length > 0 ? (
                      <p className="small muted" style={{ margin: 0, fontSize: '0.75rem' }}>
                        {item.modifiers.map((m) => m.name).join(', ')}
                      </p>
                    ) : null}
                  </div>
                  <span className="tnum small">{formatBRL(item.lineTotalCents)}</span>
                </li>
              ))}
            </ol>
            <dl
              className="ficha-hairline"
              style={{ marginTop: 16, paddingTop: 12, display: 'grid', gap: 8 }}
            >
              <div className="summary-row">
                <dt className="lbl">Subtotal</dt>
                <dd className="val">{formatBRL(totals?.subtotalCents ?? 0)}</dd>
              </div>
              <div className="summary-row">
                <dt className="lbl">Entrega</dt>
                <dd className="val">
                  {syncedMode === 'pickup'
                    ? 'grátis'
                    : feeCents > 0
                      ? formatBRL(feeCents)
                      : 'a confirmar'}
                </dd>
              </div>
              <div className="summary-row summary-total">
                <dt className="lbl" style={{ color: 'var(--zinc-950)', fontWeight: 500 }}>
                  Total
                </dt>
                <dd className="val">{formatBRL(totalCents)}</dd>
              </div>
            </dl>
          </details>

          {totals?.belowMinOrder ? (
            <p className="inline-alert warn" role="status" style={{ marginTop: 16 }}>
              Faltam {formatBRL(totals.remainingMinOrderCents)} para o pedido mínimo de{' '}
              {formatBRL(totals.minOrderCents)}.
            </p>
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            {step > 0 ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setStep((s) => Math.max(0, s - 1));
                  scrollTop();
                }}
              >
                <ArrowLeft size={16} aria-hidden="true" /> Voltar
              </button>
            ) : null}
            <button
              type="submit"
              className="btn"
              style={{ flex: 1, height: 56 }}
              disabled={step === 2 && !canPlace}
            >
              {pending ? (
                <>
                  <Loader2 size={16} className="spin" aria-hidden="true" /> Enviando…
                </>
              ) : step < 2 ? (
                <>
                  Continuar <ArrowRight size={16} aria-hidden="true" />
                </>
              ) : (
                <>
                  Confirmar pedido · {formatBRL(totalCents)}{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}

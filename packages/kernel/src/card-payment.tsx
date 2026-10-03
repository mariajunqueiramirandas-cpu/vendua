import { useEffect, useId, useRef } from 'react';
import type { CardPaymentInput, DeclineReason } from './api.ts';

// Kernel 1.17 — the in-page card. Card number, expiry and CVV live in Mercado Pago's own
// iframes (the Card Payment Brick's Secure Fields); the Kernel only ever sees the single-use
// token the Brick hands back, and Core charges the order's total.

export const DECLINE_COPY: Record<DeclineReason, { title: string; body?: string }> = {
  card_data: { title: 'Confira os dados do cartão' },
  insufficient_funds: { title: 'Saldo ou limite insuficiente', body: 'Tente outro cartão.' },
  call_for_authorize: {
    title: 'O banco pediu para você autorizar a compra',
    body: 'Ligue para ele ou use outro cartão.',
  },
  card_disabled: { title: 'Cartão bloqueado ou inativo', body: 'Fale com o banco ou use outro.' },
  duplicated: {
    title: 'Esse pagamento já foi feito',
    body: 'Confira seu extrato antes de tentar de novo.',
  },
  high_risk: { title: 'O pagamento não foi aprovado', body: 'Tente outro cartão ou Pix.' },
  max_attempts: { title: 'Muitas tentativas com esse cartão', body: 'Use outro.' },
  installments: { title: 'Esse cartão não aceita esse parcelamento' },
  challenge_failed: { title: 'A verificação do banco não foi concluída', body: 'Tente de novo.' },
  other: { title: 'O pagamento não foi aprovado', body: 'Tente outro cartão ou Pix.' },
};

export const declineCopy = (reason: string) =>
  DECLINE_COPY[reason as DeclineReason] ?? DECLINE_COPY.other;

const SDK_SRC = 'https://sdk.mercadopago.com/js/v2';

interface BrickController {
  unmount: () => void;
}
interface MercadoPagoSdk {
  bricks: () => {
    create: (
      brick: 'cardPayment',
      containerId: string,
      settings: Record<string, unknown>,
    ) => Promise<BrickController>;
  };
}
type MercadoPagoCtor = new (publicKey: string, opts: { locale: string }) => MercadoPagoSdk;
type MpGlobals = { MercadoPago?: MercadoPagoCtor; MP_DEVICE_SESSION_ID?: unknown };

let sdk: Promise<MercadoPagoCtor> | null = null;

/** The one script the Kernel injects: Mercado Pago's SDK, once per page; a failure clears the
 *  cache so a retry loads it again. */
export function loadMercadoPago(): Promise<MercadoPagoCtor> {
  const w = globalThis as MpGlobals;
  if (w.MercadoPago) return Promise.resolve(w.MercadoPago);
  sdk ??= new Promise<MercadoPagoCtor>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_SRC;
    s.async = true;
    s.onload = () => (w.MercadoPago ? resolve(w.MercadoPago) : reject(new Error('no SDK')));
    s.onerror = () => {
      s.remove();
      reject(new Error('SDK did not load'));
    };
    document.head.appendChild(s);
  }).catch((err: unknown) => {
    sdk = null;
    throw err;
  });
  return sdk;
}

const deviceId = () => {
  const id = (globalThis as MpGlobals).MP_DEVICE_SESSION_ID;
  return typeof id === 'string' && id ? id : null;
};

function luminance(color: string): number | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  const rgb = hex
    ? (hex.length === 3
        ? [...hex].map((c) => c + c)
        : [0, 2, 4].map((i) => hex.slice(i, i + 2))
      ).map((h) => parseInt(h, 16))
    : /^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(color)?.slice(1).map(Number);
  if (!rgb || rgb.length !== 3) return null;
  return (0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!) / 255;
}

/** The Brick wears the store's resolved tokens (read at mount, so live token edits apply). */
function brickStyle() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--v-${name}`).trim();
  const vars: Record<string, string> = {
    baseColor: v('color-accent'),
    buttonTextColor: v('color-on-accent'),
    textPrimaryColor: v('color-text'),
    textSecondaryColor: v('color-muted'),
    formBackgroundColor: v('color-surface'),
    inputBackgroundColor: v('color-surface'),
    errorColor: v('color-danger'),
    successColor: v('color-success'),
    borderRadiusSmall: v('radius-sm'),
    borderRadiusMedium: v('radius-md'),
    borderRadiusLarge: v('radius-lg'),
    formPadding: '0px',
  };
  const lum = luminance(v('color-surface'));
  return {
    theme: lum !== null && lum < 0.45 ? 'dark' : 'default',
    customVariables: Object.fromEntries(Object.entries(vars).filter(([, x]) => x)),
  };
}

interface CardFieldsProps {
  provider: 'mercadopago' | 'fake';
  publicKey: string;
  amountCents: number;
  submitLabel: string;
  onReady: () => void;
  onError: () => void;
  onSubmit: (input: CardPaymentInput) => Promise<void>;
}

/** One Brick per mount: the order page remounts it (a new `key`) for every attempt, since a
 *  token is single-use. */
export function CardFields(p: CardFieldsProps) {
  const id = `v-card-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const props = useRef(p);
  props.current = p;

  useEffect(() => {
    if (p.provider === 'fake') {
      props.current.onReady();
      return;
    }
    let live = true;
    let brick: BrickController | null = null;
    loadMercadoPago()
      .then((MercadoPago) => {
        if (!live) return;
        const mp = new MercadoPago(p.publicKey, { locale: 'pt-BR' });
        return mp.bricks().create('cardPayment', id, {
          initialization: { amount: p.amountCents / 100 },
          customization: {
            visual: {
              hideFormTitle: true,
              style: brickStyle(),
              texts: { formSubmit: p.submitLabel },
            },
            paymentMethods: { maxInstallments: 12 },
          },
          callbacks: {
            onReady: () => live && props.current.onReady(),
            onError: (e: { type?: string } | undefined) => {
              // non-critical errors are the Brick's own field hints
              if (live && (!e?.type || e.type === 'critical')) props.current.onError();
            },
            onSubmit: (data: BrickCardData) => props.current.onSubmit(fromBrick(data)),
          },
        });
      })
      .then((b) => {
        if (!b) return;
        if (live) brick = b;
        else b.unmount();
      })
      .catch(() => live && props.current.onError());
    return () => {
      live = false;
      brick?.unmount();
    };
    // a new attempt is a new mount; the key/amount never change under one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (p.provider === 'fake') return <FakeCardForm onSubmit={(i) => void p.onSubmit(i)} />;
  return <div id={id} className="v-cardpay-brick" data-vendua="card-fields" />;
}

interface BrickCardData {
  token: string;
  payment_method_id: string;
  issuer_id?: string | number | null;
  installments: number | string;
  payer?: { email?: string; identification?: { type?: string; number?: string } | null };
}

function fromBrick(d: BrickCardData): CardPaymentInput {
  const ident = d.payer?.identification;
  return {
    token: d.token,
    paymentMethodId: d.payment_method_id,
    issuerId: d.issuer_id == null || d.issuer_id === '' ? null : String(d.issuer_id),
    installments: Number(d.installments) || 1,
    payer: {
      email: d.payer?.email ?? '',
      identification:
        ident?.type && ident.number ? { type: ident.type, number: ident.number } : null,
    },
    deviceId: deviceId(),
  };
}

const nonce = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const FAKE_OUTCOMES = [
  ['approved', 'Aprovar'],
  ['rejected-cc_rejected_insufficient_amount', 'Recusar (saldo)'],
  ['challenge', 'Verificação do banco'],
  ['pending', 'Deixar em análise'],
] as const;

/** Dev/CI only (`provider: 'fake'`): no SDK, one button per outcome Core's fake knows. */
function FakeCardForm({ onSubmit }: { onSubmit: (input: CardPaymentInput) => void }) {
  return (
    <div className="v-cardpay-fake" data-vendua="card-fields" data-provider="fake">
      {FAKE_OUTCOMES.map(([outcome, label]) => (
        <button
          key={outcome}
          type="button"
          className="v-btn"
          data-outcome={outcome}
          onClick={() =>
            onSubmit({
              // Core's fake, like Mercado Pago, takes a token once
              token: `fake-card-${outcome}.${nonce()}`,
              paymentMethodId: 'visa',
              issuerId: null,
              installments: 1,
              payer: { email: 'comprador@example.com', identification: null },
              deviceId: null,
            })
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The bank's 3-D Secure, inside the page: a form posts `creq` into the frame at once (the
 *  bank expects the challenge within seconds); the frame says COMPLETE when it ends. */
export function ChallengeFrame({
  url,
  creq,
  onComplete,
}: {
  url: string;
  creq: string;
  onComplete: () => void;
}) {
  const name = `v-3ds-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const form = useRef<HTMLFormElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const done = useRef(onComplete);
  done.current = onComplete;

  useEffect(() => {
    form.current?.submit();
    const onMessage = (e: MessageEvent) => {
      const source = frame.current?.contentWindow;
      if (!source || e.source !== source) return;
      if ((e.data as { status?: unknown } | null)?.status === 'COMPLETE') done.current();
    };
    globalThis.addEventListener('message', onMessage);
    return () => globalThis.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="v-cardpay-challenge" data-vendua="card-challenge">
      <iframe
        ref={frame}
        name={name}
        title="Verificação do seu banco"
        width={500}
        height={600}
        data-part="challenge-frame"
      />
      <form ref={form} method="post" action={url} target={name} hidden>
        <input type="hidden" name="creq" value={creq} />
      </form>
    </div>
  );
}

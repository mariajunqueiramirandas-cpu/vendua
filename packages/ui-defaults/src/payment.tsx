import type { ReactNode } from 'react';
import type { PaymentStatusKind, SlotProps } from '@vendua/kernel';
import { formatCents, PAYMENT_METHOD_LABEL } from '@vendua/kernel/rules';

// checkout.PaymentStatus — one card for every state of an online payment (Mercado
// Pago card checkout, online Pix). The Kernel decides the state and the next step;
// this only says it. Busy states carry a progress rail + copy, never a bare spinner.

type Tone = 'success' | 'info' | 'warning' | 'neutral';

const TONE: Record<PaymentStatusKind, Tone> = {
  redirecting: 'info',
  confirming: 'info',
  due: 'info',
  processing: 'info',
  paid: 'success',
  failed: 'warning',
  expired: 'warning',
  unavailable: 'warning',
  refunded: 'neutral',
};

function copy(p: SlotProps['checkout.PaymentStatus']): { title: string; body?: ReactNode } {
  const pix = p.method === 'pix';
  const amount = formatCents(p.amountCents, p.currency);
  switch (p.status) {
    case 'redirecting':
      return {
        title: 'Levando você ao Mercado Pago…',
        body: 'O cartão é pago no ambiente do Mercado Pago. Depois, você volta para esta página.',
      };
    case 'confirming':
      return pix
        ? { title: 'Gerando seu Pix…', body: 'O código aparece aqui em instantes.' }
        : {
            title: 'Confirmando seu pagamento…',
            body: 'Estamos conferindo com o Mercado Pago.',
          };
    case 'due':
      return pix
        ? { title: 'Falta pagar o Pix', body: `Gere o código para pagar ${amount}.` }
        : {
            title: 'Falta pagar com cartão',
            body: 'Conclua o pagamento no ambiente do Mercado Pago.',
          };
    case 'paid':
      return {
        title: 'Pagamento confirmado',
        body: `${amount} pagos ${pix ? 'no Pix' : 'no cartão'}.`,
      };
    case 'processing':
      return {
        title: 'Pagamento em análise',
        body: 'O Mercado Pago está conferindo o pagamento. Esta página atualiza sozinha quando sair a resposta.',
      };
    case 'failed':
      return pix
        ? { title: 'O Pix não foi concluído', body: 'Gere um novo código para pagar.' }
        : {
            title: 'O pagamento não foi aprovado',
            body: 'Você pode tentar de novo — no Mercado Pago dá para usar outro cartão.',
          };
    case 'expired':
      return {
        title: 'O Pix expirou',
        body: 'O código vale por pouco tempo. Gere um novo para pagar.',
      };
    case 'refunded': {
      const back = formatCents(p.refundedCents ?? p.amountCents, p.currency);
      const partial = p.refundedCents != null && p.refundedCents < p.amountCents;
      return {
        title: partial ? 'Parte do pagamento foi devolvida' : 'Pagamento devolvido',
        body: pix
          ? `${back} devolvidos para a conta que fez o Pix.`
          : `${back} estornados no seu cartão. Quando aparece na fatura depende do banco.`,
      };
    }
    case 'unavailable':
      return {
        title: 'Não conseguimos falar com o Mercado Pago',
        body: p.detail ?? 'Tente de novo em instantes.',
      };
  }
}

export function PaymentStatus(props: SlotProps['checkout.PaymentStatus']) {
  const { status, method, amountCents, currency, action, href, whatsappHref, justPaid } = props;
  const c = copy(props);
  const busy = status === 'redirecting' || status === 'confirming';
  return (
    <section
      className="v-panel v-paystat"
      data-vendua="payment-status"
      data-part="root"
      data-status={status}
      data-tone={TONE[status]}
      data-just-paid={justPaid || undefined}
    >
      <span className="v-paystat-icon" data-part="icon" aria-hidden="true">
        <Icon status={status} />
      </span>
      <div className="v-paystat-text" data-part="text" role="status" aria-busy={busy || undefined}>
        <p className="v-eyebrow v-num" data-part="method">
          {PAYMENT_METHOD_LABEL[method] ?? method}{' '}
          <span className="v-paystat-amount">· {formatCents(amountCents, currency)}</span>
        </p>
        <h2 className="v-panel-title" data-part="title">
          {c.title}
        </h2>
        {c.body ? (
          <p className="v-paystat-body v-muted" data-part="body">
            {c.body}
          </p>
        ) : null}
      </div>
      {busy ? <span className="v-paystat-rail" data-part="progress" aria-hidden="true" /> : null}
      {action || href || whatsappHref ? (
        <div className="v-paystat-actions" data-part="actions">
          {action ? (
            <button
              type="button"
              className="v-btn v-btn-accent"
              data-part="action"
              disabled={action.pending}
              aria-busy={action.pending || undefined}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ) : null}
          {href ? (
            <a className="v-link-btn" data-part="provider-link" href={href}>
              Não abriu? Toque para ir ao Mercado Pago
            </a>
          ) : null}
          {whatsappHref ? (
            <a
              className="v-link-btn"
              data-part="whatsapp"
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              ou combine com a loja pelo WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Icon({ status }: { status: PaymentStatusKind }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (status) {
    case 'paid':
      return (
        <svg {...common} strokeWidth={2.4}>
          <path d="m5.5 12.5 4.2 4.2L18.5 8" />
        </svg>
      );
    case 'redirecting':
      return (
        <svg {...common}>
          <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
          <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
        </svg>
      );
    case 'confirming':
      return (
        <svg {...common}>
          <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
          <path d="M19.5 4.5v4h-4" />
        </svg>
      );
    case 'due':
    case 'processing':
    case 'expired':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case 'refunded':
      return (
        <svg {...common}>
          <path d="M9 13.5 4.5 9 9 4.5" />
          <path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5v5.5" />
          <path d="M12 16.4v.1" />
        </svg>
      );
  }
}

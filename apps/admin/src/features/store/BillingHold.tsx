import { CreditCard } from '@phosphor-icons/react';
import { ApiError } from '../../lib/api.ts';
import { useCan } from '../../lib/session.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { Notice } from '../../ui/Notice.tsx';

export const isBillingHold = (e: unknown) => e instanceof ApiError && e.code === 'BILLING_HOLD';

export const BILLING_HOLD_TEXT =
  'Sua loja abre para pedidos assim que o primeiro pagamento do plano for confirmado.';

/** A self-serve store waits for its first plan payment: say so, and where to pay. */
export function BillingHoldNotice({
  className,
  onNavigate,
}: {
  className?: string | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const owner = useCan('owner');
  return (
    <Notice
      tone="warning"
      icon={<CreditCard weight="fill" />}
      title="Falta pagar o plano"
      className={className}
      action={
        owner ? (
          <ButtonLink to="/conta" size="sm" onClick={onNavigate}>
            ver o plano e pagar
          </ButtonLink>
        ) : undefined
      }
    >
      {BILLING_HOLD_TEXT}
      {owner ? null : ' Peça para quem é dono da loja concluir o pagamento em Conta e plano.'}
    </Notice>
  );
}

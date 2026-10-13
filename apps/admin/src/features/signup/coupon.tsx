import { SealPercent, Ticket, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '../../lib/api.ts';
import { money } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Field, TextInput } from '../../ui/fields.tsx';

// A signup coupon (ADR 0042): free days and/or a discount on the first paid months, made by the
// Venduá team. The draft keeps the code; Core says what it gives on the chosen plan, and checks it
// again (with this WhatsApp's own use of it) when the store is created.

export type CouponData = Awaited<ReturnType<typeof api.signup.coupon>>;

/** the code as Core keeps it: no spaces, upper case */
export const cleanCode = (raw: string) => raw.replace(/\s+/g, '').toUpperCase();

export function useSignupCoupon(code: string | null, planId: string | null) {
  return useQuery({
    queryKey: qk.signupCoupon(code ?? '', planId ?? ''),
    queryFn: () => api.signup.coupon(code!, planId!),
    enabled: !!code && !!planId,
    retry: false,
    staleTime: 60_000,
  });
}

/** why Core refused a code, in the owner's words */
export function couponError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : '';
  switch (code) {
    case 'COUPON_INVALID':
      return 'Não encontramos esse cupom. Confira as letras e os números.';
    case 'COUPON_EXPIRED':
      return 'Esse cupom venceu.';
    case 'COUPON_USED_UP':
      return 'Esse cupom já foi usado.';
    case 'COUPON_PLAN':
      return 'Esse cupom não vale para esse plano. Escolha outro plano ou tire o cupom.';
    case 'COUPON_ALREADY_USED':
      return 'Esse WhatsApp já usou esse cupom em outra loja.';
    case 'COUPON_NEEDS_BILLING':
      return 'Os dias grátis do cupom não valem com código de acesso.';
    case 'RATE_LIMITED':
      return 'Muitas tentativas. Espere um minuto e tente de novo.';
    default:
      return 'Não deu para conferir o cupom agora. Tente de novo.';
  }
}

/** "R$ 34,95/mês nos 2 primeiros meses, depois R$ 69,90/mês" — Core's amounts, only worded here */
export function discountLine(c: CouponData): string | null {
  const d = c.coupon.discount;
  if (!d || c.discountedCents === null) return null;
  const when = d.months === 1 ? 'no primeiro mês' : `nos ${d.months} primeiros meses`;
  return `${money(c.discountedCents)}/mês ${when}, depois ${money(c.priceCents)}/mês`;
}

/**
 * "tenho um cupom" → the field → the applied coupon. `code` is the draft's; `onChange(null)`
 * takes it off.
 */
export function CouponField({
  code,
  planId,
  onChange,
  error,
}: {
  code: string | null;
  planId: string | null;
  onChange: (code: string | null) => void;
  /** Core refused it at the end (POST /signup) */
  error?: string | null | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const q = useSignupCoupon(code, planId);
  const refused = q.isError ? couponError(q.error) : (error ?? null);

  if (code && !refused) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg bg-success-soft p-4 ring-1 ring-success/25"
        role="status"
      >
        <SealPercent weight="duotone" className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            Cupom <span className="font-mono tracking-wide">{code}</span>
          </p>
          <p className="t-body text-muted">{q.data ? q.data.coupon.label : 'conferindo…'}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-my-1 -mr-2 shrink-0"
          aria-label={`tirar o cupom ${code}`}
          onClick={() => {
            onChange(null);
            setTyped('');
            setEditing(false);
          }}
        >
          <X className="size-4" aria-hidden />
          tirar
        </Button>
      </div>
    );
  }

  if (!editing && !code) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-mx-3.5 self-start"
        onClick={() => setEditing(true)}
      >
        <Ticket className="size-4" aria-hidden />
        tenho um cupom
      </Button>
    );
  }

  const apply = () => {
    const c = cleanCode(typed || code || '');
    if (c.length >= 3) onChange(c);
  };
  return (
    <Field label="Cupom" htmlFor="su-coupon" error={refused}>
      <div className="flex gap-2">
        <TextInput
          id="su-coupon"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
          className="font-mono uppercase tracking-wide"
          lead={<Ticket className="size-5" aria-hidden />}
          value={typed || code || ''}
          autoFocus={!code}
          onChange={(e) => {
            setTyped(e.target.value);
            // a refused code goes once the owner starts fixing it
            if (code) onChange(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={cleanCode(typed || code || '').length < 3 || q.isFetching}
          onClick={apply}
        >
          aplicar
        </Button>
      </div>
    </Field>
  );
}

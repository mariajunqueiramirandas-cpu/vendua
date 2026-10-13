import { Gift, Handshake } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';

// A referral link (migration 0120): `?indica=<store address>` from a store's Indique e ganhe, or
// `?parceiro=<code>` from a partner. Core says who it is and, once the phone is confirmed, whether
// its welcome month still holds (once per WhatsApp, never for the store's own owner).

export const cleanReferral = (raw: string) => raw.trim().slice(0, 40);

export function useSignupReferral(
  code: string | null | undefined,
  planId: string | null,
  token: string | null = null,
) {
  return useQuery({
    queryKey: qk.signupReferral(code ?? '', planId ?? '', token ?? ''),
    queryFn: () => api.signup.referral(code!, planId, token),
    enabled: !!code && code.length >= 3,
    retry: false,
    staleTime: 60_000,
  });
}

/** Who sent them, said once above the plans: the gift when it's a store's link. */
export function ReferralNote({
  referral,
}: {
  referral: { kind: 'store' | 'partner'; name: string; welcomeDays: number };
}) {
  const store = referral.kind === 'store';
  const Icon = store ? Gift : Handshake;
  return (
    <div className="flex items-start gap-3 rounded-lg bg-success-soft p-4 text-ink ring-1 ring-success/30">
      <Icon weight="duotone" className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">
          {store ? `Indicação da ${referral.name}` : `Você veio pelo parceiro ${referral.name}`}
        </p>
        <p className="t-body mt-0.5 text-muted">
          {store && referral.welcomeDays > 0
            ? 'Presente da indicação: um mês grátis a mais, sem cartão.'
            : store
              ? 'Esse WhatsApp já ganhou o mês de presente de uma indicação antes.'
              : 'Ele pode te ajudar a montar a loja.'}
        </p>
      </div>
    </div>
  );
}

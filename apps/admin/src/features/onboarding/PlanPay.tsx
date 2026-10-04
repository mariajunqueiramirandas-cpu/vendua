import { ArrowSquareOut, Clock, PixLogo } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, type Account } from '../../lib/api.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useMercadoPago } from '../../lib/mercadopago.ts';
import { Button } from '../../ui/Button.tsx';
import { messageOf, Skeleton } from '../../ui/feedback.tsx';
import { PixCode, useIssuePix } from '../../ui/PixCode.tsx';
import { DocumentGate, needsDocument } from '../account/DocumentGate.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';

// A store born in signup waits behind billing_hold for its first plan payment. The onboarding
// keeps that in view (the merchant may have chosen "montar a loja enquanto isso"), lets the
// owner pay without leaving, and notices by itself when the payment lands.

export type PlanState =
  | { kind: 'none' }
  /** an access code: the team confirms the payment */
  | { kind: 'team' }
  | { kind: 'card'; url: string | null }
  | { kind: 'pix'; invoiceId: string | null };

export function planState(a: Account | undefined): PlanState {
  const s = a?.subscription;
  if (!a || !s || s.status !== 'pending') return { kind: 'none' };
  if (!a.billing.available) return { kind: 'team' };
  if (s.method === 'card') return { kind: 'card', url: s.checkoutUrl };
  const inv = a.invoices.find(
    (i) => (i.status === 'open' || i.status === 'failed') && i.kind !== 'upgrade',
  );
  return { kind: 'pix', invoiceId: inv?.id ?? null };
}

/** The owner's account while the store waits on its first payment (the Shell's live stream isn't here). */
export function usePlan(owner: boolean, hold: boolean) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.account,
    queryFn: api.account,
    enabled: owner && hold,
    refetchInterval: (x) => (x.state.data?.subscription?.status === 'pending' ? 15_000 : false),
    refetchIntervalInBackground: false,
  });
  useMercadoPago(q.data?.billing);
  const was = useRef<string | null>(null);
  const status = q.data?.subscription?.status ?? null;
  useEffect(() => {
    if (was.current === 'pending' && status === 'active') {
      toast('Pagamento confirmado! A loja já pode receber pedidos.', { tone: 'ok' });
      for (const k of [qk.store, qk.home, qk.onboarding])
        void qc.invalidateQueries({ queryKey: k });
    }
    was.current = status;
  }, [status, qc]);
  return q;
}

/** The first month's Pix, issued on demand; the account poll turns it into "pago". */
export function PlanPix({ a, invoiceId }: { a: Account; invoiceId: string | null }) {
  const qc = useQueryClient();
  const inv = a.invoices.find((i) => i.id === invoiceId);
  const issue = useMutation({
    mutationFn: (id: string) => api.invoicePix(id),
    onSuccess: (n) => qc.setQueryData(qk.account, n),
  });
  const gate = needsDocument(a);
  useIssuePix(inv, inv?.status !== 'paid' && !issue.isPending && !gate, issue.mutate);
  if (gate && inv?.status !== 'paid') return <DocumentGate />;
  if (!inv)
    return (
      <p className="t-body text-muted">
        A fatura aparece em instantes. Ela também fica em Conta e plano.
      </p>
    );
  if (inv.pix)
    return (
      <div className="space-y-3">
        <PixCode
          copyPaste={inv.pix.copyPaste}
          amountCents={inv.amountCents}
          expiresAt={inv.pix.expiresAt}
          onRenew={() => issue.mutate(inv.id)}
          renewing={issue.isPending}
        />
        <p className="t-body flex items-center gap-2 text-muted" role="status">
          <span
            className="animate-pulse-dot size-2.5 shrink-0 rounded-full bg-[var(--chart)]"
            aria-hidden
          />
          Quando o pagamento cair, a loja abre sozinha.
        </p>
      </div>
    );
  if (issue.error)
    return (
      <div role="alert" className="space-y-3">
        <p className="t-body text-danger">{messageOf(issue.error)}</p>
        <Button size="sm" loading={issue.isPending} onClick={() => issue.mutate(inv.id)}>
          tentar de novo
        </Button>
      </div>
    );
  return (
    <div
      className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]"
      role="status"
      aria-label="gerando o Pix"
    >
      <Skeleton className="mx-auto size-44" delay={0} />
      <div className="space-y-3">
        <Skeleton className="h-10 w-32" delay={0} />
        <Skeleton className="h-12 w-full" delay={0} />
      </div>
    </div>
  );
}

/** A slim line under the header while the store waits for its plan: what's missing, one tap to pay. */
export function PlanBanner({ owner, hold }: { owner: boolean; hold: boolean }) {
  const account = usePlan(owner, hold);
  const [open, setOpen] = useState(false);
  if (!hold) return null;
  const st = owner ? planState(account.data) : { kind: 'team' as const };
  if (owner && (!account.data || st.kind === 'none')) return null;
  const text =
    !owner || st.kind === 'team'
      ? 'A loja abre para pedidos quando o pagamento do plano for confirmado.'
      : st.kind === 'card'
        ? 'A loja abre quando o Mercado Pago confirmar o cartão.'
        : 'A loja abre quando o Pix do plano cair.';
  return (
    <div className="border-b border-line bg-warning-soft">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-8">
        <Clock weight="bold" className="size-5 shrink-0 text-warning" aria-hidden />
        <p className="t-body min-w-0 flex-1 text-ink">{text}</p>
        {st.kind === 'pix' ? (
          <Button size="sm" icon={<PixLogo />} onClick={() => setOpen(true)}>
            pagar agora
          </Button>
        ) : st.kind === 'card' && st.url ? (
          <Button
            size="sm"
            icon={<ArrowSquareOut />}
            onClick={() => window.location.assign(st.url!)}
          >
            autorizar
          </Button>
        ) : null}
      </div>
      {st.kind === 'pix' && account.data ? (
        <Sheet
          open={open}
          onOpenChange={setOpen}
          title="O primeiro mês do plano"
          description="Pague com o app do banco. A loja abre assim que cair."
        >
          {open ? <PlanPix a={account.data} invoiceId={st.invoiceId} /> : null}
        </Sheet>
      ) : null}
    </div>
  );
}

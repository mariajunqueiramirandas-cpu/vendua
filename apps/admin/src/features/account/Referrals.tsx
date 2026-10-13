import { CheckCircle, Copy, Gift, Hourglass, WhatsappLogo } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import { dateShort } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Divided } from '../../ui/Card.tsx';
import { ErrorState, Skeleton } from '../../ui/feedback.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Chip } from './domain/kit.tsx';

// Indique e ganhe (migration 0120): the store's own link to signup. The store it brings gets a
// month free on top of its trial; once that store pays its first month, this one gets its next
// month free (Core moves the Pix charge a month on, or gives a card charge back).

export function Referrals() {
  const q = useQuery({ queryKey: qk.referrals, queryFn: api.referrals });
  if (q.error && !q.data) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-44 w-full" />;
  const r = q.data;
  const url = `${window.location.origin}/admin/comecar?indica=${encodeURIComponent(r.code)}`;
  const text = `Uso o Venduá na minha loja e recomendo. Criando a sua por este link, você ganha um mês grátis além do teste: ${url}`;
  const earned = r.appliedMonths + r.pendingMonths;
  return (
    <Card className="overflow-hidden">
      <div className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 -rotate-6 place-items-center rounded-full bg-spark text-on-spark"
          >
            <Gift weight="duotone" className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Um mês grátis para cada loja que você trouxer</p>
            <p className="t-body mt-0.5 text-muted">
              Quem criar a loja pelo seu link ganha um mês a mais, sem cartão. Quando ela pagar o
              primeiro mês, o seu próximo mês fica por nossa conta.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-md bg-sunken p-2 pl-4">
          <span className="tnum min-w-0 flex-1 truncate font-semibold">
            {url.replace(/^https?:\/\//, '')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy />}
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => toast('Link copiado'))
            }
          >
            copiar
          </Button>
        </div>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
          className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-whatsapp px-4 text-on-whatsapp"
        >
          <WhatsappLogo weight="fill" className="size-5" /> mandar no WhatsApp
        </a>
      </div>
      {r.stores.length ? (
        <>
          <div className="flex items-baseline justify-between gap-3 border-t border-line px-5 py-3">
            <p className="t-label">
              {r.stores.length} {r.stores.length === 1 ? 'loja indicada' : 'lojas indicadas'}
            </p>
            {earned ? (
              <p className="t-caption text-muted">
                {earned} {earned === 1 ? 'mês ganho' : 'meses ganhos'}
                {r.pendingMonths ? ` · ${r.pendingMonths} na próxima cobrança` : ''}
              </p>
            ) : null}
          </div>
          <Divided>
            {r.stores.map((s) => (
              <div
                key={`${s.name}-${s.joinedAt}`}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{s.name}</span>
                  <span className="t-caption block text-muted">
                    entrou em {dateShort(s.joinedAt)}
                  </span>
                </span>
                {s.rewarded ? (
                  <Chip tone="success" icon={CheckCircle}>
                    assinou: mês ganho
                  </Chip>
                ) : (
                  <Chip tone="neutral" icon={Hourglass}>
                    no teste
                  </Chip>
                )}
              </div>
            ))}
          </Divided>
        </>
      ) : null}
    </Card>
  );
}

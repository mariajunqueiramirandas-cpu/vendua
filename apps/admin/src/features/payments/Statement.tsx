import {
  CaretLeft,
  CaretRight,
  CreditCard,
  DownloadSimple,
  PixLogo,
  Receipt,
} from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type Payments as PaymentsData,
  type Statement,
  type StatementTotals,
} from '../../lib/api.ts';
import { money, plural, when } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { ArtChart } from '../../ui/illustrations.tsx';
import { attemptMeta, MetaChip } from '../../ui/PaymentChip.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone, RowsSkeleton, SkeletonGroup } from '../../ui/skeletons.tsx';

/** "setembro" · "setembro de 2025" (the year only when it isn't this one) */
export function monthName(ym: string, withYear?: boolean) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y!, m! - 1, 15);
  const sameYear = y === new Date().getFullYear();
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
  }).format(d);
}

function shift(ym: string, by: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y!, m! - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Core's month numbers, as they came: nothing here adds them up. */
function Totals({ t, big }: { t: StatementTotals; big?: boolean }) {
  return (
    <div>
      <p className="t-caption text-muted">Você recebe</p>
      <p className={cn('tnum font-display font-semibold', big ? 't-display' : 't-title-1')}>
        {money(t.netCents)}
      </p>
      <dl className="t-body mt-3 space-y-1.5">
        <div className="flex justify-between gap-3 text-muted">
          <dt>Vendas ({plural(t.count, 'pagamento', 'pagamentos')})</dt>
          <dd className="tnum">{money(t.grossCents)}</dd>
        </div>
        <div className="flex justify-between gap-3 text-muted">
          <dt>Taxa do Mercado Pago</dt>
          <dd className="tnum">−{money(t.providerFeeCents)}</dd>
        </div>
        {t.applicationFeeCents ? (
          <div className="flex justify-between gap-3 text-muted">
            <dt>Taxa Venduá</dt>
            <dd className="tnum">−{money(t.applicationFeeCents)}</dd>
          </div>
        ) : null}
      </dl>
      {/* Core's net is before refunds: a minus line under it would read as already taken out */}
      {t.refundedCents ? (
        <p className="t-body mt-3 flex justify-between gap-3 border-t border-line pt-3 text-muted">
          <span>Devolvido a clientes no mês</span>
          <span className="tnum">{money(t.refundedCents)}</span>
        </p>
      ) : null}
    </div>
  );
}

/** "Este mês" on Pagamentos: the month so far, and the way into the statement. */
export function MonthCard({ data }: { data: PaymentsData }) {
  const [open, setOpen] = useState(false);
  const m = data.month;
  return (
    <>
      <Card className="p-5">
        {m.count ? (
          <Totals t={m} />
        ) : (
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
              <Receipt weight="duotone" className="size-6" />
            </span>
            <p className="t-body min-w-0 pt-2 text-muted">
              Nenhum pagamento online em {monthName(m.month)} ainda. Quando um cliente pagar pelo
              Mercado Pago, o valor aparece aqui.
            </p>
          </div>
        )}
        <Button variant="secondary" block className="mt-5" onClick={() => setOpen(true)}>
          {m.count ? 'ver extrato' : 'ver meses anteriores'}
        </Button>
      </Card>
      <StatementSheet open={open} onOpenChange={setOpen} current={m.month} />
    </>
  );
}

function StatementSheet({
  open,
  onOpenChange,
  current,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: string;
}) {
  const [month, setMonth] = useState(current);
  const { data, error, refetch, isPlaceholderData } = useQuery({
    queryKey: qk.statement(month),
    queryFn: () => api.statement(month),
    enabled: open,
    // the last month's rows stay while the next one loads
    placeholderData: keepPreviousData,
  });
  const latest = month >= current;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Extrato do Mercado Pago" wide>
      <div className="space-y-5 pt-1">
        <div className="flex items-center gap-2 rounded-md bg-sunken p-1">
          <IconButton label="mês anterior" onClick={() => setMonth((m) => shift(m, -1))}>
            <CaretLeft weight="bold" />
          </IconButton>
          <p className="t-label flex-1 text-center first-letter:uppercase" aria-live="polite">
            {monthName(month, true)}
          </p>
          <IconButton
            label="próximo mês"
            disabled={latest}
            onClick={() => setMonth((m) => shift(m, 1))}
          >
            <CaretRight weight="bold" />
          </IconButton>
        </div>

        {error && !data ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : !data ? (
          <StatementSkeleton />
        ) : (
          <div
            className={cn('space-y-5 transition-opacity', isPlaceholderData && 'opacity-60')}
            aria-busy={isPlaceholderData || undefined}
          >
            {data.payments.length ? (
              <>
                <Totals t={data.totals} big />
                {/* Core writes the spreadsheet, money included: the month as shown, row by row */}
                <a
                  href={`/admin/v1/payments/statement.csv?month=${data.month}`}
                  download
                  className="press t-label inline-flex min-h-12 items-center gap-2 rounded-md px-4 ring-1 ring-line-strong hover:bg-hover"
                >
                  <DownloadSimple className="size-5" aria-hidden /> baixar planilha de{' '}
                  {monthName(data.month)}
                </a>
                <List rows={data.payments} onOpen={() => onOpenChange(false)} />
              </>
            ) : (
              <EmptyState
                art={<ArtChart />}
                title={`Nenhum pagamento em ${monthName(data.month)}`}
                body="Aqui aparecem os pagamentos que chegaram pelo Mercado Pago, com a taxa e o que ficou para você."
                {...(latest
                  ? {}
                  : {
                      action: (
                        <Button variant="secondary" onClick={() => setMonth(current)}>
                          voltar para este mês
                        </Button>
                      ),
                    })}
              />
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function List({ rows, onOpen }: { rows: Statement['payments']; onOpen: () => void }) {
  return (
    <div>
      <p className="t-label mb-2 px-1">Pagamentos</p>
      <ul className="divide-y divide-line overflow-hidden rounded-md ring-1 ring-line">
        {rows.map((p) => {
          const meta = attemptMeta(p.kind, p.status);
          const Icon = p.kind === 'pix' ? PixLogo : CreditCard;
          return (
            <li key={p.id}>
              <Link
                to={`/pedidos/${p.orderId}`}
                onClick={onOpen}
                className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-hover"
              >
                <Icon weight="duotone" className="size-6 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    #{p.orderNumber}
                    <span className="sr-only"> · {p.kind === 'pix' ? 'Pix' : 'cartão'}</span>
                  </span>
                  <span className="t-caption block truncate text-muted">
                    {when(p.approvedAt ?? p.createdAt)}
                  </span>
                  {p.status !== 'approved' ? (
                    <MetaChip meta={meta} className="mt-1 h-6 px-2" />
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="tnum block font-semibold">{money(p.amountCents)}</span>
                  {p.netCents !== null ? (
                    <span className="t-caption tnum block text-muted">
                      fica {money(p.netCents)}
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatementSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonGroup className="space-y-2">
        <Bone className="h-4 w-24" />
        <Bone className="h-10 w-44" />
        <Bone className="mt-3 h-4 w-full" />
        <Bone className="h-4 w-full" />
      </SkeletonGroup>
      <RowsSkeleton rows={5} avatar={false} />
    </div>
  );
}

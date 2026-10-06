import { useQuery } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { api, type CaixaReport as Report } from '../../lib/api.ts';
import { clock, dateShort, money, when } from '../../lib/format.ts';
import { isPlanRequired, useFeature } from '../../lib/session.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { PageHeader } from '../../ui/Page.tsx';
import { PDV_METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { PDV_METHOD_ICON, PDV_METHODS } from '../../ui/pdv/methods.ts';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { qk } from '../../lib/query.ts';
import { Difference, Movements } from './Caixa.tsx';

// The closing report: per method what Core expected, what was counted and the difference, then
// the day's numbers. Everyone sees it once the caixa is closed (attendants counted blind).

export default function CaixaReport() {
  return useFeature('pdv') ? <ReportScreen /> : <LockedPage title="Fechamento" feature="pdv" />;
}

function ReportScreen() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: qk.pdv.session(id), queryFn: () => api.pdv.session(id) });
  const body = (c: React.ReactNode) => (
    <div className="mx-auto w-full max-w-[880px] px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-8">{c}</div>
  );
  if (isPlanRequired(q.error))
    return body(<PlanLocked feature="pdv" reason={reasonOf(q.error)} refresh />);
  if (q.error && !q.data)
    return body(
      <>
        <PageHeader title="Fechamento do caixa" back="/pdv/caixa" />
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      </>,
    );
  if (!q.data)
    return body(
      <>
        <PageHeader title="Fechamento do caixa" back="/pdv/caixa" />
        <DetailSkeleton />
      </>,
    );
  // still open: that's the caixa screen
  if (!('report' in q.data)) return <Navigate to="/pdv/caixa" replace />;
  const r = q.data.report;
  return body(<ReportView r={r} />);
}

function ReportView({ r }: { r: Report }) {
  const total = PDV_METHODS.reduce((n, m) => n + (r.differences[m] ?? 0), 0);
  return (
    <>
      <PageHeader
        title="Fechamento do caixa"
        subtitle={`${dateShort(r.closedAt)}, das ${clock(r.openedAt)} às ${clock(r.closedAt)}`}
        back="/pdv/caixa"
      />
      <div className="space-y-5">
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <div className="min-w-0 flex-1">
            <p className="t-caption text-muted">
              aberto por {r.openedBy} · fechado por {r.closedBy} {when(r.closedAt)}
            </p>
            <p className="t-title-2 mt-0.5">
              {r.salesCount} {r.salesCount === 1 ? 'venda' : 'vendas'}
            </p>
            <p className="t-body tnum mt-1 text-muted">
              Troco inicial {money(r.openingCents)}
              {r.changeCents ? ` · troco dado ${money(r.changeCents)}` : ''}
              {r.serviceCents ? ` · serviço ${money(r.serviceCents)}` : ''}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <p className="t-caption text-muted">No total</p>
            <Difference cents={total} className="h-9 px-3.5 text-[0.9375rem]" />
          </div>
        </Card>

        <section aria-labelledby="conf-t">
          <h2 id="conf-t" className="t-title-2 mb-3 px-1">
            Conferência
          </h2>
          <Card className="overflow-hidden">
            <table className="w-full text-left">
              <caption className="sr-only">esperado, contado e diferença por forma</caption>
              <thead className="t-caption text-muted max-sm:sr-only">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-semibold">
                    Forma
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Esperado
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-semibold">
                    Contado
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">
                    Diferença
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {PDV_METHODS.map((m) => {
                  const Icon = PDV_METHOD_ICON[m];
                  const exp = r.expected?.[m] ?? null;
                  const d = r.differences[m] ?? 0;
                  return (
                    <tr
                      key={m}
                      className="max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:px-4 max-sm:py-3"
                    >
                      <th scope="row" className="px-4 py-3 font-semibold max-sm:flex-1 max-sm:p-0">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon weight="duotone" className="size-5" aria-hidden />
                          {PDV_METHOD_LABEL[m]}
                        </span>
                      </th>
                      <td className="tnum px-2 py-3 text-right text-muted max-sm:order-3 max-sm:w-full max-sm:p-0 max-sm:text-left">
                        <span className="sm:hidden">esperado </span>
                        {exp === null ? '—' : money(exp)}
                        <span className="sm:hidden"> · contado {money(r.counted[m] ?? 0)}</span>
                      </td>
                      <td className="tnum px-2 py-3 text-right max-sm:hidden">
                        {money(r.counted[m] ?? 0)}
                      </td>
                      <td className={cn('px-4 py-3 text-right max-sm:p-0')}>
                        <Difference cents={d} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>

        <Movements movements={r.movements} />

        {r.notes ? (
          <Card className="p-4">
            <p className="t-label">Observação</p>
            <p className="t-body mt-1 whitespace-pre-line">{r.notes}</p>
          </Card>
        ) : null}

        <ButtonLink to="/pdv/caixa" variant="secondary" replace>
          voltar ao caixa
        </ButtonLink>
      </div>
    </>
  );
}

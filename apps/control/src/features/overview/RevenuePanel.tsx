import { Link } from 'react-router-dom';
import type { CustomersOverview } from '@/lib/api.ts';
import { fmtMoney, relDue } from '@/lib/format.ts';
import { Panel } from '@/components/ui/card.tsx';
import { fmtN, RankBars, Stat, SubHead } from './bits.tsx';

export function RevenuePanel({ r }: { r: CustomersOverview['revenue'] }) {
  const plans = [...r.byPlan].sort((a, b) => b.mrrCents - a.mrrCents);
  return (
    <Panel
      title="receita"
      aside="MRR por plano"
      actions={
        <Link to="/lojas/planos" className="text-xs text-muted-foreground hover:text-foreground">
          planos →
        </Link>
      }
      bodyClassName="flex flex-col gap-4"
    >
      {plans.length ? (
        <RankBars
          cols={['lojas', 'MRR']}
          rows={plans.map((p) => ({
            key: p.planId,
            label: p.name,
            value: p.mrrCents,
            cells: [fmtN(p.stores), fmtMoney(p.mrrCents)],
          }))}
        />
      ) : (
        <p className="text-sm text-muted-foreground">nenhuma loja pagante ainda</p>
      )}

      <div className="grid gap-4 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
        <div className="min-w-0">
          <SubHead aside={r.trialsEndingSoon.length ? fmtN(r.trialsEndingSoon.length) : undefined}>
            testes que acabam em 7 dias
          </SubHead>
          {r.trialsEndingSoon.length ? (
            <ul className="-mx-1.5 flex flex-col">
              {r.trialsEndingSoon.map((t) => (
                <li key={t.id}>
                  <Link
                    to={`/lojas/${t.id}`}
                    className="flex h-8 items-center gap-2 rounded-md px-1.5 text-sm hover:bg-hover pointer-coarse:h-10"
                  >
                    <span className="min-w-0 truncate font-medium">{t.name}</span>
                    <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
                      {t.plan}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-warning-foreground tnum">
                      {relDue(t.trialEndsAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">nenhum teste acaba esta semana</p>
          )}
        </div>
        <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-1">
          <Stat
            label="faturas em aberto"
            value={fmtMoney(r.openInvoices.amountCents)}
            hint={`${fmtN(r.openInvoices.count)} ${r.openInvoices.count === 1 ? 'fatura' : 'faturas'} · ${fmtN(r.pastDue)} ${r.pastDue === 1 ? 'loja inadimplente' : 'lojas inadimplentes'}`}
            tone={r.pastDue ? 'bad' : undefined}
          />
          <Stat
            label="últimos 30 dias"
            value={`+${fmtN(r.newStores30d)} / −${fmtN(r.cancelled30d)}`}
            hint="lojas novas / canceladas"
          />
        </div>
      </div>
    </Panel>
  );
}

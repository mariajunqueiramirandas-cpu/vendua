import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { CustomersOverview } from '@/lib/api.ts';
import { EmptyState } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { RiskChips } from './risk.tsx';

export function AtRiskPanel({ rows }: { rows: CustomersOverview['atRisk'] }) {
  return (
    <Panel
      title="lojas em risco"
      aside={rows.length ? String(rows.length) : undefined}
      actions={
        <Link to="/lojas?f=risco" className="text-xs text-muted-foreground hover:text-foreground">
          todas →
        </Link>
      }
      flush
    >
      {rows.length ? (
        <ul className="flex flex-col divide-y">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                to={`/lojas/${s.id}`}
                className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-hover"
              >
                <span className="flex min-w-0 flex-1 basis-32 flex-col">
                  <span className="truncate text-sm font-medium">{s.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.slug}</span>
                </span>
                <RiskChips risk={s.risk} max={3} className="justify-end" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="nenhuma loja em risco"
          hint="cobrança, site, WhatsApp e uso de IA estão em dia em todas as lojas"
          className="py-8"
        />
      )}
    </Panel>
  );
}

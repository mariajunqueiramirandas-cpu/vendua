import { useSearchParams } from 'react-router-dom';
import type { CustomersOverview } from '@/lib/api.ts';
import { fmtMoney } from '@/lib/format.ts';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { DailyBars } from './DailyBars.tsx';
import { fmtN, Stat } from './bits.tsx';

const compactBrl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
const compactN = (n: number) =>
  Math.round(n).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

export function ActivityPanel({
  a,
  activeStores,
}: {
  a: CustomersOverview['activity'];
  activeStores: number;
}) {
  const [sp, setSp] = useSearchParams();
  const gmv = sp.get('g') === 'gmv';
  return (
    <Panel
      title="atividade"
      aside="pedidos nas lojas, 30 dias"
      actions={
        <Segmented
          size="sm"
          value={gmv ? 'gmv' : 'pedidos'}
          onChange={(v) =>
            setSp(
              (prev) => {
                const next = new URLSearchParams(prev);
                if (v === 'gmv') next.set('g', 'gmv');
                else next.delete('g');
                return next;
              },
              { replace: true },
            )
          }
          options={[
            ['pedidos', 'pedidos'],
            ['gmv', 'GMV'],
          ]}
        />
      }
      bodyClassName="flex flex-col gap-3"
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="pedidos" value={fmtN(a.orders30d)} />
        <Stat label="GMV" value={fmtMoney(a.gmv30dCents)} />
        <Stat
          label="lojas com pedido"
          value={fmtN(a.activeStores30d)}
          hint={`de ${fmtN(activeStores)} ativas`}
        />
      </div>
      {gmv ? (
        <DailyBars
          label="em vendas"
          points={a.daily.map((d) => ({ day: d.day, value: d.gmvCents }))}
          fmt={fmtMoney}
          fmtAxis={compactBrl}
        />
      ) : (
        <DailyBars
          label="pedidos"
          points={a.daily.map((d) => ({ day: d.day, value: d.orders }))}
          fmt={fmtN}
          fmtAxis={compactN}
        />
      )}
    </Panel>
  );
}

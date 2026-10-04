import { Link } from 'react-router-dom';
import type { CustomersOverview } from '@/lib/api.ts';
import { fmtUsd } from '@/lib/format.ts';
import { Panel } from '@/components/ui/card.tsx';
import { Allowance, fmtN, RankBars, Stat, SubHead } from './bits.tsx';

export function AiPanel({ ai }: { ai: CustomersOverview['ai'] }) {
  const models = [...ai.byModel].sort((a, b) => b.usd - a.usd).slice(0, 5);
  return (
    <Panel
      title="IA"
      aside="Duá nas lojas"
      actions={
        <Link to="/ia" className="text-xs text-muted-foreground hover:text-foreground">
          uso →
        </Link>
      }
      bodyClassName="flex flex-col gap-4"
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="conversas no mês" value={fmtN(ai.conversationsThisMonth)} />
        <Stat label="gasto 30d" value={fmtUsd(ai.spend30dUsd)} />
        <Stat
          label="lojas sem conversas"
          value={fmtN(ai.exhaustedStores)}
          tone={ai.exhaustedStores ? 'warn' : undefined}
        />
      </div>

      <div>
        <SubHead>gasto por modelo, 30 dias</SubHead>
        {models.length ? (
          <RankBars
            ink="agent"
            cols={['chamadas', 'US$']}
            rows={models.map((m) => ({
              key: `${m.provider}/${m.model}`,
              label: (
                <span title={`${m.provider} · ${m.model}`}>
                  {m.model} <span className="text-xs text-muted-foreground">{m.provider}</span>
                </span>
              ),
              value: m.usd,
              cells: [fmtN(m.calls), m.usd.toFixed(2)],
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">nenhuma chamada de modelo em 30 dias</p>
        )}
      </div>

      <div>
        <SubHead aside="conversas do período, US$ 30d">lojas que mais conversam</SubHead>
        {ai.top.length ? (
          <ul className="-mx-1.5 flex flex-col">
            {ai.top.slice(0, 6).map((s) => (
              <li key={s.id}>
                <Link
                  to={`/lojas/${s.id}`}
                  className="flex h-8 items-center gap-3 rounded-md px-1.5 text-sm hover:bg-hover pointer-coarse:h-10"
                >
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  <Allowance used={s.used} limit={s.limit} />
                  <span className="w-14 shrink-0 text-right text-[13px] tnum">
                    {s.spend30dUsd.toFixed(2)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">nenhuma loja usou a Duá ainda</p>
        )}
      </div>
    </Panel>
  );
}

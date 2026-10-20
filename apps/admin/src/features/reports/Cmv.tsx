import { CookingPot } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { api, type CmvReport } from '../../lib/api.ts';
import { money, num } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { RowsSkeleton } from '../../ui/skeletons.tsx';

// What the period's sales cost (the CMV each sale snapshotted from its fichas técnicas or the
// product's stated cost), and the gross margin left. Core does every sum; this only lays it out.

/** 3250 bp → "32,5%" */
const pct = (bp: number) => `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function CmvSection({
  params,
}: {
  params: { period: string } | { from: string; to: string };
}) {
  const key = 'period' in params ? qk.cmv(params.period) : qk.cmv('custom', params.from, params.to);
  const { data, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => api.cmv(params),
    placeholderData: (prev) => prev,
  });
  return (
    <Section
      id="r-cmv"
      title="Custo e margem"
      hint="O CMV: quanto custou o que você vendeu, pela ficha técnica de cada produto na hora da venda."
    >
      {!data ? (
        <Card className="p-5">
          <RowsSkeleton rows={3} avatar={false} />
        </Card>
      ) : !data.current.costedSalesCents ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="t-body text-muted">
            Nenhuma venda do período tem custo ainda. Monte a ficha técnica dos produtos, ou ponha o
            custo no cálculo de preço, e o CMV aparece aqui a partir das próximas vendas.
          </p>
          <ButtonLink to="/cardapio/insumos" variant="secondary" size="sm" icon={<CookingPot />}>
            ir para Insumos
          </ButtonLink>
        </Card>
      ) : (
        <div className={cn('space-y-4 transition-opacity', isFetching && 'opacity-70')}>
          <Tiles d={data} />
          <Products d={data} />
        </div>
      )}
    </Section>
  );
}

function Tiles({ d }: { d: CmvReport }) {
  const c = d.current;
  const tiles = [
    {
      label: 'CMV',
      value: c.cmvBp != null ? pct(c.cmvBp) : '—',
      detail: `${money(c.costCents)} de custo${c.packagingCents ? `, ${money(c.packagingCents)} de embalagem do pedido` : ''}`,
      prev: d.previous.cmvBp,
      cur: c.cmvBp,
      good: 'down' as const,
    },
    {
      label: 'Margem bruta',
      value: money(c.grossCents),
      detail: c.grossBp != null ? `${pct(c.grossBp)} do que vendeu` : '',
      prev: d.previous.grossBp,
      cur: c.grossBp,
      good: 'up' as const,
    },
    {
      label: 'Compras de insumos',
      value: money(d.purchasesCents),
      detail: d.lossesCents ? `${money(d.lossesCents)} em perdas` : 'nenhuma perda registrada',
      prev: null,
      cur: null,
      good: 'down' as const,
    },
  ];
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => {
          // a change in points of percentage, which Core's two ratios give directly
          const delta = t.prev != null && t.cur != null ? Math.round((t.cur - t.prev) / 100) : null;
          const good = delta !== null && (t.good === 'up' ? delta >= 0 : delta <= 0);
          return (
            <Card key={t.label} className="p-4">
              <span className="t-caption text-muted">{t.label}</span>
              <span className="mt-1 block font-display text-2xl font-semibold tnum">{t.value}</span>
              {t.detail ? <span className="t-caption block text-muted">{t.detail}</span> : null}
              {delta ? (
                <span
                  className={cn('t-caption font-semibold', good ? 'text-success' : 'text-danger')}
                >
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} pontos{' '}
                  <span className="font-normal text-muted">vs. período anterior</span>
                </span>
              ) : null}
            </Card>
          );
        })}
      </div>
      {c.coverageBp != null && c.coverageBp < 10_000 ? (
        <p className="t-caption px-1 text-warning">
          Só {pct(c.coverageBp)} das vendas têm custo: o CMV e a margem contam só elas. Monte a
          ficha dos produtos que faltam.
        </p>
      ) : null}
    </>
  );
}

function Products({ d }: { d: CmvReport }) {
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_5rem] gap-x-4 border-b border-line px-4 py-2.5 sm:grid">
        <span className="t-caption text-muted">Produto</span>
        <span className="t-caption text-right text-muted">Vendeu</span>
        <span className="t-caption text-right text-muted">Custo</span>
        <span className="t-caption text-right text-muted">Margem</span>
      </div>
      <ul className="divide-y divide-line">
        {d.products.map((p) => {
          const partial = p.costCents != null && p.costedSalesCents < p.salesCents;
          return (
            <li
              key={p.key}
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_5rem]"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="t-caption block text-muted">
                  {num(p.qty)}×
                  <span className="sm:hidden">
                    {' · '}
                    {money(p.salesCents)}
                    {' · '}
                    {p.costCents != null ? `custo ${money(p.costCents)}` : 'sem custo'}
                  </span>
                  {partial ? ' · parte das vendas sem custo' : ''}
                </span>
              </span>
              <span className="tnum hidden text-right sm:block">{money(p.salesCents)}</span>
              <span className="tnum hidden text-right sm:block">
                {p.costCents != null ? (
                  money(p.costCents)
                ) : (
                  <span className="text-muted">sem custo</span>
                )}
              </span>
              <span
                className={cn(
                  'tnum text-right font-semibold',
                  p.marginBp == null ? 'text-muted' : p.marginBp < 0 ? 'text-danger' : 'text-ink',
                )}
              >
                {p.marginBp != null ? pct(p.marginBp) : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

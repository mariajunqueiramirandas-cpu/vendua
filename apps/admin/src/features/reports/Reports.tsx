import { DownloadSimple, Info } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Kpis, type Reports as R } from '../../lib/api.ts';
import { dateShort, isoDate, money, moneyCompact, num, plural } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { Card, Section } from '../../ui/Card.tsx';
import { ColumnChart, Funnel, Heatmap, RankBars } from '../../ui/charts.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Loading } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { ArtChart } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';

type Period = 'hoje' | '7d' | '30d' | 'custom';
const METHOD: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
};

function rangeOf(p: Period, custom: { from: string; to: string }) {
  const today = isoDate(new Date());
  if (p === 'custom') return custom;
  const back = p === 'hoje' ? 0 : p === '7d' ? 6 : 29;
  return { from: isoDate(new Date(Date.now() - back * 86_400_000)), to: today };
}

export default function Reports() {
  const [period, setPeriod] = useState<Period>('7d');
  const [custom, setCustom] = useState(() => ({
    from: isoDate(new Date(Date.now() - 13 * 86_400_000)),
    to: isoDate(new Date()),
  }));
  const { from, to } = rangeOf(period, custom);
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: qk.reports(from, to),
    queryFn: () => api.reports(from, to),
    placeholderData: (p) => p,
  });
  return (
    <PageBody wide>
      <PageHeader
        title="Relatórios"
        subtitle={`${dateShort(from)} – ${dateShort(to)}`}
        actions={
          <a
            href={`/admin/v1/reports/orders.csv?from=${from}&to=${to}`}
            className="t-label inline-flex min-h-12 items-center gap-2 rounded-md px-4 ring-1 ring-line-strong hover:bg-hover"
          >
            <DownloadSimple className="size-5" /> baixar planilha
          </a>
        }
      />
      <div className="mb-6 space-y-3">
        <Chips
          label="período"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'hoje', label: 'hoje' },
            { value: '7d', label: '7 dias' },
            { value: '30d', label: '30 dias' },
            { value: 'custom', label: 'personalizado' },
          ]}
        />
        {period === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="date"
              aria-label="de"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              className="w-44"
            />
            <span className="text-muted">até</span>
            <TextInput
              type="date"
              aria-label="até"
              value={custom.to}
              min={custom.from}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              className="w-44"
            />
          </div>
        ) : null}
      </div>
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <Loading lines={4} />
      ) : data.current.orders === 0 && data.funnel.visits === 0 ? (
        <EmptyState
          art={<ArtChart />}
          title="Nada vendido nesse período"
          body="Escolha um período maior ou compartilhe a loja para começar a vender."
        />
      ) : (
        <div className={cn('space-y-8 transition-opacity', isFetching && 'opacity-70')}>
          <KpiRow d={data} />
          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card className="p-5">
              <ColumnChart
                title="Vendas por dia"
                summary={`${money(data.current.revenueCents)} em ${num(data.current.orders)} pedidos. Melhor dia: ${best(data)}.`}
                format={money}
                formatTick={moneyCompact}
                highlightLast={to === isoDate(new Date())}
                data={data.series.map((s) => ({
                  label: dateShort(s.date),
                  short: s.date.slice(8),
                  value: s.revenueCents,
                }))}
              />
            </Card>
            <Card className="p-5">
              <Funnel
                title="Do olhar ao pedido"
                summary={funnelSummary(data)}
                steps={[
                  { label: 'Visitaram a loja', value: data.funnel.visits },
                  { label: 'Viram um produto', value: data.funnel.productViews },
                  { label: 'Montaram sacola', value: data.funnel.carts },
                  { label: 'Foram pagar', value: data.funnel.checkouts },
                  { label: 'Pediram', value: data.funnel.orders },
                ]}
              />
            </Card>
            <Card className="p-5">
              <RankBars
                title="Mais vendidos"
                summary={
                  data.products[0]
                    ? `${data.products[0].name} lidera com ${data.products[0].qty} vendidos.`
                    : 'Sem vendas.'
                }
                valueHead="vendidos"
                format={(v) => `${v}×`}
                rows={data.products.map((p) => ({
                  key: p.key,
                  label: p.name,
                  value: p.qty,
                  detail: money(p.revenueCents),
                  image: p.imageUrl,
                }))}
              />
            </Card>
            <Card className="p-5">
              <Heatmap
                title="Horários de pico"
                summary={peak(data)}
                days={['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']}
                cells={data.hours.map((h) => ({ dow: h.dow, hour: h.hour, value: h.orders }))}
              />
            </Card>
            <Card className="p-5">
              <RankBars
                title="Entrega por área"
                summary={`${data.current.deliveryShare}% dos pedidos foram para entrega.`}
                format={money}
                rows={data.zones.map((z) => ({
                  key: z.name,
                  label: z.name,
                  value: z.revenueCents,
                  detail: `${plural(z.orders, 'pedido', 'pedidos')} · ${money(z.feesCents)} em taxas`,
                }))}
              />
            </Card>
            <Card className="p-5">
              <RankBars
                title="Formas de pagamento"
                summary={
                  data.payments
                    .map((p) => `${METHOD[p.method] ?? p.method}: ${p.orders}`)
                    .join(' · ') || 'Sem vendas.'
                }
                format={money}
                rows={data.payments.map((p) => ({
                  key: p.method,
                  label: METHOD[p.method] ?? p.method,
                  value: p.revenueCents,
                  detail: plural(p.orders, 'pedido', 'pedidos'),
                }))}
              />
            </Card>
          </div>
          {data.coupons.length ? (
            <Section title="Cupons usados">
              <Card className="divide-y divide-line">
                {data.coupons.map((c) => (
                  <div
                    key={c.code}
                    className="flex min-h-14 items-center justify-between gap-3 px-4"
                  >
                    <span className="font-display font-semibold tracking-wide">{c.code}</span>
                    <span className="t-body tnum text-right text-muted">
                      {plural(c.orders, 'pedido', 'pedidos')} · {money(c.revenueCents)} vendidos ·{' '}
                      {money(c.discountCents)} de desconto
                    </span>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}
        </div>
      )}
    </PageBody>
  );
}

function best(d: R) {
  const b = [...d.series].sort((a, b) => b.revenueCents - a.revenueCents)[0];
  return b && b.revenueCents ? `${dateShort(b.date)} (${money(b.revenueCents)})` : '—';
}

function funnelSummary(d: R) {
  if (!d.funnel.visits) return 'Ainda sem visitas medidas nesse período.';
  const rate = ((d.funnel.orders / d.funnel.visits) * 100).toFixed(1).replace('.', ',');
  return `${rate}% de quem visitou fez pedido.`;
}

function peak(d: R) {
  const top = [...d.hours].sort((a, b) => b.orders - a.orders)[0];
  const names = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return top
    ? `O horário mais movimentado é ${names[top.dow]} às ${top.hour}h.`
    : 'Sem pedidos no período.';
}

const KPI: {
  key: keyof Kpis;
  label: string;
  fmt: (v: number) => string;
  explain: string;
  good: 'up' | 'down';
}[] = [
  {
    key: 'revenueCents',
    label: 'Vendas',
    fmt: money,
    explain: 'Soma dos pedidos no período, sem os cancelados.',
    good: 'up',
  },
  {
    key: 'orders',
    label: 'Pedidos',
    fmt: num,
    explain: 'Quantos pedidos foram feitos, sem os cancelados.',
    good: 'up',
  },
  {
    key: 'avgTicketCents',
    label: 'Ticket médio',
    fmt: money,
    explain: 'Quanto cada pedido vale em média.',
    good: 'up',
  },
  {
    key: 'newCustomers',
    label: 'Clientes novos',
    fmt: num,
    explain: 'Quem pediu pela primeira vez na sua loja nesse período.',
    good: 'up',
  },
];

function KpiRow({ d }: { d: R }) {
  const [open, setOpen] = useState<string | null>(null);
  const repeat = d.repeat.customers
    ? Math.round((d.repeat.returning / d.repeat.customers) * 100)
    : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {KPI.map((k) => {
        const cur = d.current[k.key];
        const prev = d.previous[k.key];
        const delta = prev ? Math.round(((cur - prev) / prev) * 100) : null;
        const good = delta !== null && (k.good === 'up' ? delta >= 0 : delta <= 0);
        return (
          <Card key={k.key} className="p-4">
            <button
              type="button"
              onClick={() => setOpen(open === k.key ? null : k.key)}
              className="block w-full text-left"
              aria-expanded={open === k.key}
            >
              <span className="t-caption inline-flex items-center gap-1 text-muted">
                {k.label} <Info className="size-3.5" />
              </span>
              <span className="mt-1 block font-display text-2xl font-semibold">{k.fmt(cur)}</span>
              {delta !== null ? (
                <span
                  className={cn('t-caption font-semibold', good ? 'text-success' : 'text-danger')}
                >
                  {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%{' '}
                  <span className="font-normal text-muted">vs. período anterior</span>
                </span>
              ) : (
                <span className="t-caption text-muted">sem período anterior</span>
              )}
            </button>
            {open === k.key ? <p className="t-caption mt-2 text-muted">{k.explain}</p> : null}
          </Card>
        );
      })}
      <Card className="col-span-2 p-4 lg:col-span-1">
        <span className="t-caption text-muted">Voltaram a pedir</span>
        <span className="mt-1 block font-display text-2xl font-semibold">{repeat}%</span>
        <span className="t-caption text-muted">
          {d.repeat.returning} de {d.repeat.customers} clientes pediram 2+ vezes
        </span>
      </Card>
    </div>
  );
}

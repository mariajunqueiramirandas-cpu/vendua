import { DownloadSimple, Info, MapPin } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Kpis, type Reports as R } from '../../lib/api.ts';
import { dateShort, isoDate, money, moneyCompact, num, plural } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { ButtonLink } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { ColumnChart, Funnel, Heatmap, RankBars } from '../../ui/charts.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { ReportsSkeleton } from '../../ui/skeletons.tsx';
import { DEFAULT_PERIOD, isPeriod, PERIODS, reportsQuery } from './range.ts';

const METHOD: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega',
  cash: 'Dinheiro',
  meal_voucher: 'Vale-refeição',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validRange = (r: { from: string; to: string }) =>
  DAY.test(r.from) && DAY.test(r.to) && r.from >= '2000' && r.from <= r.to;
// presets that end today: the chart's last column is the day still going
const ENDS_TODAY = new Set(['hoje', '7d', '30d', 'mes']);

// a chip chosen from the address may sit past the row's edge: bring it into view once, sideways only
const revealChecked = (row: HTMLElement | null) => {
  const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!row || !chip) return;
  const r = row.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  if (c.left < r.left || c.right > r.right)
    row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
};

/** "sáb, 27 set" or "sáb, 27 set – dom, 5 out" */
const span = (from: string, to: string) =>
  from === to ? dateShort(from) : `${dateShort(from)} – ${dateShort(to)}`;

export default function Reports() {
  // the period lives in the address (?periodo=ontem, ?periodo=custom&de=…&ate=…): back, a reload
  // and a shared link land on the same report
  const [params, setParams] = useSearchParams();
  const p = params.get('periodo');
  const period = isPeriod(p) ? p : DEFAULT_PERIOD;
  const custom = { from: params.get('de') ?? '', to: params.get('ate') ?? '' };
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
        return next;
      },
      { replace: true },
    );
  // typing a date walks through half-dates (year 0002…): ask once the field settles on a real range
  const [settled, setSettled] = useState(custom);
  useEffect(() => {
    const t = setTimeout(() => setSettled({ from: custom.from, to: custom.to }), 400);
    return () => clearTimeout(t);
  }, [custom.from, custom.to]);
  const rq = reportsQuery(period, settled);
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: rq.key,
    queryFn: () => api.reports(rq.params),
    placeholderData: (prev) => prev,
    enabled: period !== 'custom' || validRange(settled),
  });
  const shown = data?.range;
  const choose = (v: (typeof PERIODS)[number]['value']) => {
    if (v !== 'custom')
      return update({ periodo: v === DEFAULT_PERIOD ? null : v, de: null, ate: null });
    // personalizado starts from what's on screen
    const today = isoDate(new Date());
    update({
      periodo: 'custom',
      de: custom.from || shown?.from || today,
      ate: custom.to || shown?.to || today,
    });
  };
  return (
    <PageBody wide>
      <PageHeader
        title="Relatórios"
        subtitle={shown ? span(shown.from, shown.to) : undefined}
        actions={
          <a
            href={`/admin/v1/reports/orders.csv?${new URLSearchParams(rq.params)}`}
            className="t-label inline-flex min-h-12 items-center gap-2 rounded-md px-4 ring-1 ring-line-strong hover:bg-hover"
          >
            <DownloadSimple className="size-5" /> baixar planilha
          </a>
        }
      />
      <div className="mb-6 space-y-3">
        <div ref={revealChecked} className="scroll-row -mx-4 px-4 md:mx-0 md:px-0">
          <Chips
            label="período"
            value={period}
            onChange={choose}
            className="w-max flex-nowrap md:w-auto md:flex-wrap"
            options={PERIODS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </div>
        {period === 'custom' ? (
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="date"
              aria-label="de"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => update({ de: e.target.value })}
              className="w-44"
            />
            <span className="text-muted">até</span>
            <TextInput
              type="date"
              aria-label="até"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => update({ ate: e.target.value })}
              className="w-44"
            />
          </div>
        ) : null}
      </div>
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <ReportsSkeleton chips={false} />
      ) : data.current.orders === 0 && data.funnel.visits === 0 ? (
        <EmptyState
          art={<Mascote pose="sem-pedidos" />}
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
                highlightLast={
                  ENDS_TODAY.has(data.range.period) || data.range.to === isoDate(new Date())
                }
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
                summary={zonesSummary(data)}
                format={money}
                rows={data.zones.map((z) => ({
                  key: z.name,
                  label: z.name,
                  value: z.revenueCents,
                  detail: [
                    plural(z.orders, 'pedido', 'pedidos'),
                    z.quotes
                      ? `${plural(z.quotes, 'consulta de frete', 'consultas de frete')}${z.conversion !== null ? `, ${pct(z.conversion)} virou pedido` : ''}`
                      : 'ninguém consultou o frete',
                    `${money(z.feesCents)} em taxas`,
                  ].join(' · '),
                }))}
              />
            </Card>
            {data.outOfZone.length ? (
              <Card className="p-5">
                <RankBars
                  title="Onde pediram e você não entrega"
                  summary={outOfZoneSummary(data)}
                  valueHead="consultas"
                  format={(v) => plural(v, 'consulta', 'consultas')}
                  rows={data.outOfZone.map((z) => ({
                    key: z.neighborhood,
                    label: z.neighborhood,
                    value: z.quotes,
                  }))}
                />
                <p className="t-caption mt-4 text-muted">
                  Gente que quis entrega nesses lugares e não achou uma área sua.
                </p>
                <ButtonLink
                  to="/loja#entrega"
                  variant="secondary"
                  size="sm"
                  icon={<MapPin />}
                  className="mt-3"
                >
                  ver áreas de entrega
                </ButtonLink>
              </Card>
            ) : null}
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

/** 0.4 → "40%" (Core computes the ratio; this only formats it) */
const pct = (r: number) => `${Math.round(r * 100)}%`;

function zonesSummary(d: R) {
  const base = `${d.current.deliveryShare}% dos pedidos foram para entrega.`;
  const top = [...d.zones]
    .filter((z) => z.conversion !== null && z.quotes >= 3)
    .sort((a, b) => b.conversion! - a.conversion!)[0];
  return top ? `${base} Onde mais vira pedido: ${top.name} (${pct(top.conversion!)}).` : base;
}

function outOfZoneSummary(d: R) {
  const top = d.outOfZone[0];
  if (!top) return '';
  return `${top.neighborhood} lidera, com ${plural(top.quotes, 'consulta', 'consultas')} de frete sem área de entrega.`;
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
            {open === k.key ? (
              <p className="t-caption mt-2 text-muted">
                {k.explain} Comparado com {span(d.range.prevFrom, d.range.prevTo)}.
              </p>
            ) : null}
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

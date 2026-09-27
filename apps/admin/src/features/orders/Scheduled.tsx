import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../lib/api.ts';
import { dateShort, isoDate, money } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Loading } from '../../ui/feedback.tsx';
import { ArtCalendar } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { OrderRowView } from './OrderRowView.tsx';

const WEEK = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** Encomendas as a month calendar: tap a day for its orders (§8 Pedidos). */
export default function Scheduled() {
  const today = isoDate(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const from = isoDate(first);
  const to = isoDate(last);
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.scheduled(from, to),
    queryFn: () => api.scheduled(from, to),
  });
  const byDay = useMemo(() => {
    const out = new Map<string, NonNullable<typeof data>['orders']>();
    for (const o of data?.orders ?? []) {
      const k = o.scheduledFor!;
      out.set(k, [...(out.get(k) ?? []), o]);
    }
    return out;
  }, [data]);
  const cells = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: last.getDate() }, (_, i) => isoDate(new Date(y, m - 1, i + 1))),
  ];
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    setMonth(isoDate(d).slice(0, 7));
  };
  const monthName = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const monthLabel = monthName.charAt(0).toUpperCase() + monthName.slice(1);
  const list = byDay.get(day) ?? [];
  return (
    <PageBody>
      <PageHeader title="Encomendas" subtitle="Pedidos agendados para uma data." back="/pedidos" />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <IconButton label="mês anterior" onClick={() => shift(-1)}>
              <CaretLeft />
            </IconButton>
            <p className="t-title-2">{monthLabel}</p>
            <IconButton label="próximo mês" onClick={() => shift(1)}>
              <CaretRight />
            </IconButton>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEK.map((w, i) => (
              <span key={i} className="t-caption py-1 font-semibold text-muted" aria-hidden>
                {w}
              </span>
            ))}
            {cells.map((c, i) =>
              c ? (
                <button
                  key={c}
                  type="button"
                  onClick={() => setDay(c)}
                  aria-pressed={day === c}
                  aria-label={`${dateShort(c)}: ${byDay.get(c)?.length ?? 0} encomendas`}
                  className={cn(
                    'relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-md tnum transition-colors',
                    day === c ? 'bg-primary text-on-primary' : 'hover:bg-hover',
                    c === today && day !== c && 'ring-2 ring-spark',
                    c < today && day !== c && 'text-muted',
                  )}
                >
                  {Number(c.slice(8))}
                  {byDay.get(c)?.length ? (
                    <span
                      className={cn(
                        'tnum mt-0.5 rounded-full px-1.5 text-[0.6875rem] font-bold leading-4',
                        day === c ? 'bg-spark text-on-spark' : 'bg-info-soft text-info',
                      )}
                    >
                      {byDay.get(c)!.length}
                    </span>
                  ) : null}
                </button>
              ) : (
                <span key={`b${i}`} />
              ),
            )}
          </div>
        </Card>
        <section aria-live="polite">
          <h2 className="t-title-2 mb-3 px-1">
            {dateShort(day)}
            {list.length ? (
              <span className="t-body ml-2 text-muted">
                {money(list.reduce((a, o) => a + o.totalCents, 0))}
              </span>
            ) : null}
          </h2>
          {error ? (
            <ErrorState error={error} retry={() => void refetch()} />
          ) : isPending ? (
            <Loading lines={2} />
          ) : list.length ? (
            <Card className="overflow-hidden">
              <ul>
                {list.map((o) => (
                  <OrderRowView key={o.id} o={o} />
                ))}
              </ul>
            </Card>
          ) : (
            <EmptyState
              art={<ArtCalendar />}
              title="Nenhuma encomenda nesse dia"
              body="Produtos marcados como encomenda aparecem aqui na data escolhida pelo cliente."
            />
          )}
        </section>
      </div>
    </PageBody>
  );
}

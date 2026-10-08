import type { BillingStore, CustomerRow } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDay, fmtMoney } from '@/lib/format.ts';
import { RiskChips } from '@/features/overview/risk.tsx';
import type { Column } from '@/components/DataList.tsx';
import { DOMAIN_STATUS, ORDER_STATUS, SITE_STATUS, StoreLink, Tag } from './bits.tsx';
import { AiMeter, LastOrder, SubChip } from './fleetBits.tsx';

/** A store from `/customers`, with its `/billing/stores` row when that has loaded. */
export interface StoreListRow {
  c: CustomerRow;
  b: BillingStore | undefined;
}

export type StoreFilter =
  '' | 'risco' | 'teste' | 'inadimplentes' | 'canceladas' | 'atencao' | 'dominios' | 'sites';
/** the filters that are a to-do queue, with a column for what's pending */
export type ActionFilter = Extract<StoreFilter, 'atencao' | 'dominios' | 'sites'>;
export const isActionFilter = (f: StoreFilter): f is ActionFilter =>
  f === 'atencao' || f === 'dominios' || f === 'sites';

const subIs = (r: StoreListRow, ...st: string[]) => st.includes(r.c.subscription?.status ?? '');
export const siteOpen = (b: BillingStore | null | undefined) =>
  b?.siteRequest?.status === 'requested' || b?.siteRequest?.status === 'in_progress';
/** a certificate that may be stuck, DNS that broke, or a registrar order that needs a retry */
export const domainToDo = (b: BillingStore | null | undefined) =>
  b?.customDomain?.status === 'dns_ok' ||
  b?.customDomain?.status === 'repairing' ||
  b?.domainOrder?.status === 'conflict' ||
  b?.domainOrder?.status === 'failed';

export const MATCH: Record<StoreFilter, (r: StoreListRow) => boolean> = {
  '': () => true,
  risco: (r) => r.c.risk.some((k) => k !== 'cancelled'),
  teste: (r) => subIs(r, 'trialing'),
  inadimplentes: (r) => subIs(r, 'past_due'),
  canceladas: (r) => subIs(r, 'cancelled'),
  atencao: (r) => subIs(r, 'pending', 'past_due'),
  dominios: (r) => domainToDo(r.b),
  sites: (r) => siteOpen(r.b),
};

const Muted = ({ children = '—' }: { children?: string }) => (
  <span className="text-muted-foreground/70">{children}</span>
);

/** What the to-do filter is about, for this store. */
export function Pending({
  r,
  f,
  label,
}: {
  r: StoreListRow;
  f: ActionFilter;
  label?: boolean | undefined;
}) {
  if (f === 'atencao') {
    const inv = r.c.openInvoice;
    if (!inv) return <Muted />;
    return (
      <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
        {label && <span className="text-xs text-muted-foreground">fatura</span>}
        <span className="font-medium tnum">{fmtMoney(inv.amountCents)}</span>
        {inv.dueAt && (
          <span className="text-xs text-muted-foreground tnum">desde {fmtDay(inv.dueAt)}</span>
        )}
      </span>
    );
  }
  if (f === 'dominios') {
    const d = r.b?.customDomain;
    const o = r.b?.domainOrder;
    // a failed order is the pending thing even when an older domain row exists
    const order = o && (o.status === 'conflict' || o.status === 'failed');
    if (!d && !order) return <Muted />;
    return (
      <span className="flex max-w-[14rem] min-w-0 items-center gap-1.5 lg:max-w-[18rem]">
        {order ? (
          <Tag map={ORDER_STATUS} value={o.status} />
        ) : (
          <Tag map={DOMAIN_STATUS} value={d?.status} />
        )}
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {order ? o.host : d?.host}
        </span>
      </span>
    );
  }
  const s = r.b?.siteRequest;
  if (!s) return <Muted />;
  return (
    <span className="flex max-w-[14rem] min-w-0 items-center gap-1.5 lg:max-w-[18rem]">
      <Tag map={SITE_STATUS} value={s.status} />
      {s.brief && <span className="min-w-0 truncate text-xs text-muted-foreground">{s.brief}</span>}
    </span>
  );
}

/** the subscription chip already says "cancelada" */
const shownRisk = (c: CustomerRow) => c.risk.filter((k) => k !== 'cancelled');

const PENDING_HEADER: Record<ActionFilter, string> = {
  atencao: 'fatura em aberto',
  dominios: 'domínio',
  sites: 'pedido de site',
};

export function storeColumns(f: StoreFilter): Column<StoreListRow>[] {
  const cols: Column<StoreListRow>[] = [
    {
      key: 'store',
      header: 'loja',
      className: 'max-w-[11rem] lg:max-w-[18rem]',
      cell: ({ c }) => (
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium">{c.name}</span>
          <StoreLink store={c} className="max-w-[45%] shrink-0 max-lg:hidden" />
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'plano',
      className: 'whitespace-nowrap',
      cell: ({ c }) => (
        <span className="inline-flex items-center gap-2">
          <span className="max-xl:hidden">{c.plan.name}</span>
          <SubChip sub={c.subscription} />
        </span>
      ),
    },
    {
      key: 'mrr',
      header: 'MRR',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: ({ c }) => (c.mrrCents ? fmtMoney(c.mrrCents) : <Muted />),
    },
    {
      key: 'orders',
      header: 'pedidos 30d',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: ({ c }) =>
        c.orders.count30d ? c.orders.count30d.toLocaleString('pt-BR') : <Muted>0</Muted>,
    },
    {
      key: 'gmv',
      header: 'GMV 30d',
      align: 'end',
      className: 'whitespace-nowrap max-lg:hidden',
      cell: ({ c }) => (c.orders.gmv30dCents ? fmtMoney(c.orders.gmv30dCents) : <Muted />),
    },
    {
      key: 'last',
      header: 'últ. pedido',
      align: 'end',
      className: 'whitespace-nowrap max-xl:hidden',
      cell: ({ c }) => <LastOrder at={c.orders.lastAt} />,
    },
    {
      key: 'ai',
      header: 'IA',
      className: cn('whitespace-nowrap', isActionFilter(f) && 'max-lg:hidden'),
      cell: ({ c }) => <AiMeter ai={c.ai} />,
    },
  ];
  if (isActionFilter(f)) {
    cols.push({
      key: 'pending',
      header: PENDING_HEADER[f],
      className: 'max-w-[16rem]',
      cell: (r) => <Pending r={r} f={f} />,
    });
  } else {
    cols.push({
      key: 'risk',
      header: 'risco',
      className: 'whitespace-nowrap',
      cell: ({ c }) => <RiskChips risk={shownRisk(c)} max={2} className="flex-nowrap" />,
    });
  }
  return cols;
}

export function StoreMobileRow({ r, f }: { r: StoreListRow; f: StoreFilter }) {
  const { c } = r;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{c.name}</span>
        <span
          className={cn('ml-auto shrink-0 text-sm tnum', !c.mrrCents && 'text-muted-foreground/70')}
        >
          {c.mrrCents ? fmtMoney(c.mrrCents) : '—'}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="truncate">{c.plan.name}</span>
          <SubChip sub={c.subscription} />
        </span>
        <span className="tnum">
          {c.orders.count30d.toLocaleString('pt-BR')}{' '}
          {c.orders.count30d === 1 ? 'pedido' : 'pedidos'}
          {c.orders.lastAt && <> · último {<LastOrder at={c.orders.lastAt} />}</>}
        </span>
        {c.ai.included && <AiMeter ai={c.ai} />}
      </div>
      {isActionFilter(f) ? (
        <div className="flex min-w-0 text-sm">
          <Pending r={r} f={f} label />
        </div>
      ) : (
        shownRisk(c).length > 0 && <RiskChips risk={shownRisk(c)} max={3} />
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Store, X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { DataList } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import { FilterChips } from './bits.tsx';
import { riskWeight } from './fleetBits.tsx';
import { useBillingStores, useCustomers } from './queries.ts';
import {
  isActionFilter,
  MATCH,
  storeColumns,
  StoreMobileRow,
  type StoreFilter,
  type StoreListRow,
} from './storeRows.tsx';
import { useStoresTabs } from './tabs.ts';

const FILTERS = Object.keys(MATCH) as StoreFilter[];

const SORTS = [
  ['', 'mais recentes'],
  ['risco', 'risco'],
  ['mrr', 'MRR'],
  ['pedidos', 'pedidos 30d'],
  ['gmv', 'GMV 30d'],
  ['ultimo', 'último pedido'],
  ['ia', 'uso de IA'],
  ['nome', 'nome'],
] as const;
type Sort = (typeof SORTS)[number][0];

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);
/** Descending by a number; `''` keeps Core's order (newest first). */
const SORT_KEY: Record<Exclude<Sort, '' | 'nome'>, (r: StoreListRow) => number> = {
  risco: (r) => riskWeight(r.c.risk),
  mrr: (r) => r.c.mrrCents,
  pedidos: (r) => r.c.orders.count30d,
  gmv: (r) => r.c.orders.gmv30dCents,
  ultimo: (r) => time(r.c.orders.lastAt),
  ia: (r) => (r.c.ai.included ? r.c.ai.used : -1),
};

/** Search box that owns its keystrokes and commits to the URL after a pause. */
function SearchBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const deb = useDebounced(v, 200);
  useEffect(() => void (deb !== value && onCommit(deb)), [deb]);
  useEffect(() => setV(value), [value]);
  return (
    <div className="relative min-w-0 flex-1 md:w-56 md:flex-none 2xl:w-48">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="buscar loja, slug, domínio…"
        aria-label="buscar loja"
        className="pl-8"
      />
    </div>
  );
}

export default function StoresPage() {
  const tabs = useStoresTabs();
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const rawF = sp.get('f') ?? '';
  const f = (FILTERS.includes(rawF as StoreFilter) ? rawF : '') as StoreFilter;
  const rawSort = sp.get('o') ?? '';
  const sort = (SORTS.some(([v]) => v === rawSort) ? rawSort : '') as Sort;
  const q = sp.get('q') ?? '';
  const legacyOpen = sp.get('loja');

  const customers = useCustomers();
  const billing = useBillingStores();
  const all = customers.data;

  const joined = useMemo(() => {
    if (!all) return undefined;
    const byId = new Map((billing.data ?? []).map((b) => [b.tenantId, b]));
    return all.map((c): StoreListRow => ({ c, b: byId.get(c.id) }));
  }, [all, billing.data]);

  const set = (next: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: true },
    );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = (joined ?? []).filter(
      (r) =>
        MATCH[f](r) &&
        (!needle ||
          r.c.name.toLowerCase().includes(needle) ||
          r.c.slug.includes(needle) ||
          !!r.b?.customDomain?.host.includes(needle) ||
          !!r.b?.domainOrder?.host.includes(needle)),
    );
    if (sort === 'nome') return out.sort((a, b) => a.c.name.localeCompare(b.c.name, 'pt-BR'));
    if (sort) {
      const k = SORT_KEY[sort];
      return out.sort((a, b) => k(b) - k(a));
    }
    return out;
  }, [joined, f, q, sort]);

  const columns = useMemo(() => storeColumns(f), [f]);

  // the list used to open a sheet at ?loja=<id>; the store has its own page now
  if (legacyOpen) return <Navigate to={`/lojas/${encodeURIComponent(legacyOpen)}`} replace />;

  const count = (k: StoreFilter) => {
    if (!joined) return undefined;
    if ((k === 'dominios' || k === 'sites') && !billing.data) return undefined;
    return joined.filter(MATCH[k]).length;
  };
  const filtered = !!(f || q);
  const needsBilling = f === 'dominios' || f === 'sites';

  const toolbar = (
    <div className="flex flex-col gap-2 2xl:flex-row 2xl:items-center">
      <FilterChips
        label="filtro"
        value={f}
        onChange={(v) => set({ f: v === f ? null : v || null })}
        options={[
          { value: '', label: 'todas', count: all?.length },
          { value: 'risco', label: 'em risco', count: count('risco'), tone: 'warn' },
          { value: 'teste', label: 'em teste', count: count('teste') },
          {
            value: 'inadimplentes',
            label: 'inadimplentes',
            count: count('inadimplentes'),
            tone: 'warn',
          },
          { value: 'canceladas', label: 'canceladas', count: count('canceladas') },
          { value: 'atencao', label: 'cobrança pendente', count: count('atencao'), tone: 'warn' },
          {
            value: 'dominios',
            label: 'domínio para ativar',
            count: count('dominios'),
            tone: 'warn',
          },
          { value: 'sites', label: 'pedido de site', count: count('sites'), tone: 'warn' },
        ]}
      />
      <div className="flex min-w-0 items-center gap-2 2xl:ml-auto">
        <SearchBox value={q} onCommit={(v) => set({ q: v.trim() || null })} />
        <Select
          aria-label="ordenar por"
          value={sort}
          onChange={(e) => set({ o: e.target.value || null })}
          className="w-36 shrink-0"
        >
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => set({ f: null, q: null })}
            className="max-md:hidden"
          >
            <X /> limpar
          </Button>
        )}
      </div>
    </div>
  );

  let body;
  if (customers.isError && !all) {
    body = <ErrorState error={customers.error} onRetry={() => void customers.refetch()} />;
  } else if (needsBilling && billing.isError && !billing.data) {
    body = <ErrorState error={billing.error} onRetry={() => void billing.refetch()} />;
  } else {
    body = (
      <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
        <DataList
          rows={rows}
          rowKey={(r) => r.c.id}
          columns={columns}
          mobileRow={(r) => <StoreMobileRow r={r} f={f} />}
          onRowClick={(r) => navigate(`/lojas/${r.c.id}`)}
          loading={customers.isPending || (needsBilling && billing.isPending)}
          rowClassName={({ c }) =>
            cn(
              c.subscription?.status === 'past_due' && 'bg-destructive-soft/40',
              c.subscription?.status === 'cancelled' && 'text-muted-foreground',
            )
          }
          empty={
            filtered ? (
              <EmptyState
                title="nada aqui"
                hint={
                  f && !q
                    ? isActionFilter(f)
                      ? 'nenhuma loja precisa disso agora'
                      : 'nenhuma loja nesse filtro'
                    : 'nenhuma loja corresponde à busca'
                }
                action={
                  <Button size="sm" variant="outline" onClick={() => set({ f: null, q: null })}>
                    <X /> limpar filtros
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={Store}
                title="nenhuma loja ainda"
                hint="as lojas aparecem aqui quando alguém assina pelo cadastro"
              />
            )
          }
        />
      </Card>
    );
  }

  return (
    <Page title="Lojas" count={all?.length} tabs={tabs} toolbar={toolbar}>
      {body}
    </Page>
  );
}

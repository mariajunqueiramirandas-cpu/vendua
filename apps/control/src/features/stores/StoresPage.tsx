import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Store, X } from 'lucide-react';
import type { BillingStore } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDate, fmtDay } from '@/lib/format.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  DOMAIN_STATUS,
  FilterChips,
  METHOD_LABEL,
  MP_STATUS,
  SITE_STATUS,
  StoreLink,
  SUB_STATUS,
  Tag,
} from './bits.tsx';
import { useBillingStores } from './queries.ts';
import { StoreSheet } from './StoreSheet.tsx';
import { STORES_TABS } from './tabs.ts';

type StoreFilter = '' | 'atencao' | 'dominios' | 'sites';

const billingIssue = (s: BillingStore) =>
  s.subscription?.status === 'pending' || s.subscription?.status === 'past_due';
const domainReady = (s: BillingStore) => s.customDomain?.status === 'dns_ok';
const siteOpen = (s: BillingStore) =>
  s.siteRequest?.status === 'requested' || s.siteRequest?.status === 'in_progress';

const MATCH: Record<StoreFilter, (s: BillingStore) => boolean> = {
  '': () => true,
  atencao: billingIssue,
  dominios: domainReady,
  sites: siteOpen,
};

function Subscription({ s }: { s: BillingStore }) {
  const sub = s.subscription;
  if (!sub) return <span className="text-xs text-muted-foreground/70">sem assinatura</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Tag map={SUB_STATUS} value={sub.status} />
      <span className="text-xs text-muted-foreground">
        {METHOD_LABEL[sub.method] ?? sub.method}
      </span>
    </span>
  );
}

const COLUMNS: Column<BillingStore>[] = [
  {
    key: 'store',
    header: 'loja',
    className: 'max-w-[16rem]',
    cell: (s) => (
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate font-medium">{s.name}</span>
        <StoreLink store={s} className="shrink-[3]" />
      </div>
    ),
  },
  {
    key: 'plan',
    header: 'plano',
    className: 'whitespace-nowrap',
    cell: (s) => s.plan.name,
  },
  {
    key: 'sub',
    header: 'assinatura',
    className: 'whitespace-nowrap',
    cell: (s) => <Subscription s={s} />,
  },
  {
    key: 'next',
    header: 'próx. cobrança',
    className: 'whitespace-nowrap tnum',
    cell: (s) =>
      s.subscription?.status === 'cancelled' ? (
        <span className="text-muted-foreground/70">—</span>
      ) : (
        fmtDay(s.subscription?.currentPeriodEnd)
      ),
  },
  {
    key: 'mp',
    header: 'mercado pago',
    className: 'whitespace-nowrap',
    cell: (s) => <Tag map={MP_STATUS} value={s.mercadoPago} empty="não conectado" />,
  },
  {
    key: 'domain',
    header: 'domínio',
    className: 'max-w-[14rem]',
    cell: (s) =>
      s.customDomain ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Tag map={DOMAIN_STATUS} value={s.customDomain.status} />
          <span className="min-w-0 truncate text-xs text-muted-foreground max-lg:hidden">
            {s.customDomain.host}
          </span>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/70">—</span>
      ),
  },
  {
    key: 'site',
    header: 'site',
    className: 'whitespace-nowrap',
    cell: (s) => <Tag map={SITE_STATUS} value={s.siteRequest?.status} />,
  },
  {
    key: 'created',
    header: 'criada',
    align: 'end',
    className: 'whitespace-nowrap text-muted-foreground max-xl:hidden',
    cell: (s) => fmtDate(s.createdAt),
  },
];

function MobileRow({ s }: { s: BillingStore }) {
  const flags = [
    s.customDomain?.status === 'dns_ok' && <Tag key="d" map={DOMAIN_STATUS} value="dns_ok" />,
    s.siteRequest && siteOpen(s) && <Tag key="s" map={SITE_STATUS} value={s.siteRequest.status} />,
    s.mercadoPago && s.mercadoPago !== 'connected' && (
      <Tag key="m" map={MP_STATUS} value={s.mercadoPago} />
    ),
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{s.name}</span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.plan.name}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <StoreLink store={s} className="max-w-[45%]" />
        <Subscription s={s} />
        {s.subscription && s.subscription.status !== 'cancelled' && (
          <span className="text-xs text-muted-foreground tnum">
            {fmtDay(s.subscription.currentPeriodEnd)}
          </span>
        )}
      </div>
      {flags.length > 0 && <div className="flex flex-wrap gap-1">{flags}</div>}
    </div>
  );
}

/** Search box that owns its keystrokes and commits to the URL after a pause. */
function SearchBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  const deb = useDebounced(v, 200);
  useEffect(() => void (deb !== value && onCommit(deb)), [deb]);
  useEffect(() => setV(value), [value]);
  return (
    <div className="relative min-w-0 flex-1 md:w-56 md:flex-none">
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
  const [sp, setSp] = useSearchParams();
  const f = (
    ['atencao', 'dominios', 'sites'].includes(sp.get('f') ?? '') ? sp.get('f') : ''
  ) as StoreFilter;
  const q = sp.get('q') ?? '';
  const openId = sp.get('loja');
  const query = useBillingStores();
  const all = query.data;

  const set = (next: Record<string, string | null>, push = false) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v);
          else p.delete(k);
        }
        return p;
      },
      { replace: !push },
    );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter(
      (s) =>
        MATCH[f](s) &&
        (!needle ||
          s.name.toLowerCase().includes(needle) ||
          s.slug.includes(needle) ||
          !!s.customDomain?.host.includes(needle)),
    );
  }, [all, f, q]);

  const count = (fn: (s: BillingStore) => boolean) => all?.filter(fn).length;
  const open = all?.find((s) => s.tenantId === openId) ?? null;
  const filtered = !!(f || q);

  const toolbar = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <FilterChips
        label="filtro"
        value={f}
        onChange={(v) => set({ f: v === f ? null : v || null })}
        options={[
          { value: '', label: 'todas', count: all?.length },
          {
            value: 'atencao',
            label: 'cobrança pendente',
            count: count(billingIssue),
            tone: 'warn',
          },
          {
            value: 'dominios',
            label: 'domínio para ativar',
            count: count(domainReady),
            tone: 'warn',
          },
          { value: 'sites', label: 'pedido de site', count: count(siteOpen), tone: 'warn' },
        ]}
      />
      <div className="flex min-w-0 items-center gap-2 md:ml-auto">
        <SearchBox value={q} onCommit={(v) => set({ q: v.trim() || null })} />
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
  if (query.isError && !all) {
    body = <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  } else {
    body = (
      <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
        <DataList
          rows={rows}
          rowKey={(s) => s.tenantId}
          columns={COLUMNS}
          mobileRow={(s) => <MobileRow s={s} />}
          onRowClick={(s) => set({ loja: s.tenantId }, true)}
          loading={query.isPending}
          rowClassName={(s) =>
            cn(s.subscription?.status === 'past_due' && 'bg-destructive-soft/40')
          }
          empty={
            filtered ? (
              <EmptyState
                title="nada aqui"
                hint={
                  f && !q ? 'nenhuma loja precisa disso agora' : 'nenhuma loja corresponde à busca'
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
    <Page title="Lojas" count={all?.length} tabs={STORES_TABS} toolbar={toolbar}>
      {body}
      <StoreSheet
        store={open}
        open={!!openId}
        loading={query.isPending}
        onClose={() => set({ loja: null })}
      />
    </Page>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Server, X } from 'lucide-react';
import type { FleetStorefront } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { DataList } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, KpiStrip } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { FilterChips } from '@/features/stores/bits.tsx';
import { useStoresTabs } from '@/features/stores/tabs.ts';
import { FleetAlerts, FleetProvisioning } from './FleetAlerts.tsx';
import { COLUMNS, FleetMobileRow } from './FleetList.tsx';
import { FleetSheet } from './FleetSheet.tsx';
import {
  useFleetIncidents,
  useFleetStatus,
  useFleetStorefronts,
  useProvisionings,
} from './queries.ts';

type Filter = '' | 'falhando' | 'pendentes' | 'fixadas' | 'atras';

const MATCH: Record<Filter, (s: FleetStorefront) => boolean> = {
  '': () => true,
  falhando: (s) => s.probe?.status === 'failing',
  pendentes: (s) => s.deployment?.status === 'pending',
  fixadas: (s) => s.policy === 'pinned',
  atras: (s) => s.behind,
};

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

export default function FleetPage() {
  const tabs = useStoresTabs();
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('f') ?? '';
  const f = (raw in MATCH ? raw : '') as Filter;
  const q = sp.get('q') ?? '';
  const openSlug = sp.get('loja');

  const status = useFleetStatus().data;
  const list = useFleetStorefronts();
  const incidents = useFleetIncidents().data ?? [];
  const provisionings = (useProvisionings().data ?? []).filter((p) => p.state !== 'live');
  const all = list.data;

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
  const hrefFor = (slug: string) => {
    const p = new URLSearchParams(sp);
    p.set('loja', slug);
    return `/lojas/frota?${p}`;
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (all ?? []).filter(
      (s) =>
        MATCH[f](s) &&
        (!needle ||
          s.name.toLowerCase().includes(needle) ||
          s.slug.includes(needle) ||
          s.hosts.some((h) => h.includes(needle))),
    );
  }, [all, f, q]);

  const count = (fn: (s: FleetStorefront) => boolean) => all?.filter(fn).length;
  const filtered = !!(f || q);
  const open = all?.find((s) => s.slug === openSlug) ?? null;
  const alerts = status ? status.openIncidents.critical + status.openIncidents.warning : undefined;

  const toolbar = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <FilterChips
        label="filtro"
        value={f}
        onChange={(v) => set({ f: v === f ? null : v || null })}
        options={[
          { value: '', label: 'todas', count: all?.length },
          { value: 'falhando', label: 'falhando', count: count(MATCH.falhando), tone: 'warn' },
          { value: 'pendentes', label: 'pendentes', count: count(MATCH.pendentes), tone: 'warn' },
          { value: 'fixadas', label: 'fixadas', count: count(MATCH.fixadas) },
          { value: 'atras', label: 'atrás', count: count(MATCH.atras), tone: 'warn' },
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

  return (
    <Page title="Lojas" count={all?.length} tabs={tabs} toolbar={toolbar}>
      <div className="flex flex-col gap-3">
        <KpiStrip
          items={[
            {
              label: 'no ar',
              value: status ? `${status.live}/${status.stores}` : '·',
            },
            {
              label: 'sondas falhando',
              value: status?.failingHosts ?? '·',
              tone: status?.failingHosts ? 'bad' : undefined,
              hint: status ? `de ${status.probedHosts} endereços` : undefined,
            },
            {
              label: 'implantações pendentes',
              value: status?.pendingDeployments ?? '·',
              tone: status?.pendingDeployments ? 'warn' : undefined,
            },
            {
              label: 'provisionando',
              value: status?.provisioning ?? '·',
              tone: status?.provisioning ? 'warn' : undefined,
            },
            {
              label: 'alertas abertos',
              value: alerts ?? '·',
              tone: status?.openIncidents.critical ? 'bad' : alerts ? 'warn' : undefined,
            },
          ]}
        />
        {status && !status.probes && (
          <p className="-mt-1 text-xs text-muted-foreground">sondas desligadas neste ambiente</p>
        )}
        <FleetAlerts incidents={incidents} hrefFor={hrefFor} />
        <FleetProvisioning items={provisionings} hrefFor={hrefFor} />
        {list.isError && !all ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : (
          <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
            <DataList
              rows={rows}
              rowKey={(s) => s.tenantId}
              columns={COLUMNS}
              mobileRow={(s) => <FleetMobileRow s={s} />}
              onRowClick={(s) => set({ loja: s.slug }, true)}
              loading={list.isPending}
              rowClassName={(s) => cn(s.probe?.status === 'failing' && 'bg-destructive-soft/40')}
              empty={
                filtered ? (
                  <EmptyState
                    title="nada aqui"
                    hint={
                      f && !q
                        ? 'nenhuma loja nessa situação agora'
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
                    icon={Server}
                    title="nenhuma loja na frota"
                    hint="uma loja entra aqui quando é criada — pelo cadastro ou por um lead"
                  />
                )
              }
            />
          </Card>
        )}
      </div>
      <FleetSheet
        slug={openSlug}
        row={open}
        bundles={status?.bundles ?? []}
        onClose={() => set({ loja: null })}
      />
    </Page>
  );
}

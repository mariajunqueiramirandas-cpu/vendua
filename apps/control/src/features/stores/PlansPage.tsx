import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Layers } from 'lucide-react';
import { toast } from 'sonner';
import type { ControlPlan } from '@/lib/api.ts';
import { fmtMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EditableText } from '@/components/EditableText.tsx';
import { MoneyEdit } from '@/components/MoneyEdit.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Dialog, ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useControlPlans, usePatchPlan } from './queries.ts';
import { STORES_TABS } from './tabs.ts';

interface PriceChange {
  plan: ControlPlan;
  cents: number;
}

/** Inline editors shared by the desktop table cells and the phone sheet. */
function useEditors(askPrice: (c: PriceChange) => void) {
  const patch = usePatchPlan();
  return {
    pending: patch.isPending,
    name: (p: ControlPlan) => (
      <EditableText
        value={p.name}
        label={`nome do plano ${p.id}`}
        className="font-medium"
        onSave={(v) => {
          const name = v?.trim() ?? '';
          if (name.length < 2 || name.length > 40)
            return void toast.error('o nome precisa ter de 2 a 40 caracteres');
          patch.mutate({ id: p.id, name });
        }}
      />
    ),
    price: (p: ControlPlan) => (
      <MoneyEdit
        cents={p.priceCents}
        label={`preço do plano ${p.name}`}
        onSave={(cents) => {
          if (cents == null || cents < 0) return void toast.error('o preço não pode ficar vazio');
          // next tick: the price input unmounts first, or its focus loss dismisses the dialog
          setTimeout(() => askPrice({ plan: p, cents }), 0);
        }}
      />
    ),
    public: (p: ControlPlan) => (
      <Switch
        checked={p.public}
        aria-label={`plano ${p.name} visível no cadastro`}
        disabled={patch.isPending}
        onCheckedChange={(v) => patch.mutate({ id: p.id, public: v })}
      />
    ),
    confirmPrice: (c: PriceChange) => patch.mutate({ id: c.plan.id, priceCents: c.cents }),
  };
}

function Features({ p }: { p: ControlPlan }) {
  const f = p.features ?? { customDomain: false, customSite: false };
  if (!f.customDomain && !f.customSite)
    return <span className="text-xs text-muted-foreground">loja padrão</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {f.customDomain && <Badge variant="outline">domínio próprio</Badge>}
      {f.customSite && <Badge variant="agent-soft">site pelo agente</Badge>}
    </span>
  );
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;

export default function PlansPage() {
  const query = useControlPlans();
  const [sp, setSp] = useSearchParams();
  const [change, setChange] = useState<PriceChange | null>(null);
  const ed = useEditors(setChange);
  const mobile = useIsMobile();
  const plans = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)),
    [query.data],
  );
  const openId = sp.get('plano');
  const open = plans.find((p) => p.id === openId) ?? null;
  const setOpen = (id: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('plano', id);
        else n.delete('plano');
        return n;
      },
      { replace: !id },
    );

  const columns: Column<ControlPlan>[] = [
    {
      key: 'name',
      header: 'plano',
      className: 'max-w-[16rem]',
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          {ed.name(p)}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{p.id}</span>
        </div>
      ),
    },
    { key: 'price', header: 'preço/mês', className: 'whitespace-nowrap', cell: ed.price },
    { key: 'features', header: 'inclui', cell: (p) => <Features p={p} /> },
    {
      key: 'fee',
      header: 'taxa venduá/pedido',
      className: 'whitespace-nowrap text-muted-foreground tnum',
      cell: (p) => pct(p.feeBps),
    },
    {
      key: 'public',
      header: 'no cadastro',
      align: 'end',
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{p.public ? 'visível' : 'oculto'}</span>
          {ed.public(p)}
        </span>
      ),
    },
  ];

  const mobileRow = (p: ControlPlan) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{p.name}</span>
        <span className="ml-auto shrink-0 text-sm tnum">{fmtMoney(p.priceCents)}</span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Features p={p} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {p.public ? 'no cadastro' : 'oculto'}
        </span>
      </div>
    </div>
  );

  return (
    <Page title="Lojas" tabs={STORES_TABS}>
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
            <DataList
              rows={plans}
              rowKey={(p) => p.id}
              columns={columns}
              mobileRow={mobileRow}
              {...(mobile ? { onRowClick: (p: ControlPlan) => setOpen(p.id) } : {})}
              loading={query.isPending}
              empty={<EmptyState icon={Layers} title="nenhum plano cadastrado" />}
            />
          </Card>
          <p className="mt-2 px-0.5 text-xs text-muted-foreground max-md:hidden">
            clique no nome ou no preço para editar · planos ocultos não aparecem no cadastro nem em
            “trocar de plano”
          </p>
        </>
      )}

      <ResponsiveSheet
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.name ?? 'plano'}
        description={open?.id}
      >
        {open && (
          <div className="flex flex-col gap-3">
            <Fact label="nome">{ed.name(open)}</Fact>
            <Fact label="preço por mês">{ed.price(open)}</Fact>
            <div className="flex items-center justify-between gap-3">
              <Fact label="no cadastro">{open.public ? 'visível' : 'oculto'}</Fact>
              {ed.public(open)}
            </div>
            <Fact label="inclui">
              <Features p={open} />
            </Fact>
            <Fact label="taxa venduá por pedido">{pct(open.feeBps)}</Fact>
          </div>
        )}
      </ResponsiveSheet>

      <Dialog
        open={!!change}
        onOpenChange={(o) => !o && setChange(null)}
        title={change ? `mudar o preço do ${change.plan.name}?` : ''}
        description="A mudança vale só para as próximas cobranças."
        footer={
          <>
            <Button variant="outline" onClick={() => setChange(null)}>
              cancelar
            </Button>
            <Button
              disabled={ed.pending}
              onClick={() => {
                if (change) ed.confirmPrice(change);
                setChange(null);
              }}
            >
              mudar preço
            </Button>
          </>
        }
      >
        {change && (
          <div className="flex items-center justify-center gap-3 rounded-lg border bg-secondary py-4 text-lg font-semibold tracking-[-0.02em] tnum">
            <span className="text-muted-foreground line-through decoration-1">
              {fmtMoney(change.plan.priceCents)}
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <span>{fmtMoney(change.cents)}</span>
          </div>
        )}
      </Dialog>
    </Page>
  );
}

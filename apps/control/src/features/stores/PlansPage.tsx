import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Layers } from 'lucide-react';
import { toast } from 'sonner';
import type { ControlPlan } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EditableText, editableValueClass } from '@/components/EditableText.tsx';
import { MoneyEdit } from '@/components/MoneyEdit.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Dialog, ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { useControlPlans, usePatchPlan } from './queries.ts';
import { STORES_TABS } from './tabs.ts';

type Change = { plan: ControlPlan } & (
  { kind: 'price'; cents: number } | { kind: 'trial'; days: number }
);

const TRIAL_MAX = 60;
const trialLabel = (days: number) =>
  days > 0 ? `${days} ${days === 1 ? 'dia' : 'dias'} grátis` : 'sem teste';

/** Click-to-edit trial length in whole days (0 = no trial); out-of-range input is refused. */
function TrialEdit({
  days,
  label,
  onSave,
}: {
  days: number;
  label: string;
  onSave: (days: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const settled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        className={cn(editableValueClass, 'whitespace-nowrap', !days && 'text-muted-foreground')}
        title="clique para editar"
        aria-label={`editar ${label}`}
        onClick={() => {
          settled.current = false;
          setEditing(true);
        }}
      >
        {trialLabel(days)}
      </button>
    );
  }
  const commit = (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const v = raw === '' ? 0 : Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > TRIAL_MAX)
      return void toast.error(`o teste vai de 0 a ${TRIAL_MAX} dias`);
    if (v !== days) onSave(v);
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Input
        autoFocus
        inputMode="numeric"
        aria-label={label}
        defaultValue={String(days)}
        className="w-16 tnum"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            settled.current = true;
            setEditing(false);
          }
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value.trim());
        }}
        onBlur={(e) => commit(e.target.value.trim())}
      />
      dias
    </span>
  );
}

/** Inline editors shared by the desktop table cells and the phone sheet. */
function useEditors(ask: (c: Change) => void) {
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
          setTimeout(() => ask({ kind: 'price', plan: p, cents }), 0);
        }}
      />
    ),
    trial: (p: ControlPlan) => (
      <TrialEdit
        days={p.trialDays ?? 0}
        label={`dias de teste grátis do plano ${p.name}`}
        onSave={(days) => setTimeout(() => ask({ kind: 'trial', plan: p, days }), 0)}
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
    confirm: (c: Change) =>
      patch.mutate(
        c.kind === 'price'
          ? { id: c.plan.id, priceCents: c.cents }
          : { id: c.plan.id, trialDays: c.days },
      ),
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
  const [change, setChange] = useState<Change | null>(null);
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
    { key: 'trial', header: 'teste grátis', className: 'whitespace-nowrap', cell: ed.trial },
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
          {p.trialDays > 0 && `${trialLabel(p.trialDays)} · `}
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
            clique no nome, no preço ou no teste para editar · planos ocultos não aparecem no
            cadastro nem em “trocar de plano”
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
            <Fact label="teste grátis">{ed.trial(open)}</Fact>
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
        title={
          !change
            ? ''
            : change.kind === 'price'
              ? `mudar o preço do ${change.plan.name}?`
              : `mudar o teste grátis do ${change.plan.name}?`
        }
        description={
          change?.kind === 'trial'
            ? 'Vale para as lojas que se cadastrarem daqui em diante. Quem já está em teste mantém a data.'
            : 'A mudança vale só para as próximas cobranças.'
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setChange(null)}>
              cancelar
            </Button>
            <Button
              disabled={ed.pending}
              onClick={() => {
                if (change) ed.confirm(change);
                setChange(null);
              }}
            >
              {change?.kind === 'trial' ? 'mudar teste' : 'mudar preço'}
            </Button>
          </>
        }
      >
        {change && (
          <div className="flex items-center justify-center gap-3 rounded-lg border bg-secondary py-4 text-lg font-semibold tracking-[-0.02em] tnum">
            <span className="text-muted-foreground line-through decoration-1">
              {change.kind === 'price'
                ? fmtMoney(change.plan.priceCents)
                : trialLabel(change.plan.trialDays ?? 0)}
            </span>
            <ArrowRight className="size-4 text-muted-foreground" />
            <span>
              {change.kind === 'price' ? fmtMoney(change.cents) : trialLabel(change.days)}
            </span>
          </div>
        )}
      </Dialog>
    </Page>
  );
}

import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layers, Pencil } from 'lucide-react';
import type { ControlPlan } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtMoney } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { editableValueClass } from '@/components/EditableText.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, Fact } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { ResponsiveSheet } from '@/components/ui/overlay.tsx';
import { AiPacksPanel } from './AiPacksPanel.tsx';
import { PlanChangeDialog } from './PlanChangeDialog.tsx';
import { FEATURES, trialLabel, usePlanEditors, type Change } from './planEdit.tsx';
import { useControlPlans } from './queries.ts';
import { STORES_TABS } from './tabs.ts';

const included = (p: ControlPlan) => FEATURES.filter((f) => p.features?.[f.key]);

function Features({ p }: { p: ControlPlan }) {
  const on = included(p);
  if (!on.length)
    return <span className="text-xs whitespace-nowrap text-muted-foreground">loja padrão</span>;
  return (
    <>
      {/* narrower tables get the count; the sheet has the full list */}
      <span className="text-sm whitespace-nowrap @6xl:hidden">
        {on.length} {on.length === 1 ? 'recurso' : 'recursos'}
      </span>
      <span className="inline-flex flex-wrap gap-1 @max-6xl:hidden">
        {on.map((f) => (
          <Badge
            key={f.key}
            variant={f.key === 'vendedor' ? 'agent-soft' : 'outline'}
            title={f.label}
          >
            {f.short}
          </Badge>
        ))}
      </span>
    </>
  );
}

function RecommendedBadge() {
  return (
    <Badge variant="solid" className="shrink-0">
      recomendado
    </Badge>
  );
}

/** Label + hint on the left, its switch on the right — the sheet's toggle rows. */
function SwitchRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR')}%`;

export default function PlansPage() {
  const query = useControlPlans();
  const [sp, setSp] = useSearchParams();
  const [change, setChange] = useState<Change | null>(null);
  const showHidden = sp.get('ocultos') === '1';
  const setParam = (k: string, v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: k === 'ocultos' || !v },
    );
  // a plan hidden from here stays on screen (dimmed) instead of vanishing under the filter
  const ed = usePlanEditors(setChange, () => setParam('ocultos', '1'));
  const mobile = useIsMobile();
  const all = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id)),
    [query.data],
  );
  const hiddenCount = all.filter((p) => !p.public).length;
  const plans = showHidden ? all : all.filter((p) => p.public);
  const open = all.find((p) => p.id === sp.get('plano')) ?? null;
  const setOpen = (id: string | null) => setParam('plano', id);

  const columns: Column<ControlPlan>[] = [
    {
      key: 'name',
      header: 'plano',
      className: 'max-w-[16rem]',
      cell: (p) => (
        <div className="flex min-w-0 items-center gap-2">
          {ed.name(p)}
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground @max-4xl:hidden">
            {p.id}
          </span>
          {p.recommended && (
            <span className="@4xl:hidden">
              <RecommendedBadge />
            </span>
          )}
          {!p.available && <span className="shrink-0 text-xs text-muted-foreground">fechado</span>}
        </div>
      ),
    },
    { key: 'price', header: 'preço/mês', className: 'whitespace-nowrap', cell: ed.price },
    { key: 'trial', header: 'teste grátis', className: 'whitespace-nowrap', cell: ed.trial },
    {
      key: 'ai',
      header: (
        <>
          Duá<span className="@max-5xl:hidden">/mês</span>
        </>
      ),
      className: 'whitespace-nowrap @max-3xl:hidden',
      cell: (p) => ed.ai(p, 'aiConversations'),
    },
    {
      key: 'aiTrial',
      header: 'no teste',
      className: 'whitespace-nowrap @max-5xl:hidden',
      cell: (p) => ed.ai(p, 'aiTrialConversations'),
    },
    {
      key: 'features',
      header: 'inclui',
      className: '@6xl:w-full @6xl:min-w-[16rem]',
      cell: (p) => (
        <button
          type="button"
          className={cn(editableValueClass, 'group gap-2 py-1')}
          title="editar recursos"
          aria-label={`editar recursos do plano ${p.name}`}
          onClick={() => setOpen(p.id)}
        >
          <Features p={p} />
          <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
        </button>
      ),
    },
    {
      key: 'recommended',
      header: 'recomendado',
      className: 'whitespace-nowrap @max-4xl:hidden',
      cell: ed.recommended,
    },
    {
      key: 'public',
      header: (
        <>
          <span className="@max-6xl:hidden">no cadastro</span>
          <span className="@6xl:hidden">cadastro</span>
        </>
      ),
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (p) => (
        <span className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground @max-6xl:hidden">
            {p.public ? 'visível' : 'oculto'}
          </span>
          {ed.public(p)}
        </span>
      ),
    },
  ];

  const mobileRow = (p: ControlPlan) => {
    const n = included(p).length;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{p.name}</span>
          {p.recommended && <RecommendedBadge />}
          <span className="ml-auto shrink-0 text-sm tnum">{fmtMoney(p.priceCents)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">
            {p.features?.vendedor
              ? `Duá ${p.aiConversations.toLocaleString('pt-BR')}/mês`
              : 'sem Duá'}
            {` · ${n} ${n === 1 ? 'recurso' : 'recursos'}`}
          </span>
          <span className="ml-auto shrink-0">
            {[
              p.trialDays > 0 && trialLabel(p.trialDays),
              !p.available && 'fechado',
              !p.public && 'oculto',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>
    );
  };

  return (
    <Page title="Lojas" tabs={STORES_TABS}>
      {query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Panel
              flush
              title="planos"
              actions={
                hiddenCount > 0 && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    mostrar ocultos ({hiddenCount})
                    <Switch
                      checked={showHidden}
                      onCheckedChange={(v) => setParam('ocultos', v ? '1' : null)}
                    />
                  </label>
                )
              }
              className="overflow-hidden"
            >
              {/* columns drop by the panel's width (the sidebar eats into lg), the sheet has them all */}
              <div className="@container">
                <DataList
                  rows={plans}
                  rowKey={(p) => p.id}
                  columns={columns}
                  mobileRow={mobileRow}
                  rowClassName={(p) => (p.public ? undefined : 'opacity-55')}
                  {...(mobile ? { onRowClick: (p: ControlPlan) => setOpen(p.id) } : {})}
                  loading={query.isPending}
                  empty={<EmptyState icon={Layers} title="nenhum plano no cadastro" />}
                />
              </div>
            </Panel>
            <p className="px-0.5 text-xs text-muted-foreground max-md:hidden">
              clique num valor para editar · recursos e limites do Duá mudam na hora para as lojas
              do plano · planos ocultos não aparecem no cadastro nem em “trocar de plano”
            </p>
          </div>
          <AiPacksPanel />
        </div>
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
            <div className="grid grid-cols-2 gap-3">
              <Fact label="preço por mês">{ed.price(open)}</Fact>
              <Fact label="teste grátis">{ed.trial(open)}</Fact>
            </div>
            <div className="flex flex-col">
              <SwitchRow label="recomendado" hint="pré-selecionado no cadastro e no site">
                {ed.recommended(open)}
              </SwitchRow>
              <SwitchRow label="no cadastro" hint={open.public ? 'visível' : 'oculto'}>
                {ed.public(open)}
              </SwitchRow>
              <SwitchRow
                label="aberto para assinatura"
                hint={
                  open.available
                    ? 'as lojas podem escolher'
                    : 'aparece no site e no cadastro, mas ninguém escolhe'
                }
              >
                {ed.available(open)}
              </SwitchRow>
            </div>
            <SheetSection title="Duá">
              <div className="grid grid-cols-2 gap-3 py-1">
                <Fact label="conversas por mês">{ed.ai(open, 'aiConversations')}</Fact>
                <Fact label="no teste grátis">{ed.ai(open, 'aiTrialConversations')}</Fact>
              </div>
              {!open.features?.vendedor && (
                <p className="text-xs text-muted-foreground">
                  o plano não inclui o Duá — os limites só valem com ele ligado
                </p>
              )}
            </SheetSection>
            <SheetSection title="recursos">
              {FEATURES.map((f) => (
                <SwitchRow key={f.key} label={f.label} hint={f.hint}>
                  {ed.feature(open, f.key)}
                </SwitchRow>
              ))}
            </SheetSection>
            <SheetSection title="cobrança">
              <Fact label="taxa venduá por pedido">{pct(open.feeBps)}</Fact>
            </SheetSection>
          </div>
        )}
      </ResponsiveSheet>

      <PlanChangeDialog
        change={change}
        pending={ed.pending}
        onCancel={() => setChange(null)}
        onConfirm={ed.confirm}
      />
    </Page>
  );
}

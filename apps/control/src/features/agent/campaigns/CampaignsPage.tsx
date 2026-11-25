import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Rocket } from 'lucide-react';
import type { CampaignSummary } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtUsdCents, rel } from '@/lib/format.ts';
import { useIsDesktop } from '@/lib/hooks.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Page } from '@/components/Page.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { AgentStatusPill } from '../AgentStatusPill.tsx';
import { AGENT_TABS } from '../tabs.ts';
import {
  CampaignProgressBar,
  CampaignStatusBadge,
  goalRatioText,
  PreflightBanner,
} from './bits.tsx';
import { CampaignDetail } from './CampaignDetail.tsx';
import { CampaignFormSheet } from './CampaignFormSheet.tsx';
import { useCampaigns, type CampaignFilter } from './queries.ts';

const FILTER_OPTS = [
  ['open', 'abertas'],
  ['all', 'todas'],
  ['won', 'vencidas'],
  ['ended', 'encerradas'],
] as const;

function parseFilter(raw: string | null): CampaignFilter {
  if (raw === 'open' || raw === 'all' || raw === 'won' || raw === 'ended') return raw;
  return 'all';
}

function CampaignRowContent({ c }: { c: CampaignSummary }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {c.title}
        </span>
        <CampaignStatusBadge status={c.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tnum">
        <span className="font-medium text-foreground/80">
          {goalRatioText(c.goalKind, c.goalProgress, c.goalTarget)}
        </span>
        <span>
          · {fmtUsdCents(c.spentCents)} / {fmtUsdCents(c.budgetCents)}
        </span>
        {c.wip && (
          <span>
            · WIP {c.wip.activeWip}/{c.targetWip}
          </span>
        )}
        <span className="ml-auto">{rel(c.lastTickAt ?? c.createdAt)}</span>
      </div>
      <CampaignProgressBar
        value={c.goalProgress}
        max={c.goalTarget}
        tone={c.status === 'won' ? 'live' : c.status === 'active' ? 'agent' : 'warn'}
      />
    </div>
  );
}

/** Agente → Campanhas: goal-driven multi-day sales campaigns with live WIP, guardrails, and steering. */
export default function CampaignsPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const desktop = useIsDesktop();
  const [sheetOpen, setSheetOpen] = useState(false);

  const filter = parseFilter(sp.get('f'));
  const listQ = useCampaigns(filter);

  const campaigns = useMemo(() => {
    const rows = listQ.data?.campaigns ?? [];
    if (filter === 'ended')
      return rows.filter((c) => c.status === 'stopped' || c.status === 'exhausted');
    return rows;
  }, [listQ.data?.campaigns, filter]);

  const preflight = listQ.data?.preflight;

  const qs = filter === 'all' ? '' : `?f=${filter}`;
  const openCampaign = (cid: string) => nav(`/agente/campanhas/${cid}${qs}`);

  // On desktop, auto-select the first visible campaign when visiting `/agente/campanhas` bare.
  const selectedId = id ?? (desktop ? campaigns[0]?.id : undefined);

  useEffect(() => {
    if (desktop && !id && campaigns[0]?.id) {
      nav(`/agente/campanhas/${campaigns[0].id}${qs}`, { replace: true });
    }
  }, [desktop, id, campaigns, nav, qs]);

  const setFilter = (next: CampaignFilter) => {
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        if (next === 'all') n.delete('f');
        else n.set('f', next);
        return n;
      },
      { replace: true },
    );
  };

  // Mobile detail route: dedicated page with back chevron (no hidden desktop pane).
  if (!desktop && id) {
    const current = campaigns.find((c) => c.id === id);
    return (
      <Page
        title={current?.title ?? 'Campanha'}
        back={`/agente/campanhas${qs}`}
        actions={<AgentStatusPill />}
      >
        <CampaignDetail id={id} />
      </Page>
    );
  }

  const mobileCols: Column<CampaignSummary>[] = [
    {
      key: 'campaign',
      header: 'campanha',
      cell: (c) => <CampaignRowContent c={c} />,
    },
  ];

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented size="sm" value={filter} onChange={setFilter} options={FILTER_OPTS} />
      <div className="ml-auto flex items-center gap-2">
        {preflight && (
          <span className="hidden text-xs text-muted-foreground sm:inline tnum">
            {preflight.activeCampaigns}/3 ativas
            {preflight.whatsappColdCap > 0 && preflight.whatsappColdRemaining !== null
              ? ` · WA ${preflight.whatsappColdRemaining}/${preflight.whatsappColdCap} frios`
              : ''}
          </span>
        )}
        <Button size="sm" variant="agent" onClick={() => setSheetOpen(true)}>
          <Plus /> nova campanha
        </Button>
      </div>
    </div>
  );

  return (
    <Page title="Agente" tabs={AGENT_TABS} toolbar={toolbar} actions={<AgentStatusPill />}>
      <div className="flex flex-col gap-3">
        {preflight && <PreflightBanner preflight={preflight} />}

        {listQ.isLoading && !listQ.data ? (
          <LoadingRows rows={5} />
        ) : listQ.error ? (
          <ErrorState error={listQ.error} onRetry={() => void listQ.refetch()} />
        ) : campaigns.length === 0 ? (
          <Panel>
            <EmptyState
              icon={Rocket}
              title={
                filter === 'all' ? 'nenhuma campanha criada ainda' : 'nenhuma campanha neste filtro'
              }
              hint="crie uma campanha autônoma aqui ou peça direto no Telegram (ex: “continue trabalhando até conseguir 1 cadastro”)"
              action={
                <Button size="sm" variant="agent" onClick={() => setSheetOpen(true)}>
                  <Plus /> nova campanha
                </Button>
              }
            />
          </Panel>
        ) : desktop ? (
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
            <Panel flush title="campanhas" aside={`${campaigns.length}`}>
              <ul className="divide-y">
                {campaigns.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openCampaign(c.id)}
                        className={cn(
                          'block w-full px-3 py-2.5 text-left transition-colors hover:bg-hover',
                          active && 'bg-secondary/70',
                        )}
                      >
                        <CampaignRowContent c={c} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
            {selectedId ? (
              <CampaignDetail key={selectedId} id={selectedId} />
            ) : (
              <Panel>
                <EmptyState
                  icon={Rocket}
                  title="selecione uma campanha"
                  hint="clique em uma campanha à esquerda para ver o placar, playbook, buscas e leads"
                />
              </Panel>
            )}
          </div>
        ) : (
          <Panel flush>
            <DataList
              rows={campaigns}
              rowKey={(c) => c.id}
              columns={mobileCols}
              onRowClick={(c) => openCampaign(c.id)}
              mobileRow={(c) => <CampaignRowContent c={c} />}
            />
          </Panel>
        )}
      </div>

      <CampaignFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        preflight={preflight}
        onCreated={(cid) => openCampaign(cid)}
      />
    </Page>
  );
}

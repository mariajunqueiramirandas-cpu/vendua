import { useParams, useSearchParams } from 'react-router-dom';
import { UserX } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useIsDesktop, useIsWide } from '@/lib/hooks.ts';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { CountDot } from '@/components/ui/badge.tsx';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/controls.tsx';
import { AgentPanel } from './agent/AgentPanel.tsx';
import { isMissing } from './agent/shared.tsx';
import { LeadActions } from './LeadActions.tsx';
import { LeadConversations } from './LeadConversations.tsx';
import { LeadFacts } from './LeadFacts.tsx';
import { LeadActionBar, LeadSummaryBar } from './LeadMobile.tsx';
import { LeadTasks } from './LeadTasks.tsx';
import { LeadTimeline } from './LeadTimeline.tsx';
import { useLead, useLeadThreads, usePatchLead, type LeadPatch } from './queries.ts';

type TabId = 'resumo' | 'atividade' | 'tarefas' | 'conversas' | 'agente';
type Layout = 'wide' | 'desktop' | 'narrow';

const TABS: Record<Layout, TabId[]> = {
  wide: ['atividade', 'tarefas', 'conversas'],
  desktop: ['atividade', 'tarefas', 'conversas', 'agente'],
  narrow: ['resumo', 'atividade', 'tarefas', 'agente'],
};

export default function LeadPage() {
  const { id = '' } = useParams();
  const wide = useIsWide();
  const desktop = useIsDesktop();
  const layout: Layout = wide ? 'wide' : desktop ? 'desktop' : 'narrow';
  const { data: lead, error, refetch } = useLead(id);
  const patchLead = usePatchLead(id);
  const patch = (p: LeadPatch) => patchLead.mutate(p);

  if (!lead) {
    return (
      <Page title="Lead" back="/pipeline">
        {error && isMissing(error) ? (
          <EmptyState icon={UserX} title="lead não encontrado" hint="pode ter sido arquivado" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <LoadingRows />
        )}
      </Page>
    );
  }

  return (
    <Page
      bleed
      back="/pipeline"
      title={
        <>
          {lead.name}
          {lead.businessName && (
            <span className="ml-2 text-sm font-normal text-muted-foreground max-lg:hidden">
              {lead.businessName}
            </span>
          )}
        </>
      }
      actions={<LeadActions lead={lead} />}
    >
      {layout === 'narrow' ? (
        <>
          <LeadSummaryBar lead={lead} />
          <LeadTabs lead={lead} layout={layout} patch={patch} />
          <LeadActionBar lead={lead} />
        </>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="dados do lead"
            className="w-[300px] shrink-0 overflow-y-auto border-r bg-card"
          >
            {lead.businessName && (
              <p className="truncate px-3 pt-2.5 text-sm font-medium lg:hidden">
                {lead.businessName}
              </p>
            )}
            <LeadFacts lead={lead} patch={patch} />
          </aside>
          <LeadTabs lead={lead} layout={layout} patch={patch} />
          {layout === 'wide' && (
            <aside
              aria-label="agente"
              className="w-[320px] shrink-0 overflow-y-auto border-l bg-card"
            >
              <AgentPanel lead={lead} patch={patch} />
            </aside>
          )}
        </div>
      )}
    </Page>
  );
}

function LeadTabs({
  lead,
  layout,
  patch,
}: {
  lead: LeadListItem;
  layout: Layout;
  patch: (p: LeadPatch) => void;
}) {
  const [sp, setSp] = useSearchParams();
  const { data: threads } = useLeadThreads(lead.id);
  const tabs = TABS[layout];
  const raw = sp.get('t') as TabId | null;
  const tab = raw && tabs.includes(raw) ? raw : tabs[0]!;
  const setTab = (t: string) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === tabs[0]) next.delete('t');
        else next.set('t', t);
        return next;
      },
      { replace: true },
    );

  const narrow = layout === 'narrow';
  const label: Record<TabId, string> = {
    resumo: 'resumo',
    atividade: narrow ? 'atividade' : 'linha do tempo',
    tarefas: 'tarefas',
    conversas: 'conversas',
    agente: 'agente',
  };
  // drafts waiting on staff get the attention dot; plain totals stay quiet
  const quiet: Partial<Record<TabId, number>> = {
    tarefas: lead.openTasks,
    conversas: threads?.length ?? 0,
  };
  // flat rails (sections with their own padding) vs. padded reading column
  const flat = (t: TabId) => t === 'resumo' || t === 'agente';

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabsList className="shrink-0 px-2 md:px-3">
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t}>
            {label[t]}
            {t === 'conversas' && lead.pendingDrafts ? (
              <CountDot n={lead.pendingDrafts} />
            ) : quiet[t] ? (
              <span className="text-xs text-muted-foreground tnum">{quiet[t]}</span>
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent
          key={t}
          value={t}
          className={cn('min-h-0 flex-1 overflow-y-auto outline-none', flat(t) && 'bg-card')}
        >
          <div className={cn('mx-auto w-full', flat(t) ? 'max-w-2xl' : 'max-w-3xl p-3 md:p-4')}>
            {t === 'resumo' && <LeadFacts lead={lead} patch={patch} />}
            {t === 'atividade' && <LeadTimeline leadId={lead.id} />}
            {t === 'tarefas' && <LeadTasks leadId={lead.id} />}
            {t === 'conversas' && <LeadConversations leadId={lead.id} />}
            {t === 'agente' && <AgentPanel lead={lead} patch={patch} />}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

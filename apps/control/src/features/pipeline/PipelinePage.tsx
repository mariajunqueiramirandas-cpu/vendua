import { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, KanbanSquare, List, Plus, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { LEAD_STATES } from '@/lib/labels.ts';
import { useStats } from '@/lib/queries.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Board } from './Board.tsx';
import { LeadsList } from './LeadsList.tsx';
import { NewLeadSheet } from './NewLeadSheet.tsx';
import { leadQuery, usePipelineParams } from './params.ts';
import { useBoardLeads, useLeadList, useMoveLead } from './queries.ts';
import { StageChips, PipelineToolbar } from './Toolbar.tsx';
import { PIPELINE_TABS } from './tabs.ts';

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))].sort();

export default function PipelinePage() {
  const p = usePipelineParams();
  const { view, filters } = p;
  const mobile = useIsMobile();
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const stats = useStats().data;

  const listParams = useMemo(() => leadQuery(filters), [filters]);
  // columns ARE the stages — the board filters by everything but state
  const boardParams = useMemo(() => leadQuery(filters, false), [filters]);
  const list = useLeadList(listParams, view === 'list');
  const board = useBoardLeads(boardParams, view === 'board');
  const move = useMoveLead(boardParams);

  const leads: LeadListItem[] = useMemo(
    () =>
      view === 'board' ? (board.data ?? []) : (list.data?.pages.flatMap((pg) => pg.leads) ?? []),
    [view, board.data, list.data],
  );

  // Values the filters and new-lead datalists offer — what's already in the pipe.
  const knownTags = useMemo(() => uniq(leads.flatMap((l) => l.tags)), [leads]);
  const knownSegments = useMemo(
    () => uniq([...leads.map((l) => l.segment), ...(stats?.bySegment.map((s) => s.key) ?? [])]),
    [leads, stats],
  );
  const knownSources = useMemo(
    () => uniq([...leads.map((l) => l.source), ...(stats?.bySource.map((s) => s.key) ?? [])]),
    [leads, stats],
  );
  // Stage counts come from stats — pipeline-wide, not just the loaded page.
  const total = stats ? Object.values(stats.byState).reduce((a, s) => a + s.count, 0) : undefined;

  const importCsv = async (file: File) => {
    try {
      const res = await api.importCsv(await file.text());
      toast.success(`${res.created} criados · ${res.skipped.length} ignorados`);
      void client.invalidateQueries({ queryKey: qk.leads() });
      void client.invalidateQueries({ queryKey: qk.stats() });
    } catch (e) {
      toast.error(`importação falhou: ${errorMessage(e)}`);
    }
  };
  const pickCsv = () => fileRef.current?.click();

  // phones pick one board column through the stage chips; `state` doubles as that pick
  const boardStage = (LEAD_STATES.find(([v]) => v === filters.state)?.[0] ??
    'lead') as LeadListItem['state'];

  let chips = null;
  if (view === 'list') {
    chips = (
      <StageChips
        value={filters.state}
        onChange={(v) => p.setFilter('state', v === filters.state ? '' : v)}
        options={[
          { value: '', label: 'todos', count: total },
          ...LEAD_STATES.map(([v, label]) => ({
            value: v,
            label,
            count: stats?.byState[v]?.count ?? (stats ? 0 : undefined),
          })),
        ]}
      />
    );
  } else if (mobile) {
    chips = (
      <StageChips
        value={boardStage}
        onChange={(v) => p.setFilter('state', v)}
        options={LEAD_STATES.map(([v, label]) => ({
          value: v,
          label,
          count: board.data ? board.data.filter((l) => l.state === v).length : undefined,
        }))}
      />
    );
  }

  const emptyAll = (
    <EmptyState
      title={p.filtered ? 'nada aqui' : 'funil vazio'}
      hint={
        p.filtered
          ? 'nenhum lead corresponde aos filtros'
          : 'importe uma planilha, cadastre o primeiro ou rode uma descoberta'
      }
      action={
        p.filtered ? (
          <Button size="sm" variant="outline" onClick={p.clearFilters}>
            <X /> limpar filtros
          </Button>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={pickCsv}>
              <Upload /> importar csv
            </Button>
            <Button size="sm" onClick={p.openNew}>
              <Plus /> novo lead
            </Button>
          </>
        )
      }
    />
  );

  return (
    <Page
      title="Pipeline"
      count={view === 'board' ? board.data?.length : total}
      tabs={PIPELINE_TABS}
      actions={
        <>
          <Segmented
            size="sm"
            value={view}
            onChange={p.setView}
            options={[
              [
                'list',
                <>
                  <List aria-label="lista" />
                  <span className="max-md:sr-only">lista</span>
                </>,
              ],
              [
                'board',
                <>
                  <KanbanSquare aria-label="quadro" />
                  <span className="max-md:sr-only">quadro</span>
                </>,
              ],
            ]}
          />
          <Button variant="ghost" size="sm" className="max-md:hidden" onClick={pickCsv}>
            <Upload /> importar
          </Button>
          <Button variant="ghost" size="sm" className="max-md:hidden" asChild>
            <a href="/control/v1/leads/export" download="leads.csv">
              <Download /> exportar
            </a>
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // same file can be picked again
              if (file) void importCsv(file);
            }}
          />
        </>
      }
      toolbar={<PipelineToolbar p={p} chips={chips} tags={knownTags} onImport={pickCsv} />}
    >
      {view === 'list' ? (
        <LeadsList query={list} p={p} onImport={pickCsv} />
      ) : board.isPending ? (
        <LoadingRows />
      ) : board.isError && !board.data ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : !board.data?.length ? (
        emptyAll
      ) : (
        <div className={cn(board.isPlaceholderData && 'opacity-60 transition-opacity')}>
          <Board leads={board.data} stage={boardStage} move={move} />
        </div>
      )}

      <NewLeadSheet
        open={p.novo}
        onClose={p.closeNew}
        segments={knownSegments}
        sources={knownSources}
      />
    </Page>
  );
}

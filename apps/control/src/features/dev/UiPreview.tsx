import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Filter, Mail, MessageCircle, Plus, Upload } from 'lucide-react';
import { api, type LeadListItem } from '@/lib/api.ts';
import { fmtMoney, fmtUsdCents, rel, relDue, isLate } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { useStats } from '@/lib/queries.ts';
import { cn } from '@/lib/cn.ts';
import { Page } from '@/components/Page.tsx';
import { DataList } from '@/components/DataList.tsx';
import { Avatar, KpiStrip, ScoreBar, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';

/** Living style reference (route /_ui, not in nav): shared components over real data. */
export default function UiPreview() {
  const nav = useNavigate();
  const stats = useStats();
  const leads = useQuery({
    queryKey: qk.leads({ limit: '12' }),
    queryFn: () => api.leads({ limit: '12' }),
  });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'lista' | 'quadro'>('lista');
  const s = stats.data;

  return (
    <Page
      title="Leads"
      count={s?.total}
      actions={
        <div className="hidden items-center gap-1.5 md:flex">
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              ['lista', 'Lista'],
              ['quadro', 'Quadro'],
            ]}
          />
          <Button variant="outline" size="sm">
            <Upload /> Importar
          </Button>
          <Button size="sm">
            <Plus /> Novo lead
          </Button>
        </div>
      }
      toolbar={
        <div className="flex items-center gap-2">
          <div className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
            {(['todos', 'lead', 'contacted', 'invited', 'live'] as const).map((st, i) => (
              <button
                key={st}
                type="button"
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground',
                  i === 0 && 'bg-secondary text-foreground',
                )}
              >
                {st === 'todos' ? (
                  'Todos'
                ) : (
                  <StateChip state={st} className="bg-transparent px-0" />
                )}
                <span className="text-xs text-muted-foreground tnum">
                  {st === 'todos' ? (s?.total ?? '') : (s?.byState[st]?.count ?? 0)}
                </span>
              </button>
            ))}
          </div>
          <Input placeholder="Buscar leads…" className="hidden w-56 md:block md:h-7" />
          <Button variant="outline" size="sm">
            <Filter /> Filtros
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {s && (
          <KpiStrip
            items={[
              { label: 'Leads ativos', value: s.total, to: '/pipeline' },
              {
                label: 'Rascunhos p/ aprovar',
                value: s.pendingDrafts,
                to: '/inbox?f=rascunhos',
                tone: s.pendingDrafts ? 'warn' : undefined,
              },
              {
                label: 'Tarefas atrasadas',
                value: s.overdueTasks,
                tone: s.overdueTasks ? 'bad' : undefined,
              },
              { label: 'Previsão ponderada', value: fmtMoney(s.forecast.weightedCents) },
              { label: 'Custo do agente · 30d', value: fmtUsdCents(s.agent30d.costCents) },
            ]}
          />
        )}
        <Panel
          flush
          title="Pipeline"
          aside="últimos 12"
          actions={
            <Button variant="ghost" size="sm" onClick={() => nav('/pipeline')}>
              Ver todos
            </Button>
          }
        >
          <DataList<LeadListItem>
            rows={leads.data?.leads ?? []}
            loading={leads.isPending}
            rowKey={(l) => l.id}
            selection={{ selected: sel, onChange: setSel }}
            onRowClick={(l) => nav(`/pipeline/${l.id}`)}
            columns={[
              {
                key: 'lead',
                header: 'Lead',
                cell: (l) => (
                  <span className="flex items-center gap-2.5">
                    <Avatar name={l.name} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {l.businessName}
                      </span>
                    </span>
                  </span>
                ),
              },
              { key: 'stage', header: 'Estágio', cell: (l) => <StateChip state={l.state} /> },
              {
                key: 'chan',
                header: 'Canais',
                cell: (l) => (
                  <span className="flex gap-1.5 text-muted-foreground [&_svg]:size-3.5">
                    <MessageCircle className={l.whatsapp ? 'text-success' : 'opacity-30'} />
                    <Mail className={l.email ? 'text-foreground' : 'opacity-30'} />
                  </span>
                ),
              },
              {
                key: 'agent',
                header: 'Agente',
                cell: (l) =>
                  l.agentMode === 'off' ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Badge variant={l.agentMode === 'auto' ? 'agent' : 'agent-soft'}>
                      {l.agentMode === 'auto' ? 'auto' : 'rascunho'}
                    </Badge>
                  ),
              },
              { key: 'score', header: 'Score', cell: (l) => <ScoreBar score={l.score} /> },
              {
                key: 'value',
                header: 'Valor',
                align: 'end',
                cell: (l) => fmtMoney(l.dealValueCents),
              },
              {
                key: 'next',
                header: 'Próx. ação',
                cell: (l) => (
                  <span
                    className={cn(
                      'text-muted-foreground',
                      isLate(l.nextActionAt) && 'text-destructive-foreground',
                    )}
                  >
                    {relDue(l.nextActionAt)}
                  </span>
                ),
              },
              {
                key: 'act',
                header: 'Atividade',
                align: 'end',
                cell: (l) => (
                  <span className="text-muted-foreground">
                    {rel(l.lastActivityAt ?? l.updatedAt)}
                  </span>
                ),
              },
            ]}
            mobileRow={(l) => (
              <div className="flex items-center gap-3">
                <Avatar name={l.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">{l.name}</span>
                    <span className="ml-auto shrink-0 text-[13px] tnum">
                      {l.dealValueCents != null ? fmtMoney(l.dealValueCents) : ''}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StateChip state={l.state} />
                    <span className="truncate">{l.businessName}</span>
                    <span className="ml-auto shrink-0">{rel(l.lastActivityAt ?? l.updatedAt)}</span>
                  </div>
                </div>
              </div>
            )}
          />
        </Panel>
      </div>
    </Page>
  );
}

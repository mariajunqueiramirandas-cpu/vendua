import { Link } from 'react-router-dom';
import { Bot, ListChecks } from 'lucide-react';
import type { Task } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { useSetTaskDone, useTasks } from './queries.ts';
import { groupTasks, type Bucket } from './tasks.ts';

export function TaskCheck({ t }: { t: Task }) {
  const setDone = useSetTaskDone();
  return (
    <Checkbox
      checked={!!t.doneAt}
      onCheckedChange={(v) => setDone.mutate({ id: t.id, done: v === true })}
      aria-label={t.doneAt ? 'reabrir tarefa' : 'concluir tarefa'}
    />
  );
}

export function TaskDue({ t, b }: { t: Task; b: Bucket }) {
  return (
    <span
      className={cn(
        'text-xs whitespace-nowrap tnum',
        b === 'atrasadas' && 'font-medium text-destructive-foreground',
        b === 'hoje' && 'font-medium text-warning-foreground',
        (b === 'concluídas' || b === 'sem prazo') && 'text-muted-foreground',
      )}
    >
      {t.doneAt ? `feita ${fmtDateTime(t.doneAt)}` : t.dueAt ? fmtDateTime(t.dueAt) : 'sem prazo'}
    </span>
  );
}

export function TaskLead({ t }: { t: Task }) {
  return (
    <span className="min-w-0 truncate">
      <Link
        to={`/pipeline/${t.leadId}`}
        className="underline-offset-2 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {t.leadName ?? 'lead'}
      </Link>
      {t.businessName && t.businessName !== t.leadName && (
        <span className="text-muted-foreground"> · {t.businessName}</span>
      )}
    </span>
  );
}

const AgentChip = () => (
  <Badge variant="agent-soft">
    <Bot /> agente
  </Badge>
);

function columns(b: Bucket, n: number): Column<Task>[] {
  return [
    { key: 'done', header: '', className: 'w-9', cell: (t) => <TaskCheck t={t} /> },
    {
      key: 'title',
      header: (
        <span className={cn(b === 'atrasadas' && 'text-destructive-foreground')}>
          {b} · {n}
        </span>
      ),
      cell: (t) => (
        <span className={cn(t.doneAt && 'text-muted-foreground line-through')}>{t.title}</span>
      ),
    },
    {
      key: 'lead',
      header: 'lead',
      className: 'w-[32%] max-w-0 truncate',
      cell: (t) => <TaskLead t={t} />,
    },
    {
      key: 'due',
      header: 'prazo',
      align: 'end',
      className: 'w-52',
      cell: (t) => (
        <span className="inline-flex items-center gap-2">
          {t.createdBy === 'agent' && <AgentChip />}
          <TaskDue t={t} b={b} />
        </span>
      ),
    },
  ];
}

/** The full task list (old /tarefas): grouped by due bucket, toggle done, late marks. */
export function TasksView({
  showDone,
  onShowDone,
}: {
  showDone: boolean;
  onShowDone: (v: boolean) => void;
}) {
  const q = useTasks(showDone);
  const tasks = q.data?.tasks ?? [];
  const groups = groupTasks(tasks);
  const open = tasks.filter((t) => !t.doneAt).length;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          <span className="text-foreground tnum">{open}</span> abertas
        </span>
        <Segmented
          size="sm"
          className="ml-auto"
          value={showDone ? 'all' : 'open'}
          onChange={(v) => onShowDone(v === 'all')}
          options={[
            ['open', 'só abertas'],
            ['all', 'incluir concluídas'],
          ]}
        />
      </div>
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.isPending ? (
        <LoadingRows />
      ) : !groups.length ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="sem tarefas"
            hint="tarefas de follow-up aparecem aqui — criadas por você ou pelo agente"
          />
        </Card>
      ) : (
        groups.map(([b, list]) => (
          <Card key={b} className="overflow-hidden">
            <div
              className={cn(
                'border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground md:hidden',
                b === 'atrasadas' && 'text-destructive-foreground',
              )}
            >
              {b} · {list.length}
            </div>
            <DataList
              rows={list}
              rowKey={(t) => t.id}
              columns={columns(b, list.length)}
              rowClassName={(t) => (b === 'atrasadas' && !t.doneAt ? 'bg-destructive-soft/40' : '')}
              mobileRow={(t) => (
                <div className="flex items-start gap-3">
                  <span className="pt-0.5">
                    <TaskCheck t={t} />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={cn('text-sm', t.doneAt && 'text-muted-foreground line-through')}
                    >
                      {t.title}
                    </span>
                    <span className="flex min-w-0 text-xs">
                      <TaskLead t={t} />
                    </span>
                    <span className="flex items-center gap-2">
                      <TaskDue t={t} b={b} />
                      {t.createdBy === 'agent' && <AgentChip />}
                    </span>
                  </div>
                </div>
              )}
            />
          </Card>
        ))
      )}
    </div>
  );
}

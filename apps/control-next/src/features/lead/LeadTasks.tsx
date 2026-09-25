import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, isLate } from '@/lib/format.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useLeadTasks, useSetTaskDone } from './queries.ts';

export function LeadTasks({ leadId }: { leadId: string }) {
  const client = useQueryClient();
  const { data: tasks = [], isPending, error, refetch } = useLeadTasks(leadId);
  const setDone = useSetTaskDone(leadId);
  const [title, setTitle] = useState('');
  const create = useMutation({
    mutationFn: (t: string) => api.createTask(leadId, t),
    onSuccess: () => setTitle(''),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
      void client.invalidateQueries({ queryKey: qk.lead(leadId) });
    },
  });
  const add = () => {
    const t = title.trim();
    if (t && !create.isPending) create.mutate(t);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <Input
          placeholder="nova tarefa…"
          aria-label="nova tarefa"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button
          size="icon"
          onClick={add}
          disabled={!title.trim() || create.isPending}
          aria-label="adicionar tarefa"
        >
          <Plus />
        </Button>
      </div>
      {isPending ? (
        <LoadingRows rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !tasks.length ? (
        <EmptyState icon={ListTodo} title="sem tarefas" hint="crie uma acima — ou o agente cria" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tasks.map((t) => {
            const late = !t.doneAt && isLate(t.dueAt);
            return (
              <li
                key={t.id}
                className="flex min-h-10 items-center gap-2.5 px-3 py-1.5 pointer-coarse:min-h-12"
              >
                <Checkbox
                  checked={!!t.doneAt}
                  onCheckedChange={(v) => setDone.mutate({ id: t.id, done: v === true })}
                  aria-label={t.doneAt ? 'reabrir tarefa' : 'concluir tarefa'}
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm break-words',
                    t.doneAt && 'text-muted-foreground line-through',
                  )}
                >
                  {t.title}
                </span>
                {t.createdBy === 'agent' && (
                  <Badge variant="agent" title="tarefa criada pelo agente">
                    agente
                  </Badge>
                )}
                {t.dueAt && (
                  <span
                    className={cn(
                      'shrink-0 text-xs whitespace-nowrap text-muted-foreground tnum',
                      late && 'font-medium text-destructive-foreground',
                    )}
                  >
                    {late ? 'atrasada · ' : ''}
                    {fmtDateTime(t.dueAt)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

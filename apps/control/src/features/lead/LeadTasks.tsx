import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ListTodo, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, isLate } from '@/lib/format.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { EditableText } from '@/components/EditableText.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { fromLocalInput, isHandoff, TaskMenu, usePatchTask } from '@/features/home/taskActions.tsx';
import { useLeadTasks, useSetTaskDone } from './queries.ts';

export function LeadTasks({ leadId }: { leadId: string }) {
  const client = useQueryClient();
  const { data: tasks = [], isPending, error, refetch } = useLeadTasks(leadId);
  const setDone = useSetTaskDone(leadId);
  const patch = usePatchTask();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const create = useMutation({
    mutationFn: (v: { title: string; dueAt: string | null }) =>
      api.createTask(leadId, v.title, v.dueAt),
    onSuccess: () => {
      setTitle('');
      setDue('');
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['stats'] });
      void client.invalidateQueries({ queryKey: qk.lead(leadId) });
    },
  });
  const add = () => {
    const t = title.trim();
    if (t && !create.isPending) create.mutate({ title: t, dueAt: fromLocalInput(due) });
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-col gap-1.5 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          placeholder="nova tarefa…"
          aria-label="nova tarefa"
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="sm:flex-1"
        />
        <div className="flex gap-1.5">
          <Input
            type="datetime-local"
            aria-label="prazo (opcional)"
            title="prazo (opcional)"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className={cn(
              'flex-1 sm:w-44 sm:flex-none dark:[color-scheme:dark]',
              !due && 'text-muted-foreground',
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!title.trim() || create.isPending}
            aria-label="adicionar tarefa"
          >
            <Plus />
          </Button>
        </div>
      </form>
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
            const editable = !t.doneAt && !isHandoff(t);
            return (
              <li
                key={t.id}
                className="flex min-h-10 items-center gap-2.5 py-1.5 pr-1.5 pl-3 pointer-coarse:min-h-12"
              >
                <Checkbox
                  checked={!!t.doneAt}
                  onCheckedChange={(v) => setDone.mutate({ id: t.id, done: v === true })}
                  aria-label={t.doneAt ? 'reabrir tarefa' : 'concluir tarefa'}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                  {editable ? (
                    <EditableText
                      label="título da tarefa"
                      value={t.title}
                      onSave={(v) => v?.trim() && patch.mutate({ t, patch: { title: v.trim() } })}
                      className="min-w-0 flex-1"
                    />
                  ) : (
                    <span
                      className={cn(
                        'min-w-0 flex-1 text-sm break-words',
                        t.doneAt && 'text-muted-foreground line-through',
                      )}
                    >
                      {t.title}
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1.5">
                    {t.createdBy === 'agent' && (
                      <Badge variant="agent" title="tarefa criada pelo agente">
                        agente
                      </Badge>
                    )}
                    {t.dueAt && (
                      <span
                        className={cn(
                          'text-xs whitespace-nowrap text-muted-foreground tnum',
                          late && 'font-medium text-destructive-foreground',
                        )}
                      >
                        {late ? 'atrasada · ' : ''}
                        {fmtDateTime(t.dueAt)}
                      </span>
                    )}
                  </span>
                </div>
                <TaskMenu t={t} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

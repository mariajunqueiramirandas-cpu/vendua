import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClockPlus, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Task, type TaskPatch } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Button } from '@/components/ui/button.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ResponsiveSheet,
} from '@/components/ui/overlay.tsx';

const DAY = 86_400_000;
const SNOOZE_MS = { '1d': DAY, '1w': 7 * DAY } as const;

/** The agent's handoff tasks keep their title — completing one closes its Discord card. */
export const isHandoff = (t: Pick<Task, 'title'>) => t.title.startsWith('[humano]');

/** ISO → the `datetime-local` value in the viewer's zone ("2026-10-06T09:00"). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
/** `datetime-local` value (viewer's zone) → ISO, or null when empty. */
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function guess(t: Task, p: TaskPatch): Task {
  const next = { ...t };
  if (p.title !== undefined) next.title = p.title;
  if (p.dueAt !== undefined) next.dueAt = p.dueAt;
  if (p.snooze) {
    const from = Math.max(t.dueAt ? new Date(t.dueAt).getTime() : 0, Date.now());
    next.dueAt = new Date(from + SNOOZE_MS[p.snooze]).toISOString();
  }
  if (p.done !== undefined) next.doneAt = p.done ? new Date().toISOString() : null;
  return next;
}

function useTaskCache() {
  const qc = useQueryClient();
  const root = [qk.tasks()[0]];
  const settle = (leadId: string) => {
    void qc.invalidateQueries({ queryKey: root });
    void qc.invalidateQueries({ queryKey: qk.stats() });
    void qc.invalidateQueries({ queryKey: qk.lead(leadId) });
    void qc.invalidateQueries({ queryKey: ['leads'] });
  };
  /** applies `fn` to every cached task list; returns the snapshot to roll back to */
  const rewrite = async (fn: (tasks: Task[]) => Task[]) => {
    await qc.cancelQueries({ queryKey: root });
    const snap = qc.getQueriesData<{ tasks: Task[] }>({ queryKey: root });
    qc.setQueriesData<{ tasks: Task[] }>({ queryKey: root }, (old) =>
      old ? { ...old, tasks: fn(old.tasks) } : old,
    );
    return snap;
  };
  const restore = (snap: [readonly unknown[], { tasks: Task[] } | undefined][] | undefined) => {
    for (const [key, data] of snap ?? []) qc.setQueryData(key, data);
  };
  return { settle, rewrite, restore };
}

/** Edit, snooze or complete one task — optimistic in every task list on screen. */
export function usePatchTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: ({ t, patch }: { t: Task; patch: TaskPatch }) => api.patchTask(t.id, patch),
    onMutate: async ({ t, patch }) => ({
      snap: await cache.rewrite((ts) => ts.map((x) => (x.id === t.id ? guess(x, patch) : x))),
    }),
    onError: (e, _v, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: (_r, _e, { t }) => cache.settle(t.leadId),
  });
}

export function useDeleteTask() {
  const cache = useTaskCache();
  return useMutation({
    mutationFn: (t: Task) => api.deleteTask(t.id),
    onMutate: async (t) => ({ snap: await cache.rewrite((ts) => ts.filter((x) => x.id !== t.id)) }),
    onSuccess: () => toast.success('tarefa apagada'),
    onError: (e, _t, ctx) => {
      cache.restore(ctx?.snap);
      toast.error(errorMessage(e));
    },
    onSettled: (_r, _e, t) => cache.settle(t.leadId),
  });
}

/** Title + due date form, in a sheet (bottom sheet on phones). */
function TaskEditSheet({
  t,
  open,
  onOpenChange,
}: {
  t: Task;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const patch = usePatchTask();
  const [title, setTitle] = useState(t.title);
  const [due, setDue] = useState(toLocalInput(t.dueAt));
  useEffect(() => {
    if (!open) return;
    setTitle(t.title);
    setDue(toLocalInput(t.dueAt));
  }, [open, t.title, t.dueAt]);
  const locked = isHandoff(t);
  const save = () => {
    const p: TaskPatch = {};
    if (!locked && title.trim() && title.trim() !== t.title) p.title = title.trim();
    const dueAt = fromLocalInput(due);
    if (dueAt !== (t.dueAt ? new Date(t.dueAt).toISOString() : null)) p.dueAt = dueAt;
    if (Object.keys(p).length) patch.mutate({ t, patch: p });
    onOpenChange(false);
  };
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="editar tarefa"
      width="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            cancelar
          </Button>
          <Button onClick={save} disabled={!locked && !title.trim()}>
            salvar
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="tarefa"
          htmlFor={`task-title-${t.id}`}
          hint={locked ? 'pedido de ajuda do agente — o título fica como está' : undefined}
        >
          <Input
            id={`task-title-${t.id}`}
            value={title}
            maxLength={300}
            disabled={locked}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="prazo" htmlFor={`task-due-${t.id}`}>
          <div className="flex gap-2">
            <Input
              id={`task-due-${t.id}`}
              type="datetime-local"
              className="dark:[color-scheme:dark]"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
            {due && (
              <Button variant="ghost" onClick={() => setDue('')}>
                sem prazo
              </Button>
            )}
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </ResponsiveSheet>
  );
}

/** ⋯ on a task row: edit, snooze a day or a week, delete (second tap confirms). */
export function TaskMenu({ t }: { t: Task }) {
  const patch = usePatchTask();
  const del = useDeleteTask();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 2600);
    return () => clearTimeout(id);
  }, [armed]);
  const snooze = (s: '1d' | '1w') => patch.mutate({ t, patch: { snooze: s } });

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setArmed(false);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="ações da tarefa"
            onClick={(e) => e.stopPropagation()}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => setEdit(true)}>
            <Pencil /> editar…
          </DropdownMenuItem>
          {!t.doneAt && (
            <>
              <DropdownMenuItem onSelect={() => snooze('1d')}>
                <AlarmClockPlus /> adiar 1 dia
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => snooze('1w')}>
                <AlarmClockPlus /> adiar 1 semana
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={del.isPending}
            className={armed ? 'bg-destructive-soft font-medium' : undefined}
            onSelect={(e) => {
              if (!armed) {
                e.preventDefault();
                setArmed(true);
                return;
              }
              setArmed(false);
              del.mutate(t);
            }}
          >
            <Trash2 /> {armed ? 'apagar mesmo?' : 'apagar'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TaskEditSheet t={t} open={edit} onOpenChange={setEdit} />
    </>
  );
}

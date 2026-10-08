import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { BillingStore } from '@/lib/api.ts';
import { useNow } from '@/lib/hooks.ts';
import { Due, isDone, StatusChip } from './bits.tsx';

/** The store page's line for its site builder task: status, time left, a way into the task. */
export function SiteTaskCard({ task }: { task: NonNullable<BillingStore['siteTask']> }) {
  const now = useNow();
  return (
    <Link
      to={`/lojas/sites/${task.id}`}
      className="flex min-w-0 items-center gap-2 rounded-lg border bg-card p-3 text-sm shadow-card transition-colors hover:bg-hover"
    >
      <span className="shrink-0 text-xs text-muted-foreground">tarefa</span>
      <StatusChip t={{ status: task.status, ci: null, runner: 'claude_routine' }} />
      {!isDone(task.status) && (
        <Due
          t={{ status: task.status, dueAt: task.dueAt, deliveredAt: null }}
          now={now}
          className="min-w-0 truncate text-xs"
        />
      )}
      <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs font-medium">
        abrir
        <ChevronRight className="size-3.5" />
      </span>
    </Link>
  );
}

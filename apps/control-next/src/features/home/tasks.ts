import type { Task } from '@/lib/api.ts';

const DAY = 86_400_000;

export type Bucket =
  'atrasadas' | 'hoje' | 'esta semana' | 'mais tarde' | 'sem prazo' | 'concluídas';
export const BUCKETS: Bucket[] = [
  'atrasadas',
  'hoje',
  'esta semana',
  'mais tarde',
  'sem prazo',
  'concluídas',
];

export function bucket(t: Task, now = Date.now()): Bucket {
  if (t.doneAt) return 'concluídas';
  if (!t.dueAt) return 'sem prazo';
  const due = new Date(t.dueAt).getTime();
  const todayEnd = new Date(now).setHours(23, 59, 59, 999);
  if (due < now) return 'atrasadas';
  if (due <= todayEnd) return 'hoje';
  if (due <= now + 7 * DAY) return 'esta semana';
  return 'mais tarde';
}

export function groupTasks(tasks: readonly Task[]) {
  const now = Date.now();
  const groups = new Map<Bucket, Task[]>();
  for (const t of tasks) {
    const b = bucket(t, now);
    groups.set(b, [...(groups.get(b) ?? []), t]);
  }
  return BUCKETS.filter((b) => groups.has(b)).map((b) => [b, groups.get(b)!] as const);
}

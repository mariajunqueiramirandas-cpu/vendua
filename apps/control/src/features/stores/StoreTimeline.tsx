import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  Bot,
  History,
  LifeBuoy,
  MessageSquare,
  Receipt,
  Rocket,
  ShoppingBag,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api, type StoreEvent } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, rel } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Select } from '@/components/ui/input.tsx';
import { eventText, eventTitle } from './eventText.ts';

const CATEGORIES = [
  ['', 'tudo'],
  ['vendas', 'vendas'],
  ['assinaturas', 'assinatura'],
  ['frota', 'frota'],
  ['atendimento', 'atendimento'],
  ['agente', 'agente'],
] as const;

const ICON: Record<string, LucideIcon> = {
  vendas: ShoppingBag,
  assinaturas: Receipt,
  frota: Rocket,
  atendimento: LifeBuoy,
  agente: Bot,
  crm: MessageSquare,
  sistema: Wrench,
};

const TONE: Record<StoreEvent['severity'], string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning-foreground',
  critical: 'text-destructive-foreground',
};

function Item({ e }: { e: StoreEvent }) {
  const Icon = ICON[e.category] ?? History;
  const text = eventText(e);
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
      <Icon className={cn('mt-0.5 size-4 shrink-0', TONE[e.severity])} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{eventTitle(e)}</span>
        {text && <span className="text-xs break-words text-muted-foreground">{text}</span>}
      </div>
      <span
        className="shrink-0 pt-0.5 text-xs text-muted-foreground tnum"
        title={fmtDateTime(e.createdAt)}
      >
        {rel(e.createdAt)}
      </span>
    </li>
  );
}

/** What the team heard about this store (staff events, last 30 days), newest first. */
export function StoreTimeline({ id }: { id: string }) {
  const [category, setCategory] = useState('');
  const q = useInfiniteQuery({
    queryKey: qk.storeEvents(id, category),
    queryFn: ({ pageParam }) =>
      api.storeEvents(id, { before: pageParam || undefined, category: category || undefined }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const events = q.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <Panel
      title="linha do tempo"
      aside="30 dias"
      flush
      actions={
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="filtrar eventos"
          className="w-36"
        >
          {CATEGORIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      }
    >
      {q.isPending ? (
        <LoadingRows rows={4} className="p-3" />
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !events.length ? (
        <EmptyState
          icon={History}
          title="nada por aqui"
          hint={category ? 'nenhum evento desse tipo em 30 dias' : 'nenhum evento em 30 dias'}
        />
      ) : (
        <>
          <ul className="divide-y">
            {events.map((e) => (
              <Item key={e.id} e={e} />
            ))}
          </ul>
          {q.hasNextPage && (
            <div className="flex justify-center border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? 'carregando…' : 'mais antigos'}
              </Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

import { useNavigate, useSearchParams } from 'react-router-dom';
import { Paintbrush } from 'lucide-react';
import type { SiteTask } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useNow } from '@/lib/hooks.ts';
import { needsHuman, useSiteTasks } from '@/lib/queries.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState } from '@/components/common.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { useStoresTabs } from '@/features/stores/tabs.ts';
import { CiChip, Due, KindChip, Runner, StatusChip } from './bits.tsx';

type View = 'abertos' | 'todos';

function Store({ t }: { t: SiteTask }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{t.storeName}</span>
      <span className="truncate text-xs text-muted-foreground">{t.slug}</span>
    </div>
  );
}

function columns(now: number): Column<SiteTask>[] {
  return [
    { key: 'store', header: 'loja', className: 'w-full max-w-0', cell: (t) => <Store t={t} /> },
    { key: 'kind', header: 'tipo', className: 'w-20', cell: (t) => <KindChip kind={t.kind} /> },
    {
      key: 'status',
      header: 'status',
      className: 'w-32 whitespace-nowrap',
      cell: (t) => <StatusChip t={t} />,
    },
    { key: 'ci', header: 'CI', className: 'w-40', cell: (t) => <CiChip t={t} /> },
    {
      key: 'due',
      header: 'prazo',
      className: 'w-44',
      cell: (t) => <Due t={t} now={now} className="text-[13px]" />,
    },
    {
      key: 'runner',
      header: 'quem faz',
      className: 'w-24',
      cell: (t) => <Runner runner={t.runner} />,
    },
  ];
}

function MobileRow({ t, now }: { t: SiteTask; now: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.storeName}</span>
        <StatusChip t={t} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <KindChip kind={t.kind} />
        <CiChip t={t} />
        <Runner runner={t.runner} />
        <Due t={t} now={now} className="ml-auto" />
      </div>
    </div>
  );
}

/** /lojas/sites — the site sob medida queue, by due time: the 1-day promise is kept here. */
export default function SiteTasksPage() {
  const tabs = useStoresTabs();
  const [sp, setSp] = useSearchParams();
  const view: View = sp.get('v') === 'todos' ? 'todos' : 'abertos';
  const q = useSiteTasks(view === 'todos' ? 'all' : 'open');
  const now = useNow();
  const navigate = useNavigate();
  const rows = q.data ?? [];
  const waiting = rows.filter(needsHuman).length;

  const toolbar = (
    <div className="flex min-w-0 items-center gap-3">
      <Segmented
        value={view}
        onChange={(v) => setSp(v === 'todos' ? { v } : {}, { replace: true })}
        options={[
          ['abertos', 'abertos'],
          ['todos', 'todos'],
        ]}
      />
      {waiting > 0 && (
        <span className="truncate text-xs font-medium text-warning-foreground">
          {waiting === 1 ? '1 precisa de você' : `${waiting} precisam de você`}
        </span>
      )}
    </div>
  );

  return (
    <Page title="Lojas" count={q.data?.length} tabs={tabs} toolbar={toolbar}>
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Card className="-mx-3 overflow-hidden rounded-none border-x-0 md:mx-0 md:rounded-lg md:border-x">
          <DataList
            rows={rows}
            rowKey={(t) => t.id}
            columns={columns(now)}
            mobileRow={(t) => <MobileRow t={t} now={now} />}
            onRowClick={(t) => navigate(`/lojas/sites/${t.id}`)}
            loading={q.isPending}
            rowClassName={(t) =>
              cn(
                t.status === 'escalated' && 'bg-destructive-soft/40',
                (t.status === 'delivered' || t.status === 'cancelled') && 'text-muted-foreground',
              )
            }
            empty={
              <EmptyState
                icon={Paintbrush}
                title={
                  view === 'todos' ? 'nenhum site sob medida ainda' : 'nenhum site em produção'
                }
                hint="as tarefas aparecem aqui quando o lojista aplica o cartão do Duá"
              />
            }
          />
        </Card>
      )}
    </Page>
  );
}

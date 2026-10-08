import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  GitPullRequest,
  SearchX,
  Store,
} from 'lucide-react';
import { ApiError, type SiteTask } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { useNow } from '@/lib/hooks.ts';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CiChip, due, DUE_TONE, KindChip, Runner, StatusChip } from './bits.tsx';
import { isTaskId, useSiteTask } from './queries.ts';
import { SpecView } from './SpecView.tsx';
import { BranchBox, TaskActions } from './TaskActions.tsx';
import { TaskTimeline } from './TaskTimeline.tsx';

const gone = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 400);

function Missing() {
  return (
    <EmptyState
      icon={SearchX}
      title="tarefa não encontrada"
      hint="o link pode estar errado ou a tarefa foi removida com a loja"
      action={
        <Link to="/lojas/sites" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          ver os sites
        </Link>
      }
    />
  );
}

function OutLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-sm:flex-1')}
    >
      {icon}
      {children}
      <ExternalLink className="text-muted-foreground" />
    </a>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words tnum">{children}</dd>
    </div>
  );
}

/** Status, the countdown to the 1-day promise, and the ways out to Claude and GitHub. */
function Summary({ t, now }: { t: SiteTask; now: number }) {
  const d = due(t, now);
  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip t={t} />
          <KindChip kind={t.kind} />
          <CiChip t={t} />
          <Runner runner={t.runner} />
        </div>
        <div className="flex items-baseline gap-2 sm:ml-auto">
          <span className={cn('text-xl leading-tight tracking-[-0.02em] tnum', DUE_TONE[d.tone])}>
            {d.text}
          </span>
          <span className="text-xs text-muted-foreground tnum">prazo {fmtDateTime(t.dueAt)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 sm:grid-cols-4">
        <Fact label="criada">{fmtDateTime(t.createdAt)}</Fact>
        <Fact label="disparo">{t.firedAt ? fmtDateTime(t.firedAt) : '—'}</Fact>
        <Fact label="tentativa">{t.attempt}ª</Fact>
        {t.deliveredAt ? (
          <Fact label="no ar">{fmtDateTime(t.deliveredAt)}</Fact>
        ) : t.mergedAt ? (
          <Fact label="mesclado">{fmtDateTime(t.mergedAt)}</Fact>
        ) : (
          <Fact label="aprovado por">{t.approvedBy ?? '—'}</Fact>
        )}
        <div className="col-span-full flex min-w-0 flex-col">
          <dt className="text-xs text-muted-foreground">branch</dt>
          <dd className="min-w-0 text-[13px] break-all">
            <code className="select-all">{t.branch}</code>
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {t.sessionUrl && (
          <OutLink href={t.sessionUrl} icon={<ArrowUpRight />}>
            sessão do Claude
          </OutLink>
        )}
        {t.prUrl && (
          <OutLink href={t.prUrl} icon={<GitPullRequest />}>
            {t.prNumber ? `PR #${t.prNumber}` : 'PR'}
          </OutLink>
        )}
        <Link
          to={`/lojas/${t.tenantId}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'max-sm:flex-1')}
        >
          <Store />
          ver a loja
        </Link>
      </div>
    </Card>
  );
}

/** What a person has to know first: it broke (and why), or it waits on their approval. */
function Callout({ t }: { t: SiteTask }) {
  if (t.status === 'escalated')
    return (
      <div
        role="alert"
        className="flex gap-2.5 rounded-lg border border-destructive/30 bg-destructive-soft p-3"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive-foreground">
            travou{t.escalatedReason ? `: ${t.escalatedReason}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-foreground/80">
            tente de novo com uma sessão nova, ou assuma e termine à mão.
          </p>
        </div>
      </div>
    );
  if (t.status === 'cancelled' && t.escalatedReason)
    return (
      <div className="rounded-lg border bg-muted/60 p-3 text-sm">
        <span className="text-muted-foreground">cancelado: </span>
        {t.escalatedReason}
      </div>
    );
  if (t.status === 'pr_open' && t.ci === 'success')
    return (
      <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
        <p className="text-sm font-semibold text-warning-foreground">
          PR verde esperando a sua aprovação
        </p>
        <p className="mt-0.5 text-xs text-foreground/80">
          confira o PR e aprove: o site vai ao ar sozinho depois do merge.
        </p>
      </div>
    );
  if (t.runner === 'human' && t.status === 'running')
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-card">
        <p className="text-sm font-medium">com a equipe — empurre a branch e abra o PR</p>
        <BranchBox t={t} />
      </div>
    );
  return null;
}

/** /lojas/sites/:id — one site sob medida task (Discord cards link here). */
export default function SiteTaskPage() {
  const { id = '' } = useParams();
  const q = useSiteTask(id);
  const now = useNow();
  const t = q.data?.task;

  let body: ReactNode;
  if (!isTaskId(id) || (q.isError && gone(q.error))) body = <Missing />;
  else if (q.isError && !q.data)
    body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else if (!q.data || !t) body = <LoadingRows />;
  else
    body = (
      <div className="flex flex-col gap-3">
        <Callout t={t} />
        <Summary t={t} now={now} />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr] lg:items-start">
          <div className="lg:col-start-2 lg:row-start-1">
            <TaskActions t={t} now={now} />
          </div>
          <div className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <SpecView spec={t.spec} note={t.note} />
          </div>
          <div className="lg:col-start-2 lg:row-start-2">
            <TaskTimeline events={q.data.events} />
          </div>
        </div>
      </div>
    );

  return (
    <Page title={t?.storeName ?? 'Site sob medida'} back="/lojas/sites">
      {body}
    </Page>
  );
}

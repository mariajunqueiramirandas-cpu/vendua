import { useState, type PropsWithChildren } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArrowUpRight, CheckCheck, ChevronRight, Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { DataList, type Column } from '@/components/DataList.tsx';
import { Page } from '@/components/Page.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/controls.tsx';
import { Field, Input, Select } from '@/components/ui/input.tsx';
import { CH_LABEL } from '@/features/inbox/channel.ts';
import { api, type LeadCleanupItem } from '@/lib/api.ts';
import { useBottomBar } from '@/lib/bottomBar.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { toastUndo } from '@/lib/undo.ts';
import { PIPELINE_TABS } from './tabs.ts';

const CHANNEL_OPTIONS = ['all', 'whatsapp', 'instagram', 'email'] as const;

function LeadLink({ lead }: { lead: LeadCleanupItem }) {
  return (
    <div className="min-w-0 max-w-56">
      <Link
        className="inline-flex max-w-full items-center gap-1 font-medium hover:underline"
        to={`/inbox/${lead.threadId}`}
        target="_blank"
        rel="noopener noreferrer"
        title="abrir conversa em nova aba"
      >
        <span className="truncate">{lead.name}</span>
        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
      </Link>
      <div>
        <Badge>{CH_LABEL[lead.channel]}</Badge>
      </div>
    </div>
  );
}

function LatestMessage({ lead }: { lead: LeadCleanupItem }) {
  return (
    <div className="min-w-0 max-w-md">
      <p className="line-clamp-2 wrap-anywhere text-sm">{lead.lastOutboundBody}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <time dateTime={lead.lastOutboundAt}>{fmtDateTime(lead.lastOutboundAt)}</time>
        {lead.channel === 'email' ? (
          <span>{lead.lastOutboundStatus === 'delivered' ? 'entregue' : 'enviado'}</span>
        ) : lead.seen ? (
          <span className="inline-flex items-center gap-1">
            <CheckCheck className="size-3.5" /> visualizado
          </span>
        ) : (
          <span>visualização sem confirmação</span>
        )}
        <span>
          {lead.hadHumanReply ? 'última mensagem sem resposta' : 'sem resposta humana no histórico'}
        </span>
      </div>
    </div>
  );
}

function Recommendation({ lead }: { lead: LeadCleanupItem }) {
  const r = lead.recommendation;
  return (
    <div className="min-w-0 max-w-72">
      <Badge variant={r?.decision === 'archive' ? 'agent-soft' : 'default'}>
        {r ? (r.decision === 'archive' ? 'arquivar' : 'manter') : 'revisar'}
      </Badge>
      {r && <p className="mt-1 wrap-anywhere text-xs text-muted-foreground">{r.reason}</p>}
    </div>
  );
}

function CleanupActions({ children }: PropsWithChildren) {
  useBottomBar();
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t bg-card p-3">
      {children}
    </div>
  );
}

export default function CleanupPage() {
  const [params, setParams] = useSearchParams();
  const [criteria, setCriteria] = useState('');
  const [selected, setSelected] = useState(new Set<string>());
  const [handled, setHandled] = useState(new Set<string>());
  const client = useQueryClient();
  const days = params.get('dias') ?? '14';
  const minDays = Number(days);
  const channel = CHANNEL_OPTIONS.find((option) => option === params.get('canal')) ?? 'all';
  const scheduledOnly = params.get('agendados') === '1';
  const validDays = Number.isInteger(minDays) && minDays >= 1 && minDays <= 365;
  const setFilter = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const review = useMutation({
    mutationFn: api.reviewLeadsForCleanup,
    onSuccess: (result) => {
      setHandled(new Set());
      setSelected(
        new Set(
          result.leads.filter((l) => l.recommendation?.decision === 'archive').map((l) => l.leadId),
        ),
      );
    },
  });
  const refresh = () => {
    for (const key of [qk.leads(), qk.stats(), qk.threads(), qk.approvals(), qk.wakeups()]) {
      void client.invalidateQueries({ queryKey: [key[0]] });
    }
    void client.invalidateQueries({ queryKey: ['lead'] });
    void client.invalidateQueries({ queryKey: ['thread'] });
  };
  const archive = useMutation({
    mutationFn: api.archiveReviewedLeads,
    onError: (err) => toast.error(errorMessage(err)),
    onSuccess: ({ archived, skipped }) => {
      setHandled((prev) => new Set([...prev, ...archived, ...skipped]));
      setSelected(new Set());
      refresh();
      if (archived.length) {
        toastUndo(
          `${archived.length} ${archived.length === 1 ? 'lead arquivado' : 'leads arquivados'}`,
          async () => {
            await api.bulkLeads({ ids: archived, archived: false });
            refresh();
          },
        );
      }
      if (skipped.length)
        toast.warning(
          `${skipped.length} ${skipped.length === 1 ? 'lead mudou' : 'leads mudaram'} durante a revisão. Analise de novo para atualizar.`,
        );
    },
  });

  const busy = review.isPending || archive.isPending;
  const runReview = (cursor: string | null) =>
    review.mutate({ channel, minDays, scheduledOnly, cursor, criteria: criteria.trim() });
  const current =
    review.variables?.channel === channel &&
    review.variables?.minDays === minDays &&
    review.variables?.scheduledOnly === scheduledOnly &&
    review.variables?.criteria === criteria.trim();
  const batch = current ? review.data : undefined;
  const rows = (batch?.leads.filter((l) => !handled.has(l.leadId)) ?? []).sort(
    (a, b) =>
      Number(b.recommendation?.decision === 'archive') -
        Number(a.recommendation?.decision === 'archive') ||
      a.lastOutboundAt.localeCompare(b.lastOutboundAt),
  );
  const checked = rows.filter((l) => selected.has(l.leadId));
  const suggested = rows.filter((l) => l.recommendation?.decision === 'archive');
  const toggle = (leadId: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  const checkbox = (lead: LeadCleanupItem) => (
    <Checkbox
      className="relative pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5"
      checked={selected.has(lead.leadId)}
      disabled={busy}
      onCheckedChange={(v) => toggle(lead.leadId, v === true)}
      aria-label={`selecionar ${lead.name}`}
    />
  );
  const columns: Column<LeadCleanupItem>[] = [
    {
      key: 'select',
      header: <span className="sr-only">seleção</span>,
      className: 'w-10',
      cell: checkbox,
    },
    { key: 'lead', header: 'lead', className: 'w-1/5', cell: (l) => <LeadLink lead={l} /> },
    { key: 'last-message', header: 'última mensagem', cell: (l) => <LatestMessage lead={l} /> },
    {
      key: 'followup',
      header: 'follow-up',
      className: 'w-28',
      cell: (l) => fmtDateTime(l.nextActionAt),
    },
    {
      key: 'review',
      header: 'sugestão da ia',
      className: 'w-1/4',
      cell: (l) => <Recommendation lead={l} />,
    },
  ];

  return (
    <Page title="Pipeline" tabs={PIPELINE_TABS}>
      <div className="space-y-3">
        <form
          className="space-y-3 rounded-lg border bg-card p-3 shadow-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && validDays) runReview(null);
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Archive className="size-4 text-muted-foreground" /> limpeza de leads
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                revise conversas antigas sem resposta e arquive os leads selecionados
              </p>
            </div>
            <Button type="submit" variant="agent" disabled={busy || !validDays}>
              <Sparkles /> {review.isPending ? 'analisando…' : 'analisar com ia'}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[9rem_10rem_minmax(0,1fr)]">
            <Field label="dias sem resposta" htmlFor="cleanup-days">
              <Input
                id="cleanup-days"
                type="number"
                min={1}
                max={365}
                required
                value={days}
                disabled={busy}
                onChange={(e) => setFilter('dias', e.target.value)}
              />
            </Field>
            <Field label="canal da última mensagem" htmlFor="cleanup-channel">
              <Select
                id="cleanup-channel"
                value={channel}
                disabled={busy}
                onChange={(e) =>
                  setFilter('canal', e.target.value === 'all' ? null : e.target.value)
                }
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option === 'all' ? 'todos os canais' : CH_LABEL[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              className="col-span-2 md:col-span-1"
              label="foco da análise (opcional)"
              htmlFor="cleanup-focus"
            >
              <Input
                id="cleanup-focus"
                maxLength={500}
                value={criteria}
                disabled={busy}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="ex. priorize mensagens repetitivas"
              />
            </Field>
          </div>
          <label className="flex w-fit items-center gap-2 text-sm pointer-coarse:min-h-10">
            <Checkbox
              checked={scheduledOnly}
              disabled={busy}
              onCheckedChange={(v) => setFilter('agendados', v === true ? '1' : null)}
            />{' '}
            só com follow-up agendado
          </label>
        </form>

        {review.isPending && <LoadingRows />}
        {current && review.isError && (
          <ErrorState
            error={review.error}
            onRetry={() => runReview(review.variables?.cursor ?? null)}
          />
        )}
        {batch && (
          <section
            className="rounded-lg border bg-card shadow-card"
            aria-label="resultado da análise"
          >
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {rows.length} em revisão · {suggested.length}{' '}
                  {suggested.length === 1
                    ? 'sugestão de arquivamento'
                    : 'sugestões de arquivamento'}
                </span>
                {suggested.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setSelected(new Set(suggested.map((l) => l.leadId)))}
                  >
                    selecionar sugestões
                  </Button>
                )}
              </div>
            )}
            {rows.length > 0 && rows.every((l) => !l.recommendation) && (
              <p className="border-b px-3 py-2 text-sm text-warning-foreground" role="status">
                sugestões indisponíveis. Revise as conversas ou tente analisar de novo.
              </p>
            )}
            <DataList
              rows={rows}
              rowKey={(l) => l.leadId}
              columns={columns}
              rowClassName={(l) =>
                selected.has(l.leadId) ? 'bg-agent-soft hover:bg-agent-soft' : undefined
              }
              empty={
                <EmptyState
                  title={batch.leads.length ? 'lote revisado' : 'nenhum lead para revisar'}
                  hint={batch.leads.length ? undefined : 'experimente reduzir os dias sem resposta'}
                />
              }
              mobileRow={(l) => (
                <div className="flex items-start gap-2.5">
                  <span className="pt-0.5">{checkbox(l)}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <LeadLink lead={l} />
                    <LatestMessage lead={l} />
                    {l.nextActionAt && (
                      <p className="text-xs text-muted-foreground">
                        follow-up em {fmtDateTime(l.nextActionAt)}
                      </p>
                    )}
                    <Recommendation lead={l} />
                  </div>
                </div>
              )}
            />
            {(rows.length > 0 || batch.nextCursor) && (
              <CleanupActions>
                {rows.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={busy || !checked.length}
                      onClick={() =>
                        archive.mutate({
                          channel,
                          minDays,
                          scheduledOnly,
                          leads: checked.map(({ leadId, lastMessageId, version }) => ({
                            leadId,
                            lastMessageId,
                            version,
                          })),
                        })
                      }
                    >
                      <Archive />{' '}
                      {archive.isPending
                        ? 'arquivando…'
                        : `arquivar ${checked.length} ${checked.length === 1 ? 'lead' : 'leads'}`}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      cancela os follow-ups do agente e mantém o histórico
                    </span>
                  </div>
                )}
                {batch.nextCursor && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => runReview(batch.nextCursor)}
                  >
                    analisar próximo lote <ChevronRight />
                  </Button>
                )}
              </CleanupActions>
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

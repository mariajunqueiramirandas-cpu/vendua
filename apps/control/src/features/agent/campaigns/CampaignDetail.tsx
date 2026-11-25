import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight,
  Compass,
  DollarSign,
  Loader2,
  MessageSquarePlus,
  Pause,
  Play,
  Send,
  Square,
  Trophy,
} from 'lucide-react';
import { fmtDateTime, fmtUsdCents, relDue } from '@/lib/format.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import {
  ConfirmButton,
  ErrorState,
  KpiStrip,
  LoadingRows,
  type Kpi,
} from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Textarea } from '@/components/ui/input.tsx';
import {
  CampaignProgressBar,
  CampaignStatusBadge,
  fmtHoursRemaining,
  goalRatioText,
  HealthPills,
} from './bits.tsx';
import { CampaignDetailTables, type DetailTab } from './CampaignDetailTables.tsx';
import {
  useBumpCampaignBudget,
  useCampaign,
  useGuideCampaign,
  usePauseCampaign,
  useResumeCampaign,
  useStopCampaign,
} from './queries.ts';

export function CampaignDetail({ id }: { id: string }) {
  const mobile = useIsMobile();
  const q = useCampaign(id);
  const pause = usePauseCampaign(id);
  const resume = useResumeCampaign(id);
  const stop = useStopCampaign(id);
  const guide = useGuideCampaign(id);
  const bump = useBumpCampaignBudget(id);

  const [tab, setTab] = useState<DetailTab>('leads');
  const [guiding, setGuiding] = useState(false);
  const [guidanceText, setGuidanceText] = useState('');

  if (q.isLoading && !q.data) return <LoadingRows rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return null;

  const { campaign: c, scoreboard: sc, leads, hunts, turns } = q.data;
  const busy =
    pause.isPending || resume.isPending || stop.isPending || guide.isPending || bump.isPending;

  const isOpen = c.status === 'active' || c.status === 'paused' || c.status === 'exhausted';
  const winner = leads.find((l) => l.convertedAt !== null);

  const sendGuidance = async () => {
    const txt = guidanceText.trim();
    if (!txt || guide.isPending) return;
    await guide.mutateAsync(txt);
    setGuidanceText('');
    setGuiding(false);
  };

  const kpis: Kpi[] = [
    {
      label: 'meta',
      value: goalRatioText(c.goalKind, c.goalProgress, c.goalTarget),
      tone: c.status === 'won' ? 'agent' : undefined,
      hint: c.goalScope === 'any' ? 'qualquer lead' : 'só desta campanha',
    },
    {
      label: 'gasto',
      value: fmtUsdCents(sc.spentCents),
      tone: sc.remainingBudgetCents <= Math.round(c.budgetCents * 0.15) ? 'warn' : undefined,
      hint: `teto ${fmtUsdCents(c.budgetCents)}`,
    },
    {
      label: 'WIP ativo',
      value: `${sc.wip.activeWip}/${c.targetWip}`,
      hint: `${sc.wip.activeConversations} resp · ${sc.wip.awaitingReply} aguard`,
    },
    {
      label: 'buscas · prazo',
      value: `${sc.huntsTotal} · ${fmtHoursRemaining(sc.hoursRemaining)}`,
      tone: sc.hoursRemaining <= 12 && c.status === 'active' ? 'warn' : undefined,
      hint: c.nextTickAt
        ? `${sc.huntsLast24h}/${c.maxHuntsPerDay} hoje · check ${relDue(c.nextTickAt)}`
        : `${sc.huntsLast24h}/${c.maxHuntsPerDay} hoje${sc.huntsQueued ? ` · ${sc.huntsQueued} rodando` : ''}`,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Panel title={c.title} actions={<CampaignStatusBadge status={c.status} />}>
        <div className="flex flex-col gap-3">
          {isOpen && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(c.status === 'active' || c.status === 'paused') && (
                <Button
                  size="sm"
                  variant={guiding ? 'secondary' : 'outline'}
                  disabled={busy}
                  onClick={() => setGuiding((v) => !v)}
                >
                  <MessageSquarePlus /> orientar
                </Button>
              )}
              {c.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => pause.mutate(undefined)}
                >
                  <Pause /> pausar
                </Button>
              )}
              {(c.status === 'paused' || c.status === 'exhausted') && (
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy}
                  onClick={() => resume.mutate(undefined)}
                >
                  <Play /> retomar
                </Button>
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => bump.mutate(10)}>
                <DollarSign /> +US$ 10
              </Button>
              <ConfirmButton
                size="sm"
                variant="destructive-outline"
                confirm="encerrar?"
                disabled={busy}
                onConfirm={() => stop.mutate(undefined)}
              >
                <Square /> encerrar
              </ConfirmButton>
            </div>
          )}
          {c.status === 'won' && winner && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stage-live-dot/30 bg-stage-live px-3 py-2 text-xs text-stage-live-fg">
              <div className="flex items-center gap-2">
                <Trophy className="size-4 shrink-0" />
                <span>
                  meta batida com <strong>{winner.name}</strong>
                  {winner.businessName ? ` (${winner.businessName})` : ''}
                  {c.wonAt ? ` · ${fmtDateTime(c.wonAt)}` : ''}
                </span>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/pipeline/${winner.id}`}>
                  abrir lead <ArrowUpRight />
                </Link>
              </Button>
            </div>
          )}

          {c.stopReason && c.status !== 'won' && (
            <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
              {c.stopReason}
            </div>
          )}

          <p className="text-[13px] leading-relaxed text-foreground/90">{c.objective}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>criada por {c.createdBy}</span>
            <span>· {fmtDateTime(c.createdAt)}</span>
            {c.focusSegment && <span>· segmento: {c.focusSegment}</span>}
            {c.focusCity && <span>· cidade: {c.focusCity}</span>}
            <span>· pool CRM intocado: {sc.untouchedCrmPool}</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground tnum">
              <span>progresso da meta</span>
              <span>{goalRatioText(c.goalKind, c.goalProgress, c.goalTarget)}</span>
            </div>
            <CampaignProgressBar
              value={c.goalProgress}
              max={c.goalTarget}
              tone={c.status === 'won' ? 'live' : 'agent'}
            />
          </div>

          <HealthPills
            autonomyLevel={sc.health.autonomyLevel}
            signupOpen={sc.health.signupOpen}
            whatsappReady={sc.health.whatsappReady}
            whatsappColdRemaining={sc.health.whatsappColdRemaining}
            instagramReady={sc.health.instagramReady}
            instagramColdRemaining={sc.health.instagramColdRemaining}
            emailReady={sc.health.emailReady}
            researchReady={sc.health.researchReady}
            inQuietHours={sc.health.inQuietHours}
          />

          {guiding && (c.status === 'active' || c.status === 'paused') && (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-2.5">
              <Textarea
                rows={2}
                value={guidanceText}
                onChange={(e) => setGuidanceText(e.target.value)}
                placeholder="ex: foca em confeitarias sob encomenda em Campinas e evita pizzarias…"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void sendGuidance();
                  }
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  salva no playbook e acorda o diretor agora
                </span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setGuiding(false)}>
                    cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="agent"
                    disabled={!guidanceText.trim() || guide.isPending}
                    onClick={() => void sendGuidance()}
                  >
                    {guide.isPending ? <Loader2 className="animate-spin" /> : <Send />}
                    aplicar orientação
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <KpiStrip items={kpis} />

      <Panel
        title={
          <span className="flex items-center gap-1.5">
            <Compass className="size-3.5 text-muted-foreground" />
            playbook do diretor
          </span>
        }
        aside={mobile ? undefined : 'memória estratégica entre turnos'}
        actions={
          (c.status === 'active' || c.status === 'paused') && !guiding ? (
            <Button size="sm" variant="ghost" onClick={() => setGuiding(true)}>
              <MessageSquarePlus /> orientar
            </Button>
          ) : undefined
        }
      >
        {c.playbook.trim() ? (
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
            {c.playbook}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            ainda vazio — o diretor registra aqui nichos testados, sinais de resposta e próximos
            pivôs.
          </p>
        )}
      </Panel>

      <Panel flush>
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b px-3 py-2">
          <Segmented
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              [
                'leads',
                <>
                  leads <span className="text-muted-foreground tnum">{leads.length}</span>
                </>,
              ],
              [
                'buscas',
                <>
                  buscas <span className="text-muted-foreground tnum">{hunts.length}</span>
                </>,
              ],
              [
                'atividade',
                <>
                  atividade <span className="text-muted-foreground tnum">{turns.length}</span>
                </>,
              ],
            ]}
          />
        </div>
        <CampaignDetailTables tab={tab} leads={leads} hunts={hunts} turns={turns} />
      </Panel>
    </div>
  );
}

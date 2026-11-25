import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Pause, Rocket, Square, Trophy } from 'lucide-react';
import type { CampaignGoalKind, CampaignPreflight, CampaignStatus } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Badge } from '@/components/ui/badge.tsx';

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  active: 'rodando',
  paused: 'pausada',
  won: 'meta batida',
  stopped: 'encerrada',
  exhausted: 'limite atingido',
};

export const CAMPAIGN_ORIGIN_LABEL: Record<'discovered' | 'revived' | 'matched', string> = {
  discovered: 'descoberto',
  revived: 'reativado',
  matched: 'convertido',
};

export function goalWord(kind: CampaignGoalKind, count = 1): string {
  if (kind === 'signup') return count === 1 ? 'cadastro' : 'cadastros';
  if (kind === 'meeting') return count === 1 ? 'reunião' : 'reuniões';
  return count === 1 ? 'resposta' : 'respostas';
}

export function goalRatioText(kind: CampaignGoalKind, progress: number, target: number): string {
  return `${progress}/${target} ${goalWord(kind, target)}`;
}

export function CampaignStatusBadge({
  status,
  className,
}: {
  status: CampaignStatus;
  className?: string | undefined;
}) {
  if (status === 'active') {
    return (
      <Badge variant="agent-soft" className={className}>
        <span className="relative inline-flex size-1.5" aria-hidden>
          <span className="absolute inset-0 animate-ping rounded-full bg-agent" />
          <span className="relative size-1.5 rounded-full bg-agent" />
        </span>
        {CAMPAIGN_STATUS_LABEL.active}
      </Badge>
    );
  }
  if (status === 'won') {
    return (
      <Badge variant="live" className={className}>
        <Trophy />
        {CAMPAIGN_STATUS_LABEL.won}
      </Badge>
    );
  }
  if (status === 'paused') {
    return (
      <Badge variant="warn" className={className}>
        <Pause />
        {CAMPAIGN_STATUS_LABEL.paused}
      </Badge>
    );
  }
  if (status === 'exhausted') {
    return (
      <Badge variant="warn" className={className}>
        <AlertTriangle />
        {CAMPAIGN_STATUS_LABEL.exhausted}
      </Badge>
    );
  }
  return (
    <Badge variant="default" className={className}>
      <Square />
      {CAMPAIGN_STATUS_LABEL.stopped}
    </Badge>
  );
}

export function CampaignProgressBar({
  value,
  max,
  tone = 'agent',
  className,
}: {
  value: number;
  max: number;
  tone?: 'agent' | 'live' | 'warn' | 'primary' | undefined;
  className?: string | undefined;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <span
      className={cn('block h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-300',
          tone === 'agent' && 'bg-agent',
          tone === 'live' && 'bg-stage-live-dot',
          tone === 'warn' && 'bg-warning',
          tone === 'primary' && 'bg-primary',
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function fmtHoursRemaining(hours: number): string {
  if (hours <= 0) return 'encerrado';
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = hours / 24;
  return days >= 2 ? `${days.toFixed(1).replace('.', ',')}d` : `${Math.round(hours)}h`;
}

/** Quiet readiness bar shown when workspace prerequisites need attention before running campaigns. */
export function PreflightBanner({ preflight }: { preflight: CampaignPreflight }) {
  if (!preflight.warnings.length) return null;
  const critical =
    preflight.autonomyLevel === 'off' || !preflight.channels.any || !preflight.signupOpen;
  return (
    <div
      className={cn(
        'flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-xs',
        critical
          ? 'border-warning/40 bg-warning-soft text-warning-foreground'
          : 'border-border bg-card text-muted-foreground',
      )}
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium text-foreground">pré-requisitos para modo campanha</p>
        <p className="leading-snug">{preflight.warnings.join(' · ')}</p>
      </div>
      <Link
        to="/agente/configurar"
        className="shrink-0 font-medium text-foreground underline underline-offset-2 hover:opacity-80"
      >
        configurar
      </Link>
    </div>
  );
}

/** Compact channel/readiness pills inside the Campaign Detail header. */
export function HealthPills({
  autonomyLevel,
  signupOpen,
  whatsappReady,
  whatsappColdRemaining,
  instagramReady,
  instagramColdRemaining,
  emailReady,
  researchReady,
  inQuietHours,
}: {
  autonomyLevel: string;
  signupOpen: boolean;
  whatsappReady: boolean;
  whatsappColdRemaining: number | null;
  instagramReady: boolean;
  instagramColdRemaining: number;
  emailReady: boolean;
  researchReady: boolean;
  inQuietHours: boolean;
}) {
  const pill = (ok: boolean, label: string) => (
    <Badge key={label} variant={ok ? 'outline' : 'warn'} className="tnum">
      {ok ? <CheckCircle2 className="text-stage-live-dot" /> : <AlertTriangle />}
      {label}
    </Badge>
  );

  const waLabel = !whatsappReady
    ? 'WhatsApp off'
    : whatsappColdRemaining === null
      ? 'WhatsApp livre'
      : `WA ${whatsappColdRemaining} frios`;
  const igLabel = !instagramReady ? 'Instagram off' : `IG ${instagramColdRemaining} DMs`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant={autonomyLevel === 'autopilot' ? 'agent-soft' : 'warn'}>
        <Rocket />
        {autonomyLevel}
      </Badge>
      {pill(
        whatsappReady && (whatsappColdRemaining === null || whatsappColdRemaining > 0),
        waLabel,
      )}
      {pill(instagramReady && instagramColdRemaining > 0, igLabel)}
      {pill(emailReady, emailReady ? 'Email pronto' : 'Email off')}
      {pill(researchReady, researchReady ? 'Pesquisa ativa' : 'Sem pesquisa')}
      {pill(signupOpen, signupOpen ? 'Cadastro aberto' : 'Cadastro fechado')}
      {inQuietHours && <Badge variant="outline">horário silencioso</Badge>}
    </div>
  );
}

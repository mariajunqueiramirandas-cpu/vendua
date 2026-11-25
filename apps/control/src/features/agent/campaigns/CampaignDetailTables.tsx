import { useNavigate } from 'react-router-dom';
import { Activity, Compass, Search, Trophy, Users } from 'lucide-react';
import type { CampaignHuntItem, CampaignLeadItem, CampaignTurnItem } from '@/lib/api.ts';
import { fmtUsdCents, rel } from '@/lib/format.ts';
import { RUN_KIND_LABEL, TRIGGER_LABEL } from '@/lib/labels.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { CAMPAIGN_ORIGIN_LABEL } from './bits.tsx';

export type DetailTab = 'leads' | 'buscas' | 'atividade';

const HUNT_STATUS_BADGE: Record<
  CampaignHuntItem['status'],
  { label: string; variant: 'agent-soft' | 'live' | 'bad' }
> = {
  queued: { label: 'rodando', variant: 'agent-soft' },
  done: { label: 'concluída', variant: 'live' },
  failed: { label: 'falhou', variant: 'bad' },
};

export function CampaignDetailTables({
  tab,
  leads,
  hunts,
  turns,
}: {
  tab: DetailTab;
  leads: CampaignLeadItem[];
  hunts: CampaignHuntItem[];
  turns: CampaignTurnItem[];
}) {
  const nav = useNavigate();

  if (tab === 'leads') {
    const cols: Column<CampaignLeadItem>[] = [
      {
        key: 'name',
        header: 'lead',
        cell: (l) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{l.name}</span>
              {l.convertedAt && (
                <Badge variant="live">
                  <Trophy /> converteu
                </Badge>
              )}
            </div>
            {(l.businessName || l.city || l.segment) && (
              <p className="truncate text-xs text-muted-foreground">
                {[l.businessName, l.segment, l.city].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'origin',
        header: 'origem',
        cell: (l) => (
          <Badge variant={l.origin === 'revived' ? 'outline' : 'agent-soft'}>
            {CAMPAIGN_ORIGIN_LABEL[l.origin]}
          </Badge>
        ),
      },
      {
        key: 'state',
        header: 'estágio',
        cell: (l) => <StateChip state={l.state} />,
      },
      {
        key: 'when',
        header: 'inscrito',
        align: 'end',
        className: 'w-20',
        cell: (l) => (
          <span className="text-xs text-muted-foreground tnum">
            {rel(l.convertedAt ?? l.enrolledAt)}
          </span>
        ),
      },
    ];

    return (
      <DataList
        rows={leads}
        rowKey={(l) => l.id}
        columns={cols}
        onRowClick={(l) => nav(`/pipeline/${l.id}`)}
        mobileRow={(l) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
              {l.convertedAt ? (
                <Badge variant="live">
                  <Trophy /> converteu
                </Badge>
              ) : (
                <StateChip state={l.state} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant={l.origin === 'revived' ? 'outline' : 'agent-soft'}>
                {CAMPAIGN_ORIGIN_LABEL[l.origin]}
              </Badge>
              {(l.businessName || l.city) && (
                <span className="truncate">
                  {[l.businessName, l.city].filter(Boolean).join(' · ')}
                </span>
              )}
              <span className="ml-auto tnum">{rel(l.convertedAt ?? l.enrolledAt)}</span>
            </div>
          </div>
        )}
        empty={
          <EmptyState
            icon={Users}
            title="nenhum lead inscrito ainda"
            hint="assim que o diretor ativar leads intocados ou concluir a primeira busca, eles aparecem aqui"
          />
        }
      />
    );
  }

  if (tab === 'buscas') {
    const cols: Column<CampaignHuntItem>[] = [
      {
        key: 'query',
        header: 'busca',
        cell: (h) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{h.query}</p>
            {(h.segment || h.city || h.target) && (
              <p className="truncate text-xs text-muted-foreground">
                {[h.segment, h.city, h.target ? `meta ${h.target}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'status',
        cell: (h) => {
          const b = HUNT_STATUS_BADGE[h.status];
          return <Badge variant={b.variant}>{b.label}</Badge>;
        },
      },
      {
        key: 'leads',
        header: 'leads',
        align: 'end',
        className: 'w-16',
        cell: (h) => <span className="font-medium tnum">{h.leadsCreated}</span>,
      },
      {
        key: 'cost',
        header: 'custo',
        align: 'end',
        className: 'w-24',
        cell: (h) => (
          <span className="text-xs text-muted-foreground tnum">{fmtUsdCents(h.costCents)}</span>
        ),
      },
      {
        key: 'when',
        header: 'quando',
        align: 'end',
        className: 'w-20',
        cell: (h) => (
          <span className="text-xs text-muted-foreground tnum">
            {rel(h.finishedAt ?? h.createdAt)}
          </span>
        ),
      },
    ];

    return (
      <DataList
        rows={hunts}
        rowKey={(h) => h.id}
        columns={cols}
        mobileRow={(h) => {
          const b = HUNT_STATUS_BADGE[h.status];
          return (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{h.query}</span>
                <Badge variant={b.variant}>{b.label}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tnum">
                <span>{[h.segment, h.city].filter(Boolean).join(' · ') || 'busca aberta'}</span>
                <span>· {h.leadsCreated} leads</span>
                <span>· {fmtUsdCents(h.costCents)}</span>
                <span className="ml-auto">{rel(h.finishedAt ?? h.createdAt)}</span>
              </div>
            </div>
          );
        }}
        empty={
          <EmptyState
            icon={Search}
            title="nenhuma busca disparada ainda"
            hint="o diretor lança novas caçadas automaticamente quando o WIP ficar abaixo do alvo"
          />
        }
      />
    );
  }

  const turnCols: Column<CampaignTurnItem>[] = [
    {
      key: 'kind',
      header: 'execução',
      cell: (t) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant={t.kind === 'campaign' ? 'agent-soft' : 'outline'}>
              {RUN_KIND_LABEL[t.kind] ?? t.kind}
            </Badge>
            <span className="truncate font-medium">
              {t.leadName ?? TRIGGER_LABEL[t.source] ?? t.source}
            </span>
          </div>
          {t.error && (
            <p className="mt-0.5 truncate text-xs text-destructive-foreground">{t.error}</p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'resultado',
      cell: (t) => (
        <Badge
          variant={t.status === 'failed' ? 'bad' : t.outcome === 'parked' ? 'warn' : 'default'}
        >
          {t.status === 'failed' ? 'falhou' : (t.outcome ?? t.status)}
        </Badge>
      ),
    },
    {
      key: 'steps',
      header: 'passos',
      align: 'end',
      className: 'w-16',
      cell: (t) => <span className="text-xs text-muted-foreground tnum">{t.steps}</span>,
    },
    {
      key: 'cost',
      header: 'custo',
      align: 'end',
      className: 'w-24',
      cell: (t) => (
        <span className="text-xs text-muted-foreground tnum">{fmtUsdCents(t.costCents)}</span>
      ),
    },
    {
      key: 'when',
      header: 'quando',
      align: 'end',
      className: 'w-20',
      cell: (t) => (
        <span className="text-xs text-muted-foreground tnum">
          {rel(t.finishedAt ?? t.startedAt)}
        </span>
      ),
    },
  ];

  return (
    <DataList
      rows={turns}
      rowKey={(t) => t.id}
      columns={turnCols}
      onRowClick={(t) => nav(`/agente/operacao/${t.id}?v=execucoes`)}
      mobileRow={(t) => (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Badge variant={t.kind === 'campaign' ? 'agent-soft' : 'outline'}>
              {RUN_KIND_LABEL[t.kind] ?? t.kind}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {t.leadName ?? TRIGGER_LABEL[t.source] ?? t.source}
            </span>
            <span className="text-xs text-muted-foreground tnum">
              {rel(t.finishedAt ?? t.startedAt)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground tnum">
            <span>{t.outcome ?? t.status}</span>
            <span>· {t.steps} passos</span>
            <span>· {fmtUsdCents(t.costCents)}</span>
          </div>
          {t.error && <p className="truncate text-xs text-destructive-foreground">{t.error}</p>}
        </div>
      )}
      empty={
        <EmptyState
          icon={turns.length ? Compass : Activity}
          title="nenhuma execução concluída ainda"
          hint="cada turno do diretor, busca de descoberta ou abordagem de lead aparece aqui com link para o trace completo"
        />
      }
    />
  );
}

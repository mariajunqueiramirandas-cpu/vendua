import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { api, type Routine } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { relDue } from '@/lib/format.ts';
import { useAgentConfig } from '@/lib/queries.ts';
import { qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { num, obj, useSettingsMap } from '../config/settings.ts';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function RoutineDot({ r, on }: { r: Routine | undefined; on: boolean }) {
  const failing = r?.enabled && r.lastOk === false;
  return (
    <span
      aria-hidden
      className={cn(
        'size-2 shrink-0 rounded-full',
        failing ? 'bg-destructive' : on ? 'bg-agent' : 'bg-border-strong',
      )}
    />
  );
}

/**
 * Surfaces the discovery & strategist automation rules right on Descoberta so staff
 * don't have to hunt across Configurar to understand why briefs run or auto-contact.
 */
export function DiscoveryAutomationStrip() {
  const cfg = useAgentConfig().data;
  const settings = useSettingsMap().data;
  const routines = useQuery({
    queryKey: qk.routines(),
    queryFn: api.routines,
    select: (r) => r.routines,
  }).data;

  if (!cfg && !settings) return null;

  const g = obj(settings?.guardrails);
  const autoContact = g.discoveryAutoContact !== false;
  const minScore = num(g.discoveryContactMinScore, 7);
  const autoPause = num(g.briefAutoPauseRuns, 5);

  const off = cfg?.level === 'off';
  const discOn = !off && (cfg?.jobs.discovery ?? false);
  const stratOn = !off && (cfg?.jobs.strategist ?? false);

  const briefRoutine = routines?.find((r) => r.name === 'briefs');
  const stratRoutine = routines?.find((r) => r.name === 'weekly-review');

  return (
    <Card className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-4">
      <div className="grid min-w-0 flex-1 gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5">
            <RoutineDot r={briefRoutine} on={discOn} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span>rotina de briefs</span>
              {briefRoutine?.lastOk === false && <Badge variant="bad">falhando</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {discOn && cfg
                ? `todo dia às ${hh(cfg.schedule.discoveryHour)}${briefRoutine?.nextAt ? ` · próxima ${relDue(briefRoutine.nextAt)}` : ''}`
                : off
                  ? 'agente desligado'
                  : 'pausada'}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5">
            <RoutineDot r={stratRoutine} on={stratOn} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span>revisão semanal</span>
              {stratRoutine?.lastOk === false && <Badge variant="bad">falhando</Badge>}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {stratOn && cfg
                ? `toda ${WEEKDAYS[cfg.schedule.weeklyDay]} às ${hh(cfg.schedule.weeklyHour)} · ${cfg.weeklyDiscoveryUsd > 0 ? `auto até US$ ${cfg.weeklyDiscoveryUsd}/sem` : 'aprovação manual'}`
                : off
                  ? 'agente desligado'
                  : 'pausada'}
            </p>
          </div>
        </div>

        <div className="min-w-0 pl-4 sm:pl-0">
          <div className="text-xs font-medium">autocontato</div>
          <p className="truncate text-xs text-muted-foreground">
            {autoContact
              ? `fit ≥ ${minScore} (ou ${Math.max(1, minScore - 1)} com int. ≥ 6) inicia contato`
              : 'só cria o card no pipeline'}
          </p>
        </div>

        <div className="min-w-0 pl-4 sm:pl-0">
          <div className="text-xs font-medium">auto-pausa de brief</div>
          <p className="truncate text-xs text-muted-foreground">
            {autoPause > 0 ? `pausa após ${autoPause} rodadas sem leads` : 'nunca pausa sozinho'}
          </p>
        </div>
      </div>

      <Button asChild size="sm" variant="outline" className="self-start lg:self-center">
        <Link to="/agente/configurar?s=descoberta">
          <SlidersHorizontal /> ajustar regras
        </Link>
      </Button>
    </Card>
  );
}

import { useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { useIntegrations } from '@/lib/queries.ts';
import { Page } from '@/components/Page.tsx';
import { tabTriggerClass } from '@/components/ui/controls.tsx';
import { TzList } from './bits.tsx';
import { AgendaArea } from './AgendaArea.tsx';
import { ConnectionsArea } from './ConnectionsArea.tsx';
import { OverviewArea } from './OverviewArea.tsx';
import { KINDS, WA_IDLE, type ProvTone } from './providers.ts';
import { AREAS, computeReadiness, STUDIO, type AreaKey } from './readiness.ts';
import { ReportsArea } from './ReportsArea.tsx';
import { obj, useMeetingsStatus, useSaveSetting, useSettingsMap, useWaQr } from './queries.ts';

const MARK: Record<ProvTone, string> = {
  live: 'text-agent-foreground bg-agent',
  warn: 'text-warning-foreground bg-warning-soft',
  off: 'text-muted-foreground bg-secondary',
};

/**
 * Config — the "engine room", one area at a time (`?a=`, `?p=` scrolls to a
 * provider card). Card state is real runtime state ('ativo' = the driver can
 * work now), not just the saved row.
 */
export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();

  const integQ = useIntegrations();
  const settingsQ = useSettingsMap();
  const waQ = useWaQr();
  const mQ = useMeetingsStatus();
  const saveSetting = useSaveSetting();

  // pre-redesign links used ?s=; the agent sections moved to the Estúdio
  const legacy = params.get('s');
  useEffect(() => {
    if (!legacy) return;
    if (legacy === 'agente') return nav(STUDIO, { replace: true });
    if (legacy === 'regras') return nav(`${STUDIO}?s=limites`, { replace: true });
    const next = new URLSearchParams(params);
    next.delete('s');
    if (AREAS.some((a) => a.key === legacy) && legacy !== 'visao') next.set('a', legacy);
    setParams(next, { replace: true });
  }, [legacy, params, nav, setParams]);

  const area: AreaKey = AREAS.find((a) => a.key === params.get('a'))?.key ?? 'visao';
  const anchor = params.get('p');
  const go = (a: AreaKey, p?: string) => {
    const next = new URLSearchParams(params);
    if (a === 'visao') next.delete('a');
    else next.set('a', a);
    if (p) next.set('p', p);
    else next.delete('p');
    setParams(next);
  };

  const integrations = integQ.data?.integrations ?? [];
  const settings = settingsQ.data ?? {};
  const wa = waQ.data ? { qr: waQ.data.qr, status: waQ.data.status, me: waQ.data.me } : WA_IDLE;
  // 'err' = the status probe itself failed — report it instead of guessing
  const mStatus = mQ.isError ? 'err' : (mQ.data ?? null);
  // gate on first answers so empty defaults don't read as 'não configurado'
  const loading = integQ.isPending || settingsQ.isPending || mQ.isPending;

  const r = computeReadiness({
    integrations,
    integErr: integQ.isError,
    settings,
    setErr: settingsQ.isError,
    wa,
    mStatus,
  });
  const marks: Partial<Record<AreaKey, ProvTone>> = {};
  if (mStatus && r.agendaCheck.tone !== 'live') marks.agenda = r.agendaCheck.tone;

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!anchor) return;
    // after the area paints — the card may not be in the DOM on the tick the param flips
    const t = setTimeout(
      () => document.getElementById(`prov-${anchor}`)?.scrollIntoView({ block: 'start' }),
      30,
    );
    return () => clearTimeout(t);
  }, [area, anchor, loading]);
  useEffect(() => {
    if (!anchor) scroller.current?.scrollTo({ top: 0 });
  }, [area, anchor]);

  const loadErr = integQ.error ?? settingsQ.error;
  const savingKey = saveSetting.isPending ? saveSetting.variables.key : null;
  const save = (key: string) => (value: Record<string, unknown>) =>
    saveSetting.mutate({ key, value });

  return (
    <Page title="Config" bleed>
      <nav
        aria-label="áreas da config"
        className="no-scrollbar flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-2 md:px-3"
      >
        {AREAS.map((a) => {
          const mark = a.key === 'conexoes' ? r.connMark : marks[a.key];
          return (
            <button
              key={a.key}
              type="button"
              data-state={area === a.key ? 'active' : 'inactive'}
              aria-current={area === a.key ? 'page' : undefined}
              onClick={() => go(a.key)}
              className={tabTriggerClass}
            >
              {a.label}
              {a.key === 'conexoes' && !loading ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10px] leading-4 font-semibold tnum',
                    MARK[r.connMark],
                  )}
                >
                  {integQ.isError ? '—' : `${r.provLive}/${KINDS.length}`}
                </span>
              ) : (
                mark && (
                  <i
                    className={cn(
                      'size-1.5 rounded-full',
                      mark === 'warn' ? 'bg-warning' : 'bg-border-strong',
                    )}
                    aria-hidden
                  />
                )
              )}
            </button>
          );
        })}
        <Link
          to={STUDIO}
          className={cn(tabTriggerClass, 'ml-auto')}
          title="autonomia, voz, instruções, limites e memória do agente"
        >
          estúdio do agente <ArrowUpRight />
        </Link>
      </nav>

      <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-3 p-3 md:p-4">
          {loadErr && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              falha ao carregar: {errorMessage(loadErr)}
            </div>
          )}
          {/* areas stay mounted — switching hides, not unmounts, so unsaved edits survive */}
          <div hidden={area !== 'visao'}>
            <OverviewArea r={r} loading={loading} onGo={go} />
          </div>
          <div hidden={area !== 'conexoes'}>
            <ConnectionsArea
              integrations={integrations}
              loading={integQ.isPending}
              wa={wa}
              provLive={r.provLive}
            />
          </div>
          <div hidden={area !== 'agenda'}>
            <AgendaArea
              value={obj(settings.meeting)}
              status={mStatus === 'err' ? null : mStatus}
              onSave={save('meeting')}
              saving={savingKey === 'meeting'}
            />
          </div>
          <div hidden={area !== 'relatorios'}>
            <ReportsArea
              forecast={obj(settings.forecast)}
              digest={obj(settings.digest)}
              saveForecast={save('forecast')}
              saveDigest={save('digest')}
              saving={savingKey}
            />
          </div>
        </div>
      </div>
      <TzList />
    </Page>
  );
}

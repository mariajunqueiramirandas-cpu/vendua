import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import type { FleetStorefrontDetail, Provisioning } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { ConfirmButton } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { SheetSection } from '@/features/stores/bits.tsx';
import {
  ago,
  CheckList,
  DEPLOY_KIND,
  DEPLOY_STATUS,
  kb,
  Mono,
  parseChecks,
  ProbeChip,
  ProvisionProgress,
  short,
  SOURCE_LABEL,
  stamp,
  ToneTag,
} from './bits.tsx';
import { AlertRow, RetryButton } from './FleetAlerts.tsx';
import { useProbeNow, usePromote } from './queries.ts';

type S = { s: FleetStorefrontDetail };

export function ReleasesSection({ s }: S) {
  const promote = usePromote(s.slug);
  const live = s.live?.release;
  if (!s.releases.length)
    return (
      <SheetSection title="versões do pacote">
        <p className="text-sm text-muted-foreground">nenhuma versão publicada de {s.bundle}</p>
      </SheetSection>
    );
  return (
    <SheetSection
      title="versões do pacote"
      aside={<Mono className="text-muted-foreground">{s.bundle}</Mono>}
    >
      <ul className="-mx-1 flex flex-col">
        {s.releases.map((r) => {
          const isLive = r.id === live;
          const failed = r.qaStatus !== 'passed';
          const busy = promote.isPending && promote.variables?.release === r.id;
          return (
            <li
              key={r.id}
              className={cn(
                'flex min-h-10 items-center gap-2 rounded-md px-1 py-1',
                isLive && 'bg-muted/60',
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <Mono className="font-medium">{short(r.id)}</Mono>
                  <span className="text-xs text-muted-foreground tnum">{r.kernelVersion}</span>
                  {isLive && <Badge variant="live">no ar</Badge>}
                  {failed && <Badge variant="bad">reprovada</Badge>}
                </span>
                <span className="truncate text-xs text-muted-foreground tnum">
                  {ago(r.publishedAt)}
                  {r.budgets?.entryGzipBytes != null &&
                    ` · entrada ${kb(r.budgets.entryGzipBytes)}`}
                  {r.commit && ` · ${r.commit.slice(0, 7)}`}
                </span>
              </div>
              {!isLive &&
                (failed ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    não passou nas verificações
                  </span>
                ) : (
                  <ConfirmButton
                    size="sm"
                    confirm="promover?"
                    disabled={promote.isPending}
                    title={
                      r.id === s.latestRelease
                        ? 'a mais nova: a loja segue o pacote'
                        : 'uma versão que não é a mais nova fixa a loja nela'
                    }
                    onConfirm={() => promote.mutate({ release: r.id })}
                  >
                    {busy ? 'promovendo…' : 'promover'}
                  </ConfirmButton>
                ))}
            </li>
          );
        })}
      </ul>
    </SheetSection>
  );
}

export function ProbeSection({ s }: S) {
  const probe = useProbeNow(s.slug);
  const recentFailures = s.healthChecks.filter((h) => !h.ok).slice(0, 5);
  return (
    <SheetSection
      title="sonda"
      aside={
        <Button
          size="sm"
          variant="outline"
          disabled={probe.isPending}
          onClick={() => probe.mutate()}
        >
          <Activity /> {probe.isPending ? 'verificando…' : 'verificar agora'}
        </Button>
      }
    >
      {s.probes.length === 0 && (
        <p className="text-sm text-muted-foreground">nenhum endereço sob sonda ainda</p>
      )}
      <ul className="flex flex-col gap-2">
        {s.probes.map((p) => {
          const now = probe.data?.results.find((x) => x.host === p.host)?.result;
          return (
            <li key={p.host} className="flex flex-col gap-1.5 rounded-lg border p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate text-[13px] font-medium">{p.host}</span>
                <span className="ml-auto shrink-0">
                  <ProbeChip status={p.status} />
                </span>
              </div>
              <p className="text-xs text-muted-foreground tnum">
                {p.latencyMs != null ? `${p.latencyMs} ms · ` : ''}
                verificada {ago(p.checkedAt)}
                {p.status === 'failing' &&
                  p.failingSince &&
                  ` · falhando desde ${ago(p.failingSince)}`}
                {p.status === 'failing' && p.failures > 0 && ` · ${p.failures} seguidas`}
              </p>
              {p.error && p.status !== 'ok' && (
                <p className="text-xs text-destructive-foreground">{p.error}</p>
              )}
              {now && (
                <div className="flex flex-col gap-1.5 border-t pt-2">
                  <p className="text-xs">
                    <span
                      className={cn(
                        'font-medium',
                        now.ok ? 'text-success' : 'text-destructive-foreground',
                      )}
                    >
                      {now.ok ? 'passou agora' : 'falhou agora'}
                    </span>
                    <span className="text-muted-foreground tnum"> · {now.latencyMs} ms</span>
                  </p>
                  <CheckList checks={now.checks} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {recentFailures.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-foreground/80">falhas recentes</p>
          <ul className="flex flex-col divide-y text-xs">
            {recentFailures.map((h) => {
              const bad = parseChecks(h.checks).filter((c) => !c.ok);
              return (
                <li key={h.id} className="flex min-w-0 items-baseline gap-2 py-1">
                  <span
                    className="w-20 shrink-0 text-muted-foreground tnum"
                    title={fmtDateTime(h.at)}
                  >
                    {stamp(h.at)}
                  </span>
                  <span className="min-w-0 truncate">
                    {bad.length
                      ? bad.map((c) => `${c.id}${c.detail ? ` ${c.detail}` : ''}`).join(' · ')
                      : 'falhou'}
                  </span>
                  {h.latencyMs != null && (
                    <span className="ml-auto shrink-0 text-muted-foreground tnum">
                      {h.latencyMs} ms
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SheetSection>
  );
}

export function DeploymentsSection({ s }: S) {
  return (
    <SheetSection title="implantações">
      {s.deployments.length === 0 ? (
        <p className="text-sm text-muted-foreground">nenhuma implantação ainda</p>
      ) : (
        <ol className="flex flex-col">
          {s.deployments.map((d, i) => (
            <li key={d.id} className="relative flex gap-2.5 pb-3 last:pb-0">
              {i < s.deployments.length - 1 && (
                <span aria-hidden className="absolute top-3 bottom-0 left-[3.5px] w-px bg-border" />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative mt-1.5 size-2 shrink-0 rounded-full',
                  d.status === 'live' && 'bg-stage-live-dot',
                  d.status === 'pending' && 'bg-warning',
                  d.status === 'failed' && 'bg-destructive',
                  (d.status === 'rolled_back' || d.status === 'superseded') && 'bg-border-strong',
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium">{DEPLOY_KIND[d.kind] ?? d.kind}</span>
                  <Mono>{short(d.release)}</Mono>
                  {d.kernelVersion && (
                    <span className="text-xs text-muted-foreground tnum">{d.kernelVersion}</span>
                  )}
                  <ToneTag map={DEPLOY_STATUS} value={d.status} />
                  <span
                    className="ml-auto text-xs text-muted-foreground tnum"
                    title={fmtDateTime(d.startedAt)}
                  >
                    {ago(d.startedAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.actor}
                  {d.reason && ` — ${d.reason}`}
                </p>
                {d.detail && <p className="text-xs text-muted-foreground/80">{d.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </SheetSection>
  );
}

export function ProvisioningSection({ p }: { p: Provisioning }) {
  // Core appends in order; several entries can share one timestamp
  const log = [...p.log].reverse();
  return (
    <SheetSection title="provisionamento" aside={<RetryButton p={p} />}>
      <ProvisionProgress state={p.state} error={!!p.lastError} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          origem: <span className="text-foreground">{SOURCE_LABEL[p.source] ?? p.source}</span>
        </span>
        <span className="tnum">
          {p.state === 'live' ? `no ar ${ago(p.liveAt)}` : `${p.attempts} tentativas`}
        </span>
        {p.leadId && (
          <Link
            to={`/pipeline/${p.leadId}`}
            className="col-span-2 truncate text-foreground hover:underline"
          >
            lead: {p.leadName ?? 'abrir lead'}
          </Link>
        )}
      </div>
      {p.lastError && <p className="text-xs text-warning-foreground">{p.lastError}</p>}
      <ol className="flex flex-col divide-y text-xs">
        {log.map((e, i) => (
          <li key={i} className="flex min-w-0 items-baseline gap-2 py-1">
            <span className="w-20 shrink-0 text-muted-foreground tnum" title={fmtDateTime(e.at)}>
              {stamp(e.at)}
            </span>
            <span className="min-w-0">{e.note}</span>
          </li>
        ))}
      </ol>
    </SheetSection>
  );
}

export function StoreAlertsSection({ s }: S) {
  if (!s.incidents.length) return null;
  return (
    <SheetSection title="alertas">
      <ul className="-mx-3 divide-y">
        {s.incidents.map((i) => (
          <AlertRow key={i.id} i={i} />
        ))}
      </ul>
    </SheetSection>
  );
}

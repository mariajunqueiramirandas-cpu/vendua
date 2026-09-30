import type { FleetStorefront } from '@/lib/api.ts';
import type { Column } from '@/components/DataList.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { ago, DEPLOY_STATUS, HostLink, Mono, ProbeChip, short, ToneTag } from './bits.tsx';

export function Version({ s }: { s: FleetStorefront }) {
  if (!s.live) return <span className="text-xs text-muted-foreground/70">nada no ar</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Mono>{short(s.live.release)}</Mono>
      {s.live.kernelVersion && (
        <span className="text-xs text-muted-foreground tnum">{s.live.kernelVersion}</span>
      )}
      {s.behind && (
        <Badge variant="warn" title={`a mais nova do pacote é ${short(s.latestRelease)}`}>
          atrás
        </Badge>
      )}
    </span>
  );
}

export function Policy({ s }: { s: FleetStorefront }) {
  return s.policy === 'pinned' ? (
    <Badge variant="outline" title={s.pinnedReason ?? undefined} className="cursor-help">
      fixada
    </Badge>
  ) : (
    <Badge variant="default">auto</Badge>
  );
}

function Probe({ s, compact }: { s: FleetStorefront; compact?: boolean }) {
  const p = s.probe;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      title={p?.status === 'failing' ? (p.error ?? undefined) : undefined}
    >
      <ProbeChip status={p?.status} />
      {p?.latencyMs != null && (
        <span className="text-xs text-muted-foreground tnum">{p.latencyMs} ms</span>
      )}
      {!compact && p?.checkedAt && (
        <span className="text-xs text-muted-foreground tnum max-xl:hidden">{ago(p.checkedAt)}</span>
      )}
    </span>
  );
}

function LastDeploy({ s }: { s: FleetStorefront }) {
  const d = s.deployment;
  if (!d) return <span className="text-xs text-muted-foreground/70">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <ToneTag map={DEPLOY_STATUS} value={d.status} />
      <span className="text-xs text-muted-foreground tnum">{ago(d.startedAt)}</span>
    </span>
  );
}

export const COLUMNS: Column<FleetStorefront>[] = [
  {
    key: 'store',
    header: 'loja',
    className: 'max-w-[12rem] lg:max-w-[18rem]',
    cell: (s) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{s.name}</span>
        <HostLink host={s.host} className="max-w-full" />
      </div>
    ),
  },
  {
    key: 'bundle',
    header: 'pacote',
    className: 'max-w-[10rem] max-lg:hidden',
    cell: (s) => <Mono className="block truncate text-muted-foreground">{s.bundle}</Mono>,
  },
  { key: 'version', header: 'versão no ar', cell: (s) => <Version s={s} /> },
  { key: 'policy', header: 'política', cell: (s) => <Policy s={s} /> },
  { key: 'probe', header: 'sonda', cell: (s) => <Probe s={s} /> },
  {
    key: 'deploy',
    header: 'última implantação',
    align: 'end',
    cell: (s) => <LastDeploy s={s} />,
  },
];

export function FleetMobileRow({ s }: { s: FleetStorefront }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{s.name}</span>
        <span className="ml-auto shrink-0">
          <Probe s={s} compact />
        </span>
      </div>
      <HostLink host={s.host} className="max-w-full" />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Version s={s} />
        <Policy s={s} />
        {s.deployment && s.deployment.status !== 'live' && <LastDeploy s={s} />}
      </div>
    </div>
  );
}

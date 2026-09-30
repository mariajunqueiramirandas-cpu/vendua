import { CheckCircle } from '@phosphor-icons/react';
import type { Incident } from '../../lib/api.ts';
import { when } from '../../lib/format.ts';
import { Notice } from '../../ui/Notice.tsx';

export const openIncidents = (xs: Incident[] | undefined) =>
  (xs ?? [])
    .filter((i) => !i.resolvedAt)
    .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.startedAt.localeCompare(a.startedAt));

const RANK: Record<Incident['severity'], number> = { outage: 3, degraded: 2, info: 1 };

const TONE = { outage: 'danger', degraded: 'warning', info: 'info' } as const;
const WORD: Record<Incident['severity'], string> = {
  outage: 'Fora do ar',
  degraded: 'Funcionando com lentidão',
  info: 'Aviso',
};

export function IncidentNotice({ incident, compact }: { incident: Incident; compact?: boolean }) {
  return (
    <Notice
      tone={TONE[incident.severity]}
      title={incident.title}
      role={incident.severity === 'info' ? 'status' : 'alert'}
    >
      <span className="t-caption block font-semibold text-muted">
        {WORD[incident.severity]} · desde {when(incident.startedAt)}
      </span>
      {incident.body && !compact ? <p className="mt-1">{incident.body}</p> : null}
      {compact ? <p className="mt-1">A equipe Venduá já está cuidando disso.</p> : null}
    </Notice>
  );
}

/** Ajuda's status card: open problems first and loud; otherwise a calm "tudo funcionando". */
export function PlatformStatus({ incidents }: { incidents: Incident[] }) {
  const open = openIncidents(incidents);
  const resolved = incidents
    .filter((i) => i.resolvedAt)
    .sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!));
  return (
    <div className="space-y-3">
      {open.length ? (
        open.map((i) => <IncidentNotice key={i.id} incident={i} />)
      ) : (
        <div
          role="status"
          className="flex items-center gap-3 rounded-lg bg-surface px-5 py-4 depth-1"
        >
          <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-success-soft">
            <CheckCircle weight="fill" className="size-6 text-success" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">Tudo funcionando</span>
            <span className="t-body block text-muted">
              Nenhum problema na Venduá agora. Se algo parar, avisamos aqui.
            </span>
          </span>
        </div>
      )}
      {resolved.length ? (
        <details className="group rounded-lg bg-surface depth-1">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 font-semibold [&::-webkit-details-marker]:hidden">
            Resolvidos nos últimos 7 dias
            <span className="t-caption rounded-full bg-sunken px-2.5 py-0.5 tnum">
              {resolved.length}
            </span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {resolved.map((i) => (
              <li key={i.id} className="flex gap-3 px-5 py-3">
                <CheckCircle className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <span className="min-w-0">
                  <span className="block font-semibold">{i.title}</span>
                  <span className="t-caption block text-muted">
                    resolvido {when(i.resolvedAt!)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

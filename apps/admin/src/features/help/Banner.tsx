import { WarningOctagon, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Incident } from '../../lib/api.ts';
import { cn } from '../../ui/cn.ts';
import { openIncidents } from './status.tsx';

// hidden for this visit only: a reload (or a new incident) shows it again
const hidden = new Set<string>();

/** The Shell's strip for an open outage or slowdown; Ajuda has the details. */
export default function Banner({ incidents }: { incidents: Incident[] }) {
  const [, bump] = useState(0);
  const inc = openIncidents(incidents).find((i) => i.severity !== 'info' && !hidden.has(i.id));
  if (!inc) return null;
  const outage = inc.severity === 'outage';
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 px-4 py-2 md:px-8',
        outage ? 'bg-danger-soft' : 'bg-warning-soft',
      )}
    >
      <WarningOctagon
        weight="fill"
        className={cn('size-5 shrink-0', outage ? 'text-danger' : 'text-warning')}
        aria-hidden
      />
      <p className="t-body min-w-0 flex-1">
        <span className="font-semibold">{inc.title}</span>{' '}
        <NavLink
          to="/ajuda"
          className="whitespace-nowrap font-semibold underline underline-offset-2"
        >
          ver detalhes
        </NavLink>
      </p>
      <button
        type="button"
        aria-label="esconder aviso"
        onClick={() => {
          hidden.add(inc.id);
          bump((n) => n + 1);
        }}
        className="-mr-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-press"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

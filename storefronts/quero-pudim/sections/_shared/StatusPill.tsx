import { formatTime, formatWhen, useStoreStatus } from '@vendua/kernel';

/** Open / paused / closed as a dot + word, coloured by state, with the moment Core serves
 *  ("até 22:00", "abre amanhã às 09:00") — none when Core has none. */
export function StatusPill({ openLabel = 'Aberto agora' }: { openLabel?: string }) {
  const { status, hint, timeZone } = useStoreStatus();
  if (!status || !hint) return null;
  const label = status === 'open' ? openLabel : status === 'paused' ? 'Pausado' : 'Fechado agora';
  const when = !hint.at
    ? null
    : hint.kind === 'open-until'
      ? `até ${formatTime(hint.at, timeZone)}`
      : hint.kind === 'opens'
        ? `abre ${formatWhen(hint.at, timeZone)}`
        : `volta ${formatWhen(hint.at, timeZone)}`;
  return (
    <span className="status-pill" data-state={status} data-hint={hint.kind} role="status">
      <span className="status-dot" aria-hidden="true" />
      {label}
      {when ? (
        <>
          {' '}
          <span className="status-when">{when}</span>
        </>
      ) : null}
    </span>
  );
}

import { useStore } from '@vendua/kernel';

/** Open / paused / closed as a dot + word, coloured by state (the Kernel badge is unstyleable per contract). */
export function StatusPill({ openLabel = 'Aberto agora' }: { openLabel?: string }) {
  const { status } = useStore();
  if (!status) return null;
  const label = status === 'open' ? openLabel : status === 'paused' ? 'Pausado' : 'Fechado agora';
  return (
    <span className="status-pill" data-state={status} role="status">
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

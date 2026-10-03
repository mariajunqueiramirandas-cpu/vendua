import { cn } from '../cn.ts';

/**
 * "19 de 20": a ring with the score as display numerals. The number is the accessible label;
 * a model's confidence never appears here (sales-agent-ux §1). `running` draws the part done
 * so far while a Cliente oculto run is still going.
 */
export function ScoreRing({
  value,
  total,
  size = 112,
  running,
  label,
  className,
}: {
  value: number;
  total: number;
  size?: number | undefined;
  running?: boolean | undefined;
  /** the accessible label, when "19 de 20" alone isn't the whole story */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  return (
    <span
      role="img"
      aria-label={label ?? `${value} de ${total}${running ? ', ainda rodando' : ''}`}
      className={cn('relative inline-grid shrink-0 place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          className="stroke-sunken noite:stroke-line-strong"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${share * c} ${c}`}
          className="stroke-primary transition-[stroke-dasharray] duration-(--duration-smooth) ease-(--ease-soft) noite:stroke-spark"
        />
      </svg>
      <span aria-hidden className="relative text-center">
        <span
          className="tnum block font-display font-semibold leading-none tracking-[-0.02em]"
          style={{ fontSize: Math.round(size * 0.3) }}
        >
          {value}
        </span>
        <span className="t-caption mt-1 block text-muted">de {total}</span>
      </span>
    </span>
  );
}

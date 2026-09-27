/** Fallback illustration for photoless products; figureVariant comes from Core via a widening type (OBSERVATIONS.md). */

export type FigureVariant = 'default' | 'alt';

export function ProductFigure({
  variant = 'default',
  className,
  title = 'Doce artesanal',
}: {
  variant?: FigureVariant;
  className?: string;
  title?: string;
}) {
  if (variant === 'alt') {
    return (
      <svg viewBox="0 0 120 140" role="img" aria-label={title} className={className}>
        <ellipse cx="60" cy="128" rx="30" ry="6" fill="#291809" opacity="0.12" />
        <path
          d="M42 22 C42 14 78 14 78 22 L86 108 C86 120 34 120 34 108 Z"
          fill="#F8ECD4"
          stroke="#DFCAB1"
          strokeWidth="2"
        />
        <rect x="46" y="26" width="28" height="10" rx="5" fill="#B45309" />
        <rect x="46" y="26" width="28" height="4" rx="2" fill="#D97706" opacity="0.8" />
        <path
          d="M38 78 C50 70 70 86 82 76 L84 96 C84 106 36 106 36 96 Z"
          fill="#B45309"
          opacity="0.85"
        />
        <path
          d="M38 84 C50 76 70 92 82 82"
          stroke="#7C2D12"
          strokeWidth="2"
          fill="none"
          opacity="0.5"
        />
        <rect x="44" y="44" width="7" height="52" rx="3.5" fill="#FFFFFF" opacity="0.65" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 200 160" role="img" aria-label={title} className={className}>
      <ellipse cx="100" cy="142" rx="66" ry="8" fill="#291809" opacity="0.14" />
      <ellipse cx="100" cy="128" rx="78" ry="17" fill="#FFFFFF" stroke="#EFE3D3" strokeWidth="2" />
      <ellipse cx="100" cy="125" rx="58" ry="11" fill="none" stroke="#EFE3D3" strokeWidth="1.5" />
      <path
        d="M58 62 L64 118 C64 124 136 124 136 118 L142 62 Z"
        fill="#F6DFA9"
        stroke="#D9A441"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M122 62 L128 116 C110 120 90 120 72 116"
        fill="none"
        stroke="#D9A441"
        strokeWidth="5"
        opacity="0.35"
        strokeLinecap="round"
      />
      <rect x="72" y="72" width="9" height="38" rx="4.5" fill="#FFFFFF" opacity="0.55" />
      <ellipse cx="100" cy="60" rx="44" ry="15" fill="#7C2D12" />
      <ellipse cx="100" cy="57" rx="44" ry="14" fill="#B45309" />
      <ellipse cx="100" cy="55" rx="44" ry="12" fill="#D97706" opacity="0.55" />
      <path d="M66 58 C66 70 62 74 62 80 C62 85 70 85 70 79 L71 60 Z" fill="#B45309" />
      <path d="M88 62 C88 74 84 78 85 86 C86 92 94 91 94 84 L95 62 Z" fill="#92400E" />
      <path d="M114 62 C114 72 118 76 117 83 C116 89 108 88 108 81 L109 62 Z" fill="#B45309" />
      <path d="M132 58 C132 68 136 71 135 77 C134 82 127 81 127 75 L128 58 Z" fill="#92400E" />
      <ellipse cx="84" cy="52" rx="12" ry="3.5" fill="#FDE68A" opacity="0.7" />
    </svg>
  );
}

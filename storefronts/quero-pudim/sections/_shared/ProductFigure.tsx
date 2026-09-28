import { FALLBACK_FLAVOR, KIT_FLAVOR, flavorOf, type Flavor } from './flavor.ts';

/** Illustration for photoless products — a real photo replaces it the moment one is uploaded. */

export type FigureVariant = 'default' | 'alt';

export function ProductFigure({
  variant = 'default',
  kind,
  className,
  title = 'Doce artesanal',
  flavor,
}: {
  variant?: FigureVariant;
  /** 'combo' draws the gift box */
  kind?: 'simple' | 'combo' | undefined;
  className?: string;
  title?: string;
  flavor?: Flavor;
}) {
  const f = flavor ?? (kind === 'combo' ? KIT_FLAVOR : title ? flavorOf(title) : FALLBACK_FLAVOR);

  if (kind === 'combo') {
    return (
      <svg viewBox="0 0 200 170" role="img" aria-label={title} className={className}>
        <ellipse cx="100" cy="156" rx="70" ry="8" fill="#291809" opacity="0.13" />
        <rect
          x="42"
          y="74"
          width="116"
          height="74"
          rx="10"
          fill="#FFF7EE"
          stroke="#E8D3BD"
          strokeWidth="2"
        />
        <rect
          x="34"
          y="58"
          width="132"
          height="26"
          rx="8"
          fill={f.body}
          stroke={f.bodyEdge}
          strokeWidth="2"
        />
        <rect x="90" y="58" width="20" height="90" fill={f.bodyEdge} opacity="0.85" />
        <path d="M100 58 C82 30 58 36 66 52 C72 62 92 60 100 58Z" fill={f.top} />
        <path
          d="M100 58 C118 30 142 36 134 52 C128 62 108 60 100 58Z"
          fill={f.top}
          opacity="0.85"
        />
        <circle cx="100" cy="58" r="7" fill={f.bodyEdge} />
        <rect x="52" y="90" width="24" height="44" rx="12" fill="#fff" opacity="0.6" />
      </svg>
    );
  }

  if (variant === 'alt') {
    return (
      <svg viewBox="0 0 120 150" role="img" aria-label={title} className={className}>
        <ellipse cx="60" cy="138" rx="30" ry="6" fill="#291809" opacity="0.12" />
        <path
          d="M42 22 C42 14 78 14 78 22 L86 116 C86 128 34 128 34 116 Z"
          fill="#FFF8EC"
          stroke="#E4D3BC"
          strokeWidth="2"
        />
        <path
          d="M36 60 L84 60 L86 116 C86 128 34 128 34 116 Z"
          fill={f.body}
          stroke={f.bodyEdge}
          strokeWidth="1.5"
        />
        <path
          d="M36 60 C50 52 70 68 84 58 L83 76 C70 84 50 70 36 80 Z"
          fill={f.top}
          opacity="0.9"
        />
        <rect x="46" y="26" width="28" height="10" rx="5" fill={f.top} />
        <rect x="46" y="26" width="28" height="4" rx="2" fill="#fff" opacity="0.4" />
        <rect x="44" y="42" width="7" height="60" rx="3.5" fill="#FFFFFF" opacity="0.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 200 160" role="img" aria-label={title} className={className}>
      <ellipse cx="100" cy="146" rx="66" ry="7" fill="#291809" opacity="0.13" />
      <ellipse cx="100" cy="130" rx="80" ry="17" fill="#FFFFFF" stroke="#EDE0CE" strokeWidth="2" />
      <ellipse cx="100" cy="127" rx="60" ry="11" fill="none" stroke="#EDE0CE" strokeWidth="1.5" />
      <path
        d="M58 62 L64 120 C64 126 136 126 136 120 L142 62 Z"
        fill={f.body}
        stroke={f.bodyEdge}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M122 62 L128 118 C110 122 90 122 72 118"
        fill="none"
        stroke={f.bodyEdge}
        strokeWidth="5"
        opacity="0.3"
        strokeLinecap="round"
      />
      <rect x="72" y="72" width="9" height="40" rx="4.5" fill="#FFFFFF" opacity="0.55" />
      <ellipse cx="100" cy="60" rx="44" ry="15" fill={f.top} />
      <ellipse cx="100" cy="57" rx="44" ry="14" fill={f.top} opacity="0.85" />
      <ellipse cx="100" cy="55" rx="44" ry="12" fill="#fff" opacity="0.22" />
      <path d="M66 58 C66 70 62 74 62 80 C62 85 70 85 70 79 L71 60 Z" fill={f.top} />
      <path d="M88 62 C88 74 84 78 85 86 C86 92 94 91 94 84 L95 62 Z" fill={f.top} opacity="0.9" />
      <path d="M114 62 C114 72 118 76 117 83 C116 89 108 88 108 81 L109 62 Z" fill={f.top} />
      <path
        d="M132 58 C132 68 136 71 135 77 C134 82 127 81 127 75 L128 58 Z"
        fill={f.top}
        opacity="0.9"
      />
      <ellipse cx="84" cy="51" rx="12" ry="3.5" fill="#fff" opacity="0.5" />
    </svg>
  );
}

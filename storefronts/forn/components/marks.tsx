export function LoafMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M5 31c0-9.4 8.5-17 19-17s19 7.6 19 17c0 1.7-1.3 3-3 3H8c-1.7 0-3-1.3-3-3Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M13 18.5c-2.6 2.1-4 4.9-4 7.7M21 15.5c-2.9 2.3-4.4 5.3-4.4 8.7M29.5 15.8c-2.6 2.5-3.9 5.6-3.9 9.1"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CupMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M10 20h22v9.5A9.5 9.5 0 0 1 22.5 39h-3A9.5 9.5 0 0 1 10 29.5V20Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M32 22h4a5 5 0 0 1 0 10h-4.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M16 14.5c0-2 1.6-2.4 1.6-4.2M23 14.5c0-2 1.6-2.4 1.6-4.2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M30.6 8.5A15.5 15.5 0 1 0 39.5 31 12.4 12.4 0 0 1 30.6 8.5Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path d="M38 11.5v4M36 13.5h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function BagMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M11 16h26l-2.4 25.2a3 3 0 0 1-3 2.8H16.4a3 3 0 0 1-3-2.8L11 16Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M17 16V13a7 7 0 0 1 14 0v3"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M18.5 24.5l11 0"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="1.5 4"
      />
    </svg>
  );
}

/** figureVariant → mark: 'alt' is the café/doces figure, default is the loaf. */
export function ProductFigure({
  variant,
  size = 22,
}: {
  variant?: string | undefined;
  size?: number;
}) {
  return variant === 'alt' ? <CupMark size={size} /> : <LoafMark size={size} />;
}

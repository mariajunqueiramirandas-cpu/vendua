import type { ReactNode, SVGProps } from 'react';

// One style (design spec §4.7): hand-inked line drawings of food and shop objects
// in the ink colour, with a single lime highlight. Strokes use currentColor and the
// accent var, so they recolour in Noite. Slightly irregular paths keep the "sketched
// on kraft paper" feel. Placeholder set until the commissioned illustrations land.

type P = SVGProps<SVGSVGElement> & { title?: string };

function Art({ children, title, ...rest }: P & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

const lime = 'var(--spark)';

export const ArtBell = (p: P) => (
  <Art {...p}>
    <ellipse cx="80" cy="104" rx="46" ry="5" fill={lime} stroke="none" opacity=".7" />
    <path d="M58 86c1-22 3-44 22-47 20 3 22 25 23 47" />
    <path d="M50 87c18 3 42 3 61-.5" />
    <path d="M80 39v-8.5" />
    <circle cx="80" cy="27" r="4" />
    <path d="M73 93c1.5 6 12.5 6 14 0" />
    <path
      d="M36 44c-6 7-7 17-3 25M124 44c6 7 7.5 16.5 3 25M29 36c-9 11-10 26-3 38M131 36c9 11 10 26 3 38"
      strokeWidth={2}
    />
  </Art>
);

export const ArtPudim = (p: P) => (
  <Art {...p}>
    <path d="M28 96c20 7 84 7 104 0" />
    <path d="M24 92c4 6 108 6 112 0-2-4-110-4-112 0z" />
    <path d="M46 88c1-14 4-38 7-42 9-6 45-6 54 0 3 4 6 28 7 42" />
    <path d="M52 47c10 4 46 4 56 0" fill={lime} stroke="currentColor" />
    <path d="M58 48c-1 6 2 9 1 14M78 50c0 5 1 7 0 11M98 48c1 5-2 8-1 12" strokeWidth={2} />
    <path d="M70 30c2-6 8-8 10-3 2-5 9-3 10 3" strokeWidth={2} />
  </Art>
);

export const ArtBag = (p: P) => (
  <Art {...p}>
    <path d="M44 44h72l-5 58c-.5 4-3.5 6-7.5 6h-47c-4 0-7-2-7.5-6z" />
    <path d="M62 50V38c0-10 8-17 18-17s18 7 18 17v12" />
    <path d="M58 70c14 5 30 5 44 0" stroke={lime} strokeWidth={5} />
    <circle cx="62" cy="52" r="2.5" fill="currentColor" />
    <circle cx="98" cy="52" r="2.5" fill="currentColor" />
  </Art>
);

export const ArtStore = (p: P) => (
  <Art {...p}>
    <path d="M30 104h100" />
    <path d="M38 58v46M122 58v46" />
    <path d="M30 44l8-18h84l8 18" />
    <path
      d="M30 44c0 8 13 12 20 4 6 8 17 8 20 0 5 8 16 8 20 0 5 8 16 8 20 0 7 8 20 4 20-4z"
      fill={lime}
    />
    <path d="M52 104V74h22v30" />
    <rect x="88" y="72" width="24" height="18" rx="2" />
    <path d="M60 88h2" />
  </Art>
);

export const ArtChart = (p: P) => (
  <Art {...p}>
    <path d="M30 100h104" />
    <rect x="40" y="70" width="14" height="30" rx="3" />
    <rect x="62" y="54" width="14" height="46" rx="3" />
    <rect x="84" y="60" width="14" height="40" rx="3" />
    <rect x="106" y="32" width="14" height="68" rx="3" fill={lime} />
    <path d="M36 50c14-10 28-4 40-14s24-4 38-18" strokeWidth={2} strokeDasharray="1 6" />
  </Art>
);

export const ArtPeople = (p: P) => (
  <Art {...p}>
    <circle cx="62" cy="46" r="13" />
    <path d="M36 100c2-20 13-30 26-30s24 10 26 30" />
    <circle cx="104" cy="52" r="11" fill={lime} />
    <path d="M84 100c1.5-16 10-24 20-24s18.5 8 20 24" />
  </Art>
);

export const ArtTicket = (p: P) => (
  <Art {...p}>
    <path d="M32 40h96v14c-6 0-10 5-10 10s4 10 10 10v14H32V74c6 0 10-5 10-10s-4-10-10-10z" />
    <path d="M96 42v44" strokeDasharray="3 6" />
    <path d="M52 56l24 16M54 72l20-16" stroke={lime} strokeWidth={5} />
  </Art>
);

export const ArtPhone = (p: P) => (
  <Art {...p}>
    <rect x="56" y="14" width="48" height="92" rx="10" />
    <path d="M74 22h12" />
    <rect x="64" y="34" width="32" height="24" rx="4" fill={lime} />
    <path d="M64 68h32M64 78h20" strokeWidth={2} />
    <circle cx="80" cy="96" r="3" />
  </Art>
);

export const ArtCalendar = (p: P) => (
  <Art {...p}>
    <rect x="34" y="28" width="92" height="76" rx="8" />
    <path d="M34 48h92M56 20v14M104 20v14" />
    <rect x="88" y="72" width="18" height="16" rx="3" fill={lime} />
    <path d="M52 64h8M72 64h8M52 80h8M72 80h8" strokeWidth={2} />
  </Art>
);

export const ArtPalette = (p: P) => (
  <Art {...p}>
    <path d="M80 18c-32 0-52 22-52 46 0 20 16 38 36 38 8 0 10-6 8-12-2-7 3-12 10-12h12c20 0 38-10 38-28 0-18-20-32-52-32z" />
    <circle cx="58" cy="56" r="6" fill={lime} />
    <circle cx="76" cy="38" r="5" />
    <circle cx="100" cy="40" r="5" />
    <circle cx="114" cy="58" r="5" />
  </Art>
);

export const ArtChat = (p: P) => (
  <Art {...p}>
    <path d="M28 34c0-8 6-14 14-14h58c8 0 14 6 14 14v30c0 8-6 14-14 14H62l-18 16v-16h-2c-8 0-14-6-14-14z" />
    <path d="M52 44h44M52 58h28" strokeWidth={2} />
    <path d="M104 72h14c8 0 14 6 14 14v8c0 6-4 10-10 10v10l-12-10h-8" fill={lime} />
  </Art>
);

export const ArtCloudOff = (p: P) => (
  <Art {...p}>
    <path d="M46 88h66c14 0 22-10 22-20s-8-20-20-20c-2-16-16-26-32-26-14 0-26 8-30 22-14 0-24 10-24 22s8 22 18 22z" />
    <path d="M40 24l84 76" stroke={lime} strokeWidth={5} />
  </Art>
);

export const ArtMoon = (p: P) => (
  <Art {...p}>
    <path
      d="M96 22c-26 2-44 22-44 46 0 24 20 42 44 42 12 0 22-4 30-12-26 2-46-16-46-40 0-16 6-28 16-36z"
      fill={lime}
    />
    <path
      d="M40 34l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM128 40l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z"
      strokeWidth={2}
    />
  </Art>
);

export const ArtSearch = (p: P) => (
  <Art {...p}>
    <circle cx="72" cy="54" r="26" />
    <path d="M92 74l24 24" strokeWidth={5} />
    <path d="M60 46c4-6 12-8 18-6" stroke={lime} strokeWidth={4} />
  </Art>
);

export const ArtBox = (p: P) => (
  <Art {...p}>
    <path d="M30 50l50-22 50 22-50 22z" fill={lime} />
    <path d="M30 50v40l50 22 50-22V50M80 72v40" />
    <path d="M52 40l50 22" strokeWidth={2} />
  </Art>
);

export const ArtSparkle = (p: P) => (
  <Art {...p}>
    <path
      d="M80 18c4 22 12 30 34 34-22 4-30 12-34 34-4-22-12-30-34-34 22-4 30-12 34-34z"
      fill={lime}
    />
    <path d="M122 76c2 9 6 13 15 15-9 2-13 6-15 15-2-9-6-13-15-15 9-2 13-6 15-15zM38 78c1.5 6 4 8.5 10 10-6 1.5-8.5 4-10 10-1.5-6-4-8.5-10-10 6-1.5 8.5-4 10-10z" />
  </Art>
);

/** What a product shows before it has a photo. */
export function NoPhoto({ className }: { className?: string }) {
  return (
    <span className={`grid size-full place-items-center ${className ?? 'text-ink'}`}>
      <ArtPudim className="h-3/5 w-auto opacity-40" />
    </span>
  );
}

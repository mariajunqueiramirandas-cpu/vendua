// The Vendedor's three voices and its receipt paper (sales-agent-ux §1), built from theme.css
// tokens. The board's seller edge, owner bubble and paper have no token of their own, so they
// are mixed here from existing ones, in one place.

/** the seller's hairline: a deeper spark in Creme, a faint one on Noite */
export const SELLER_EDGE =
  'ring-1 ring-inset ring-[color:color-mix(in_srgb,var(--spark)_88%,var(--ink-muted))] noite:ring-[color:color-mix(in_srgb,var(--spark)_30%,transparent)]';

/** the Vendedor's voice: spark-soft with the spark edge */
export const SELLER = `bg-spark-soft text-ink ${SELLER_EDGE}`;

/** the owner's voice: forest. Noite's primary is lime, so the owner keeps a deep green there */
export const YOU =
  'bg-primary text-on-primary noite:bg-[color:color-mix(in_srgb,var(--success)_24%,var(--surface))] noite:text-ink';

/** the shopper's voice: paper */
export const IN = 'bg-surface text-ink depth-1';

/** receipt paper: Core's figures */
export const PAPER = 'bg-surface noite:bg-raised ring-1 ring-inset ring-line-strong depth-1';

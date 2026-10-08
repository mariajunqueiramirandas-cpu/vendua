// Names for ADR 0038: which hosts are registrable roots, the www./root alias each one is served
// with, the .com.br names Venduá can buy, and holder documents as screens show them.

// Second-level suffixes a store's domain realistically sits under (registro.br's categories and
// the common foreign ones); anything else is treated as a single-label TLD.
const SECOND_LEVEL = new Set([
  'com.br',
  'net.br',
  'org.br',
  'art.br',
  'adv.br',
  'app.br',
  'arq.br',
  'blog.br',
  'eco.br',
  'emp.br',
  'eng.br',
  'ind.br',
  'log.br',
  'med.br',
  'psi.br',
  'rec.br',
  'srv.br',
  'tec.br',
  'tur.br',
  'dev.br',
  'nom.br',
  'agr.br',
  'esp.br',
  'etc.br',
  'far.br',
  'imb.br',
  'inf.br',
  'radio.br',
  'tmp.br',
  'tv.br',
  'b.br',
  'co.uk',
  'org.uk',
  'com.ar',
  'com.pt',
  'com.mx',
  'com.co',
  'com.uy',
  'com.py',
  'co.za',
]);

function suffixOf(host: string): string {
  const labels = host.split('.');
  const two = labels.slice(-2).join('.');
  return labels.length > 2 && SECOND_LEVEL.has(two) ? two : labels.at(-1)!;
}

/** `loja.com.br` → true; `www.loja.com.br`, `pedidos.loja.com.br`, `com.br` → false */
export function isRoot(host: string): boolean {
  if (SECOND_LEVEL.has(host)) return false;
  const suffix = suffixOf(host);
  const rest = host.slice(0, host.length - suffix.length - 1);
  return rest.length > 0 && !rest.includes('.');
}

/** The other name a domain is served under: `www.` of a root, the root of a `www.` host. */
export function aliasOf(host: string): string | null {
  if (isRoot(host)) return `www.${host}`;
  if (host.startsWith('www.') && isRoot(host.slice(4))) return host.slice(4);
  return null;
}

// registro.br: 2 to 26 characters, letters, digits and hyphens, not only digits, no hyphen at
// either end. Accented names (IDN) are left out on purpose.
const COM_BR_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,24}[a-z0-9])$/;

/** `loja.com.br` when `host` is a .com.br name Venduá can register, else null */
export function comBrLabel(host: string): string | null {
  const m = /^([a-z0-9-]+)\.com\.br$/.exec(host);
  if (!m) return null;
  const label = m[1]!;
  if (!COM_BR_LABEL.test(label) || /^\d+$/.test(label) || label.includes('--')) return null;
  return label;
}

/** What an owner types into the search box → a candidate label ("Pizzaria do Zé" → pizzariadoze). */
export function labelFromQuery(q: string): string | null {
  const label = q
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.com\.br.*$/, '')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 26)
    .replace(/-$/, '');
  return comBrLabel(`${label}.com.br`) ? label : null;
}

/** Names worth suggesting beside the owner's own query, from the store's name and slug. */
export function suggestions(query: string | null, storeName: string, slug: string): string[] {
  const base = [query, labelFromQuery(storeName), labelFromQuery(slug.replace(/-/g, ''))].filter(
    (x): x is string => !!x,
  );
  const out: string[] = [];
  const add = (label: string) => {
    const host = `${label}.com.br`;
    if (comBrLabel(host) && !out.includes(host)) out.push(host);
  };
  for (const b of base) add(b);
  const root = base[0];
  if (root) {
    add(`${root}delivery`);
    add(`loja${root}`);
    add(`${root}oficial`);
  }
  return out.slice(0, 5);
}

/** `12345678000199` → `12.345.678/0001-**`; `12345678901` → `***.456.789-**` */
export function maskDocument(doc: string): string {
  if (doc.length === 14)
    return `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-**`;
  return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
}

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { CheckResult } from './report.ts';
import { sourceFiles } from './static.ts';
import { balanced, lineOf, literals, stripComments, type Literal } from './source.ts';

// K17-K22: what the Kernel owns (docs/kernel-helper-gaps.md §6). A store keeps its voice
// (labels, layout, art) but never re-derives a decision the Kernel's rules module already makes,
// so every failure names the replacement.

interface Source {
  rel: string;
  src: string;
  lits: Literal[];
}
interface Found {
  line: number;
  msg: string;
}

function sources(dir: string): Source[] {
  return sourceFiles(dir).map((f) => {
    const src = stripComments(readFileSync(f, 'utf8'));
    return { rel: relative(dir, f), src, lits: literals(src) };
  });
}

/** A template's own text, with its `${…}` expressions cut out (they hold nested literals of their own). */
function textOf(l: Literal): string {
  if (l.quote !== '`') return l.raw;
  let out = '';
  for (let i = 0; i < l.raw.length; i++) {
    if (l.raw[i] === '\\') out += l.raw[i++ + 1] ?? '';
    else if (l.raw[i] === '$' && l.raw[i + 1] === '{') {
      const inner = balanced(l.raw, i + 1);
      i += inner === null ? l.raw.length : inner.length + 2;
    } else out += l.raw[i];
  }
  return out;
}

type LinePattern = [RegExp, string];

function byLine(s: Source, patterns: LinePattern[]): Found[] {
  const out: Found[] = [];
  s.src.split('\n').forEach((text, i) => {
    for (const [re, msg] of patterns) if (re.test(text)) out.push({ line: i + 1, msg });
  });
  return out;
}

function byLiteral(s: Source, test: (l: Literal, text: string) => string | null): Found[] {
  const out: Found[] = [];
  for (const l of s.lits) {
    const msg = test(l, textOf(l));
    if (msg) out.push({ line: l.line, msg });
  }
  return out;
}

function run(
  files: Source[],
  id: string,
  title: string,
  find: (s: Source) => Found[],
): CheckResult {
  const problems: string[] = [];
  for (const s of files) {
    // one row per line: a hand-rolled formatter trips several patterns at once
    const lines = new Set<number>();
    for (const f of find(s).sort((a, b) => a.line - b.line)) {
      if (lines.has(f.line)) continue;
      lines.add(f.line);
      problems.push(`${s.rel}:${f.line}: ${f.msg}`);
    }
  }
  return problems.length
    ? { id, title, status: 'fail', detail: problems.join('\n') }
    : { id, title, status: 'pass' };
}

const MONEY = 'use formatCents(cents) / useMoney() / <ProductPrice product={p} />';
const WHEN = 'formatDateTime(iso, timeZone) / formatTime / formatDay';

function k17(s: Source): Found[] {
  const out = byLine(s, [
    [/\bIntl\s*\.\s*NumberFormat\b/, `Intl.NumberFormat — ${MONEY}`],
    [/\.toFixed\s*\(\s*2\s*\)/, `toFixed(2) builds a price by hand — ${MONEY}`],
    [/\b\w*[cC]ents\s*\/\s*100\b/, `cents / 100 builds a price by hand — ${MONEY}`],
  ]);
  for (const m of s.src.matchAll(/\.toLocaleString\s*\(/g)) {
    const args = balanced(s.src, m.index + m[0].length - 1, s.lits);
    if (args !== null && /\bcurrency\b/.test(args))
      out.push({
        line: lineOf(s.src, m.index),
        msg: `toLocaleString with a currency option — ${MONEY}`,
      });
  }
  out.push(
    ...byLiteral(s, (l, text) => {
      if (text.includes('R$')) return `'R$' in a literal — ${MONEY}`;
      if (l.quote === '`') return null;
      if (l.raw === 'BRL')
        return `'BRL' literal — the Kernel formats in the store's currency: ${MONEY}`;
      if (l.raw === 'currency') return `style: 'currency' — ${MONEY}`;
      if (l.raw === 'pt-BR') {
        const before = s.src.slice(Math.max(0, l.start - 24), l.start);
        if (/\b(?:hrefL|l)ang\s*=\s*$/.test(before)) return null;
        if (/(?:toLocale(?:Lower|Upper)Case|localeCompare)\s*\(\s*$/.test(before))
          return "'pt-BR' literal — accent- and case-blind text matching is foldText(s) / useMenu({ query })";
        return `'pt-BR' literal — the locale is the Kernel's: ${MONEY}; dates: ${WHEN}`;
      }
      return null;
    }),
  );
  return out;
}

const PRICE = 'use priceDisplay(p) / <ProductPrice product={p} />';
const CARD = 'use cardState(p, stockLeft) / useCardState(p)';
const CARD_NAMES = /\b(stockQuantity|lowStockThreshold|lowStock|needsChoices|requiresPreorder)\b/;
const PRICE_NAMES = /\b(basePriceCents|fromPriceCents|compareAtPriceCents)\b/;

// `lowStock` is also what a store names a label ("restam"): not Core's field there
const LABEL_BAG = /^(?:labels?|copy|strings?|texts?|words|settings?|vocabulary)$/i;

function k18(s: Source): Found[] {
  const out = byLine(s, [
    [
      /\.\s*(basePriceCents|fromPriceCents|compareAtPriceCents)\b/,
      `price field read by hand (.basePriceCents / .fromPriceCents / .compareAtPriceCents) — ${PRICE}`,
    ],
    [
      /\.\s*(stockQuantity|lowStockThreshold)\b/,
      `stock field read by hand (.stockQuantity / .lowStockThreshold) — ${CARD}`,
    ],
    [
      /\.\s*(needsChoices|requiresPreorder)\b/,
      `card decision re-derived (.needsChoices / .requiresPreorder) — ${CARD}.canQuickAdd / .badge`,
    ],
  ]);
  s.src.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/([\w$]*)\s*\??\s*\.\s*lowStock\b/g))
      if (!LABEL_BAG.test(m[1]!))
        out.push({
          line: i + 1,
          msg: `stock field read by hand (.lowStock) — ${CARD}.lowStock / .badge`,
        });
  });
  for (const m of s.src.matchAll(/\{[^{}]*\}\s*=(?![=>])\s*([\w$]*)/g)) {
    const name = PRICE_NAMES.exec(m[0]) ?? CARD_NAMES.exec(m[0]);
    if (!name || (name[1] === 'lowStock' && LABEL_BAG.test(m[1]!))) continue;
    out.push({
      line: lineOf(s.src, m.index + name.index),
      msg: `${name[1]} destructured from a product — ${PRICE_NAMES.test(name[1]!) ? PRICE : CARD}`,
    });
  }
  return out;
}

const CONTACTS = 'use contactLinks(store) / useLinks().contacts';

function k19(s: Source): Found[] {
  return byLiteral(s, (l, text) => {
    if (/\bwa\.me\b|\bwhatsapp\.com\b/.test(text))
      return `WhatsApp link built by hand — ${CONTACTS}.whatsapp (whatsappUrl / whatsappDigits)`;
    if (/\binstagram\.com\b/.test(text))
      return `Instagram link built by hand — ${CONTACTS}.instagram (instagramUrl / instagramHandle)`;
    if (
      /\btel:/.test(text) &&
      (l.raw.includes('${') || /^\s*\+/.test(s.src.slice(l.end, l.end + 8)))
    )
      return `tel: link built by hand — ${CONTACTS} (phoneDisplay for the number)`;
    return null;
  });
}

const HOURS = 'useStoreHours() / useStoreStatus()';

function k20(s: Source): Found[] {
  return byLine(s, [
    [
      /\bIntl\s*\.\s*DateTimeFormat\b/,
      `Intl.DateTimeFormat — use ${WHEN}; open or closed: ${HOURS}`,
    ],
    [/\.toLocaleDateString\s*\(/, `toLocaleDateString — use ${WHEN}`],
    [/\.toLocaleTimeString\s*\(/, `toLocaleTimeString — use ${WHEN}`],
    [/\.getDay\s*\(/, `weekday math — use ${HOURS} (Core decides open or closed)`],
    [
      /\.hours\s*\??\.\s*windows\b/,
      `hours windows read by hand — use ${HOURS} (rows, today, status)`,
    ],
    [/\.timezone\b/, `store timezone read by hand — ${HOURS} and ${WHEN} apply it`],
  ]);
}

const MEDIA = 'use <ProductImage product={p} /> (products) or <Img src=…> (logo, cover, gallery)';

/** `<img …>` tags with the attribute text of each (JSX expressions and strings balanced). */
function imgTags(s: Source): { index: number; attrs: string }[] {
  const out: { index: number; attrs: string }[] = [];
  const skip = new Map(s.lits.map((l) => [l.start, l.end]));
  for (const m of s.src.matchAll(/<img\b/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length; i < s.src.length; i++) {
      const end = skip.get(i);
      if (end !== undefined) i = end - 1;
      else if (s.src[i] === '{') depth++;
      else if (s.src[i] === '}') depth--;
      else if (s.src[i] === '>' && depth === 0) {
        out.push({ index: m.index, attrs: s.src.slice(m.index + m[0].length, i) });
        break;
      }
    }
  }
  return out;
}

function k21(s: Source): Found[] {
  const out: Found[] = [];
  const readsGallery = /\.\s*gallery\b/.test(s.src);
  for (const tag of imgTags(s)) {
    for (const m of tag.attrs.matchAll(/\b(src|srcSet)\s*=\s*\{/g)) {
      const expr = balanced(tag.attrs, m.index + m[0].length - 1) ?? '';
      let field = /\b(imageUrl|logoUrl|coverUrl|gallery)\b/.exec(expr)?.[1];
      // a gallery item is `{ url, alt, … }`: `photos.map((g) => <img src={g.url}>`
      if (!field && readsGallery && /^\s*\w+\s*\??\.\s*url\s*$/.test(expr)) field = 'gallery';
      if (field)
        out.push({
          line: lineOf(s.src, tag.index),
          msg: `<img ${m[1]}={…${field}…}> — ${MEDIA}`,
        });
    }
  }
  return out;
}

function k22(s: Source): Found[] {
  const out = byLine(s, [
    [/\bnavigator\s*\??\.\s*vibrate\b/, 'navigator.vibrate — use haptic.tick() / haptic.commit()'],
  ]);
  for (const m of s.src.matchAll(/\bmatchMedia\s*\(\s*['"`][^'"`]*prefers-reduced-motion/g))
    out.push({
      line: lineOf(s.src, m.index),
      msg: "matchMedia('(prefers-reduced-motion…)') — use useReducedMotion()",
    });
  return out;
}

export function runOwnership(dir: string): CheckResult[] {
  const files = sources(dir);
  return [
    run(
      files,
      'K17',
      'money-format: prices are formatted by the Kernel (formatCents / useMoney / ProductPrice)',
      k17,
    ),
    run(
      files,
      'K18',
      'price-and-card-fields: price form, stock and card state come from priceDisplay / cardState',
      k18,
    ),
    run(
      files,
      'K19',
      'links: WhatsApp, Instagram and tel: links come from contactLinks / useLinks',
      k19,
    ),
    run(
      files,
      'K20',
      'store-time: hours, open/closed and dates come from useStoreHours / useStoreStatus / formatDateTime',
      k20,
    ),
    run(files, 'K21', 'media: images go through Img / ProductImage (Core srcset)', k21),
    run(
      files,
      'K22',
      'platform-primitives: haptics and reduced motion come from haptic / useReducedMotion',
      k22,
    ),
  ];
}

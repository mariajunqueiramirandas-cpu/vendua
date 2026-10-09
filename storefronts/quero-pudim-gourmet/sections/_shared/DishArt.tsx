import type { ReactNode } from 'react';
import { foldText } from '@vendua/kernel';

// Stand-in art for a product without a photo: a plum line drawing on a blush tint with one
// gold highlight, picked from the product's own words — never a grey box.

export type Dish = 'flan' | 'pop' | 'cup' | 'burger' | 'pizza' | 'bowl' | 'box' | 'cloche';

const RULES: [Dish, RegExp][] = [
  ['box', /\b(kit|combo|caixa|cesta|presente|box)/],
  ['pop', /(sacol|picol|sorvet|gelad|geladinho|milk ?shake|acai|chup)/],
  ['cup', /(cafe|suco|bebida|refri|drink|cha\b|cerveja|agua|vinho|soda|capuccino|latte)/],
  ['burger', /(burger|hamb|lanche|sandu|\bx-|hot ?dog|cachorro)/],
  ['pizza', /(pizza|esfiha|esfirra|calzone|fogazza)/],
  ['flan', /(pudi|bolo|torta|doce|brigadeiro|brownie|cookie|mousse|cheesecake|sobremesa|pave)/],
  ['bowl', /(salada|poke|prato|marmita|sopa|caldo|massa|macarr|risoto|bowl|executivo|feijoada)/],
];

export function dishOf(...words: (string | null | undefined)[]): Dish {
  const text = foldText(words.filter(Boolean).join(' '));
  return RULES.find(([, re]) => re.test(text))?.[0] ?? 'cloche';
}

const DRAWINGS: Record<Dish, ReactNode> = {
  flan: (
    <>
      <ellipse cx="32" cy="50" rx="23" ry="4.5" />
      <path d="M18.5 46 21.8 27.4A3 3 0 0 1 24.8 25h14.4a3 3 0 0 1 3 2.4L45.5 46Z" />
      <path d="M22 28.5c1.6 4 3.4 4 4.4.6 1 5 3.6 5 4.8.2 1.1 3.4 3 3.4 4-.2 1.3 4.6 3.6 4.4 4.8-.6" />
    </>
  ),
  pop: (
    <>
      <path d="M22 21a10 10 0 0 1 20 0v19a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2Z" />
      <path d="M29 42v8.5a3 3 0 0 0 6 0V42" />
      <path d="M28 20v12M34 17v9" />
    </>
  ),
  cup: (
    <>
      <path d="M15 28h27v9a13.5 13.5 0 0 1-27 0Z" />
      <path d="M42 31h3a5 5 0 0 1 0 10h-3.8" />
      <path d="M11 55h36" />
      <path d="M23 22c-2.2-3 2.2-5 0-8.5M31 22c-2.2-3 2.2-5 0-8.5" />
    </>
  ),
  burger: (
    <>
      <path d="M14 30c0-8 8-14 18-14s18 6 18 14Z" />
      <path d="M14 35.5q3-3 6 0t6 0 6 0 6 0 6 0 6 0" />
      <rect x="15" y="39" width="34" height="5" rx="2.5" />
      <path d="M15 47h34v1a4 4 0 0 1-4 4H19a4 4 0 0 1-4-4Z" />
      <path d="M26 22.5l1.5-1M33 21l1.5 1M39 24l1-1.5" />
    </>
  ),
  pizza: (
    <>
      <path d="M32 55 14.5 19.5Q32 11 49.5 19.5Z" />
      <path d="M17 25q15-7 30 0" />
      <circle cx="28" cy="30" r="3" />
      <circle cx="37.5" cy="33" r="3" />
      <circle cx="31.5" cy="42" r="2.5" />
    </>
  ),
  bowl: (
    <>
      <path d="M11 33h42c0 10.5-9.4 17-21 17S11 43.5 11 33Z" />
      <path d="M25 51h14" />
      <path d="M19 33c0-6 4-9.5 8.5-9.5M30 33c.5-7 5.5-10.5 11-9.5M41 33c.3-3.6 2.2-5.8 5-6" />
    </>
  ),
  box: (
    <>
      <path d="M15 27h34v23a2 2 0 0 1-2 2H17a2 2 0 0 1-2-2Z" />
      <rect x="12" y="20" width="40" height="7" rx="2" />
      <path d="M32 20v32" />
      <path d="M32 20c-3.5-7.5-11.5-6-8-1 2 2.6 8 1 8 1Zm0 0c3.5-7.5 11.5-6 8-1-2 2.6-8 1-8 1Z" />
    </>
  ),
  cloche: (
    <>
      <path d="M12 44a20 20 0 0 1 40 0" />
      <path d="M8 44h48" />
      <circle cx="32" cy="21.5" r="2.5" />
      <path d="M20 38.5a13 13 0 0 1 7-9" />
    </>
  ),
};

// where the lime highlight sits behind each drawing
const SPARK: Record<Dish, [number, number, number]> = {
  flan: [41, 23, 11],
  pop: [40, 18, 10],
  cup: [24, 38, 12],
  burger: [42, 20, 10],
  pizza: [38, 27, 11],
  bowl: [42, 28, 10],
  box: [42, 38, 11],
  cloche: [40, 30, 11],
};

export function DishGlyph({ dish, spark = true }: { dish: Dish; spark?: boolean }) {
  const [cx, cy, r] = SPARK[dish];
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className="dish-glyph">
      {spark ? <circle cx={cx} cy={cy} r={r} className="dish-glyph-spark" /> : null}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {DRAWINGS[dish]}
      </g>
    </svg>
  );
}

/** The media box for a product with no photo. */
export function DishArt({ dish }: { dish: Dish }) {
  return (
    <span className="dish-art" data-dish={dish}>
      <DishGlyph dish={dish} />
    </span>
  );
}

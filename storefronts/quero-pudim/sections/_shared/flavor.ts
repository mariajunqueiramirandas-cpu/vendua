import { foldText } from '@vendua/kernel';

// The catalog has no photos yet, so a product's name picks its colours: cards stay
// distinct at a glance and the fallback art reads as the flavour it sells.
export interface Flavor {
  /** card / frame background */
  tint: string;
  /** the dessert itself */
  body: string;
  bodyEdge: string;
  /** syrup on a pudim, top layer on a sacolé */
  top: string;
}

const FLAVORS: [RegExp, Flavor][] = [
  [
    /chocolate|brigadeiro|cacau/,
    { tint: '#F1E3DA', body: '#7A4A38', bodyEdge: '#5B3427', top: '#3E2219' },
  ],
  [
    /morango|frutas vermelhas|goiaba/,
    { tint: '#FCE6E8', body: '#F4A7B3', bodyEdge: '#E17F91', top: '#D6536B' },
  ],
  [/maracuj/, { tint: '#FDF3CB', body: '#F7D454', bodyEdge: '#DDB230', top: '#F0A81C' }],
  [/coco/, { tint: '#F6F1E7', body: '#F8F2E2', bodyEdge: '#E3D6B8', top: '#B45309' }],
  [
    /leite|ninho|caramelo/,
    { tint: '#F8E7CE', body: '#E8BE84', bodyEdge: '#C99656', top: '#A0520F' },
  ],
  [/limao|lima/, { tint: '#EEF5D8', body: '#DCE79A', bodyEdge: '#B7C766', top: '#8BA030' }],
];

export const FALLBACK_FLAVOR: Flavor = {
  tint: '#FBEED8',
  body: '#F6DFA9',
  bodyEdge: '#D9A441',
  top: '#B45309',
};

export function flavorOf(name: string): Flavor {
  const n = foldText(name);
  return FLAVORS.find(([re]) => re.test(n))?.[1] ?? FALLBACK_FLAVOR;
}

/** A gift-box tint for kits, so combos never read as one more sacolé. */
export const KIT_FLAVOR: Flavor = {
  tint: '#F9E4E4',
  body: '#F3B1B2',
  bodyEdge: '#C44E52',
  top: '#C44E52',
};

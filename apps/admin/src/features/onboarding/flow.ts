import { ForkKnife, Motorcycle, Storefront, Wallet, type Icon } from '@phosphor-icons/react';
import type { Pose } from '../../ui/Mascote.tsx';

// The onboarding's map: four screens, each one part of the store with its questions together,
// then the finale. Which screens a store gets depends on the role (money is the owner's).

export type ScreenId = 'cara' | 'atendimento' | 'pagamento' | 'cardapio' | 'pronto';
/** the import from another app: a detour from the first screen, not a screen of its own */
export type StepId = ScreenId | 'importar';

export const SCREENS: {
  id: Exclude<ScreenId, 'pronto'>;
  label: string;
  /** Duá at work on this part */
  pose: Pose;
  Icon: Icon;
  /** the part of the store the preview marks while the screen is open */
  spot: Spot;
}[] = [
  { id: 'cara', label: 'A cara da loja', pose: 'personalizar', Icon: Storefront, spot: 'logo' },
  { id: 'atendimento', label: 'Atendimento', pose: 'entrega', Icon: Motorcycle, spot: 'how' },
  { id: 'pagamento', label: 'Pagamento', pose: 'pagamento', Icon: Wallet, spot: 'pay' },
  { id: 'cardapio', label: 'Cardápio', pose: 'catalogo', Icon: ForkKnife, spot: 'products' },
];

export const screensFor = (owner: boolean): ScreenId[] => [
  ...SCREENS.map((x) => x.id).filter((x) => owner || x !== 'pagamento'),
  'pronto',
];

// The one-question-per-screen wizard's steps, as Core may still hold them (where a store stopped)
// and as links carry them (`/bem-vindo?passo=horarios`): each lands on the screen that asks it.
const LEGACY: Record<string, ScreenId> = {
  oi: 'cara',
  tipo: 'cara',
  importar: 'cara',
  nome: 'cara',
  logo: 'cara',
  cores: 'cara',
  frase: 'cara',
  whatsapp: 'atendimento',
  endereco: 'atendimento',
  horarios: 'atendimento',
  como: 'atendimento',
  retirada: 'atendimento',
  entrega: 'atendimento',
  formas: 'pagamento',
  pix: 'pagamento',
  mercadopago: 'pagamento',
  produtos: 'cardapio',
};

/** A saved place or a `?passo=` link as one of this store's screens (null when it names none). */
export function screenOf(v: unknown, screens: ScreenId[]): ScreenId | null {
  if (typeof v !== 'string') return null;
  const x = (screens as string[]).includes(v) ? (v as ScreenId) : LEGACY[v];
  if (!x) return null;
  // a manager has no payments screen: what it asked is the owner's
  return screens.includes(x) ? x : 'pronto';
}

/** The part of the store a screen changes: the preview marks it while the screen is open. */
export type Spot =
  'name' | 'logo' | 'color' | 'tagline' | 'hours' | 'how' | 'whatsapp' | 'products' | 'pay';

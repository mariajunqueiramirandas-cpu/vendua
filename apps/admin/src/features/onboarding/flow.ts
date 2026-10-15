import { ForkKnife, Motorcycle, Storefront, Wallet, type Icon } from '@phosphor-icons/react';
import type { Payments, StoreView } from '../../lib/api.ts';

// The onboarding's map: four parts, one question per screen. Which questions a store gets
// depends on what's already known (signup asked the name and what it sells), the role (money
// is the owner's) and its own answers (retirada and entrega follow "como").

export type StepId =
  | 'oi'
  | 'tipo'
  | 'importar'
  | 'nome'
  | 'logo'
  | 'cores'
  | 'frase'
  | 'whatsapp'
  | 'endereco'
  | 'horarios'
  | 'como'
  | 'retirada'
  | 'entrega'
  | 'formas'
  | 'pix'
  | 'mercadopago'
  | 'produtos'
  | 'pronto';

export type ChapterId = 'cara' | 'atendimento' | 'pagamentos' | 'cardapio';

export const CHAPTERS: {
  id: ChapterId;
  label: string;
  blurb: string;
  /** what Duá says as the part begins */
  start: string;
  Icon: Icon;
  steps: StepId[];
}[] = [
  {
    id: 'cara',
    start: 'Primeiro, a cara da loja.',
    label: 'A cara da loja',
    blurb: 'O que você vende, logo, cores e uma frase',
    Icon: Storefront,
    steps: ['tipo', 'importar', 'nome', 'logo', 'cores', 'frase'],
  },
  {
    id: 'atendimento',
    start: 'Agora, o atendimento.',
    label: 'Atendimento',
    blurb: 'WhatsApp, endereço, horários, retirada e entrega',
    Icon: Motorcycle,
    steps: ['whatsapp', 'endereco', 'horarios', 'como', 'retirada', 'entrega'],
  },
  {
    id: 'pagamentos',
    start: 'Agora, os pagamentos.',
    label: 'Pagamentos',
    blurb: 'Como o cliente paga e para onde vai o dinheiro',
    Icon: Wallet,
    steps: ['formas', 'pix', 'mercadopago'],
  },
  {
    id: 'cardapio',
    start: 'Por último, o cardápio!',
    label: 'Cardápio',
    blurb: 'Os primeiros produtos, com foto',
    Icon: ForkKnife,
    steps: ['produtos'],
  },
];

export const ALL_STEPS: StepId[] = ['oi', ...CHAPTERS.flatMap((c) => c.steps), 'pronto'];
export const isStep = (v: unknown): v is StepId =>
  typeof v === 'string' && (ALL_STEPS as string[]).includes(v);

export const chapterOf = (step: StepId) => CHAPTERS.find((c) => c.steps.includes(step)) ?? null;

/** The first of this store's questions that comes after `from` in the map — whether or not
 *  `from` is still one of them (Mercado Pago drops out once connected). */
export const after = (steps: StepId[], from: StepId): StepId =>
  steps.find((s) => ALL_STEPS.indexOf(s) > ALL_STEPS.indexOf(from)) ?? 'pronto';

/** `s` if it's still one of the store's questions, else the next one that is. */
export const landOn = (steps: StepId[], s: StepId): StepId =>
  steps.includes(s) ? s : after(steps, s);

/** How a question is named in the map of questions (and the header under the progress). */
export const LABEL: Record<StepId, string> = {
  oi: 'Boas-vindas',
  tipo: 'O que você vende',
  importar: 'Trazer de outro app',
  nome: 'Nome',
  logo: 'Foto ou logo',
  cores: 'Cor da loja',
  frase: 'Frase',
  whatsapp: 'WhatsApp',
  endereco: 'Endereço',
  horarios: 'Horários',
  como: 'Retirada ou entrega',
  retirada: 'Onde buscar',
  entrega: 'Preço da entrega',
  formas: 'Formas de pagamento',
  pix: 'Chave Pix',
  mercadopago: 'Cartão pelo site',
  produtos: 'Primeiros produtos',
  pronto: 'No ar',
};

/** The button on the welcome-back screen names the next question in a couple of words. */
export const LINE_SHORT: Record<StepId, string> = {
  oi: 'início',
  tipo: 'o que você vende',
  importar: 'trazer o cardápio',
  nome: 'o nome',
  logo: 'a logo',
  cores: 'as cores',
  frase: 'a frase',
  whatsapp: 'o WhatsApp',
  endereco: 'o endereço',
  horarios: 'os horários',
  como: 'retirada e entrega',
  retirada: 'onde buscar',
  entrega: 'a taxa de entrega',
  formas: 'as formas de pagamento',
  pix: 'a chave Pix',
  mercadopago: 'o Mercado Pago',
  produtos: 'o cardápio',
  pronto: 'o fim',
};

/** The part of the store a question changes: the preview marks it while the question is open. */
export type Spot =
  'name' | 'logo' | 'color' | 'tagline' | 'hours' | 'how' | 'whatsapp' | 'products' | 'pay';

export const SPOT: Partial<Record<StepId, Spot>> = {
  importar: 'products',
  nome: 'name',
  logo: 'logo',
  cores: 'color',
  frase: 'tagline',
  whatsapp: 'whatsapp',
  horarios: 'hours',
  como: 'how',
  retirada: 'how',
  entrega: 'how',
  formas: 'pay',
  pix: 'pay',
  mercadopago: 'pay',
  produtos: 'products',
};

export interface Known {
  /** what the store sells was unknown when the wizard opened */
  askSegment: boolean;
  /** signup already asked the name */
  askName: boolean;
  /** an empty menu: importing from another app makes sense */
  importable: boolean;
  pickup: boolean;
  delivery: boolean;
  owner: boolean;
  /** this install offers Mercado Pago and the store isn't connected yet */
  mp: boolean;
}

export function stepsFor(k: Known): StepId[] {
  const skip = new Set<StepId>();
  if (!k.askSegment) skip.add('tipo');
  if (!k.askName) skip.add('nome');
  if (!k.importable) skip.add('importar');
  if (!k.pickup) skip.add('retirada');
  if (!k.delivery) skip.add('entrega');
  if (!k.owner) for (const s of ['formas', 'pix', 'mercadopago'] as const) skip.add(s);
  if (!k.mp) skip.add('mercadopago');
  return ALL_STEPS.filter((s) => !skip.has(s));
}

/** Whether a step's answer already lives in the store (the welcome-back map ticks these). */
export function answered(
  step: StepId,
  x: {
    s: StoreView;
    pay: Payments | undefined;
    segment: string | null;
    products: number;
    hasColors: boolean;
    /** the furthest the wizard got ('pronto' once finished) */
    reached: StepId | null;
  },
): boolean {
  const past = (s: StepId) => !!x.reached && ALL_STEPS.indexOf(x.reached) > ALL_STEPS.indexOf(s);
  switch (step) {
    case 'tipo':
      return !!x.segment;
    case 'importar':
      // "começar do zero" is an answer too: it counts once the wizard went past it
      return x.products > 0 || past('importar');
    case 'produtos':
      return x.products > 0;
    case 'nome':
      return !!x.s.profile.name;
    case 'logo':
      return !!x.s.profile.logoUrl;
    case 'cores':
      return x.hasColors;
    case 'frase':
      return !!x.s.profile.tagline;
    case 'whatsapp':
      return !!x.s.profile.whatsapp;
    case 'endereco':
      return !!(x.s.profile.cep || x.s.profile.city || x.s.profile.address);
    case 'horarios':
      return x.s.hours.windows.length > 0;
    case 'como':
      return x.s.operations.pickupEnabled || x.s.operations.deliveryEnabled;
    case 'retirada':
      return !!x.s.operations.pickupAddress;
    case 'entrega':
      return x.s.zones.some((z) => z.active) || x.s.distancePricing.enabled;
    case 'formas':
      // the methods always have an answer (Core's defaults): it counts once the owner went past
      return past('formas');
    case 'pix':
      // a store that doesn't take Pix has nothing to set here
      return !!x.pay?.pix || (!!x.pay && !x.pay.methods.includes('pix'));
    case 'mercadopago':
      return x.pay?.mercadoPago.status === 'connected';
    default:
      return false;
  }
}

/** The Core checklist item a step answers, so "ficou para depois" points back into the wizard. */
export const STEP_FOR_ITEM: Record<string, StepId> = {
  profile: 'logo',
  hours: 'horarios',
  delivery: 'como',
  pix: 'pix',
  menu: 'produtos',
};

/** Questions a detour (`?passo=`) carries on to when they're still open. */
export const FOLLOWS: Partial<Record<StepId, StepId[]>> = {
  logo: ['whatsapp', 'endereco'],
  como: ['retirada', 'entrega'],
  retirada: ['entrega'],
};

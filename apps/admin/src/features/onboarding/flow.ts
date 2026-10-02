import { ForkKnife, Motorcycle, Storefront, Wallet, type Icon } from '@phosphor-icons/react';
import type { Payments, StoreView } from '../../lib/api.ts';
import type { Pose } from '../../ui/Mascote.tsx';

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
  Icon: Icon;
  steps: StepId[];
}[] = [
  {
    id: 'cara',
    label: 'A cara da loja',
    blurb: 'O que você vende, logo, cores e uma frase',
    Icon: Storefront,
    steps: ['tipo', 'importar', 'nome', 'logo', 'cores', 'frase'],
  },
  {
    id: 'atendimento',
    label: 'Atendimento',
    blurb: 'WhatsApp, horários, retirada e entrega',
    Icon: Motorcycle,
    steps: ['whatsapp', 'horarios', 'como', 'retirada', 'entrega'],
  },
  {
    id: 'pagamentos',
    label: 'Pagamentos',
    blurb: 'Como o cliente paga e para onde vai o dinheiro',
    Icon: Wallet,
    steps: ['formas', 'pix', 'mercadopago'],
  },
  {
    id: 'cardapio',
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

export const LINE: Record<StepId, string> = {
  oi: 'Vou montar a sua loja junto com você, sem pressa e sem palavra difícil.',
  tipo: 'Primeiro, me conta: o que você vende?',
  importar: 'Se você já tem um cardápio digital, eu trago tudo de lá para cá.',
  nome: 'O mais importante: o nome!',
  logo: 'Agora um rostinho para a loja.',
  cores: 'Que tal as cores da loja?',
  frase: 'Um toque de personalidade.',
  whatsapp: 'Como os clientes vão falar com você?',
  horarios: 'Hora de dizer quando você trabalha.',
  como: 'Como o pedido chega até o cliente?',
  retirada: 'Onde o cliente busca o pedido?',
  entrega: 'Agora, quanto custa a entrega.',
  formas: 'Vamos falar de dinheiro.',
  pix: 'Para onde vai o dinheiro do Pix?',
  mercadopago: 'Quer receber cartão pelo site também?',
  produtos: 'A parte mais gostosa: o cardápio!',
  pronto: 'Olha só o que a gente fez juntos!',
};

export const POSE: Record<StepId, Pose> = {
  oi: 'avatar-ola',
  tipo: 'avatar-pensando',
  importar: 'catalogo',
  nome: 'loja',
  logo: 'personalizar',
  cores: 'personalizar',
  frase: 'avatar-feliz',
  whatsapp: 'avatar-pensando',
  horarios: 'horarios',
  como: 'entrega',
  retirada: 'loja',
  entrega: 'entrega',
  formas: 'pagamento',
  pix: 'pagamento',
  mercadopago: 'seguranca',
  produtos: 'catalogo',
  pronto: 'avatar-feliz',
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
  switch (step) {
    case 'tipo':
      return !!x.segment;
    case 'importar':
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
      return !!x.reached && ALL_STEPS.indexOf(x.reached) > ALL_STEPS.indexOf('formas');
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
  logo: ['whatsapp'],
  como: ['retirada', 'entrega'],
  retirada: ['entrega'],
};

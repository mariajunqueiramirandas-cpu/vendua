import { resolveSettings, SDK_SCHEMAS } from '@vendua/kernel/sdk-catalog';
import type { ComponentType } from '@vendua/templates';

// What the page editor knows about a section's settings. SDK sections carry their
// real schemas (the Kernel's catalog — pure data). A store's own sections publish
// only their areas, so their fields are inferred from the values the template holds:
// the merchant edits copy, photos and links there, never the section's code (§A5).

export type FieldSpec =
  | { kind: 'text'; key: string; label: string; max: number; long: boolean }
  | { kind: 'number'; key: string; label: string; min: number; max: number; def?: number }
  | { kind: 'boolean'; key: string; label: string; def?: boolean }
  | { kind: 'select'; key: string; label: string; options: readonly string[]; def?: string }
  | { kind: 'image'; key: string; label: string }
  | { kind: 'url'; key: string; label: string }
  | { kind: 'list'; key: string; label: string; max: number; of: FieldSpec[] }
  | { kind: 'skip'; key: string };

const SDK_SECTIONS = SDK_SCHEMAS.flatMap((s) => (s.kind === 'section' ? [s] : []));
const SDK_TITLES = new Map<string, string>(
  SDK_SECTIONS.flatMap((s) => (s.title ? [[s.type, s.title] as const] : [])),
);

/** pt-BR names for a store's own sections; SDK sections name themselves (their schema's
 *  `title`), so the merchant never sees "sdk:catalog-grid". */
const STORE_SECTION_NAMES: Record<string, string> = {
  'store:hero': 'Abertura',
  'store:values': 'Destaques',
  'store:showcase': 'Vitrine',
  'store:story': 'Nossa história',
  'store:steps': 'Como pedir',
  'store:closing': 'Chamada final',
  'store:header': 'Topo da loja',
  'store:footer': 'Rodapé',
  'store:catalog': 'Cardápio',
  'store:qr-menu': 'Cardápio do QR code',
};

export const sectionName = (type: string) =>
  SDK_TITLES.get(type) ??
  STORE_SECTION_NAMES[type] ??
  `Seção ${type.replace(/^(sdk|store):/, '').replace(/-/g, ' ')}`;

/** SDK sections a merchant can add to a page (the schemas' `addable`). */
export const ADDABLE: ComponentType[] = SDK_SECTIONS.filter((s) => s.addable).map((s) => s.type);

/** Whether the storefront keeps a link: the Kernel drops an unsafe one silently when it renders
 *  (`resolveSettings`), so the editor says so first. */
export const keepsUrl = (v: string) => resolveSettings({ v: { kind: 'url' } }, { v }).v === v;

const KEY_NAMES: Record<string, string> = {
  title: 'Título',
  titleEmphasis: 'Título (destaque)',
  eyebrow: 'Chamada acima do título',
  text: 'Texto',
  body: 'Texto',
  intro: 'Introdução',
  lede: 'Subtítulo',
  note: 'Recado',
  footnote: 'Nota de rodapé',
  description: 'Descrição',
  image: 'Foto',
  imageAlt: 'Descrição da foto (para leitores de tela)',
  logo: 'Logo',
  brand: 'Nome no topo',
  ctaLabel: 'Texto do botão',
  ctaHref: 'Link do botão',
  secondaryLabel: 'Texto do segundo botão',
  secondaryHref: 'Link do segundo botão',
  cardCta: 'Botão de cada produto',
  cardCaption: 'Legenda de cada produto',
  label: 'Texto',
  linkLabel: 'Texto do link',
  href: 'Link',
  links: 'Links',
  items: 'Itens',
  steps: 'Passos',
  icon: 'Ícone',
  limit: 'Quantos produtos',
  category: 'Categoria (endereço)',
  numbered: 'Numerar os produtos',
  showStatus: 'Mostrar se está aberta',
  showHours: 'Mostrar horários',
  showContacts: 'Mostrar contatos',
  showAddress: 'Mostrar endereço',
  showSearch: 'Mostrar busca',
  showCategoryTabs: 'Mostrar abas de categoria',
  showDescription: 'Mostrar descrição',
  cartLabel: 'Nome da sacola',
  searchLabel: 'Texto da busca',
  allLabel: 'Aba “todos”',
  emptyText: 'Quando não houver produtos',
  addLabel: 'Botão de adicionar',
  backLabel: 'Botão de voltar',
  soldOutText: 'Quando esgotado',
  variant: 'Estilo',
  tone: 'Cor',
  afterAdd: 'Depois de adicionar',
  figTitle: 'Legenda da foto',
  figSub: 'Sublegenda da foto',
  anchor: 'Âncora',
};

const OPTION_NAMES: Record<string, string> = {
  grid: 'grade',
  list: 'lista',
  card: 'cartão',
  inline: 'em linha',
  accent: 'cor da loja',
  surface: 'neutra',
  pill: 'pílula',
  text: 'texto',
  split: 'dividido',
  compact: 'compacto',
  editorial: 'editorial',
  cart: 'ir para a sacola',
  stay: 'continuar na página',
};
export const optionName = (o: string) => OPTION_NAMES[o] ?? o;

export function keyName(k: string) {
  return KEY_NAMES[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

type SchemaField = {
  kind: string;
  default?: unknown;
  max?: number;
  min?: number;
  options?: readonly string[];
  of?: Record<string, SchemaField>;
};

function fromSchema(key: string, f: SchemaField): FieldSpec {
  const label = keyName(key);
  switch (f.kind) {
    case 'text':
    case 'richText':
      return {
        kind: 'text',
        key,
        label,
        max: f.max ?? 200,
        long: f.kind === 'richText' || (f.max ?? 0) > 120,
      };
    case 'number':
      return {
        kind: 'number',
        key,
        label,
        min: f.min ?? 0,
        max: f.max ?? 100,
        ...(typeof f.default === 'number' ? { def: f.default } : {}),
      };
    case 'boolean':
      return {
        kind: 'boolean',
        key,
        label,
        ...(typeof f.default === 'boolean' ? { def: f.default } : {}),
      };
    case 'select':
      return {
        kind: 'select',
        key,
        label,
        options: f.options ?? [],
        ...(typeof f.default === 'string' ? { def: f.default } : {}),
      };
    case 'image':
      return { kind: 'image', key, label };
    case 'url':
      return { kind: 'url', key, label };
    case 'list':
      return {
        kind: 'list',
        key,
        label,
        max: f.max ?? 8,
        of: Object.entries(f.of ?? {}).map(([k, v]) => fromSchema(k, v)),
      };
    default:
      // product/category pickers: the storefront falls back to its own default
      return { kind: 'skip', key };
  }
}

const IMG_RE = /\.(jpe?g|png|webp|avif|gif|svg)(\?.*)?$/i;

function infer(key: string, v: unknown): FieldSpec {
  const label = keyName(key);
  if (typeof v === 'boolean') return { kind: 'boolean', key, label };
  if (typeof v === 'number')
    return { kind: 'number', key, label, min: 0, max: Math.max(24, v * 4) };
  if (typeof v === 'string') {
    if (/image|photo|logo|foto/i.test(key) || IMG_RE.test(v)) return { kind: 'image', key, label };
    if (/href$/i.test(key) || /^(https?:\/\/|\/)/.test(v)) return { kind: 'url', key, label };
    if (key === 'anchor' || key === 'icon' || key === 'category') return { kind: 'skip', key };
    return {
      kind: 'text',
      key,
      label,
      max: v.length > 120 ? 600 : 200,
      long: v.length > 70 || /text|body|lede|description/i.test(key),
    };
  }
  if (
    Array.isArray(v) &&
    v.length &&
    v.every((x) => typeof x === 'object' && x && !Array.isArray(x))
  ) {
    const keys = [...new Set(v.flatMap((x) => Object.keys(x as object)))].sort(
      (a, b) => rank(a) - rank(b),
    );
    return {
      kind: 'list',
      key,
      label,
      max: Math.max(v.length, 8),
      of: keys.map((k) =>
        infer(
          k,
          (
            v.find((x) => (x as Record<string, unknown>)[k] !== undefined) as Record<
              string,
              unknown
            >
          )[k],
        ),
      ),
    };
  }
  return { kind: 'skip', key };
}

const SDK = new Map(
  SDK_SCHEMAS.map((s) => [
    s.type as string,
    s as unknown as { settings: Record<string, SchemaField> },
  ]),
);

// jsonb sorts keys alphabetically — inferred fields follow reading order instead
const READING = [
  'eyebrow',
  'brand',
  'title',
  'titleEmphasis',
  'lede',
  'intro',
  'text',
  'body',
  'description',
  'note',
  'items',
  'steps',
  'links',
  'image',
  'imageAlt',
  'logo',
  'figTitle',
  'figSub',
  'ctaLabel',
  'ctaHref',
  'secondaryLabel',
  'secondaryHref',
  'cardCta',
  'cardCaption',
  'limit',
  'numbered',
  'footnote',
];
const rank = (k: string) => {
  const i = READING.indexOf(k);
  return i < 0 ? READING.length : i;
};

export function fieldsFor(
  type: string,
  settings: Record<string, unknown> | undefined,
): FieldSpec[] {
  const sdk = SDK.get(type);
  if (sdk) return Object.entries(sdk.settings).map(([k, f]) => fromSchema(k, f));
  return Object.entries(settings ?? {})
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([k, v]) => infer(k, v));
}

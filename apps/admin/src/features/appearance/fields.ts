import { resolveSettings, SDK_SCHEMAS } from '@vendua/kernel/sdk-catalog';
import type { ComponentType } from '@vendua/templates';

// What the page editor knows about a section's settings. SDK sections carry their
// real schemas (the Kernel's catalog — pure data). A store's own sections are told by its
// preview frame (Kernel 1.29); a frame built before that says nothing, so their fields are
// inferred from the values the template holds. Either way the merchant edits copy, photos,
// links and picks there, never the section's code (§A5).

export type FieldSpec = (
  | { kind: 'text'; key: string; label: string; max: number; long: boolean; def?: string }
  | { kind: 'number'; key: string; label: string; min: number; max: number; def?: number }
  | { kind: 'boolean'; key: string; label: string; def?: boolean }
  | { kind: 'select'; key: string; label: string; options: readonly string[]; def?: string }
  | { kind: 'image'; key: string; label: string }
  | { kind: 'url'; key: string; label: string }
  | { kind: 'product'; key: string; label: string }
  | { kind: 'category'; key: string; label: string }
  | { kind: 'list'; key: string; label: string; max: number; of: FieldSpec[] }
  | { kind: 'skip'; key: string }
) & { help?: string };

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
  'store:faq': 'Perguntas frequentes',
  'store:catalog-browser': 'Cardápio',
  'store:product-figure': 'Foto do produto',
  'store:product-perks': 'Vantagens do produto',
  // the default bundle's (storefronts/_template)
  'store:menu-hero': 'Capa da loja',
  'store:menu-rail': 'Vitrine',
  'store:menu': 'Cardápio',
  'store:intro': 'Apresentação',
  'store:dish-media': 'Foto do prato',
  // blocks inside a section, should one ever be named on its own
  'sdk:recent-order': 'Seu último pedido',
  'sdk:party-cta': 'Monte sua festa',
  'sdk:plans-cta': 'Planos semanais',
  'sdk:notify-me': 'Avise quando voltar',
  'sdk:delivery-eta': 'Entrega e retirada',
  'sdk:stock-counter': 'Últimas unidades',
  'sdk:promo-badge': 'Selo de promoção',
  'sdk:pix-info': 'Pague com Pix',
  'sdk:loyalty-teaser': 'Cartão fidelidade',
};

/** A store's own part as its preview frame reports it (Kernel 1.29). */
export type StoreSchema = {
  kind: 'section' | 'block';
  settings: Record<string, SchemaField>;
  /** the names of the places it holds blocks in, in its own order */
  areas?: string[];
  title?: string;
  addable?: boolean;
};
export type StoreSchemas = Record<string, StoreSchema>;

/** What the frame says about the store's own parts, kept where it reads like a schema. */
export function readSchemas(raw: unknown): StoreSchemas {
  const out: StoreSchemas = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [type, s] of Object.entries(raw)) {
    if (!type.startsWith('store:') || !s || typeof s !== 'object') continue;
    const { kind, settings, areas, title, addable } = s as Record<string, unknown>;
    if (kind !== 'section' && kind !== 'block') continue;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
    out[type] = {
      kind,
      settings: settings as Record<string, SchemaField>,
      ...(areas && typeof areas === 'object' && !Array.isArray(areas)
        ? { areas: Object.keys(areas) }
        : {}),
      ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 60) } : {}),
      ...(kind === 'section' && addable === true ? { addable: true } : {}),
    };
  }
  return out;
}

/** A store that names its own part knows it better than the admin's guess. */
export const sectionName = (type: string, store?: StoreSchemas) =>
  SDK_TITLES.get(type) ??
  store?.[type]?.title ??
  STORE_SECTION_NAMES[type] ??
  `Seção ${type.replace(/^(sdk|store):/, '').replace(/-/g, ' ')}`;

/** SDK sections a merchant can add to a page (the schemas' `addable`). */
export const ADDABLE: ComponentType[] = SDK_SECTIONS.filter((s) => s.addable).map((s) => s.type);

/** A part's block areas in the order it renders them (a template's are jsonb: alphabetical). */
export function areaOrder(type: string, store?: StoreSchemas): string[] {
  return SDK_AREAS.get(type) ?? store?.[type]?.areas ?? [];
}
const SDK_AREAS = new Map(SDK_SECTIONS.map((s) => [s.type as string, Object.keys(s.areas ?? {})]));

/** What the add sheet offers: the Kernel's, then the store's own that say they may be added. */
export const addable = (store?: StoreSchemas): ComponentType[] => [
  ...ADDABLE,
  ...Object.entries(store ?? {}).flatMap(([type, s]) => (s.addable ? [type as ComponentType] : [])),
];

/** One line on what an addable section is for, in the add sheet. */
export const ADD_HINT: Record<string, string> = {
  'sdk:announcement-bar': 'Uma faixa no alto para um recado: promoção, feriado, novidade.',
  'sdk:catalog-grid': 'Seus produtos em grade, com foto e preço.',
  'sdk:product-list': 'Uma seleção de produtos lado a lado.',
  'sdk:store-status': 'Se a loja está aberta, os horários e o endereço.',
  'sdk:rich-text': 'Um título e um texto seu, como um recado ou a sua história.',
  'sdk:recent-order':
    'Para quem já pediu deste celular: acompanhar o pedido em andamento ou pedir de novo.',
  'sdk:party-cta':
    'Um convite para a calculadora de festa: o cliente diz quantas pessoas e a loja calcula tudo.',
  'sdk:plans-cta':
    'Um convite para os planos semanais: o cliente escolhe uma cesta e recebe toda semana.',
};

/** The words a merchant recognises a section by: its own title or first line of copy, else the
 *  one its store prints when the template sets none. */
export function sectionSummary(
  type: string,
  settings: Record<string, unknown> | undefined,
  store?: StoreSchemas,
): string | null {
  const schema = SDK.get(type) ?? store?.[type];
  for (const k of ['title', 'eyebrow', 'kicker', 'brand', 'text', 'body', 'note', 'label']) {
    const v = settings?.[k] ?? schema?.settings[k]?.default;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

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
  category: 'Categoria',
  product: 'Produto',
  numbered: 'Numerar os produtos',
  showStatus: 'Mostrar se está aberta',
  showHours: 'Mostrar horários',
  showContacts: 'Mostrar contatos',
  showAddress: 'Mostrar endereço',
  showSearch: 'Mostrar busca',
  showCategoryTabs: 'Mostrar abas de categoria',
  showDietFilter: 'Mostrar filtros de dieta',
  categoryNav: 'Ao tocar numa aba de categoria',
  showShare: 'Mostrar botão de compartilhar',
  showNote: 'Mostrar campo de observação',
  showMinOrder: 'Mostrar pedido mínimo e entrega grátis',
  showFee: 'Mostrar taxa de entrega',
  showPickup: 'Mostrar retirada',
  storeTitle: 'Título com a loja fechada',
  successText: 'Depois de pedir o aviso',
  showWhenPlenty: 'Mostrar mesmo com bastante estoque',
  showQr: 'Mostrar o QR code',
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
  proof: 'Selos (separe cada um com |)',
  cover: 'Foto de capa',
  kicker: 'Chamada acima do título',
  subtitle: 'Subtítulo',
  blurb: 'Texto curto sobre a loja',
  text2: 'Segundo parágrafo',
  quote: 'Citação',
  signature: 'Assinatura',
  slogan: 'Slogan',
  hint: 'Dica',
  question: 'Pergunta',
  answer: 'Resposta',
  handle: 'Seu @ no Instagram',
  cta: 'Texto do botão',
  feature: 'Cartões grandes, deitados',
  fileName: 'Nome do arquivo do QR code',
  qrLabel: 'Texto do link do QR code',
  qrHref: 'Link do QR code',
  contactsTitle: 'Título dos contatos',
  featuredLabel: 'Título dos destaques',
  whatsappLabel: 'Botão do WhatsApp',
  threshold: 'Mostrar quando restarem até',
  // the small words a store's own part prints
  openLabel: 'Quando está aberta',
  closedLabel: 'Quando está fechada',
  pausedLabel: 'Quando está pausada',
  untilLabel: 'Antes da hora de fechar',
  opensLabel: 'Antes da hora de abrir',
  todayLabel: 'Hoje',
  everyDayLabel: 'Aberta todos os dias',
  closedDayLabel: 'Dia em que fecha',
  moreLabel: 'Link de endereço e horários',
  deliveryLabel: 'Entrega',
  fromLabel: 'Antes da menor taxa',
  freeDeliveryLabel: 'Entrega grátis',
  someFreeLabel: 'Grátis só em algumas regiões',
  freeOverLabel: 'Grátis acima de um valor',
  pickupLabel: 'Retirada',
  minOrderLabel: 'Pedido mínimo',
  soldOutLabel: 'Quando esgotado',
  lowStockLabel: 'Quando restam poucas unidades',
  preorderLabel: 'Sob encomenda',
  inBagLabel: 'Já na sacola',
  allInBagLabel: 'Todas as unidades na sacola',
  prevLabel: 'Seta para trás (para leitores de tela)',
  nextLabel: 'Seta para a frente (para leitores de tela)',
  categoriesLabel: 'Lista de categorias (para leitores de tela)',
  newTabLabel: 'Aviso de que abre em nova aba (para leitores de tela)',
  searchPlaceholder: 'Dica dentro da busca',
  resultsLabel: 'Título dos resultados da busca',
  emptyTitle: 'Título com o cardápio vazio',
  noMatchTitle: 'Quando a busca não acha nada',
  resetLabel: 'Botão de limpar a busca',
  errorTitle: 'Quando o cardápio não carrega',
  retryLabel: 'Botão de tentar de novo',
  itemSingular: 'Um produto se chama',
  itemPlural: 'Vários produtos se chamam',
};

/** One line under a setting whose name alone doesn't say what the shopper sees. */
const KEY_HELP: Record<string, string> = {
  showDietFilter: 'Vegano, sem glúten e outros: só as dietas que algum produto seu informa.',
  categoryNav:
    'Mostrar só a categoria troca a lista a cada toque. Rolar até ela deixa o cardápio inteiro na página.',
  showShare: 'Para o cliente mandar o link do produto a alguém.',
  showNote: 'O cliente deixa uma observação no item, como “sem cebola”, e ela chega à cozinha.',
  showMinOrder: 'Como estão nas suas áreas de entrega.',
  storeTitle: 'Quando a loja está fechada, o cliente pede um aviso para quando ela abrir.',
  untilLabel: 'Como em “até 22h”.',
  opensLabel: 'Como em “abre 18h”.',
  fromLabel: 'Como em “a partir de R$ 5”.',
  freeOverLabel: 'Como em “grátis acima de R$ 80”.',
  lowStockLabel: 'Como em “restam 3”.',
  itemSingular: 'Vazio usa a palavra do seu cardápio, como “pudim”.',
  itemPlural: 'Vazio usa a palavra do seu cardápio, como “pudins”.',
  feature: 'Bom para kits e combos.',
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
  filter: 'mostrar só a categoria',
  jump: 'rolar até a categoria',
  // the icons a store's own part may pick
  heart: 'coração',
  snowflake: 'gelado',
  truck: 'entrega',
  utensils: 'talheres',
  shield: 'segurança',
  bag: 'sacola',
};
export const optionName = (o: string) => OPTION_NAMES[o] ?? o;

export function keyName(k: string) {
  return KEY_NAMES[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

type SchemaField = {
  kind: string;
  label?: string;
  default?: unknown;
  max?: number;
  min?: number;
  options?: readonly unknown[];
  of?: Record<string, SchemaField>;
};

/** Where a part links within its own page (a menu's "nossa história"): moving it breaks that. */
const TECHNICAL = new Set(['anchor', 'storyAnchor']);

function fromSchema(key: string, f: SchemaField): FieldSpec {
  if (!f || typeof f !== 'object' || TECHNICAL.has(key)) return { kind: 'skip', key };
  const spec = fromKind(key, f);
  return KEY_HELP[key] ? { ...spec, help: KEY_HELP[key] } : spec;
}

// a store's schema arrives from its frame: a value that isn't what it should be is left out
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function fromKind(key: string, f: SchemaField): FieldSpec {
  // the admin's own words first (they match its other switches), then the Kernel's
  const label = KEY_NAMES[key] ?? (typeof f.label === 'string' && f.label ? f.label : keyName(key));
  switch (f.kind) {
    case 'text':
    case 'richText': {
      const max = Math.max(1, num(f.max, 200));
      return {
        kind: 'text',
        key,
        label,
        max,
        long: f.kind === 'richText' || max > 120,
        ...(typeof f.default === 'string' && f.default ? { def: f.default } : {}),
      };
    }
    case 'number':
      return {
        kind: 'number',
        key,
        label,
        min: num(f.min, 0),
        max: num(f.max, 100),
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
        options: Array.isArray(f.options)
          ? f.options.filter((o): o is string => typeof o === 'string')
          : [],
        ...(typeof f.default === 'string' ? { def: f.default } : {}),
      };
    case 'image':
      return { kind: 'image', key, label };
    case 'url':
      return { kind: 'url', key, label };
    case 'product':
    case 'category':
      return { kind: f.kind, key, label };
    case 'list':
      return {
        kind: 'list',
        key,
        label,
        max: num(f.max, 8),
        of:
          f.of && typeof f.of === 'object'
            ? Object.entries(f.of).map(([k, v]) => fromSchema(k, v))
            : [],
      };
    default:
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
    if (key === 'category' || key === 'product') return { kind: key, key, label };
    if (TECHNICAL.has(key) || key === 'icon') return { kind: 'skip', key };
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

/** `folded`: under "mais textos", closed until asked for */
export type FieldGroup = { label: string | null; fields: FieldSpec[]; folded?: boolean };

const GROUPS: [string, (f: FieldSpec) => boolean][] = [
  ['Fotos', (f) => f.kind === 'image' || /^(image|logo|fig)/i.test(f.key)],
  ['Botões e links', (f) => f.kind === 'url' || BUTTONS.test(f.key)],
  [
    'Opções',
    (f) =>
      f.kind === 'boolean' ||
      f.kind === 'select' ||
      f.kind === 'number' ||
      f.kind === 'product' ||
      f.kind === 'category',
  ],
];

// the small words a part prints (aberto agora, esgotado, na sacola, limpar busca), each with
// the store's own default: most stores never change them, and a dozen of them would bury the
// title and the photo
const SMALL = /(Label|Placeholder)$|^(empty|noMatch|error|results)[A-Z]/;
const BUTTONS = /^(cta|secondary|link|cardCta)/i;
const FOLD_FROM = 4;

/** Long forms read in chunks (textos, fotos, botões, opções, mais textos); a short one stays
 *  one list. */
export function groupFields(fields: FieldSpec[]): FieldGroup[] {
  const all = fields.filter((f) => f.kind !== 'skip');
  const small = all.filter((f) => f.kind === 'text' && SMALL.test(f.key) && !BUTTONS.test(f.key));
  const folded = small.length >= FOLD_FROM ? small : [];
  const shown = all.filter((f) => !folded.includes(f));
  const more: FieldGroup[] = folded.length
    ? [{ label: 'Mais textos', fields: folded, folded: true }]
    : [];
  const out: FieldGroup[] = [{ label: 'Textos', fields: [] }];
  for (const f of shown) {
    // a list is a group of its own, titled by its field
    const name = f.kind === 'list' ? null : (GROUPS.find(([, test]) => test(f))?.[0] ?? 'Textos');
    const g = name === null ? undefined : out.find((x) => x.label === name);
    if (g) g.fields.push(f);
    else out.push({ label: name, fields: [f] });
  }
  const groups = out.filter((g) => g.fields.length);
  if (shown.length <= 3 || groups.length < 2)
    return [...(shown.length ? [{ label: null, fields: shown }] : []), ...more];
  return [...groups, ...more];
}

/**
 * A part's fields: the Kernel's schema for its own, the store's (from its frame) for the
 * store's, else inferred from the template. On the product page a product pick is left out: the
 * page shows the product in its address, and a pick there would show one product on all of them.
 */
export function fieldsFor(
  type: string,
  settings: Record<string, unknown> | undefined,
  ctx: { store?: StoreSchemas; page?: string } = {},
): FieldSpec[] {
  const schema = SDK.get(type) ?? ctx.store?.[type];
  if (schema)
    return Object.entries(schema.settings).map(([k, f]) => {
      const spec = fromSchema(k, f);
      return spec.kind === 'product' && ctx.page === 'product' ? { kind: 'skip', key: k } : spec;
    });
  return Object.entries(settings ?? {})
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([k, v]) => infer(k, v));
}

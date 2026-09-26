// Page templates are data (docs/architecture/17-page-composition.md). This module
// is framework-free: Core validates and versions them, the Kernel renders them,
// the CLI migrates them — all against the same shapes and caps.

export const TEMPLATE_VERSION = 1 as const;

export type PageId = 'layout' | 'home' | 'catalog' | 'product' | `page:${string}`;
export type ComponentType = `sdk:${string}` | `store:${string}`;

export interface BlockInstance {
  id: string;
  type: ComponentType;
  settings?: Record<string, unknown>;
}

export interface SectionInstance {
  id: string;
  type: ComponentType;
  settings?: Record<string, unknown>;
  blocks?: Record<string, BlockInstance[]>;
  disabled?: boolean;
}

export interface PageTemplate {
  version: typeof TEMPLATE_VERSION;
  page: PageId;
  sections: SectionInstance[];
  /** Types a merchant removed; migrations never re-add them. */
  removed?: ComponentType[];
}

export type TemplateSet = Partial<Record<PageId, PageTemplate>>;

/** Block categories an area can accept (17 — blocks and areas). Additive only. */
export const BLOCK_CATEGORIES = [
  'purchase-extras',
  'badge',
  'social-proof',
  'promo',
  'info',
  'media',
] as const;
export type BlockCategory = (typeof BLOCK_CATEGORIES)[number];

/** The layout template marks where each page renders with this section. */
export const PAGE_CONTENT = 'sdk:page-content' as const;

export const LIMITS = {
  sections: 40,
  blocksPerArea: 12,
  areas: 12,
  settingsBytes: 16 * 1024,
  templateBytes: 128 * 1024,
  removed: 64,
} as const;

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const TYPE_RE = /^(sdk|store):[a-z0-9][a-z0-9-]{0,39}$/;
export const PAGE_RE = /^(layout|home|catalog|product|page:[a-z0-9][a-z0-9-]{0,39})$/;
const AREA_RE = /^[a-z0-9][a-z0-9.-]{0,39}$/;

export type ValidationResult =
  { ok: true; template: PageTemplate } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function bytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v) ?? '').length;
}

function checkSettings(where: string, s: unknown, errors: string[]) {
  if (s === undefined) return;
  if (!isObj(s)) errors.push(`${where}.settings must be an object`);
  else if (bytes(s) > LIMITS.settingsBytes)
    errors.push(`${where}.settings exceeds ${LIMITS.settingsBytes} bytes`);
}

/** Shape + caps check. Unknown section/block *types* are valid here — rendering
 *  decides what it knows, so a template may reference features newer than a build. */
export function validateTemplate(input: unknown, expectPage?: PageId): ValidationResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['template must be an object'] };
  if (input.version !== TEMPLATE_VERSION)
    errors.push(`version must be ${TEMPLATE_VERSION} (got ${JSON.stringify(input.version)})`);
  if (typeof input.page !== 'string' || !PAGE_RE.test(input.page))
    errors.push(`page must match ${PAGE_RE}`);
  else if (expectPage && input.page !== expectPage)
    errors.push(`page is '${input.page}', expected '${expectPage}'`);
  if (!Array.isArray(input.sections)) errors.push('sections must be an array');
  else if (input.sections.length > LIMITS.sections)
    errors.push(`at most ${LIMITS.sections} sections`);
  if (bytes(input) > LIMITS.templateBytes)
    errors.push(`template exceeds ${LIMITS.templateBytes} bytes`);

  const ids = new Set<string>();
  const seeId = (where: string, id: unknown) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) errors.push(`${where}.id must match ${ID_RE}`);
    else if (ids.has(id)) errors.push(`${where}.id '${id}' is not unique in the template`);
    else ids.add(id);
  };

  let pageContent = 0;
  if (Array.isArray(input.sections)) {
    input.sections.forEach((s: unknown, i: number) => {
      const where = `sections[${i}]`;
      if (!isObj(s)) {
        errors.push(`${where} must be an object`);
        return;
      }
      seeId(where, s.id);
      if (typeof s.type !== 'string' || !TYPE_RE.test(s.type))
        errors.push(`${where}.type must match ${TYPE_RE}`);
      if (s.type === PAGE_CONTENT) pageContent++;
      if (s.disabled !== undefined && typeof s.disabled !== 'boolean')
        errors.push(`${where}.disabled must be boolean`);
      checkSettings(where, s.settings, errors);
      if (s.blocks === undefined) return;
      if (!isObj(s.blocks)) {
        errors.push(`${where}.blocks must be an object keyed by area`);
        return;
      }
      const areas = Object.entries(s.blocks);
      if (areas.length > LIMITS.areas) errors.push(`${where} has more than ${LIMITS.areas} areas`);
      for (const [area, list] of areas) {
        if (!AREA_RE.test(area)) errors.push(`${where}.blocks: bad area name '${area}'`);
        if (!Array.isArray(list)) {
          errors.push(`${where}.blocks.${area} must be an array`);
          continue;
        }
        if (list.length > LIMITS.blocksPerArea)
          errors.push(`${where}.blocks.${area} has more than ${LIMITS.blocksPerArea} blocks`);
        list.forEach((b: unknown, j: number) => {
          const bw = `${where}.blocks.${area}[${j}]`;
          if (!isObj(b)) {
            errors.push(`${bw} must be an object`);
            return;
          }
          seeId(bw, b.id);
          if (typeof b.type !== 'string' || !TYPE_RE.test(b.type))
            errors.push(`${bw}.type must match ${TYPE_RE}`);
          checkSettings(bw, b.settings, errors);
        });
      }
    });
  }
  if (input.page === 'layout' && pageContent !== 1)
    errors.push(`the layout template needs exactly one '${PAGE_CONTENT}' section`);
  if (input.page !== 'layout' && pageContent > 0)
    errors.push(`'${PAGE_CONTENT}' only belongs in the layout template`);

  if (input.removed !== undefined) {
    if (!Array.isArray(input.removed) || input.removed.length > LIMITS.removed)
      errors.push(`removed must be an array of at most ${LIMITS.removed} types`);
    else if (input.removed.some((t) => typeof t !== 'string' || !TYPE_RE.test(t)))
      errors.push('removed entries must be component types');
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, template: input as unknown as PageTemplate };
}

export function componentTypes(t: PageTemplate): Set<ComponentType> {
  const out = new Set<ComponentType>();
  for (const s of t.sections) {
    out.add(s.type);
    for (const list of Object.values(s.blocks ?? {})) for (const b of list) out.add(b.type);
  }
  return out;
}

/** A merchant/staff edit that drops a type records it, so no migration re-adds it. */
export function withRemovals(prev: PageTemplate | null, next: PageTemplate): PageTemplate {
  const removed = new Set<ComponentType>(next.removed ?? prev?.removed ?? []);
  if (prev) {
    const now = componentTypes(next);
    for (const t of componentTypes(prev)) if (!now.has(t)) removed.add(t);
    // re-adding by hand clears the tombstone
    for (const t of now) removed.delete(t);
  }
  const list = [...removed].slice(-LIMITS.removed);
  const out: PageTemplate = { ...next };
  if (list.length) out.removed = list;
  else delete out.removed;
  return out;
}

/** Page path routing for content pages: `page:<handle>` renders at `/<handle>`. */
export function contentHandle(page: PageId): string | null {
  return page.startsWith('page:') ? page.slice(5) : null;
}

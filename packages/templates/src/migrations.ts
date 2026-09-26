import {
  componentTypes,
  validateTemplate,
  type BlockInstance,
  type ComponentType,
  type PageId,
  type PageTemplate,
  type SectionInstance,
} from './model.ts';
import { satisfies } from './semver.ts';

// Template migrations place features on existing stores (17 — template migrations):
// deterministic, idempotent, never touching merchant settings, never re-adding
// what a merchant removed.

export class MigrationConflict extends Error {}

type NewSection = Omit<SectionInstance, 'id'> & { id?: string };
type NewBlock = Omit<BlockInstance, 'id'> & { id?: string };

/** Mutable working copy handed to `up()`; every op addresses sections/blocks by type or id. */
export class TemplateEditor {
  readonly page: PageId;
  private t: PageTemplate;

  constructor(template: PageTemplate) {
    this.t = structuredClone(template);
    this.page = template.page;
  }

  get sections(): readonly SectionInstance[] {
    return this.t.sections;
  }

  /** True when the type appears as a section or a block anywhere on the page. */
  has(type: ComponentType): boolean {
    return componentTypes(this.t).has(type);
  }

  /** The merchant removed this type before — migrations must leave it out. */
  wasRemoved(type: ComponentType): boolean {
    return (this.t.removed ?? []).includes(type);
  }

  find(type: ComponentType): SectionInstance | undefined {
    return this.t.sections.find((s) => s.type === type);
  }

  private freshId(type: string): string {
    const used = new Set<string>();
    for (const s of this.t.sections) {
      used.add(s.id);
      for (const list of Object.values(s.blocks ?? {})) for (const b of list) used.add(b.id);
    }
    const base = type.replace(':', '-').slice(0, 36);
    if (!used.has(base)) return base;
    for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private make(s: NewSection): SectionInstance {
    return { ...s, id: s.id ?? this.freshId(s.type) };
  }

  insertAfter(anchor: ComponentType | { id: string }, section: NewSection): this {
    const i = this.indexOf(anchor);
    if (i < 0) throw new MigrationConflict(`anchor ${JSON.stringify(anchor)} not on ${this.page}`);
    this.t.sections.splice(i + 1, 0, this.make(section));
    return this;
  }

  insertBefore(anchor: ComponentType | { id: string }, section: NewSection): this {
    const i = this.indexOf(anchor);
    if (i < 0) throw new MigrationConflict(`anchor ${JSON.stringify(anchor)} not on ${this.page}`);
    this.t.sections.splice(i, 0, this.make(section));
    return this;
  }

  append(section: NewSection): this {
    this.t.sections.push(this.make(section));
    return this;
  }

  remove(type: ComponentType): this {
    this.t.sections = this.t.sections.filter((s) => s.type !== type);
    for (const s of this.t.sections)
      for (const [area, list] of Object.entries(s.blocks ?? {}))
        s.blocks![area] = list.filter((b) => b.type !== type);
    return this;
  }

  /** Append a block to a section's area (creating the area list if needed). */
  addBlock(target: SectionInstance | { id: string }, area: string, block: NewBlock): this {
    const s = this.t.sections.find((x) => x.id === target.id);
    if (!s) throw new MigrationConflict(`section '${target.id}' not on ${this.page}`);
    s.blocks ??= {};
    (s.blocks[area] ??= []).push({ ...block, id: block.id ?? this.freshId(block.type) });
    return this;
  }

  private indexOf(anchor: ComponentType | { id: string }): number {
    return this.t.sections.findIndex((s) =>
      typeof anchor === 'string' ? s.type === anchor : s.id === anchor.id,
    );
  }

  result(): PageTemplate {
    return this.t;
  }
}

/** What a build knows about its section modules — published in the artifact
 *  manifest so migrations can target areas by category without running store code. */
export type SectionCatalog = Record<
  string,
  { areas?: Record<string, { accepts: readonly string[]; max?: number }> }
>;

export interface MigrationContext {
  /** Kernel version of the store's current artifact (from its manifest). */
  kernelVersion?: string | undefined;
  sections?: SectionCatalog | undefined;
}

export interface TemplateMigration {
  id: string;
  description: string;
  /** Stores on an older Kernel are skipped, not broken. */
  requiresKernel?: string;
  pages: PageId[];
  up(t: TemplateEditor, ctx: MigrationContext): void;
}

export function defineTemplateMigration(m: TemplateMigration): TemplateMigration {
  if (!/^\d{4}-\d{2}-[a-z0-9-]+$/.test(m.id))
    throw new Error(`migration id '${m.id}' must look like YYYY-MM-some-name`);
  return m;
}

export type MigrationOutcome =
  | { status: 'applied'; template: PageTemplate }
  | { status: 'skipped'; reason: string }
  | { status: 'conflict'; reason: string };

export function runMigration(
  m: TemplateMigration,
  template: PageTemplate,
  ctx: MigrationContext = {},
): MigrationOutcome {
  if (!m.pages.includes(template.page))
    return { status: 'skipped', reason: `page ${template.page} not targeted` };
  if (m.requiresKernel) {
    if (!ctx.kernelVersion)
      return { status: 'skipped', reason: 'store kernel version unknown (no build recorded)' };
    if (!satisfies(ctx.kernelVersion, m.requiresKernel))
      return {
        status: 'skipped',
        reason: `kernel ${ctx.kernelVersion} does not satisfy ${m.requiresKernel}`,
      };
  }
  const editor = new TemplateEditor(template);
  try {
    m.up(editor, ctx);
  } catch (err) {
    if (err instanceof MigrationConflict) return { status: 'conflict', reason: err.message };
    throw err;
  }
  const next = editor.result();
  if (JSON.stringify(next) === JSON.stringify(template))
    return { status: 'skipped', reason: 'already applied or not applicable' };
  // a migration may never re-add a merchant-removed type
  const before = componentTypes(template);
  for (const t of componentTypes(next))
    if (!before.has(t) && (template.removed ?? []).includes(t))
      return { status: 'skipped', reason: `merchant removed ${t}` };
  const valid = validateTemplate(next, template.page);
  if (!valid.ok) return { status: 'conflict', reason: valid.errors.join('; ') };
  return { status: 'applied', template: next };
}

/** First area (in section order) that accepts `category`, per the build's section catalog. */
export function findArea(
  t: TemplateEditor,
  category: string,
  sections: SectionCatalog | undefined,
): { section: SectionInstance; area: string } | null {
  for (const s of t.sections) {
    if (s.disabled) continue;
    const areas = sections?.[s.type]?.areas ?? {};
    for (const [area, spec] of Object.entries(areas)) {
      if (!spec.accepts.includes(category)) continue;
      const count = s.blocks?.[area]?.length ?? 0;
      if (spec.max !== undefined && count >= spec.max) continue;
      return { section: s, area };
    }
  }
  return null;
}

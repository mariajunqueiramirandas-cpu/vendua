import type { ComponentType } from 'react';
import type { StorefrontTokens, TemplateSet } from '@vendua/templates';
import type { BlockSchema, SectionSchema, SettingsValues } from './schema.ts';

// What a storefront build hands the provider (virtual:vendua/storefront):
// its own section/block modules and the template/token snapshot it was built with.

export interface SectionComponentProps<S extends SectionSchema | BlockSchema = SectionSchema> {
  settings: SettingsValues<S['settings']>;
  /** stable instance id from the template (migrations and merchant edits use it) */
  id: string;
}
export type SectionProps<S extends SectionSchema> = SectionComponentProps<S>;
export type BlockProps<S extends BlockSchema> = SectionComponentProps<S>;

export interface ComponentModule {
  schema: SectionSchema | BlockSchema;
  default: ComponentType<SectionComponentProps<never>>;
}

export interface StorefrontSnapshot {
  templates: TemplateSet;
  tokens: StorefrontTokens | null;
  source?: 'core' | 'repo';
}

export interface StorefrontBundle {
  /** `import.meta.glob('/sections/*.tsx', { eager: true })` — keyed by file path */
  sections: Record<string, unknown>;
  snapshot: StorefrontSnapshot;
}

export interface RegisteredComponent {
  schema: SectionSchema | BlockSchema;
  Component: ComponentType<SectionComponentProps<never>>;
  source: 'sdk' | 'store';
}

function isModule(m: unknown): m is ComponentModule {
  if (!m || typeof m !== 'object') return false;
  const mod = m as Partial<ComponentModule>;
  return (
    typeof mod.default === 'function' &&
    !!mod.schema &&
    (mod.schema.kind === 'section' || mod.schema.kind === 'block')
  );
}

/** Store modules may only register `store:*` types — the `sdk:` namespace is the Kernel's. */
export function buildRegistry(
  sdk: RegisteredComponent[],
  storeModules: Record<string, unknown>,
): Map<string, RegisteredComponent> {
  const reg = new Map<string, RegisteredComponent>();
  for (const c of sdk) reg.set(c.schema.type, c);
  for (const [path, m] of Object.entries(storeModules)) {
    if (!isModule(m)) {
      console.warn(
        `[vendua] ${path}: not a section module (needs \`export const schema\` + default component)`,
      );
      continue;
    }
    if (!m.schema.type.startsWith('store:')) {
      console.warn(
        `[vendua] ${path}: store sections must use a 'store:' type, got '${m.schema.type}'`,
      );
      continue;
    }
    reg.set(m.schema.type, { schema: m.schema, Component: m.default, source: 'store' });
  }
  return reg;
}

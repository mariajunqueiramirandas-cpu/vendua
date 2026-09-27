import type { BlockCategory } from '@vendua/templates';

// Section/block settings schemas (17 — sections). Content is data: a section's
// copy, images and product picks are settings in the template, validated here.
// Invalid or unknown values fall back to the default — never a crash.

type Base<K extends string, T> = { kind: K; default?: T; label?: string };

export type TextField = Base<'text', string> & { max: number };
export type RichTextField = Base<'richText', string> & { max: number };
export type NumberField = Base<'number', number> & { min: number; max: number };
export type BooleanField = Base<'boolean', boolean>;
export type SelectField<O extends string = string> = Base<'select', O> & {
  options: readonly O[];
  default: O;
};
export type ImageField = Base<'image', string>;
export type UrlField = Base<'url', string>;
export type ProductField = Base<'product', string>;
export type CategoryField = Base<'category', string>;
export interface ListField<F extends Record<string, Field> = Record<string, Field>> {
  kind: 'list';
  of: F;
  max: number;
  default?: SettingsValues<F>[];
  label?: string;
}

export type Field =
  | TextField
  | RichTextField
  | NumberField
  | BooleanField
  | SelectField
  | ImageField
  | UrlField
  | ProductField
  | CategoryField
  | ListField;

type ValueOf<F> =
  F extends SelectField<infer O>
    ? O
    : F extends ListField<infer G>
      ? SettingsValues<G>[]
      : F extends Base<string, infer T>
        ? T
        : never;

type HasDefault<F> = F extends { default: unknown } ? true : false;

/** Fields with a default are always present; the rest may be undefined. */
export type SettingsValues<S extends Record<string, Field>> = {
  [K in keyof S as HasDefault<S[K]> extends true ? K : never]: ValueOf<S[K]>;
} & {
  [K in keyof S as HasDefault<S[K]> extends true ? never : K]?: ValueOf<S[K]>;
};

export const text = <D extends string | undefined = undefined>(o: {
  max: number;
  default?: D;
  label?: string;
}) => ({ kind: 'text', ...o }) as TextField & (D extends string ? { default: string } : unknown);
export const richText = <D extends string | undefined = undefined>(o: {
  max: number;
  default?: D;
  label?: string;
}) =>
  ({ kind: 'richText', ...o }) as RichTextField &
    (D extends string ? { default: string } : unknown);
export const number = <D extends number | undefined = undefined>(o: {
  min: number;
  max: number;
  default?: D;
  label?: string;
}) =>
  ({ kind: 'number', ...o }) as NumberField & (D extends number ? { default: number } : unknown);
export const boolean = <D extends boolean | undefined = undefined>(
  o: { default?: D; label?: string } = {},
) =>
  ({ kind: 'boolean', ...o }) as BooleanField &
    (D extends boolean ? { default: boolean } : unknown);
export const select = <const O extends string>(
  options: readonly O[],
  o: { default: O; label?: string },
) => ({ kind: 'select', options, ...o }) as SelectField<O>;
export const image = <D extends string | undefined = undefined>(
  o: { default?: D; label?: string } = {},
) => ({ kind: 'image', ...o }) as ImageField & (D extends string ? { default: string } : unknown);
export const url = <D extends string | undefined = undefined>(
  o: { default?: D; label?: string } = {},
) => ({ kind: 'url', ...o }) as UrlField & (D extends string ? { default: string } : unknown);
export const product = (o: { label?: string } = {}) => ({ kind: 'product', ...o }) as ProductField;
export const category = (o: { label?: string } = {}) =>
  ({ kind: 'category', ...o }) as CategoryField;
export const list = <F extends Record<string, Field>>(
  of: F,
  o: { max: number; default?: SettingsValues<F>[]; label?: string },
) =>
  ({ kind: 'list', of, ...o }) as ListField<F> &
    (typeof o.default extends undefined ? unknown : { default: SettingsValues<F>[] });

export interface AreaSpec {
  accepts: readonly (BlockCategory | (string & {}))[];
  max?: number;
}

export interface SectionSchema<S extends Record<string, Field> = Record<string, Field>> {
  kind: 'section';
  type: `sdk:${string}` | `store:${string}`;
  settings: S;
  areas?: Record<string, AreaSpec>;
}

export interface BlockSchema<S extends Record<string, Field> = Record<string, Field>> {
  kind: 'block';
  type: `sdk:${string}` | `store:${string}`;
  category: BlockCategory | (string & {});
  settings: S;
}

export function defineSection<const S extends Record<string, Field>>(
  s: Omit<SectionSchema<S>, 'kind'>,
): SectionSchema<S> {
  return { kind: 'section', ...s };
}

export function defineBlock<const S extends Record<string, Field>>(
  s: Omit<BlockSchema<S>, 'kind'>,
): BlockSchema<S> {
  return { kind: 'block', ...s };
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const SAFE_URL = /^(\/(?!\/)|https:\/\/|#|mailto:|tel:|https:\/\/wa\.me\/)/;

function coerce(field: Field, raw: unknown): unknown {
  switch (field.kind) {
    case 'text':
    case 'richText':
      return typeof raw === 'string' && raw.length <= field.max ? raw : field.default;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) && raw >= field.min && raw <= field.max
        ? raw
        : field.default;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : field.default;
    case 'select':
      return typeof raw === 'string' && field.options.includes(raw) ? raw : field.default;
    case 'image':
    case 'url':
      // no javascript:/data: — a template is data a merchant can edit
      return typeof raw === 'string' && raw.length <= 500 && SAFE_URL.test(raw)
        ? raw
        : field.default;
    case 'product':
    case 'category':
      return typeof raw === 'string' && SLUG_RE.test(raw) ? raw : field.default;
    case 'list': {
      if (!Array.isArray(raw)) return field.default;
      return raw
        .slice(0, field.max)
        .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
        .map((x) => resolveSettings(field.of, x as Record<string, unknown>));
    }
  }
}

export function resolveSettings<S extends Record<string, Field>>(
  schema: S,
  raw: Record<string, unknown> | undefined,
): SettingsValues<S> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const v = coerce(field, raw?.[key]);
    if (v !== undefined) out[key] = v;
  }
  return out as SettingsValues<S>;
}

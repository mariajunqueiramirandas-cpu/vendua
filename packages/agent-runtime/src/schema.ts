// Standard Schema v1 (standardschema.dev) is the only contract the runtime needs from a schema:
// tools validate with `~standard.validate` and send `jsonSchema` to providers. `s` is a small
// built-in implementation so the runtime has no dependency; a host may use any library that
// implements the interface (ADR 0030 open decision 3) and pass `jsonSchema` itself.

export interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

export type StandardResult<O> =
  | { readonly value: O; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

export interface StandardSchemaV1<I = unknown, O = I> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<O> | Promise<StandardResult<O>>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

export type InferOutput<S> = S extends StandardSchemaV1<unknown, infer O> ? O : never;

export type JsonSchema = { [k: string]: unknown };

export async function validate<O>(
  schema: StandardSchemaV1<unknown, O>,
  value: unknown,
): Promise<StandardResult<O>> {
  return schema['~standard'].validate(value);
}

export function formatIssues(issues: ReadonlyArray<StandardIssue>): string {
  return issues
    .slice(0, 8)
    .map((i) => {
      const path = (i.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)).join('.');
      return path ? `${path}: ${i.message}` : i.message;
    })
    .join('; ');
}

type Issue = { message: string; path: PropertyKey[] };
type Check<T> = (value: unknown, path: PropertyKey[], issues: Issue[]) => T | undefined;

export class Schema<T> implements StandardSchemaV1<unknown, T> {
  readonly '~standard': StandardSchemaV1<unknown, T>['~standard'];
  /** True when the key may be absent from an object. */
  readonly isOptional: boolean;

  constructor(
    readonly check: Check<T>,
    readonly jsonSchema: JsonSchema,
    isOptional = false,
  ) {
    this.isOptional = isOptional;
    this['~standard'] = {
      version: 1,
      vendor: 'vendua',
      validate: (value: unknown): StandardResult<T> => {
        const issues: Issue[] = [];
        const out = this.check(value, [], issues);
        return issues.length ? { issues } : { value: out as T };
      },
    };
  }

  optional(): Schema<T | undefined> {
    return new Schema<T | undefined>(
      (v, p, i) => (v === undefined ? undefined : this.check(v, p, i)),
      this.jsonSchema,
      true,
    );
  }

  nullable(): Schema<T | null> {
    const inner = this.jsonSchema;
    return new Schema<T | null>(
      (v, p, i) => (v === null ? null : this.check(v, p, i)),
      { anyOf: [inner, { type: 'null' }] },
      this.isOptional,
    );
  }

  describe(description: string): Schema<T> {
    return new Schema(this.check, { ...this.jsonSchema, description }, this.isOptional);
  }
}

function fail(issues: Issue[], path: PropertyKey[], message: string): undefined {
  issues.push({ message, path: [...path] });
  return undefined;
}

interface StringOpts {
  min?: number;
  max?: number;
  pattern?: RegExp;
}

function string(opts: StringOpts = {}): Schema<string> {
  // every string is bounded: the default cap keeps a model from sending a novel as an argument
  const max = opts.max ?? 2000;
  const js: JsonSchema = { type: 'string', maxLength: max };
  if (opts.min !== undefined) js.minLength = opts.min;
  if (opts.pattern) js.pattern = opts.pattern.source;
  return new Schema<string>((v, p, i) => {
    if (typeof v !== 'string') return fail(i, p, 'expected a string');
    if (v.length > max) return fail(i, p, `at most ${max} characters`);
    if (opts.min !== undefined && v.length < opts.min)
      return fail(i, p, `at least ${opts.min} characters`);
    if (opts.pattern && !opts.pattern.test(v)) return fail(i, p, `must match ${opts.pattern}`);
    return v;
  }, js);
}

interface NumberOpts {
  min?: number;
  max?: number;
}

function numberLike(int: boolean, opts: NumberOpts): Schema<number> {
  const js: JsonSchema = { type: int ? 'integer' : 'number' };
  if (opts.min !== undefined) js.minimum = opts.min;
  if (opts.max !== undefined) js.maximum = opts.max;
  return new Schema<number>((v, p, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fail(i, p, 'expected a number');
    if (int && !Number.isInteger(v)) return fail(i, p, 'expected an integer');
    if (opts.min !== undefined && v < opts.min) return fail(i, p, `at least ${opts.min}`);
    if (opts.max !== undefined && v > opts.max) return fail(i, p, `at most ${opts.max}`);
    return v;
  }, js);
}

function boolean(): Schema<boolean> {
  return new Schema<boolean>(
    (v, p, i) => (typeof v === 'boolean' ? v : fail(i, p, 'expected a boolean')),
    { type: 'boolean' },
  );
}

function literal<const L extends string | number | boolean>(value: L): Schema<L> {
  return new Schema<L>(
    (v, p, i) => (v === value ? value : fail(i, p, `expected ${String(value)}`)),
    {
      const: value,
    },
  );
}

function enumOf<const E extends readonly [string, ...string[]]>(values: E): Schema<E[number]> {
  const set = new Set<string>(values);
  return new Schema<E[number]>(
    (v, p, i) =>
      typeof v === 'string' && set.has(v)
        ? (v as E[number])
        : fail(i, p, `expected one of ${values.join(', ')}`),
    { type: 'string', enum: [...values] },
  );
}

interface ArrayOpts {
  min?: number;
  max?: number;
}

function array<T>(item: Schema<T>, opts: ArrayOpts = {}): Schema<T[]> {
  const max = opts.max ?? 100;
  const js: JsonSchema = { type: 'array', items: item.jsonSchema, maxItems: max };
  if (opts.min !== undefined) js.minItems = opts.min;
  return new Schema<T[]>((v, p, i) => {
    if (!Array.isArray(v)) return fail(i, p, 'expected an array');
    if (v.length > max) return fail(i, p, `at most ${max} items`);
    if (opts.min !== undefined && v.length < opts.min)
      return fail(i, p, `at least ${opts.min} items`);
    const before = i.length;
    const out = v.map((x, n) => item.check(x, [...p, n], i) as T);
    return i.length > before ? undefined : out;
  }, js);
}

type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: undefined extends InferOutput<S[K]> ? K : never;
}[keyof S];
type RequiredKeys<S extends Shape> = Exclude<keyof S, OptionalKeys<S>>;
export type ObjectOutput<S extends Shape> = { [K in RequiredKeys<S>]: InferOutput<S[K]> } & {
  [K in OptionalKeys<S>]?: InferOutput<S[K]>;
};

function object<S extends Shape>(shape: S): Schema<ObjectOutput<S>> {
  const keys = Object.keys(shape);
  const js: JsonSchema = {
    type: 'object',
    properties: Object.fromEntries(keys.map((k) => [k, shape[k]!.jsonSchema])),
    required: keys.filter((k) => !shape[k]!.isOptional),
    additionalProperties: false,
  };
  return new Schema<ObjectOutput<S>>((v, p, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return fail(i, p, 'expected an object');
    const rec = v as Record<string, unknown>;
    const before = i.length;
    for (const k of Object.keys(rec)) {
      if (!(k in shape)) fail(i, [...p, k], 'unknown field');
    }
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const val = shape[k]!.check(rec[k], [...p, k], i);
      if (val !== undefined) out[k] = val;
    }
    return i.length > before ? undefined : (out as ObjectOutput<S>);
  }, js);
}

function union<T extends Schema<unknown>[]>(...options: T): Schema<InferOutput<T[number]>> {
  return new Schema<InferOutput<T[number]>>(
    (v, p, i) => {
      for (const o of options) {
        const scratch: Issue[] = [];
        const out = o.check(v, p, scratch);
        if (scratch.length === 0) return out as InferOutput<T[number]>;
      }
      return fail(i, p, 'matches none of the allowed shapes');
    },
    { anyOf: options.map((o) => o.jsonSchema) },
  );
}

/** Any JSON value, bounded by serialized size. For host payloads, never for model arguments. */
function json(maxBytes = 16_000): Schema<unknown> {
  return new Schema<unknown>((v, p, i) => {
    let text: string | undefined;
    try {
      text = JSON.stringify(v);
    } catch {
      return fail(i, p, 'not JSON');
    }
    if (text === undefined) return fail(i, p, 'not JSON');
    if (new TextEncoder().encode(text).length > maxBytes)
      return fail(i, p, `at most ${maxBytes} bytes`);
    return v;
  }, {});
}

export const s = {
  string,
  number: (opts: NumberOpts = {}) => numberLike(false, opts),
  int: (opts: NumberOpts = {}) => numberLike(true, opts),
  boolean,
  literal,
  enum: enumOf,
  array,
  object,
  union,
  json,
};

/** The JSON Schema a provider receives for a Standard Schema, when the schema carries one. */
export function jsonSchemaOf(schema: StandardSchemaV1, override?: JsonSchema): JsonSchema {
  if (override) return override;
  const js = (schema as { jsonSchema?: JsonSchema }).jsonSchema;
  if (!js) throw new Error('schema has no JSON Schema: pass jsonSchema to defineTool');
  return js;
}

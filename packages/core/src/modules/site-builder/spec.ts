// The DesignSpec: what Duá writes from the owner's brief and the generation agent builds from
// (docs/architecture/14-agent-pipeline.md). Bounded and versioned; Core validates it, the
// model never writes it straight to a row.

export const SPEC_VERSION = 1 as const;

export type Motion = 'none' | 'subtle' | 'expressive';
export const MOTIONS: readonly Motion[] = ['none', 'subtle', 'expressive'];

export interface DesignSpec {
  version: typeof SPEC_VERSION;
  /** one or two sentences, pt-BR: what the site should feel like */
  summary: string;
  brand: {
    /** "afetiva", "premium", "divertida" */
    personality: string[];
    palette: { primary: string | null; accents: string[]; notes: string | null };
    typography: string;
    references: { url: string; note: string }[];
  };
  experience: {
    /** sections or moments the owner asked for, in their words */
    mustHave: string[];
    differentials: string[];
    motion: Motion;
    avoid: string[];
  };
  copy: { tone: string; language: 'pt-BR' };
}

const HEX = /^#[0-9a-f]{6}$/i;
const MAX = { text: 200, summary: 400, list: 8, refs: 5 };

export type SpecResult = { ok: true; spec: DesignSpec } | { ok: false; errors: string[] };

export function validateSpec(input: unknown): SpecResult {
  const errors: string[] = [];
  const obj = (v: unknown, path: string): Record<string, unknown> => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    errors.push(`${path} must be an object`);
    return {};
  };
  const text = (v: unknown, path: string, max = MAX.text, optional = false): string | null => {
    if ((v === undefined || v === null || v === '') && optional) return null;
    if (typeof v !== 'string' || !v.trim()) {
      errors.push(`${path} must be text`);
      return null;
    }
    if (v.length > max) errors.push(`${path} must be at most ${max} characters`);
    return v.trim();
  };
  const list = (v: unknown, path: string, max = MAX.list): string[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      errors.push(`${path} must be a list`);
      return [];
    }
    if (v.length > max) errors.push(`${path} has at most ${max} items`);
    return v.slice(0, max).flatMap((x, i) => text(x, `${path}[${i}]`) ?? []);
  };

  const root = obj(input, 'spec');
  if (root.version !== SPEC_VERSION) errors.push(`spec.version must be ${SPEC_VERSION}`);
  const summary = text(root.summary, 'summary', MAX.summary) ?? '';

  const brand = obj(root.brand, 'brand');
  const personality = list(brand.personality, 'brand.personality');
  if (!personality.length) errors.push('brand.personality needs at least one word');
  const palette = obj(brand.palette ?? {}, 'brand.palette');
  const primary = text(palette.primary, 'brand.palette.primary', 7, true);
  if (primary && !HEX.test(primary)) errors.push('brand.palette.primary must be #rrggbb');
  const accents = list(palette.accents, 'brand.palette.accents', 4);
  for (const a of accents) if (!HEX.test(a)) errors.push('brand.palette.accents must be #rrggbb');
  const notes = text(palette.notes, 'brand.palette.notes', MAX.text, true);
  const typography = text(brand.typography, 'brand.typography') ?? '';
  const refsIn = brand.references ?? [];
  const references: { url: string; note: string }[] = [];
  if (!Array.isArray(refsIn)) errors.push('brand.references must be a list');
  else {
    if (refsIn.length > MAX.refs) errors.push(`brand.references has at most ${MAX.refs} items`);
    refsIn.slice(0, MAX.refs).forEach((r, i) => {
      const o = obj(r, `brand.references[${i}]`);
      const url = text(o.url, `brand.references[${i}].url`, 500);
      if (url && !/^https:\/\/[^\s]+$/.test(url))
        errors.push(`brand.references[${i}].url must be an https URL`);
      const note = text(o.note, `brand.references[${i}].note`, MAX.text, true) ?? '';
      if (url) references.push({ url, note });
    });
  }

  const exp = obj(root.experience, 'experience');
  const motion = exp.motion ?? 'subtle';
  if (!MOTIONS.includes(motion as Motion))
    errors.push(`experience.motion must be one of ${MOTIONS.join(', ')}`);

  const copy = obj(root.copy, 'copy');
  const tone = text(copy.tone, 'copy.tone') ?? '';
  if (copy.language !== undefined && copy.language !== 'pt-BR')
    errors.push('copy.language must be pt-BR');

  const spec: DesignSpec = {
    version: SPEC_VERSION,
    summary,
    brand: {
      personality,
      palette: { primary: primary?.toLowerCase() ?? null, accents, notes },
      typography,
      references,
    },
    experience: {
      mustHave: list(exp.mustHave, 'experience.mustHave'),
      differentials: list(exp.differentials, 'experience.differentials'),
      motion: motion as Motion,
      avoid: list(exp.avoid, 'experience.avoid'),
    },
    copy: { tone, language: 'pt-BR' },
  };
  return errors.length ? { ok: false, errors: errors.slice(0, 20) } : { ok: true, spec };
}

/** The lines a copilot card shows the owner, pt-BR. */
export function specLines(spec: DesignSpec): { label: string; to: string }[] {
  const join = (xs: string[]) => xs.join(', ');
  const lines = [
    { label: 'Ideia', to: spec.summary },
    { label: 'Jeito', to: join(spec.brand.personality) },
    {
      label: 'Cores',
      to:
        [spec.brand.palette.primary, ...spec.brand.palette.accents].filter(Boolean).join(' · ') ||
        (spec.brand.palette.notes ?? 'as da marca'),
    },
    { label: 'Letras', to: spec.brand.typography },
    {
      label: 'Movimento',
      to: { none: 'nenhum', subtle: 'discreto', expressive: 'marcante' }[spec.experience.motion],
    },
    { label: 'Tom', to: spec.copy.tone },
  ];
  if (spec.experience.mustHave.length)
    lines.push({ label: 'Não pode faltar', to: join(spec.experience.mustHave) });
  if (spec.experience.differentials.length)
    lines.push({ label: 'Diferenciais', to: join(spec.experience.differentials) });
  if (spec.experience.avoid.length)
    lines.push({ label: 'Evitar', to: join(spec.experience.avoid) });
  if (spec.brand.references.length)
    lines.push({ label: 'Referências', to: spec.brand.references.map((r) => r.url).join(' · ') });
  return lines;
}

import { die } from './paths.ts';

// One place that knows which flags a command takes, so a typo is an error instead of a
// silently ignored word (`vendua ops acme --maintanence "x"` used to read the store).

export interface FlagSpec {
  /** flags that stand alone */
  bool?: readonly string[];
  /** flags followed by a value; may repeat */
  value?: readonly string[];
}

export interface Parsed {
  /** the non-flag words, in order */
  positionals: string[];
  has(flag: string): boolean;
  /** the last value given to a value flag */
  get(flag: string): string | undefined;
  /** every value given to a repeatable value flag */
  all(flag: string): string[];
}

export class ArgError extends Error {}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length]!;
}

/** Up to `max` candidates that look like `word`: a prefix or substring of it, or a few typos away. */
export function suggest(word: string, candidates: readonly string[], max = 3): string[] {
  const w = word.toLowerCase().replace(/^-+/, '');
  if (!w) return [];
  const limit = Math.max(2, Math.floor(w.length / 3));
  return candidates
    .map((c) => {
      const k = c.toLowerCase().replace(/^-+/, '');
      const near = (w.length >= 3 && k.includes(w)) || (k.length >= 3 && w.includes(k));
      return { c, rank: near ? 0 : distance(w, k) };
    })
    .filter((x) => x.rank <= limit)
    .sort((a, b) => a.rank - b.rank || a.c.localeCompare(b.c))
    .slice(0, max)
    .map((x) => x.c);
}

export function didYouMean(word: string, candidates: readonly string[]): string {
  const hits = suggest(word, candidates);
  return hits.length ? ` (did you mean ${hits.map((h) => `'${h}'`).join(' or ')}?)` : '';
}

/** Throws ArgError for a flag the command does not take, or a value flag without its value. */
export function parseArgs(args: readonly string[], spec: FlagSpec): Parsed {
  const bool = new Set(spec.bool ?? []);
  const value = new Set(spec.value ?? []);
  const positionals: string[] = [];
  const seen = new Map<string, string[]>();
  const known = [...bool, ...value];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('-') || a === '-') {
      positionals.push(a);
      continue;
    }
    if (bool.has(a)) {
      seen.set(a, [...(seen.get(a) ?? []), '']);
      continue;
    }
    if (value.has(a)) {
      const v = args[i + 1];
      if (v === undefined || (v.startsWith('--') && v.length > 2))
        throw new ArgError(`${a} needs a value`);
      seen.set(a, [...(seen.get(a) ?? []), v]);
      i++;
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    if (eq > 0 && value.has(name))
      throw new ArgError(`write the value after a space, not '=': ${name} ${a.slice(eq + 1)}`);
    throw new ArgError(`unknown flag '${name}'${didYouMean(name, known)}`);
  }
  return {
    positionals,
    has: (f) => seen.has(f),
    get: (f) => seen.get(f)?.at(-1),
    all: (f) => seen.get(f) ?? [],
  };
}

/** `parseArgs` for a command's entry point: a bad flag prints the cause and where the help is. */
export function parseOrDie(args: readonly string[], spec: FlagSpec, helpCmd: string): Parsed {
  try {
    return parseArgs(args, spec);
  } catch (e) {
    if (e instanceof ArgError) die(`${e.message}\nrun 'vendua ${helpCmd} --help' for usage`, 2);
    throw e;
  }
}

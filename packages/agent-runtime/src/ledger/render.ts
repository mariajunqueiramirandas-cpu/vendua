import type { Figure } from '../engine/state.ts';

const REF = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.-]{0,80})\s*\}\}/g;
const LEFTOVER = /\{\{([^{}\n]{0,80})\}\}/g;

export interface Rendered {
  text: string;
  refs: string[];
  unknown: string[];
}

/** Fills `{{id}}` with Core's formatted text. An unknown id is an error the model must fix. */
export function render(raw: string, ledger: Readonly<Record<string, Figure>>): Rendered {
  const refs: string[] = [];
  const unknown: string[] = [];
  const text = raw.replace(REF, (whole, id: string) => {
    const f = ledger[id];
    if (!f) {
      unknown.push(id);
      return whole;
    }
    refs.push(id);
    return f.text;
  });
  // A brace form the id pattern can't parse (`{{p:mirim}}`, `{{ nome do cliente }}`) would reach
  // the user verbatim: it is just as unknown.
  for (const m of raw.replace(REF, '').matchAll(LEFTOVER)) {
    const id = m[1]!.trim();
    if (!unknown.includes(id)) unknown.push(id);
  }
  return { text, refs, unknown };
}

/** The model's own words: every reference replaced by a neutral marker. */
export function withoutRefs(raw: string): string {
  return raw.replace(REF, '⟨ref⟩');
}

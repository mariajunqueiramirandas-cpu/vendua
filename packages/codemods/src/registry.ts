import { CodemodFailure, type Codemod } from './index.ts';

// Registered codemods. Ids are permanent: CI, the train and the Kernel's
// deprecation notes (SLOT_ALIASES[…].codemod) refer to them.

const OLD_SLOT = 'system.StorePausedNotice';
const NEW_SLOT = 'system.PauseNotice';

/**
 * Contract-major rehearsal (roadmap 1b-ii): the two changes Contract 3 will make,
 * applied while Contract 2's alias window still accepts both forms —
 *  1. slot rename `system.StorePausedNotice` → `system.PauseNotice`
 *     (Kernel 1.x keeps the old key aliased; Contract 3 drops it);
 *  2. `ring` leaves vendua.config.ts (it is Control Plane data: storefront_ops.ring).
 */
const c3Rehearsal: Codemod = {
  id: 'c3-rehearsal',
  description: `rename ${OLD_SLOT} → ${NEW_SLOT}; drop the deprecated \`ring\` from vendua.config.ts`,
  transform(files) {
    const edits = new Map<string, string>();
    const notes: string[] = [];
    const quoted = new RegExp(`(['"\`])${OLD_SLOT.replace('.', '\\.')}\\1`, 'g');

    const cfg = files.get('vendua.config.ts');
    if (cfg === undefined) throw new CodemodFailure('vendua.config.ts missing');

    // overrides must be a literal object the codemod can read — anything else is unprovable
    const ov = /\boverrides\s*:\s*([^\s{])/.exec(cfg);
    if (ov && quoted.test(Object.values(Object.fromEntries(files)).join('\n')))
      throw new CodemodFailure(
        `overrides is not an object literal (\`overrides: ${ov[1]}…\`) — rename by hand`,
      );
    quoted.lastIndex = 0;
    if (/\boverrides\s*:\s*\{[^}]*\.\.\./s.test(cfg) && cfg.includes(OLD_SLOT))
      throw new CodemodFailure(
        'overrides spreads another object — the old key may hide there; rename by hand',
      );
    if (cfg.includes(`'${NEW_SLOT}'`) && cfg.includes(OLD_SLOT))
      throw new CodemodFailure(
        `both ${OLD_SLOT} and ${NEW_SLOT} are registered — pick one by hand`,
      );

    for (const [file, src] of files) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const next = src.replace(quoted, (_m, q: string) => `${q}${NEW_SLOT}${q}`);
      if (next !== src) {
        edits.set(file, next);
        notes.push(`${file}: ${OLD_SLOT} → ${NEW_SLOT}`);
      }
    }

    const base = edits.get('vendua.config.ts') ?? cfg;
    const ringLine = /^[ \t]*ring\s*:\s*(['"])(stable|early|canary)\1\s*,?[ \t]*(\/\/[^\n]*)?\n/m;
    if (ringLine.test(base)) {
      // a comment block introducing the property goes with it
      const withoutRing = base
        .replace(/(?:^[ \t]*\/\/[^\n]*\n)*(?=^[ \t]*ring\s*:)/m, '')
        .replace(ringLine, '');
      edits.set('vendua.config.ts', withoutRing);
      notes.push('vendua.config.ts: removed `ring` (Control Plane data)');
    } else if (/^\s*ring\s*:/m.test(base)) {
      throw new CodemodFailure('`ring` is not a string literal — remove it by hand');
    }
    return { edits, notes };
  },
};

export const CODEMODS: readonly Codemod[] = [c3Rehearsal];

export function findCodemod(id: string): Codemod | undefined {
  return CODEMODS.find((c) => c.id === id);
}

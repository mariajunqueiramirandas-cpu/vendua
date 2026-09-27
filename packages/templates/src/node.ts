import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTemplate, type PageId, type TemplateSet } from './model.ts';

// A storefront's repo templates: `templates/<page>.json`, content pages as
// `templates/page.<handle>.json`. They are the initial composition (seeded into
// Core at provisioning) and the build's fallback when Core isn't reachable.

export function pageFromFile(file: string): PageId | null {
  const m = /^(layout|home|catalog|product|page\.[a-z0-9][a-z0-9-]{0,39})\.json$/.exec(file);
  if (!m) return null;
  return (m[1]!.startsWith('page.') ? `page:${m[1]!.slice(5)}` : m[1]) as PageId;
}

export function readTemplatesDir(dir: string): TemplateSet {
  const out: TemplateSet = {};
  if (!existsSync(dir)) return out;
  const problems: string[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const page = pageFromFile(file);
    if (!page) {
      problems.push(
        `${file}: not a template file name (layout|home|catalog|product|page.<handle>).json`,
      );
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      problems.push(`${file}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    const v = validateTemplate(json, page);
    if (!v.ok) problems.push(...v.errors.map((e) => `${file}: ${e}`));
    else out[page] = v.template;
  }
  if (problems.length) throw new Error(`invalid templates in ${dir}:\n  ${problems.join('\n  ')}`);
  return out;
}

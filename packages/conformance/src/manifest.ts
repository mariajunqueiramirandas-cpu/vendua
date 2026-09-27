import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkCompat } from '@vendua/templates';
import type { CheckResult } from './report.ts';

// K16 standalone: the artifact a build produced is a valid compat-matrix row
// (Kernel × Contract × Core API majors). CI runs it after every storefront build.
export function runManifest(storefrontDir: string): CheckResult[] {
  const id = 'K16';
  const title = 'artifact manifest ⊆ compat matrix';
  const file = join(resolve(storefrontDir), 'dist', 'vendua-manifest.json');
  if (!existsSync(file))
    return [
      { id, title, status: 'fail', detail: `${file} missing — built without the vendua() plugin?` },
    ];
  const m = JSON.parse(readFileSync(file, 'utf8'));
  const problems = checkCompat(m);
  return problems.length
    ? [{ id, title, status: 'fail', detail: problems.join('\n') }]
    : [
        {
          id,
          title,
          status: 'pass',
          detail: `kernel ${m.kernel} · contract ${m.contract} · storefront API v${m.coreApi.storefront}`,
        },
      ];
}

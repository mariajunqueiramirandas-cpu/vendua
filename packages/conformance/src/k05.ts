/**
 * K05 — the PR's diff may only touch storefronts/<slug>/**. Runs in the repo
 * checkout (CI changed-paths job calls `vendua-conformance k05 <slug>`).
 */
import type { CheckResult } from './report.ts';

export async function runK05(slug: string, baseRef?: string): Promise<CheckResult[]> {
  const id = 'K05';
  const title = `PR diff limited to storefronts/${slug}/**`;
  const base = baseRef ?? 'origin/main';

  const proc = Bun.spawn(['git', 'diff', '--name-only', `${base}...HEAD`], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) {
    return [
      {
        id,
        title,
        status: 'fail',
        detail: `git diff ${base}...HEAD failed: ${stderr.trim()}`,
      },
    ];
  }

  const files = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const allowed = `storefronts/${slug}/`;
  const offenders = files.filter((f) => !f.startsWith(allowed));
  if (offenders.length) {
    return [
      {
        id,
        title,
        status: 'fail',
        detail: `${offenders.length} changed path(s) outside ${allowed}\n${offenders.join('\n')}`,
      },
    ];
  }
  return [
    {
      id,
      title,
      status: 'pass',
      detail: `${files.length} changed file(s), all under ${allowed}`,
    },
  ];
}

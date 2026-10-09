import { storefrontLockViolation } from './lockfile.ts';
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
  // a new store's `bun install` registers its workspace in bun.lock; that entry alone may ride along
  const lockWhy = offenders.includes('bun.lock') ? storefrontLockViolation(slug, base) : null;
  const outside = offenders
    .filter((f) => f !== 'bun.lock' || lockWhy !== null)
    .map((f) => (f === 'bun.lock' ? `bun.lock — ${lockWhy}` : f));
  if (outside.length) {
    return [
      {
        id,
        title,
        status: 'fail',
        detail: `${outside.length} changed path(s) outside ${allowed}\n${outside.join('\n')}`,
      },
    ];
  }
  return [
    {
      id,
      title,
      status: 'pass',
      detail: `${files.length} changed file(s), all under ${allowed}${offenders.length ? ' (plus its bun.lock entry)' : ''}`,
    },
  ];
}

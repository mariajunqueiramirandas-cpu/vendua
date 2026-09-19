/**
 * Check result model — every command emits one result per check ID, always
 * printing IDs so failure bundles can reference them (docs/architecture/10).
 */

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail?: string;
  durationMs?: number;
}

export function printChecks(results: CheckResult[]): void {
  for (const r of results) {
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
    const suffix = r.detail ? ` — ${r.detail.split('\n')[0]}` : '';
    console.log(`${tag} ${r.id} ${r.title}${suffix}`);
  }
  const fails = results.filter((r) => r.status === 'fail');
  const skips = results.filter((r) => r.status === 'skip');
  console.log(
    `\n${results.length - fails.length - skips.length} passed, ${fails.length} failed, ${skips.length} skipped`,
  );
  for (const r of fails) {
    if (r.detail) console.log(`\n--- ${r.id} ${r.title}\n${r.detail}`);
  }
}

export function anyFailed(results: CheckResult[]): boolean {
  return results.some((r) => r.status === 'fail');
}

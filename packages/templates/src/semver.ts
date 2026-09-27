// Just enough semver for compat checks: `x.y.z` versions and space-separated
// comparator ranges (`>=1.1.0 <2.0.0`). No prerelease tags — Kernel doesn't ship them.

export type Version = [number, number, number];

export function parseVersion(v: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function satisfies(version: string, range: string): boolean {
  if (!parseVersion(version)) return false;
  const parts = range.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/.exec(p);
    if (!m) throw new Error(`bad range comparator '${p}' in '${range}'`);
    const c = compareVersions(version, m[2]!);
    switch (m[1] ?? '=') {
      case '>=':
        return c >= 0;
      case '<=':
        return c <= 0;
      case '>':
        return c > 0;
      case '<':
        return c < 0;
      default:
        return c === 0;
    }
  });
}

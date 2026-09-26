import { satisfies } from './semver.ts';

// The compat matrix (11-backward-compatibility.md#compat-matrix): which Kernel
// lines may build a storefront of a Contract major, and which Core API majors
// they speak. CI checks every artifact manifest against it.

export interface CompatRow {
  contract: number;
  kernel: string;
  coreApi: { storefront: number[]; checkout: number[] };
}

export const COMPAT_MATRIX: readonly CompatRow[] = [
  // Contract 1 was the pre-1.0 Kernel (0.x) — retired before the first customer.
  { contract: 2, kernel: '>=1.0.0 <2.0.0', coreApi: { storefront: [1], checkout: [1] } },
];

/** API majors Core serves today — every row's majors must stay in this set. */
export const CORE_API_MAJORS = { storefront: [1], checkout: [1] } as const;

export interface ArtifactManifest {
  manifestVersion: 1;
  storefront: string;
  contract: number;
  kernel: string;
  coreApi: { storefront: number; checkout: number };
  builtAt: string;
  templates: { source: 'core' | 'repo'; pages: string[]; hash: string };
  tokens: { source: 'core' | 'repo'; hash: string };
  sections: Record<string, { areas?: Record<string, { accepts: string[]; max?: number }> }>;
  overrides: string[];
}

export function checkCompat(
  m: Pick<ArtifactManifest, 'contract' | 'kernel' | 'coreApi'>,
): string[] {
  const row = COMPAT_MATRIX.find((r) => r.contract === m.contract);
  if (!row) return [`contract ${m.contract} has no compat-matrix row`];
  const problems: string[] = [];
  if (!satisfies(m.kernel, row.kernel))
    problems.push(`kernel ${m.kernel} is outside ${row.kernel} for contract ${m.contract}`);
  for (const surface of ['storefront', 'checkout'] as const) {
    const major = m.coreApi[surface];
    if (!row.coreApi[surface].includes(major))
      problems.push(`${surface} API v${major} not in the row's majors [${row.coreApi[surface]}]`);
    if (!(CORE_API_MAJORS[surface] as readonly number[]).includes(major))
      problems.push(`Core no longer serves ${surface} API v${major}`);
  }
  return problems;
}

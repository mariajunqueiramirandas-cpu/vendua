import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { BUNDLE_RE, RELEASE_RE } from './deps.ts';

// A release is one immutable build of one bundle (storefront.manifest.json, written by
// `vendua release publish`). Core keeps the manifest minus its file index; the edge reads the
// files from the artifact store.

export interface ReleaseRow {
  id: string;
  bundle: string;
  tenant_slug: string;
  kernel_version: string;
  contract: number;
  commit: string;
  artifact_uri: string;
  manifest: Record<string, unknown>;
  qa_status: 'passed' | 'failed';
  qa_report: QaCheck[];
  built_at: Date;
  created_at: Date;
  published_at: Date;
}

export interface QaCheck {
  id: string;
  ok: boolean;
  detail?: string;
}

export interface ParsedRelease {
  id: string;
  bundle: string;
  tenant: string;
  kernelVersion: string;
  contract: number;
  commit: string;
  builtAt: Date;
  qaStatus: 'passed' | 'failed';
  qa: QaCheck[];
  artifactUri: string;
  manifest: Record<string, unknown>;
}

const TENANT_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const MAX_FILES = 5000;

function bad(message: string, field?: string): never {
  throw new HttpError(422, 'INVALID_MANIFEST', message, field ? { field } : undefined);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function parseRelease(body: Record<string, unknown>): ParsedRelease {
  const m = body.manifest;
  if (!isObj(m)) bad('manifest must be an object', 'manifest');
  if (m.manifestVersion !== 1) bad('manifestVersion must be 1', 'manifestVersion');
  const id = m.release;
  if (typeof id !== 'string' || !RELEASE_RE.test(id))
    bad('release must be 20 hex chars', 'release');
  const bundle = m.bundle;
  if (typeof bundle !== 'string' || !BUNDLE_RE.test(bundle)) bad('bad bundle', 'bundle');
  const tenant = m.tenant;
  if (typeof tenant !== 'string' || !TENANT_RE.test(tenant)) bad('bad tenant', 'tenant');
  if (typeof m.kernelVersion !== 'string' || !SEMVER_RE.test(m.kernelVersion))
    bad('kernelVersion must be semver', 'kernelVersion');
  if (
    typeof m.contract !== 'number' ||
    !Number.isInteger(m.contract) ||
    m.contract < 1 ||
    m.contract > 99
  )
    bad('contract must be an integer 1–99', 'contract');
  if (typeof m.commit !== 'string' || m.commit.length < 1 || m.commit.length > 64)
    bad('commit must have 1–64 chars', 'commit');
  const builtAt = typeof m.builtAt === 'string' ? new Date(m.builtAt) : null;
  if (!builtAt || Number.isNaN(builtAt.getTime())) bad('builtAt must be an ISO date', 'builtAt');
  if (!isObj(m.files) || Object.keys(m.files).length === 0)
    bad('files must list the artifact', 'files');
  if (Object.keys(m.files).length > MAX_FILES) bad(`at most ${MAX_FILES} files`, 'files');
  if (!('index.html' in m.files)) bad('the artifact has no index.html', 'files');
  const qa = m.qa;
  if (!isObj(qa) || (qa.status !== 'passed' && qa.status !== 'failed'))
    bad('qa.status must be passed or failed', 'qa');
  if (!Array.isArray(qa.checks) || qa.checks.length > 50) bad('qa.checks must be a list', 'qa');
  const checks: QaCheck[] = qa.checks.map((c) => {
    if (!isObj(c) || typeof c.id !== 'string' || c.id.length > 40 || typeof c.ok !== 'boolean')
      bad('each qa check needs id and ok', 'qa');
    const detail = typeof c.detail === 'string' ? c.detail.slice(0, 500) : undefined;
    return { id: c.id, ok: c.ok, ...(detail ? { detail } : {}) };
  });
  // a check that failed can't ride under a "passed" label
  if (qa.status === 'passed' && checks.some((c) => !c.ok))
    bad('qa.status is passed but a check failed', 'qa');

  const uri = body.artifactUri;
  if (typeof uri !== 'string' || uri.length > 500 || !/^(file|s3):\/\//.test(uri))
    bad('artifactUri must be a file:// or s3:// uri', 'artifactUri');
  if (!uri.endsWith(`/storefronts/${bundle}/${id}`))
    bad(`artifactUri must end with /storefronts/${bundle}/${id}`, 'artifactUri');

  const { files, ...rest } = m;
  return {
    id,
    bundle,
    tenant,
    kernelVersion: m.kernelVersion,
    contract: m.contract,
    commit: m.commit,
    builtAt,
    qaStatus: qa.status,
    qa: checks,
    artifactUri: uri,
    manifest: { ...rest, fileCount: Object.keys(files as object).length },
  };
}

/** Registers (or re-publishes) a release. Same id twice is the same build: only
 *  published_at moves, so auto stores follow the newest publish of their bundle. */
export async function registerReleaseTx(
  tx: Sql,
  r: ParsedRelease,
): Promise<{ row: ReleaseRow; created: boolean }> {
  const inserted = await tx<ReleaseRow[]>`
    insert into releases (id, bundle, tenant_slug, kernel_version, contract, commit, artifact_uri,
                          manifest, qa_status, qa_report, built_at)
    values (${r.id}, ${r.bundle}, ${r.tenant}, ${r.kernelVersion}, ${r.contract}, ${r.commit},
            ${r.artifactUri}, ${tx.json(r.manifest as never)}, ${r.qaStatus},
            ${tx.json(r.qa as never)}, ${r.builtAt})
    on conflict (id) do nothing
    returning *
  `;
  if (inserted[0]) return { row: inserted[0], created: true };
  const existing = (
    await tx<ReleaseRow[]>`
      update releases set published_at = now() where id = ${r.id} returning *
    `
  )[0]!;
  if (existing.bundle !== r.bundle || existing.artifact_uri !== r.artifactUri)
    throw new HttpError(409, 'RELEASE_CONFLICT', 'this release id belongs to another artifact');
  return { row: existing, created: false };
}

export async function latestPassedTx(tx: Sql, bundle: string): Promise<ReleaseRow | null> {
  return (
    (
      await tx<ReleaseRow[]>`
        select * from releases where bundle = ${bundle} and qa_status = 'passed'
        order by published_at desc, created_at desc limit 1
      `
    )[0] ?? null
  );
}

export function releaseJson(r: ReleaseRow) {
  return {
    id: r.id,
    bundle: r.bundle,
    tenant: r.tenant_slug,
    kernelVersion: r.kernel_version,
    contract: r.contract,
    commit: r.commit,
    artifactUri: r.artifact_uri,
    qaStatus: r.qa_status,
    qa: r.qa_report,
    budgets: (r.manifest.budgets as Record<string, number> | undefined) ?? null,
    fileCount: (r.manifest.fileCount as number | undefined) ?? null,
    builtAt: r.built_at,
    createdAt: r.created_at,
    publishedAt: r.published_at,
  };
}

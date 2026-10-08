import { writeFileSync } from 'node:fs';
import { didYouMean, parseOrDie, type FlagSpec } from './args.ts';
import { control } from './core.ts';
import { die } from './paths.ts';

// `vendua templates list`
// `vendua templates migrate <id> [--apply] [--ring canary|early|stable] [--tenant slug]… [--report f]`
// `vendua templates rollback <id> (--ring … | --tenant slug… | --all) [--apply]`
// Template migrations run in Core against each store's live templates (17 —
// template migrations). Without --apply it's a dry run: the per-store report of
// what would be applied, skipped or conflicted, and nothing written.

interface Row {
  tenant: string;
  ring: string;
  page: string;
  status: string;
  reason?: string;
  fromVersion?: number;
  toVersion?: number;
}

function table(rows: Row[]): string {
  return [
    '| Store | Ring | Page | Outcome | Versions | Note |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.tenant} | ${r.ring} | ${r.page} | ${r.status} | ${r.fromVersion ?? '—'}${r.toVersion ? ` → ${r.toVersion}` : ''} | ${r.reason ?? ''} |`,
    ),
  ].join('\n');
}

const FLAGS: Record<string, FlagSpec> = {
  list: {},
  migrate: { bool: ['--apply'], value: ['--ring', '--tenant', '--report'] },
  rollback: { bool: ['--apply', '--all'], value: ['--ring', '--tenant'] },
};

export async function cmdTemplates(args: string[]): Promise<never> {
  const sub = args[0] ?? 'list';
  const spec = FLAGS[sub];
  if (!spec)
    die(
      `unknown templates subcommand '${sub}'${didYouMean(sub, Object.keys(FLAGS))}\nsubcommands: list | migrate | rollback`,
      2,
    );
  const p = parseOrDie(args.slice(1), spec, 'templates');
  const [id] = p.positionals;
  const ring = p.get('--ring');
  const tenants = p.all('--tenant');
  const reportFile = p.get('--report');
  const scope = { ...(ring ? { ring } : {}), ...(tenants.length ? { tenants } : {}) };
  try {
    if (sub === 'list') {
      const r = await control<{
        migrations: {
          id: string;
          description: string;
          requiresKernel: string | null;
          pages: string[];
        }[];
      }>('GET', '/control/v1/template-migrations');
      for (const m of r.migrations)
        console.log(
          `${m.id}  [${m.pages.join(', ')}] kernel ${m.requiresKernel ?? 'any'} — ${m.description}`,
        );
      process.exit(0);
    }
    if (!id) die(`usage: vendua templates ${sub} <migration-id>`, 2);
    if (sub === 'migrate') {
      const apply = p.has('--apply');
      const r = await control<{ dry: boolean; report: Row[] }>(
        'POST',
        `/control/v1/template-migrations/${id}/run`,
        { dry: !apply, ...scope },
        apply ? `tpl-migrate:${id}:${ring ?? 'all'}:${tenants.join(',')}:${Date.now()}` : undefined,
      );
      const md = [
        `# Template migration \`${id}\` — ${r.dry ? 'dry run' : 'applied'}${ring ? ` (ring ${ring})` : ''}`,
        '',
        table(r.report),
        '',
      ].join('\n');
      console.log(md);
      if (reportFile) writeFileSync(reportFile, md);
      process.exit(r.report.some((x) => x.status === 'conflict') ? 1 : 0);
    }
    if (sub === 'rollback') {
      // an undo across the whole fleet is never the default
      if (!ring && !tenants.length && !p.has('--all'))
        die('templates rollback needs --ring <r>, --tenant <slug> or --all', 2);
      const apply = p.has('--apply');
      const r = await control<{ report: Row[] }>(
        'POST',
        `/control/v1/template-migrations/${id}/rollback`,
        { dry: !apply, ...scope },
        apply
          ? `tpl-rollback:${id}:${ring ?? 'all'}:${tenants.join(',')}:${Date.now()}`
          : undefined,
      );
      console.log(
        [
          `# Template rollback \`${id}\` — ${apply ? 'applied' : 'dry run'}${ring ? ` (ring ${ring})` : ''}`,
          '',
          table(r.report),
        ].join('\n'),
      );
      process.exit(0);
    }
    die(`unknown templates subcommand '${sub}' (list | migrate | rollback)`, 2);
  } catch (e) {
    die((e as Error).message);
  }
}

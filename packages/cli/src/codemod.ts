import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { apply, diff, findCodemod, plan, CODEMODS, type CodemodResult } from '@vendua/codemods';
import { select, type FleetStore } from './fleet.ts';
import { die } from './paths.ts';

// `vendua codemod run <id> [slug…] [--dry]` — apply (or preview) a Contract codemod.
// `vendua codemod rehearse <id> [--report <file>]` — the Contract-major rehearsal:
//   every in-repo storefront is copied, codemodded, typechecked and run through
//   `vendua check`; the failure tail is measured. Nothing in the repo changes.

async function exec(cmd: string[], cwd: string): Promise<{ code: number; output: string }> {
  const p = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, output: `${out}\n${err}`.trim() };
}

function show(r: CodemodResult, root: string, dry: boolean) {
  const where = relative(root, r.storefront);
  if (r.status === 'failed') return console.log(`✘ ${where}: ${r.reason}`);
  if (r.status === 'unchanged') return console.log(`· ${where}: nothing to change`);
  console.log(`${dry ? '~' : '✓'} ${where}: ${r.notes.join('; ')}`);
  if (dry) for (const e of r.edits) console.log(diff(e).replace(/^/gm, '    '));
}

export async function cmdCodemod(args: string[], root: string): Promise<never> {
  const [sub, id, ...rest] = args;
  if (sub === 'list' || !sub) {
    for (const c of CODEMODS) console.log(`${c.id}  ${c.description}`);
    process.exit(0);
  }
  const codemod = id ? findCodemod(id) : undefined;
  if (!codemod) die(`unknown codemod '${id ?? ''}' — see \`vendua codemod list\``, 2);
  const dry = rest.includes('--dry');
  const reportIdx = rest.indexOf('--report');
  const reportFile = reportIdx >= 0 ? rest[reportIdx + 1] : undefined;
  const slugs = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--report');
  let stores: FleetStore[];
  try {
    stores = select(root, slugs);
  } catch (e) {
    die((e as Error).message);
  }

  if (sub === 'run') {
    let failed = 0;
    for (const s of stores) {
      const r = plan(codemod, s.dir);
      show(r, root, dry);
      if (r.status === 'failed') failed++;
      else if (!dry) apply(r);
    }
    process.exit(failed ? 1 : 0);
  }

  if (sub !== 'rehearse') die(`unknown codemod subcommand '${sub}' (run | rehearse | list)`, 2);
  const rows: {
    storefront: string;
    codemod: string;
    typecheck: string;
    check: string;
    outcome: 'green' | 'tail';
  }[] = [];
  for (const s of stores) {
    const scratch = join(root, 'storefronts', `.rehearsal-${codemod.id}-${s.slug}`);
    rmSync(scratch, { recursive: true, force: true });
    cpSync(s.dir, scratch, {
      recursive: true,
      filter: (p) => !/[\\/](node_modules|dist|qa-report)([\\/]|$)/.test(p),
    });
    symlinkSync(join(s.dir, 'node_modules'), join(scratch, 'node_modules'));
    const tsconfig = JSON.parse(readFileSync(join(scratch, 'tsconfig.json'), 'utf8'));
    tsconfig.extends = join(root, 'tsconfig.base.json');
    writeFileSync(join(scratch, 'tsconfig.json'), JSON.stringify(tsconfig));
    try {
      const r = plan(codemod, scratch);
      if (r.status !== 'failed') apply(r);
      const tc =
        r.status === 'failed'
          ? { code: 1, output: '' }
          : await exec(['bun', 'run', 'check'], scratch);
      const bin = join(root, 'node_modules', '.bin', 'vendua-conformance');
      const ck =
        r.status === 'failed' || !existsSync(bin)
          ? { code: r.status === 'failed' ? 1 : 0, output: '' }
          : await exec([bin, 'static', scratch], root);
      const green = r.status !== 'failed' && tc.code === 0 && ck.code === 0;
      rows.push({
        storefront: s.rel,
        codemod:
          r.status === 'failed'
            ? `failed: ${r.reason}`
            : `${r.status}${r.notes.length ? ` (${r.notes.join('; ')})` : ''}`,
        typecheck: r.status === 'failed' ? '—' : tc.code === 0 ? 'pass' : 'fail',
        check:
          r.status === 'failed'
            ? '—'
            : ck.code === 0
              ? 'pass'
              : `fail: ${ck.output
                  .split('\n')
                  .filter((l) => l.startsWith('FAIL'))
                  .join(' | ')}`,
        outcome: green ? 'green' : 'tail',
      });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const tail = rows.filter((r) => r.outcome === 'tail').length;
  const pct = rows.length ? Math.round((tail / rows.length) * 100) : 0;
  const md = [
    `# Codemod rehearsal: \`${codemod.id}\``,
    '',
    `${codemod.description}`,
    '',
    '| Storefront | Codemod | Typecheck | vendua check | Outcome |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) => `| \`${r.storefront}\` | ${r.codemod} | ${r.typecheck} | ${r.check} | ${r.outcome} |`,
    ),
    '',
    `**Failure tail: ${tail}/${rows.length} (${pct}%).** Budget per 09: 5–15% expected, >20% means fix the codemod.`,
    '',
  ].join('\n');
  console.log(md);
  if (reportFile) writeFileSync(reportFile, md);
  process.exit(pct > 20 ? 1 : 0);
}

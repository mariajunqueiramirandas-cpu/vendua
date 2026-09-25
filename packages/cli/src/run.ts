import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { storefrontDir } from './paths.ts';

async function run(cmd: string[], cwd: string): Promise<number> {
  const proc = Bun.spawn(cmd, { cwd, stdio: ['inherit', 'inherit', 'inherit'] });
  return proc.exited;
}

function conformanceBin(root: string): string | null {
  const local = join(root, 'node_modules', '.bin', 'vendua-conformance');
  if (existsSync(local)) return local;
  return Bun.which('vendua-conformance');
}

async function conformance(root: string, mode: 'static' | 'e2e', dir: string): Promise<number> {
  const bin = conformanceBin(root);
  if (!bin) {
    console.log(
      `note: @vendua/conformance is not installed — skipped its '${mode}' suite ` +
        '(the package lands in this same phase).',
    );
    return 0;
  }
  return run([bin, mode, relative(root, dir)], root);
}

export async function cmdDev(slug: string | undefined, root: string): Promise<never> {
  const dir = storefrontDir(root, slug);
  process.exit(await run(['bun', 'run', 'dev'], dir));
}

export async function cmdCheck(slug: string | undefined, root: string): Promise<never> {
  const dir = storefrontDir(root, slug);
  const typecheck = await run(['bun', 'run', 'check'], dir);
  if (typecheck !== 0) process.exit(typecheck);
  process.exit(await conformance(root, 'static', dir));
}

export async function cmdBuild(slug: string | undefined, root: string): Promise<never> {
  const dir = storefrontDir(root, slug);
  process.exit(await run(['bun', 'run', 'build'], dir));
}

export async function cmdQa(slug: string | undefined, root: string): Promise<never> {
  const dir = storefrontDir(root, slug);
  const build = await run(['bun', 'run', 'build'], dir);
  if (build !== 0) process.exit(build);
  process.exit(await conformance(root, 'e2e', dir));
}

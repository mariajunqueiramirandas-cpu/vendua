#!/usr/bin/env bun
import { die, findRoot } from './paths.ts';
import { cmdBuild, cmdCheck, cmdDev, cmdQa } from './run.ts';
import { cmdScaffold } from './scaffold.ts';

/**
 * `vendua` — the storefront CLI (03-storefront-contract.md): scaffold, dev,
 * check, build, qa. Zero-config inside the monorepo: commands discover the
 * repo root from cwd and resolve [slug] to storefronts/<slug>, or to cwd when
 * run inside a storefront.
 */

const USAGE = `vendua — the Venduá storefront CLI

Usage:
  vendua scaffold <slug>   create storefronts/<slug> from _template, allocate
                           a dev port, and register a dev tenant in Postgres
                           (DATABASE_URL; default postgres://vendua:vendua@localhost:5433/vendua)
  vendua dev [slug]        run the storefront's dev server
  vendua check [slug]      typecheck + vendua-conformance static (when installed)
  vendua build [slug]      vite build → storefronts/<slug>/dist
  vendua qa [slug]         build + vendua-conformance e2e (when installed)

[slug] is optional when the current directory is a storefront (has a
vendua.config.ts). All commands must run inside the vendua monorepo.
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }
  if (!['scaffold', 'dev', 'check', 'build', 'qa'].includes(command)) {
    console.error(USAGE);
    die(`unknown command '${command}'`, 2);
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const slug = args[1];
  if (args.length > 2) die(`unexpected argument '${args[2]}'`, 2);

  const root = findRoot();
  if (!root) {
    die('not inside the vendua monorepo (no package.json with a storefronts/* workspace found)');
  }

  switch (command) {
    case 'scaffold':
      await cmdScaffold(slug, root);
      break;
    case 'dev':
      await cmdDev(slug, root);
      break;
    case 'check':
      await cmdCheck(slug, root);
      break;
    case 'build':
      await cmdBuild(slug, root);
      break;
    case 'qa':
      await cmdQa(slug, root);
      break;
  }
}

await main();

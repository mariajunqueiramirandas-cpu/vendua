#!/usr/bin/env bun
import { die, findRoot } from './paths.ts';
import { cmdBuild, cmdCheck, cmdDev, cmdQa } from './run.ts';
import { cmdScaffold } from './scaffold.ts';
import { cmdCodemod } from './codemod.ts';
import { cmdTemplates } from './templates.ts';
import { cmdTrain } from './train.ts';
import { cmdOps } from './ops.ts';
import { cmdRelease } from './release.ts';
import { cmdFleet } from './fleet-ops.ts';

const USAGE = `vendua — the Venduá storefront CLI

Usage:
  vendua scaffold <slug>   create storefronts/<slug> from _template, allocate
                           a dev port, and register a dev tenant in Postgres
                           (DATABASE_URL; default postgres://vendua:vendua@localhost:5433/vendua)
  vendua dev [slug]        run the storefront's dev server
  vendua check [slug]      typecheck + vendua-conformance static (when installed)
  vendua build [slug]      vite build → storefronts/<slug>/dist
  vendua qa [slug]         build + vendua-conformance e2e (when installed)

Fleet (every in-repo storefront unless slugs are given):
  vendua train [slug…] [--core] [--record] [--pending] [--report f]
                           rebuild on the current Kernel, check each artifact,
                           validate manifests vs the compat matrix, assert zero
                           storefront diffs; --record files manifests with Core;
                           --pending rebuilds only stores Core queued (token edits)
  vendua codemod list
  vendua codemod run <id> [slug…] [--dry]
                           apply (or preview) a Contract codemod
  vendua codemod rehearse <id> [--report f]
                           copy → codemod → typecheck → check, per store;
                           measures the failure tail, changes nothing
  vendua templates list
  vendua templates migrate <id> [--apply] [--ring r] [--tenant slug]… [--report f]
                           dry-run (default) or apply a template migration in Core
  vendua templates rollback <id> [--ring r] [--tenant slug]…
  vendua release build [slug…] [--no-build] [--core]
                           build each storefront and write dist/storefront.manifest.json
                           (content-addressed release id, budgets, QA checks)
  vendua release publish <slug…|--all> [--artifacts <uri>] [--no-build] [--no-register]
                           upload the release to the artifact store (VENDUA_ARTIFACTS:
                           file:///abs/dir or s3://bucket/prefix; skipped when already
                           there) and register it with the Control Plane
  vendua ops <tenant> [--maintenance "msg" [--href u] | --normal] [--ring r] [--demand high|normal]
                           a store's ring, v.js kill switch and demand notice

Control Plane (every store Core knows):
  vendua fleet status | stores | store <tenant> | releases [bundle]     [--json]
  vendua fleet promote <tenant> <release> [--reason r] [--force]
  vendua fleet rollback <tenant> [--reason r] | pin <tenant> | unpin <tenant>
  vendua fleet bundle <tenant> <bundle> | probe <tenant>
  vendua fleet provision --slug s --name n --plan p --owner n --phone p --email e [--lead id]
  vendua fleet provisions | retry <id> | incidents [--all] | incidents ack|resolve <id>

Core: VENDUA_CORE_ORIGIN (default http://localhost:8787), CONTROL_SECRET.

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
  const FLEET = ['train', 'codemod', 'templates', 'ops', 'release', 'fleet'];
  if (![...FLEET, 'scaffold', 'dev', 'check', 'build', 'qa'].includes(command)) {
    console.error(USAGE);
    die(`unknown command '${command}'`, 2);
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const root = findRoot();
  if (!root) {
    die('not inside the vendua monorepo (no package.json with a storefronts/* workspace found)');
  }

  if (command === 'train') await cmdTrain(args.slice(1), root);
  if (command === 'codemod') await cmdCodemod(args.slice(1), root);
  if (command === 'templates') await cmdTemplates(args.slice(1));
  if (command === 'ops') await cmdOps(args.slice(1));
  if (command === 'release') await cmdRelease(args.slice(1), root);
  if (command === 'fleet') await cmdFleet(args.slice(1));

  const slug = args[1];
  if (args.length > 2) die(`unexpected argument '${args[2]}'`, 2);

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

#!/usr/bin/env bun
import { anyFailed, printChecks } from './report.ts';
import { runStatic } from './static.ts';
import { runK05 } from './k05.ts';
import { runE2E } from './e2e.ts';
import { runManifest } from './manifest.ts';

const [, , cmd, ...args] = process.argv;

function usage(): never {
  console.error(
    'usage:\n' +
      '  vendua-conformance static <storefrontDir>\n' +
      '  vendua-conformance k05 <slug> [baseRef]\n' +
      '  vendua-conformance e2e <storefrontDir> [--prebuilt] [--grep <re>]\n' +
      '  vendua-conformance manifest <storefrontDir>   (K16 on dist/vendua-manifest.json)',
  );
  process.exit(2);
}

switch (cmd) {
  case 'static': {
    const dir = args[0];
    if (!dir) usage();
    const results = await runStatic(dir);
    printChecks(results);
    process.exit(anyFailed(results) ? 1 : 0);
  }
  case 'k05': {
    const slug = args[0];
    if (!slug) usage();
    const results = await runK05(slug, args[1]);
    printChecks(results);
    process.exit(anyFailed(results) ? 1 : 0);
  }
  case 'e2e': {
    const dir = args[0];
    if (!dir) usage();
    const gi = args.indexOf('--grep');
    process.exit(
      await runE2E(dir, {
        prebuilt: args.includes('--prebuilt'),
        ...(gi >= 0 && args[gi + 1] ? { grep: args[gi + 1] } : {}),
      }),
    );
  }
  case 'manifest': {
    const dir = args[0];
    if (!dir) usage();
    const results = runManifest(dir);
    printChecks(results);
    process.exit(anyFailed(results) ? 1 : 0);
  }
  default:
    usage();
}

#!/usr/bin/env bun
import { anyFailed, printChecks } from './report.ts';
import { runStatic } from './static.ts';
import { runK05 } from './k05.ts';
import { runE2E } from './e2e.ts';

const [, , cmd, ...args] = process.argv;

function usage(): never {
  console.error(
    'usage:\n' +
      '  vendua-conformance static <storefrontDir>\n' +
      '  vendua-conformance k05 <slug> [baseRef]\n' +
      '  vendua-conformance e2e <storefrontDir>',
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
    process.exit(await runE2E(dir));
  }
  default:
    usage();
}

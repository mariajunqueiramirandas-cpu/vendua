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
import { didYouMean } from './args.ts';
import { COMMANDS, USAGE, helpFor } from './help.ts';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(command ? 0 : 2);
  }
  if (command === 'help') {
    const topic = args[1];
    if (topic && !COMMANDS.includes(topic)) {
      console.error(USAGE);
      die(`no help for '${topic}'${didYouMean(topic, COMMANDS)}`, 2);
    }
    console.log(topic ? helpFor(topic, args[2]) : USAGE);
    process.exit(0);
  }
  if (!COMMANDS.includes(command)) {
    console.error(USAGE);
    die(`unknown command '${command}'${didYouMean(command, COMMANDS)}`, 2);
  }
  if (args.includes('--help') || args.includes('-h')) {
    const sub = args.slice(1).find((a) => !a.startsWith('-'));
    console.log(helpFor(command, sub));
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
  if (slug?.startsWith('-'))
    die(
      `unknown flag '${slug}': vendua ${command} takes no flags\nrun 'vendua ${command} --help' for usage`,
      2,
    );
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

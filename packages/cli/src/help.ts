// `vendua --help` lists every command; `vendua <command> --help` (or `vendua help <command>`)
// prints just that command's section. Each command's block is written once and used by both.

interface Entry {
  /** the lines under the global listing */
  list: string;
  /** the fuller text for `vendua <command> --help`; defaults to `list` */
  full?: string;
}

const CORE_ENV = `Needs CONTROL_SECRET; Core is at VENDUA_CORE_ORIGIN (default http://localhost:8787).`;
const SLUG_NOTE = `[slug] is optional when the current directory is a storefront (has a vendua.config.ts).`;

export const FLEET_USAGE = `vendua fleet status [--json]
vendua fleet stores [--json]
vendua fleet store <tenant> [--json]
vendua fleet releases [bundle] [--json]
vendua fleet promote <tenant> <release> [--reason "…"] [--force] [--dry-run]
vendua fleet rollback <tenant> [--reason "…"] [--dry-run]
vendua fleet pin <tenant> [--reason "…"] | unpin <tenant>
vendua fleet bundle <tenant> <bundle>
vendua fleet probe <tenant>
vendua fleet provision --slug s --name "Loja" --plan basic --owner "Nome" --phone 11999990000
                       --email dono@x.com [--lead <lead id>]
vendua fleet provisions [--json]
vendua fleet retry <provisioning id>
vendua fleet incidents [--all] [--json] | ack <id> | resolve <id>`;

export const HELP: Record<string, Entry> = {
  scaffold: {
    list: `  vendua scaffold <slug>   create storefronts/<slug> from _template, allocate
                           a dev port, and register a dev tenant in Postgres
                           (DATABASE_URL; default postgres://vendua:vendua@localhost:5433/vendua)`,
    full: `vendua scaffold <slug>

Create storefronts/<slug> from _template, allocate a dev port, and register a dev tenant in
Postgres (DATABASE_URL; default postgres://vendua:vendua@localhost:5433/vendua).`,
  },
  dev: {
    list: `  vendua dev [slug]        run the storefront's dev server`,
    full: `vendua dev [slug]

Run the storefront's dev server.

${SLUG_NOTE}`,
  },
  check: {
    list: `  vendua check [slug]      typecheck + vendua-conformance static (when installed)`,
    full: `vendua check [slug]

Typecheck, then run vendua-conformance static (K01–K15) when it is installed.

${SLUG_NOTE}`,
  },
  build: {
    list: `  vendua build [slug]      vite build → storefronts/<slug>/dist`,
    full: `vendua build [slug]

vite build → storefronts/<slug>/dist.

${SLUG_NOTE}`,
  },
  qa: {
    list: `  vendua qa [slug]         build + vendua-conformance e2e (when installed)`,
    full: `vendua qa [slug]

Build, then run vendua-conformance e2e (when installed).

${SLUG_NOTE}`,
  },
  train: {
    list: `  vendua train [slug…] [--core] [--record] [--pending] [--report f]
                           rebuild on the current Kernel, check each artifact,
                           validate manifests vs the compat matrix, assert zero
                           storefront diffs; --record files manifests with Core;
                           --pending rebuilds only stores Core queued (token edits)`,
    full: `vendua train [slug…] [--core] [--record] [--pending] [--report <file>]

Rebuild every in-repo storefront (or the slugs given) on the current Kernel, check each
artifact, validate its manifest against the compat matrix and assert the train touched no
storefront source.

  --core        pull templates and tokens from Core instead of the repo
  --record      file each manifest with Core, so template migrations know the store's Kernel
  --pending     rebuild only the stores Core queued (token edits), then acknowledge them
  --report <f>  also write the result table to <f>

${CORE_ENV}`,
  },
  codemod: {
    list: `  vendua codemod list
  vendua codemod run <id> [slug…] [--dry]
                           apply (or preview) a Contract codemod
  vendua codemod rehearse <id> [--report f]
                           copy → codemod → typecheck → check, per store;
                           measures the failure tail, changes nothing`,
    full: `vendua codemod list
vendua codemod run <id> [slug…] [--dry]
vendua codemod rehearse <id> [--report <file>]

  list       the codemods and what they do
  run        apply a Contract codemod to every in-repo storefront (or the slugs given);
             --dry prints the diff and writes nothing
  rehearse   copy each store, run the codemod, typecheck and \`vendua check\` the copy;
             measures the failure tail and changes nothing in the repo; --report writes
             the table to <file>`,
  },
  templates: {
    list: `  vendua templates list
  vendua templates migrate <id> [--apply] [--ring r] [--tenant slug]… [--report f]
                           dry-run (default) or apply a template migration in Core
  vendua templates rollback <id> [--ring r] [--tenant slug]…`,
    full: `vendua templates list
vendua templates migrate <id> [--apply] [--ring r] [--tenant slug]… [--report <file>]
vendua templates rollback <id> [--ring r] [--tenant slug]…

Template migrations run in Core against each store's live templates.

  list        the migrations Core knows
  migrate     a dry run by default: the per-store report of what would be applied, skipped or
              conflicted, and nothing written; --apply writes it
  rollback    undo a migration
  --ring r    only stores in this ring (canary | early | stable)
  --tenant s  only this store; repeat to name several

${CORE_ENV}`,
  },
  release: {
    list: `  vendua release build [slug…] [--no-build] [--core]
                           build each storefront and write dist/storefront.manifest.json
                           (content-addressed release id, budgets, QA checks)
  vendua release publish <slug…|--all> [--artifacts <uri>] [--no-build] [--no-register]
                           upload the release to the artifact store (VENDUA_ARTIFACTS:
                           file:///abs/dir or s3://bucket/prefix; skipped when already
                           there) and register it with the Control Plane`,
    full: `vendua release build [slug…] [--no-build] [--core]
vendua release publish <slug…|--all> [--artifacts <uri>] [--no-build] [--no-register] [--core]

  build       build each storefront and write dist/storefront.manifest.json (content-addressed
              release id, budgets, QA checks)
  publish     upload the release to the artifact store and register it with the Control Plane
  --artifacts <uri>  the artifact store, file:///abs/dir or s3://bucket/prefix (default
                     $VENDUA_ARTIFACTS); a release already there is skipped
  --no-build         reuse the existing dist/
  --no-register      upload only, do not register with the Control Plane
  --core             build with data from Core, not the repo

${CORE_ENV}`,
  },
  ops: {
    list: `  vendua ops <tenant> [--maintenance "msg" [--href u] | --normal] [--ring r] [--demand high|normal]
                           a store's ring, v.js kill switch and demand notice`,
    full: `vendua ops <tenant> [--maintenance "msg" [--href <url>] | --normal] [--ring r] [--demand high|normal]

Show or change a store's ring, v.js kill switch and demand notice. With no flags it only reads.

  --maintenance "msg"  turn the kill switch on: v.js shows the message instead of the store
  --href <url>         link on the notice (https:// or a path); only with --maintenance
  --normal             turn the kill switch off
  --ring r             canary | early | stable
  --demand level       high | normal

Examples:
  vendua ops <tenant>
  vendua ops <tenant> --maintenance "Voltamos em 10 minutos"
  vendua ops <tenant> --normal --demand normal

${CORE_ENV}`,
  },
  fleet: {
    list: `  vendua fleet status | stores | store <tenant> | releases [bundle]     [--json]
  vendua fleet promote <tenant> <release> [--reason r] [--force] [--dry-run]
  vendua fleet rollback <tenant> [--reason r] [--dry-run] | pin <tenant> | unpin <tenant>
  vendua fleet bundle <tenant> <bundle> | probe <tenant>
  vendua fleet provision --slug s --name n --plan p --owner n --phone p --email e [--lead id]
  vendua fleet provisions | retry <id> | incidents [--all] | incidents ack|resolve <id>`,
    full: `${FLEET_USAGE}

  --json      print the data as JSON instead of a table
  --dry-run   promote and rollback: print what would change and write nothing
  --force     promote a release whose checks failed

${CORE_ENV}`,
  },
};

const SECTIONS: [string, string[]][] = [
  ['Usage:', ['scaffold', 'dev', 'check', 'build', 'qa']],
  [
    'Fleet (every in-repo storefront unless slugs are given):',
    ['train', 'codemod', 'templates', 'release', 'ops'],
  ],
  ['Control Plane (every store Core knows):', ['fleet']],
];

export const COMMANDS = Object.keys(HELP);

export const USAGE = `vendua — the Venduá storefront CLI

${SECTIONS.map(([title, cmds]) => `${title}\n${cmds.map((c) => HELP[c]!.list).join('\n')}`).join('\n\n')}

Core: VENDUA_CORE_ORIGIN (default http://localhost:8787), CONTROL_SECRET.
\`vendua <command> --help\` shows one command.

[slug] is optional when the current directory is a storefront (has a
vendua.config.ts). All commands must run inside the vendua monorepo.
`;

const FLEET_NOTES: Record<string, string> = {
  promote: `Make <release> the store's live version: a full id, or the prefix \`fleet status\` prints.
Anything but the bundle's newest passing release also pins the store there.
--dry-run prints what would change and writes nothing; --force promotes a release whose checks failed.`,
  rollback: `Go back to the newest release the store had live before the current one, and pin the store there.
--dry-run prints what would change and writes nothing.`,
};

/** `vendua fleet promote --help` narrows the fleet help to the lines about that subcommand. */
export function helpFor(command: string, sub?: string): string {
  const entry = HELP[command];
  if (!entry) return USAGE;
  const full = entry.full ?? entry.list;
  if (command !== 'fleet' || !sub) return full;
  const blocks: string[][] = [];
  for (const line of FLEET_USAGE.split('\n')) {
    if (line.startsWith('vendua fleet')) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  const hit = blocks.filter((b) => b[0]!.split(/[ |]+/).includes(sub));
  if (!hit.length) return full;
  const note = FLEET_NOTES[sub];
  return `${hit.map((b) => b.join('\n')).join('\n')}${note ? `\n\n${note}` : ''}\n\n${CORE_ENV}`;
}

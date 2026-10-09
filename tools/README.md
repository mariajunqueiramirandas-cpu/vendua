# tools/

Repo-level CI utilities implementing the fleet isolation machinery
([docs/architecture/06-monorepo.md](../docs/architecture/06-monorepo.md)):
the changed-path check that enforces storefront write scope, and the
affected graph that decides what CI builds. Also the developer scripts
the root `package.json` exposes: `workspaces.mjs` (`check` / `test`),
`dev-stack.mjs` (`dev:stack` / `dev:stop`) and `new-migration.mjs`.

## check-storefront-paths.mjs

A PR labelled `storefront:<slug>` may only touch `storefronts/<slug>/**`, plus
`bun.lock` when its change (merge base → HEAD) is only that store's own workspace
entry and self-link, which `bun install` writes for a new store
(`packages/conformance/src/lockfile.ts`, shared with K05 and `affected.mjs`).
Zero `storefront:` labels → no-op pass; two different slugs → fail (a PR
belongs to one storefront). Exit 0 pass / 1 failure with violations listed.

CI (`.github/workflows/ci.yml` → `storefront-isolation` job):

```sh
bun tools/check-storefront-paths.mjs [--base <ref>]
```

Reads labels and the base branch from the `pull_request` payload at
`$GITHUB_EVENT_PATH`; changed files come from
`git diff --name-only <base>...HEAD` (default base `origin/<pr base>`; the
checkout needs `fetch-depth: 0`).

Local — the same check on an explicit file list:

```sh
bun tools/check-storefront-paths.mjs --slug demo --files storefronts/demo/src/App.tsx
```

## check-agent-runtime-boundary.mjs

`packages/agent-runtime` imports nothing from Core (ADR 0030 decision 11): no
other `@vendua/*` package, no relative path leaving the package, no npm
dependency — only `node:` / `bun:` builtins. Fails with one
`file:line specifier` per offence; exit 0 pass / 1 failure.

```sh
bun tools/check-agent-runtime-boundary.mjs [--root <dir>]   # default: packages/agent-runtime
```

CI: the `check` job's "Agent runtime boundary" step. A change to
`packages/agent-runtime` also runs Core's tests, conformance, the admin gate
and the edge smoke (Core depends on it).

## affected.mjs

Prints the affected graph for a diff as JSON
`{"packages": [<workspace dirs>], "allStorefronts": <bool>}`:

```sh
bun tools/affected.mjs [--base <ref>]   # default base: origin/main
```

Mapping:

| Diff touches …                                                                                            | Result                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/{kernel,cli,conformance,ui-defaults}/**`, root `package.json`, `bun.lock`, `tsconfig.base.json` | `allStorefronts: true` + that workspace listed |
| `storefronts/<slug>/**`                                                                                   | `storefronts/<slug>`                           |
| other paths under `storefronts/` (Dockerfile, README — shared infra that can't be attributed to one slug) | `allStorefronts: true`                         |
| `packages/<other>/**`                                                                                     | `packages/<name>`                              |
| `site/**`                                                                                                 | `site`                                         |
| `docs/`, `tools/`, `.github/`, other root files                                                           | nothing                                        |

`packages` lists workspace _directories_, not package names — consumers
`cd` into them and run the script they need (`build`, `check`). When
`allStorefronts` is true, expand to every `storefronts/*/` dir. Used by the `check` job's Builds step; on
push to main CI builds all storefronts instead of diffing.

## workspaces.mjs

Runs a script in every workspace that has one: the two loops the CI `check` job used to carry as
shell, now shared with the root `package.json` (`bun run check`, `bun run test`).

```sh
bun tools/workspaces.mjs check [--keep-going] [--list]
bun tools/workspaces.mjs test  [--keep-going] [--list] [--core]
```

- `check`: `bun run check` in each of `packages/* site apps/* storefronts/*` whose `package.json`
  has a `check` script, so a new package needs no CI edit.
- `test`: `bun test` (not the package's `test` script) in each of `packages/* apps/status tools`
  that has a `test` script, except `packages/core`: CI runs that in its own job against Postgres
  (`cd packages/core && bun test`; `--core` adds it here). `tools/` itself has no
  `package.json`; CI's own "Isolation tools tests" step runs `bun test tools/`.
- Like CI's `bash -e`, the first failure stops the run with that command's exit code;
  `--keep-going` finishes the rest and fails at the end. `--list` prints the directories only.

## dev-stack.mjs

`bun run dev:stack [--seed] [--dry-run] [--only core,admin,control]`, `bun run dev:stack status`
and `bun run dev:stop [--dry-run]`: Core :8787 (dev env, `VENDUA_ADMIN_DEV_OTP=1`), the merchant
admin :5196 and the CRM :5195, each in its own process group with a pidfile and log under
`/tmp/vendua-dev/` (`VENDUA_DEV_DIR`). A service whose port already answers is left alone, and
`dev:stop` only signals the groups its own pidfiles name. `--seed` runs migrate and
`seed:fixtures` before Core boots, then the CRM leads and the demo orders. Details and the manual
equivalents are in `.claude/skills/local-stack/SKILL.md`.

## new-migration.mjs

`cd packages/core && bun run migration:new <name>` writes `db/migrations/NNNN_<name>.sql`, NNNN
being the highest number there plus one (read at run time), with a header and a commented-out
tenant-RLS skeleton.

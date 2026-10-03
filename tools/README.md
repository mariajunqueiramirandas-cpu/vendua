# tools/

Repo-level CI utilities implementing the fleet isolation machinery
([docs/architecture/06-monorepo.md](../docs/architecture/06-monorepo.md)):
the changed-path check that enforces storefront write scope, and the
affected graph that decides what CI builds.

## check-storefront-paths.mjs

A PR labelled `storefront:<slug>` may only touch `storefronts/<slug>/**`.
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

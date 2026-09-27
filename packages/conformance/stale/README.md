# Stale reference storefronts

The staleness guarantee (docs/architecture/11-backward-compatibility.md) is tested,
not asserted: `kernel-1.0.0/` is `storefronts/_template` **as built on Kernel 1.0.0**
— the oldest supported line for Contract 2 — committed byte-for-byte and never
rebuilt. CI's `stale-reference` job serves it against Core `main` on every merge
and runs the S-series (plus K16) through the preview proxy:

```sh
bunx vendua-conformance e2e packages/conformance/stale/kernel-1.0.0 --prebuilt --grep '\[(S0|K16)'
```

If a Core or Kernel change breaks a store nobody rebuilt, this job goes red and
the merge that broke it reverts.

Refresh only when the oldest supported Kernel line moves (a compat-matrix change):
build `storefronts/_template` on that Kernel and replace `dist/` + `templates/`.
Features newer than this artifact (new notice kinds, SDK blocks placed by template
migrations) must degrade here — that is the point.

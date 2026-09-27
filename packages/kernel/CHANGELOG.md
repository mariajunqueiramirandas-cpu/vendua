# @vendua/kernel changelog

Semver, per docs/architecture/11-backward-compatibility.md: minors and patches
never need a storefront edit; a major only ships with a Contract major.

## 1.1.1

- Build plugin: the manifest's section catalog carries each section's area
  declaration order (`order`). Core stores manifests as jsonb, which reorders
  object keys, so template migrations picked areas in the wrong order — found
  in the canary review of `2026-09-delivery-eta-on-product` (the block landed
  in `after-cta`), rolled back, fixed here, re-applied.

## 1.1.0

- New SDK block `sdk:delivery-eta` (category `info`): delivery window and fee
  from Core's zones, pickup time from the store's prep time. Placed on existing
  stores by the template migration `2026-09-delivery-eta-on-product`
  (requires Kernel ≥ 1.1.0).

## 1.0.0

- Contract 2 (ADR 0018): page templates, SDK and store sections, blocks in
  category-typed areas, Kernel pages, styling API. Every slot has a default
  (`@vendua/ui-defaults`). Public surface frozen (API.md).

# ADR 0018: Pages are composed from SDK and store sections

- Status: Proposed
- Date: 2026-09-26
- Amends: [ADR 0005](0005-server-driven-system-surfaces.md) (brand pages are
  no longer wholly outside data-driven composition)

## Context

After a store is created, agent coding should be close to zero. Today the
architecture doesn't allow that:

- Brand pages are free React code under `routes/`. A new platform feature that
  belongs on a brand page (a stock counter, reviews, a loyalty badge) reaches a
  store only after someone edits that store. Rungs 4–5 of the
  [shipping ladder](../architecture/00-overview.md#how-a-global-feature-ships-the-ladder)
  are opt-in, so every new feature becomes an N-storefront adoption job.
- `<SurfaceRegion>` lets Core place notices inside brand pages, but only
  notices, and only where a store chose to mount a region.
- A fixed list of required regions would help, but only until we need a region
  nobody anticipated. Adding one later is a Contract major.
- Copy and imagery are hard-coded in page code
  (`storefronts/quero-pudim/routes/index.tsx`), so a merchant's headline change
  is a code change.

## Decision

A storefront page is a **template**: data that lists **sections** in order.
Sections contain **blocks**. Everything critical or likely to change is an SDK
section or block. The store's own code supplies only the bespoke sections that
carry its design.

1. **Templates are data.** Each page (home, catalog, product, custom content
   pages) has a JSON template per store, stored in Core and delivered with the
   store state. The artifact bundles a snapshot as the last-known-good
   fallback.
2. **Two kinds of section.**
   - `sdk:*` sections are Kernel-owned: purchase panel, catalog grid, cart,
     store status, hours, reviews, loyalty, header cart and more. The Kernel
     owns their behaviour and markup and improves them for every store.
   - `store:*` sections live in `storefronts/<slug>/sections/`. They are
     presentation only: they read their text and images from their settings
     and never implement commerce.
3. **Sections are the regions.** A template can put any section at any position
   on any page, so there is no fixed list of regions to outgrow.
4. **Blocks go into areas.** A section declares named areas
   (`<BlockArea name="after-price" />`) and the block **categories** each area
   accepts (`purchase-extras`, `badge`, `social-proof`…). A block the SDK ships
   next year is placeable into a store section written today, because the
   section accepts its category, not a list of block names.
5. **Content is data.** A section's text, images and product picks are its
   settings in the template, editable by the merchant. Store sections declare a
   settings schema, and conformance flags hard-coded copy.
6. **Kernel pages.** Features that need a whole page (order history, loyalty,
   waitlist, account) are Kernel pages under the reserved `/(vendua)/*` routes.
   They render inside the store's layout shell and use its tokens and styling
   API.
7. **Styling API instead of overrides.** Every SDK section and block exposes:
   - tokens;
   - `variant` settings;
   - documented `data-part` attributes and `--v-<component>-*` custom
     properties that store CSS may target. These are Contract surface, stable
     within a major.

   Slot overrides stay as the last resort. Each override freezes that UI
   against Kernel improvements, so generation QA counts them and flags stores
   above a threshold.

8. **Template migrations.** New features are placed across the fleet by
   deterministic, versioned transforms over templates: insert, move or remove a
   section or block by rule. Each migration:
   - has a dry-run report per store;
   - is applied by ring;
   - is reversible, because templates are versioned;
   - never overwrites merchant settings.
9. **Stale-safe by construction.** A section or block type the store's Kernel
   doesn't know renders nothing and is reported. Unknown settings are ignored.
   A template carries a `version` for incompatible shape changes, which follow
   [11](../architecture/11-backward-compatibility.md) like any envelope.
10. **This is Contract v2.** Pages move from free `routes/` to `sections/` plus
    templates. It lands **before the first customer**. The in-repo storefronts
    are ported by hand: the change is structural, not codemod-shaped. No
    customer stores exist, so no dual-support window is needed.

Mechanics, schemas and the migration format:
[architecture/17-page-composition](../architecture/17-page-composition.md).

## Consequences

### Positive

- A new feature ships as a Kernel minor (new section or block) plus a template
  migration. It reaches every store without touching store code, which extends
  rung 4 of the ladder to brand pages.
- Merchants change copy, imagery, section order and feature toggles without an
  engineer or an agent.
- After launch, agent coding is limited to a new bespoke section or a redesign
  the merchant asks for. That is a product event, not maintenance.
- Generation gets smaller and better bounded: the agent writes store sections
  plus the initial templates and content. It no longer writes whole pages.

### Negative / costs

- The Kernel's scope grows. SDK sections are products that need real design
  range (variants, parts) or every store looks alike.
- Brand pages lose some freedom. The page skeleton is data, and bespoke design
  lives inside sections.
- An auto-placed block can sit awkwardly in a bespoke design. Mitigations:
  category acceptance, tokens, a visual conformance check, and canary review
  before a migration leaves the canary ring.
- Two places to reason about a page (template + section code). Tooling must
  show the resolved page.
- Porting the in-repo storefronts to v2 is manual work.

## Alternatives considered

- **Fixed list of required regions.** Cheaper now, but breaks the first time we
  need a region nobody anticipated. Every new region is then a Contract major.
- **Per-store adoption PRs by agents.** Works for any feature, but costs agent
  time × N stores on every feature. It stays for rare, large, bespoke work
  only.
- **Full page builder (sections all the way down, no store code).** Kills the
  bespoke differentiator ADR 0005 protects.
- **Micro-frontends / Web Components injected by Core.** Loses React
  composition, tokens and conformance, and brings back the per-framework tax
  ADR 0002 rejected.

## Links

- [architecture/17-page-composition](../architecture/17-page-composition.md)
- [architecture/00-overview — feature ladder](../architecture/00-overview.md#how-a-global-feature-ships-the-ladder)
- [ADR 0005](0005-server-driven-system-surfaces.md),
  [ADR 0007](0007-headless-primitives.md), [ADR 0008](0008-contract-versioning.md)

# 17 — Page Composition: Templates, Sections and Blocks

> Status: Implemented — Contract v2, Kernel 1.x · Last reviewed: 2026-09-27
> Decisions: [ADR 0018](../adr/0018-page-composition.md)

How a storefront page is put together so that new platform features reach it
without anyone editing the store's code. This is **Contract v2**, frozen in [03](03-storefront-contract.md).

**Where it lives:** the template model, validation and migration DSL in
`@vendua/templates` (shared by Core, Kernel and CLI); the renderer, `defineSection`,
`<BlockArea>`, SDK sections/blocks and Kernel pages in `@vendua/kernel`
(`src/composition`, `src/sdk`, `src/pages`); slot defaults and all default CSS in
`@vendua/ui-defaults`; templates, tokens, migrations and their history in Core
(`storefront_templates`, `storefront_tokens`, `template_migration_runs`). Fleet
commands: `vendua templates migrate|rollback`, `vendua train`. Evidence of the
first real runs: [fleet-runs](../fleet-runs/README.md).

## The model in one picture

```
page template (data, per store, in Core)
  └─ section  sdk:purchase-panel   ← Kernel code
  │    └─ area "after-price"  accepts [purchase-extras, badge]
  │         ├─ block sdk:stock-counter
  │         └─ block sdk:notify-me
  └─ section  store:story           ← storefronts/<slug>/sections/story.tsx
  │    └─ area "aside" accepts [social-proof]
  │         └─ block sdk:review-snippet   ← placed by a template migration
  └─ section  sdk:reviews           ← placed by a template migration
```

The store owns what its sections look like. The template decides which sections
appear, in what order, with which blocks and settings. The Kernel owns every
`sdk:*` section and block.

## Page templates

```ts
type PageTemplate = {
  version: 1;
  page: 'home' | 'catalog' | 'product' | `page:${string}`; // page:<handle> = content pages
  sections: SectionInstance[];
};
type SectionInstance = {
  id: string; // stable, used by migrations and merchant edits
  type: `sdk:${string}` | `store:${string}`;
  settings?: Record<string, unknown>; // validated against the section's schema
  blocks?: Record<string /* area */, BlockInstance[]>;
  disabled?: boolean;
};
type BlockInstance = {
  id: string;
  type: `sdk:${string}` | `store:${string}`;
  settings?: Record<string, unknown>;
};
```

- Stored in Core per tenant, with a version history (`storefront_templates`,
  RLS-scoped like every table).
- Delivered in the store state (`__VENDUA_STATE__` and
  `/storefront/v1/state?templates=1` — `v.js`'s poll omits them to stay small),
  so first paint already has the composition.
- The artifact bundles the template snapshot it was built with. If Core is
  unreachable, the store renders that last-known-good composition.
- The layout shell (header, footer, announcement bar) is a template too
  (`page: 'layout'`) with areas such as `header.actions` and `footer.extra`.

## Sections

A section module exports a component and a schema:

```ts
// storefronts/<slug>/sections/story.tsx
export const schema = defineSection({
  type: 'store:story',
  settings: {
    title: text({ max: 80 }),
    body: richText({ max: 600 }),
    image: image(),
  },
  areas: { aside: { accepts: ['social-proof'], max: 2 } },
});
export default function Story({ settings }: SectionProps<typeof schema>) {
  /* bespoke markup, animation, 3D... — reads copy from settings */
}
```

Rules for `store:*` sections:

- Presentation only. Commerce goes through primitives and hooks, and never
  through raw network calls (the v1 rules still apply).
- Text, images and product picks come from `settings`. Conformance flags JSX
  text longer than a short label as hard-coded copy.
- A section MAY declare areas. It SHOULD declare at least one area wherever an
  SDK block could reasonably sit, and the scaffold's sections show the pattern.

`sdk:*` sections are Kernel code (`@vendua/kernel/src/sdk`; their styles in
`@vendua/ui-defaults`). They follow the same
schema format. Each one ships with canonical fixtures for conformance.

## Blocks and areas

- `<BlockArea name="after-price" />` renders the blocks the template lists for
  that area, in order, each inside an error boundary.
- An area accepts block **categories**, not block names. Initial categories:
  `purchase-extras`, `badge`, `social-proof`, `promo`, `info`, `media`. A new
  SDK block declares its category, so it can go into any existing area that
  accepts that category, including store sections written before the block
  existed.
- New categories are additive (Kernel minor). An old section simply doesn't
  accept them until its store adds the category. That's a one-line change and
  one of the few post-launch code edits we expect.

## Kernel pages

Features that need a whole page live under the reserved `/(vendua)/*` route
group: checkout and order today, plus order history, account, loyalty and
waitlist as they ship. A Kernel page:

- renders inside the store's `layout` template (its header and footer);
- uses the store's tokens and the styling API;
- appears on every store on the next rebuild. Links to it are added by a
  template migration (for example a header block) or by the merchant.

## Styling API

Styling an SDK component MUST NOT require replacing it. Each SDK section and
block exposes three layers:

1. **Tokens.** These are the global defaults. Tokens become store data in Core,
   so changing them triggers a rebuild with no code change.
2. **Variants**, a `variant` setting per component (e.g. purchase panel
   `compact | editorial | split`).
3. **Parts**: documented `data-part="…"` attributes and `--v-<component>-*`
   custom properties that store CSS MAY target. The documented parts are
   Contract surface (stable within a major, renamed only with a codemod). Store
   CSS may target these documented parts; the v1 `no-v-namespace` rule still
   bans every other `v-*` / `[data-vendua]` selector.

Slot overrides ([04](04-extensions-and-overrides.md)) remain available but are
the last resort. An overridden component stops receiving Kernel improvements.
Generation QA reports the override count per store and flags stores above a
threshold.

## Template migrations

This is how a new feature gets placed on existing stores:

```ts
export default defineTemplateMigration({
  id: '2026-11-reviews-on-product',
  requiresKernel: '>=1.4.0', // stores on an older Kernel are skipped, not broken
  up(t) {
    if (t.page !== 'product' || t.has('sdk:reviews')) return t;
    return t.insertAfter('sdk:purchase-panel', { type: 'sdk:reviews' });
  },
});
```

- **Deterministic and idempotent.** Migrations address sections and blocks by
  type and id. They never rewrite merchant settings, and they skip a template
  where the merchant removed the thing before.
- **Dry run first.** Each migration produces a per-store report (applied,
  skipped, conflicted) before it is applied.
- **Applied by ring**, like a train: canary, then early, then stable. Canary
  includes a visual review of the resolved pages.
- **Reversible.** Every application writes a new template version. Rollback
  restores the previous version.
- **Merchants can opt out.** A merchant can remove or move what a migration
  added. A migration never re-adds something a merchant removed (edits record
  removed types as tombstones on the template).
- **Placement by category, from the build's manifest.** A migration finds "the
  first area on this page that accepts `info`" through the section catalog the
  store's last recorded build published (areas in declaration order).

## Compatibility

- An unknown section or block type renders nothing and is reported to
  telemetry. Unknown settings are ignored. A template can therefore reference
  features newer than the store's build, which shows up as nothing until the
  next train. Migrations normally avoid this by gating on `requiresKernel`.
- The template `version` only changes for incompatible shape changes. Those
  follow [11](11-backward-compatibility.md): the Kernel keeps reading the old
  shape for a full major.
- Section settings schemas are additive within a major, like slot props.

## What still needs code after launch

| Change                                          | How it ships                              | Store code touched?     |
| ----------------------------------------------- | ----------------------------------------- | ----------------------- |
| Copy, images, product picks, section order      | Merchant or staff edits the template      | Never                   |
| Colours, fonts, radii                           | Token edit → automatic rebuild            | Never                   |
| New SDK section, block or Kernel page           | Kernel minor → train → template migration | Never                   |
| New block category in an existing store section | One-line area change                      | Yes, rare               |
| New bespoke store section / redesign            | Merchant request → agent or human         | Yes, product event      |
| Contract major                                  | Codemod → train                           | Automated; tail → agent |

**Post-launch agent-minutes per store per month** is tracked, with a target near
zero. If it climbs, something that should have been data or SDK is still code.

## Generation under v2

The generation agent ([14](14-agent-pipeline.md)) produces:

- `store:*` sections for the bespoke parts of the design;
- the initial page templates, mixing SDK and store sections;
- the initial content as template settings;
- tokens.

The agent no longer writes whole pages. The diff it is judged on is smaller,
and the result is updatable from day one.

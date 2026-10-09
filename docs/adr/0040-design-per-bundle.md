# ADR 0040: A store's saved design belongs to the bundle it was made for

- Status: Accepted (built 2026-10-09: migration 0114, `storefront-platform.ts`,
  `PUT /admin/v1/appearance/site`, Aparência's site picker)
- Date: 2026-10-09
- Amends: [ADR 0039](0039-site-builder-on-claude-code.md) (delivery) and
  [17](../architecture/17-page-composition.md) (templates as store data)

## Context

A store's layout (`storefront_templates`) and colours (`storefront_tokens`) were one set per
store, whichever bundle it ran. The site sob medida's delivery writes its design into that set,
over the store's earlier Aparência edits. Staff then moved Quero Pudim Gourmet back to
`_template` in the CRM: the template's code ran the custom design, drew nothing for the
`store:hero`, `store:story` and `store:instagram` sections it doesn't have, and kept the custom
colours. The default store card never came back, because no saved page asked for it.

The owner's decision (2026-10-09): a store with a site sob medida chooses, in Aparência, between
its custom site and the default template, each with its own layout and appearance, and the
edits made on each side are kept.

## Decision

- **Every saved template and token row names its bundle.** A store reads and writes the rows of
  the bundle it runs (`storefront_ops.bundle`). A bundle with nothing saved shows its built-in
  layout and colours, as a new store does. Version numbers stay unique per store and page
  across bundles; history and restore stay within the bundle on screen.
- **The site sob medida's delivery writes to the store's own bundle** (`storefronts/<slug>`),
  whichever bundle the store runs at that moment.
- **The switch is a bundle change.** `setBundleTx` (the CRM's bundle change, and now
  Aparência's `PUT /appearance/site`) moves the store, locks it there (a publish of its own
  bundle no longer adopts it back), and reconciles to that bundle's newest passed release. The
  design follows because the reads follow the bundle. The owner's switch records
  `site.mode_changed` for the team and runs in the request's own transaction under
  `vendua.control`, since releases and deployments are Control Plane tables.
- **Backfill (0114):** a row belongs to the bundle of the store's newest deployment started
  before it was written; a row older than every deployment, to the first one's bundle (else the
  bundle it runs); a 'site sob medida' row, to the store's own bundle. A writer that names no
  bundle (an older Core during the deploy) gets the store's current one from a trigger.

## Consequences

- Switching is lossless both ways and takes effect within the edge's 30 s route cache. During
  that window a visitor can get the new layout on the old code; sections the code lacks render
  nothing (no crash). Aparência reloads its preview after 35 s.
- Template migrations run on the bundle a store shows. After a switch the other side's pages
  wait for the migration to be run again (it is safe to rerun).
- A revision of the site sob medida, delivered while the store shows the template, waits for
  the store to run its own bundle (the delivery needs a deployment of it). The owner switches
  back to see it.
- The build-time pull (`/storefront/v1/design`, `vendua train --core`) returns the design of the
  bundle the store runs, so it is only meaningful when building that bundle.

## Alternatives considered

- **Snapshot and restore on switch:** copy the current set aside and write the other side's back
  as new versions. One set to read, but every switch rewrites history, and a revision delivered
  while the store shows the template would overwrite the template's design.
- **Drop the saved design on switch to the template:** simplest, but the owner's edits on either
  side would be lost, which the owner ruled out.

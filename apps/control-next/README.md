# apps/control-next — the redesigned CRM console

Replaces `apps/control` at cutover (the folder gets renamed back). Same API
(`/control/v1`, `src/lib/api.ts`), same base path (`/control/`), same PWA.

```sh
bun run dev      # http://localhost:5196/control/  (proxies /control/v1 → Core :8787)
bun run check    # tsc
bun run build
bun scripts/dev-seed.ts   # 40 leads + threads/drafts/tasks into a local Core
CHROMIUM=/opt/pw-browsers/chromium bun scripts/shots.ts /pipeline /inbox   # screenshots at 375/820/1440 + overflow check
```

## Layout

```
src/app/          shell: AppShell (sidebar ≥768, tab bar <768), routes + legacy redirects, CommandPalette
src/lib/          api.ts + events.ts (unchanged from apps/control), query.ts (client + `qk` keys),
                  live.ts (SSE → invalidation), format.ts, labels.ts, hooks.ts, theme.ts
src/components/   Page, DataList, common (EmptyState, ErrorState, LoadingRows, StateChip, Avatar,
                  ScoreBar, ConfirmButton, KpiStrip, Fact); ui/ = primitives (button, input, badge,
                  card/Panel, controls, overlay)
src/features/<area>/   one folder per hub/screen: pages, components, queries.ts
```

## Rules

**Design**

- Density first. Desktop: text-sm body, h-8 controls, h-10 table rows, p-3 cards, p-4 page gutter.
  Phones: 16px inputs (the `Input` already does it), ≥40px tap targets (`pointer-coarse:` sizes
  are baked into Button/controls), p-3 gutter.
- One header line per page: `<Page title count actions tabs toolbar>`. No hero sections, no
  display type, no `min-height` filler. The serif is for the logo and login only.
- Colors are tokens only (`bg-card`, `text-muted-foreground`, `border`, `bg-agent`…) — never
  hex in components. Both themes must work; check dark with `THEME=dark bun scripts/shots.ts`.
- Lime (`agent`) marks what the agent did or will do. Amber (`warning`) = needs you.
  Red (`destructive`) = danger. Primary (forest) = the main action.
- Mobile first: every list uses `DataList` with a real `mobileRow`; forms/filters open in
  `ResponsiveSheet` (bottom sheet on phones); multi-pane layouts collapse to routes, not
  `display:none`. No hover-only affordances. No horizontal page scroll at 375px.

**Code**

- Data through TanStack Query with keys from `qk` in `lib/query.ts` — the first key segment
  is what SSE invalidates (`lib/live.ts`). No `setInterval` polling, no hand-rolled
  "newest response wins" refs. Mutations: `useMutation` + `invalidateQueries`, optimistic
  where the old app was.
- Put filters/tabs/selected ids in the URL (`useSearchParams`) so back/forward and deep links work.
- Errors: `ErrorState`/`toast.error(errorMessage(e))` from `lib/query.ts`; never `String(e)`.
- No inline `style={{}}` except truly dynamic values (bar widths, calendar positions).
- Files under ~400 lines; split by tab/area.
- `exactOptionalPropertyTypes` is on: optional props are typed `?: T | undefined`.
- Copy is pt-BR, lowercase-first like the old app ("novo lead", "carregando…").
- Comments are sparse: only non-obvious _why_.

---
name: frontend-design
description: Anti-slop frontend design contract. Use for ANY UI work — pages, components, layouts, styling, design systems, landing pages, dashboards. Enforces real design decisions over generic AI output.
---

# Frontend design — anti-slop contract

AI frontend fails the same way every time: it reaches for the median. Purple gradient hero, three feature cards with lucide icons, Inter, a faint grid pattern, rounded-2xl everything, and a layout that could be any product. This skill exists to kill that output before it ships.

The test is not "does it look clean". It's "could this only have been made for this product". If swapping the logo makes it indistinguishable from a thousand other generated pages, it's slop — redo it.

## The slop checklist — reject on sight

If any of these appear, the work is not done:

- **Generic hero** — centered headline + subtext + two buttons + gradient blob. No product-specific visual idea.
- **Card grid of features** — 3 or 6 identical cards, icon on top, title, one-line description. The single most overused AI pattern.
- **Purple/blue gradient** — the default "AI aesthetic". Same for generic dark-mode-with-glow.
- **Inter / Roboto / system-ui stack** — the "I didn't choose a font" font.
- **Emoji or lucide-only icons** — no custom or contextual iconography.
- **`rounded-2xl` + `shadow-lg` on everything** — uniform radius and elevation with no depth logic.
- **Fake content** — lorem ipsum, "Feature 1/2/3", stock-photo placeholders, fake testimonials with initials.
- **No state design** — only the happy path; no empty, loading, error, or edge states.
- **Symmetry by default** — everything centered, equal-width columns, no intentional asymmetry or tension.
- **Decorative noise** — gradients, grids, and glows added to look "designed" instead of serving hierarchy.

## The design contract — required before writing code

Answer these in the work, not in prose. If you can't answer one, that's the gap to fix first.

1. **One strong idea.** What is the single visual/conceptual idea that makes this *this product*? A layout, a motif, a type treatment, a motion signature — one thing, done with conviction. Not five weak ones.
2. **A real type system.** Choose a typeface with a reason (or commit to a variable font with intent). Define a scale, weights, and tracking. Typography carries more design weight than any other single choice.
3. **A deliberate palette.** Not "blue". A named, constrained set: one surface scale, one accent, semantic tokens. Check contrast. Color should be doing hierarchy work, not decoration.
4. **Hierarchy through space.** Grouping, alignment, and whitespace before borders and shadows. If you need a border to separate two things, you probably needed more space.
5. **States, not just screens.** Empty, loading, error, hover, focus, disabled, and the long-content case. A design that only works with perfect data is a mockup, not a UI.
6. **Motion with purpose.** Animate to explain state changes and spatial relationships, not to decorate. Every animation needs a reason; most need none.

## Execution rules

- **Commit to a direction.** Pick a real aesthetic — brutalist, editorial, dense-tool, soft-consumer, whatever fits — and execute it fully. Half a direction is worse than none.
- **Match the product's existing language first.** If the codebase has tokens, components, and a motion language, extend them. Don't import a new aesthetic on top of an old one.
- **Real content or realistic content.** Write copy that sounds like the product, with real lengths and real edge cases. Design against the content that will actually ship.
- **Depth is earned.** Elevation means something: closer = more interactive. Don't sprinkle shadows; build a z-axis logic.
- **Details compound.** Optical alignment, consistent radii (outer = inner + padding), tabular numbers in data, correct text wrapping — the small things are the difference between "generated" and "designed".

## Done means

- It has a point of view — someone could identify the product from the design alone.
- Every state is designed, not just the happy path.
- Nothing on the slop checklist survived.
- It was verified against the actual rendered surface, not just written.

## References

- Polish values (radius, shadows, hit areas, motion): `better-ui`
- Type scale, spacing, wrapping, OpenType: `better-typography`
- Grouping, alignment, reading order, progressive disclosure: `better-layout`
- Contrast, focus, keyboard, reduced motion: `better-accessibility`
- Color systems and tokens: `better-colors`

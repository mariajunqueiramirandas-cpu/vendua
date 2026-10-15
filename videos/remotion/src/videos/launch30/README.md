# Launch30 — the 16.10.2026 launch Reel

30 s, 1080×1920, pt-BR, 96 BPM in D minor (12 bars of 2.5 s). Built 2026-10-12. Brief: a product
launch Reel/Story with the official launch date 16/10/2026, the real product shown without
screenshots, music and SFX made in code.

**Cut 2: calm and cinematic.** The author rejected cut 1 (the house "frenético" pace: cuts on every
eighth, shakes, flashes, a HUD) as too fast and not serious. For a launch, the house pace is this:
one idea per shot held 2.5–5 s, words rising out of a soft blur, slow push-ins and crossfades, no
shake, flash or glitch, a felt-piano and pad score with one deep hit on the date.

| Time    | Shot     | What happens                                                                     |
| ------- | -------- | -------------------------------------------------------------------------------- |
| 0–5     | Open     | "Toda grande loja / começou pequena."                                            |
| 5–10    | Brand    | the 3D mark turns out of the dark; venduá.; "Uma loja online com a sua cara / e um app para tocar o dia." |
| 10–20   | Features | 01 the order push (#29), 02 Pix received, 03 menu and hours switches, 04 Duá on WhatsApp |
| 20–25   | Date     | LANÇAMENTO OFICIAL · 16 de outubro · 2026 · "Sexta-feira. Marque na agenda."     |
| 25–30   | End      | mark, venduá., LANÇAMENTO 16.10.2026, vendua.com.br, @vendua.digital            |

No voice (none chosen). Order names and totals are the demo store's facts
(`site/src/lib/screens.facts.json`); no Venduá price or plan is on screen.

```bash
npm run audio -- launch30 && npm run render -- Launch30 out/launch30.mp4
```

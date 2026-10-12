# Launch30 — the 16.10.2026 launch Reel

30 s, 1080×1920, pt-BR, 128 BPM in D minor. Built 2026-10-12 with no further input from the author:
the brief was "a product launch Reel/Story, official launch date 16/10/2026, invent how to show the
real product, no screenshots, music and SFX in code".

**Concept: a launch sequence.** A mission-control HUD counts T−22,50 down to T−0 while Venduá's
systems are checked one per bar, each drawn in code with the brand tokens (no captures):

| Bars  | Scene     | What happens                                                                 |
| ----- | --------- | ---------------------------------------------------------------------------- |
| 0–2   | Hook      | "Algo grande vem aí." → "Sequência de lançamento", verificando sistemas…     |
| 2–7   | Checks    | Loja online · Pedidos (push #28/#29) · Pix (R$ 499 → 718) · Cozinha (ticket) · Cardápio e horários, each stamped PRONTO |
| 7–10  | Duá       | boots over the riser (0→100%), drops online on lime, the chat orbits it      |
| 10–12 | Ready     | the six systems recapped, "prontos.", 3 · 2 · 1, ignition                    |
| 12–14 | Date      | hyperspace warp; LANÇAMENTO OFICIAL, reels land 16.10, 2026, Sexta-feira     |
| 14–16 | End       | 3D mark, venduá., LANÇAMENTO 16.10.2026, vendua.com.br, @vendua.digital      |

No voice (none chosen). Order numbers, names and totals are the demo store's facts
(`site/src/lib/screens.facts.json`); no Venduá price or plan is on screen.

```bash
npm run audio -- launch30 && npm run render -- Launch30 out/launch30.mp4
```

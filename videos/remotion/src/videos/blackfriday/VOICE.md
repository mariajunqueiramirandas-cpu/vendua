# BlackFriday: the narrator

The author's call (2026-11-24): narration by **ElevenLabs' latest model, through OpenRouter**, with a
good Brazilian Portuguese voice. No provider key lives in the repo; the take is committed instead
(`public/blackfriday/vo/sarah-3.mp3`) so the video rebuilds without calling anything.

| | |
| --- | --- |
| Model | `elevenlabs/eleven-v4` via `POST https://openrouter.ai/api/v1/audio/speech` |
| Voice | `sarah` (ElevenLabs premade) |
| Take | full read no. 3 of 7, used whole: every line comes from this one take |
| Options | `provider.options.elevenlabs.language_code = "pt"`; v4 has no speed control (the API answers 400 to `speed`) |

The prompt, exactly (the brand is spelled for the model, not for the screen):

```
[excited] Atenção, quem vende comida! Vem aí a Venn-du-á! Sua loja online, com a sua cara. Os pedidos caem direto no seu celular. E o Duá, vendedor com IA, atende e fecha o pedido no WhatsApp. Zero comissão por pedido! Lançamento oficial na Black Friday: sexta, dia 27! Com um super desconto de lançamento! Anota aí: Venn-du-á ponto com ponto bê erre!
```

## How it was picked

- **Voice**: one test line in all 21 premade voices. Whisper (small) and a listening model
  (`google/gemini-4-neon` on OpenRouter, given the clips head to head) agreed that adam, chris,
  laura, brian and jessica stress the brand VEN-du-a. Of the rest, sarah and matilda ranked first and
  second in both shuffled runs for a native Brazilian accent; sarah read the full script with more
  announcer energy.
- **Brand spelling**: `Vendu-á` came out "Van-duá" in full reads (Whisper hears it as "Vandoa"). Six
  spellings × two voices × two takes, ranked on the brand alone: `Venn-du-á` gave [vẽ.du.ˈa] best,
  `Ven du á` second; `Vendú-á` moved the stress to DU. Whisper hears the right one as "Vem duá" /
  "Vendo A".
- **One take, not a splice**: the best line from each of several takes, spliced, was rejected by the
  listening model for timbre and energy jumps between lines (1→2, 4→5, 7→8). Take 3 ranked first
  overall and second on the brand; it is used end to end.

## How it is placed

`timeline.ts` keeps each line's first and last sound and the quietest point of each pause in the
take. Each line starts 0.07 s after a cut on the 128 BPM eighth grid; the take's own pauses and
breaths are kept and only ever lengthened (by under an eighth) to land the next line on a cut. The
music's bars are anchored on the drop ("Lançamento oficial"), so the opening is a two-eighth pickup.

`scripts/render-audio.mjs` cuts the take at those pauses, places the spans, de-esses, compresses 2:1,
adds a little presence and a short plate, then sums it at −15 LUFS over the music + effects at
−20 LUFS and masters to −14 LUFS. In the speech band the voice sits 10–14 dB over the bed on every
line; the music ducks ~7 dB under speech, the drop's chords close down while she talks, and the
drop's hook only plays between lines.

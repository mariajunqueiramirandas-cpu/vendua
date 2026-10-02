# Venduá videos

Marketing videos (Instagram Reels first) built with HyperFrames: one folder per video under
`videos/`, shared tools in `videos/tools/`. The first one, `vendua-audio-47s/`, is the reference
project: copy its design spec, caption skin and scripts instead of starting from the presets.

Read this, then load the `vendua-reel` skill (`.claude/skills/vendua-reel/SKILL.md`), which routes
the HyperFrames `product-launch-video` workflow through the house defaults below.

## Defaults (decided on vendua-audio-47s; ask only to change them)

| Decision       | Default                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format         | 1080×1920, 30 fps, Reels + Stories, pt-BR                                                                                                            |
| Pace           | **Frenético**: 25–30 s, cuts on a 128 BPM grid, 0.2 s slams, punch-ins, shakes. The calm 36 s v1 was rejected as "muito lento".                      |
| Narrator       | ElevenLabs **Bruna da Costa** `AKXBn24T1f9tvTDnWzWT` (Creator plan), `eleven_v3`, `[energetic, fast]`                                                |
| Customer voice | ElevenLabs **Talis** `E9a8LlXPNWtyvvSoZzrb`, band-limited to sound like a phone voice note                                                           |
| Brand name     | "Venduá" is stressed on the final **á**. Prompts spell it `Vendu-á`. Bruna says it right on every take; other voices vary per take, so check by ear. |
| Music          | ElevenLabs Music, instrumental, 128 BPM, "full energy from the first second, no intro, no fade", 30 s                                                |
| SFX            | ElevenLabs Sound Effects: tap, pops, whoosh (peak on the cut), short impact, chime, buzz                                                             |
| Visuals        | Real captures only (admin screens from `site/`, storefront shots from the dev stack); no AI images, no photos of people                              |
| Copy           | Prices, plans and dates on screen need the author's decision (repo `CLAUDE.md`)                                                                      |
| Safe area      | Readable content in y 250–1280, x 72–940; captions in y 1300–1520; nothing in the Reels UI zones                                                     |

## ElevenLabs: use the API key, not the connector

- The key is the environment secret **`ELEVENLABS_API_KEY`** (cloud environment settings → Edit →
  API credentials or environment variables). Never paste it into chat, never write it to a file in
  the repo; scripts read it from the environment.
- `videos/tools/elevenlabs.py` calls the API directly (stdlib only, uses the session proxy's CA):
  `whoami`, `tts <voice> "<text>" out.mp3 [--model eleven_v3]`, `sfx "<prompt>" out.mp3
[--seconds N]`, `music "<prompt>" out.mp3 [--seconds 30]` (`force_instrumental` on).
- Why not the ElevenLabs MCP connector: it is tied to whichever account authorised it (here the
  free tier, so no Bruna), and from a cloud session that account got flagged ("Unusual activity…
  proxy or VPN… Free Tier access has been disabled") mid-job. Its music nodes also default to
  `Instrumental: False`.
- The vendored HyperFrames TTS path (`media-use` → `audio.mjs`, `HF_TTS_PROVIDER=elevenlabs`) works
  with the same env var but hardcodes `eleven_multilingual_v2`: no `[audio tags]`, and no music or
  SFX. Use `videos/tools/elevenlabs.py` for anything expressive.
- Limits: 3–4 generations in flight; a 429 means nothing started (safe to resend). Signed result
  URLs from the connector expire after 2 h, so download as soon as a take lands.

## The fast path

1. **Brief** (`BRIEF.md`): concept, destination, exact CTA copy, the trial/price wording from the
   site. Settle the pace (default frenético) and the voices before writing a storyboard.
2. **Pronunciation and voice test first**: one line containing "Venduá" with the chosen narrator
   (`elevenlabs.py tts …`), heard by the author, before generating the whole script.
3. **Voices**: generate every line with `eleven_v3` tags. Run `scripts/build-audio.py voices`
   (pauses cut to ≤0.14 s, light rubberband speed-ups only to fit a frame).
4. **Words**: Whisper small (faster-whisper, int8) gives word starts. Map them onto the script's
   own spelling and punctuation: captions group on punctuation, and Whisper writes "está" for
   "tá", "PIX" for "Pix", and splits "Vendu-á" into "vendo a" (that split is the stress you
   wanted; glue it back to "Venduá").
5. **Bed**: generate at 128 BPM, measure it (`videos/tools/measure.py tempo`), start it on its first
   beat. Frame lengths are whole eighth notes (0.234375 s), so every cut lands on the grid; frame 2's
   pile lands one note per beat.
6. **Mix**: `scripts/build-audio.py mix` pads each frame's voice, ducks the bed under the voices
   (sidechain threshold 0.02, ratio 4: the bed sits 6–8 dB under speech, louder in the gaps), hangs
   each SFX off the word that triggers it, and writes `audio/cues.json` and `audio_meta.json`.
7. **Storyboard**: per frame, the duration, `transition_in`, SFX and Scene lines with the cue times.
   Write seams as numbers (the handoff box, the pile's ten slots, the phone box), not prose.
8. **Frames**: one Opus agent per frame, all in parallel, each editing only its own
   `compositions/frames/NN-*.html`, each starting with "read the shared brief file". When the audio
   changes later, message the same agents with the new cue table; they retime in a minute.
9. **Assemble and check** (from the project dir): `assemble-index.mjs` → swap the CDN GSAP tag for
   `assets/vendor/gsap.min.js` → `transitions.mjs inject` + `verify` → `npx hyperframes lint` and
   `check` → `snapshot` at frame midpoints and around every cut → look at every frame.
10. **Draft for the author**: `npx hyperframes render --quality draft`, Whisper the draft to
    confirm every line sits in its frame, send it with a contact sheet. Only after "render it":
    `--quality high`, then loudness (below), then commit `renders/<name>.mp4`.

## Gotchas that each cost a round on vendua-audio-47s

- Invoke the HyperFrames scripts through `.agents/skills/...`, not the `.claude/skills` symlink:
  some main-guards compare realpaths and silently do nothing.
- Prettier never touches a video project: `.prettierignore` lists `videos/*/`, because the
  HyperFrames scripts parse `frame.md`, `STORYBOARD.md` and `index.html` as text (`transitions.mjs
verify` matches exact lines) and regenerate the JSON and caption files. The Claude Code format
  hook passes `--ignore-path` so this holds from any working directory, and CI's auto-fix skips
  them too. Never run prettier on these files by hand.
- `assemble-index.mjs` writes a jsDelivr GSAP tag; swap it for the vendored file after every
  assembly (renders must not need the network).
- `transitions.mjs inject` rewrites the frame files' tails: never run it while agents edit frames.
- `stage-assets.mjs` only scans `capture/assets`, `capture/assets/svgs`, `…/videos` and
  `capture/screenshots`, and reads any `asset_candidates` text as a filename.
- Captions: measure the widest group with the real font loaded from a `file://` page
  (`setContent` can't load `file://` fonts); give Frame 6 `words: []` so the end card stays clean.
- `hyperframes check` flags two-line display titles at line-height ~1 as overlapping; put
  `data-layout-allow-overlap` on the overlapping text elements themselves (not the parent).
- AI music: ask for "no fade" and 30 s, or it fades by ~20 s. To lengthen a bed, loop it on its
  4-bar phrase (`measure.py loop`) and stretch with `rubberband`, not `atempo`.
- Loudness: `loudnorm` in one pass squashes the dynamics; use plain gain plus an oversampled
  true-peak limiter (`volume=+N dB, aresample=192000, alimiter=limit=0.83, aresample=48000`) to
  land on −14 LUFS / −1.5 dBTP.
- Story continuity: the checkout shown must be the order that arrives (same cart, same total).
- Shell: a trailing `&` runs the command in a subshell that loses `cd` and `export`; loops need
  `ffmpeg -nostdin`; never return GSAP objects from Playwright's `page.evaluate`.
- Frame agents' own headless-Chromium checks can hang (two did, for 10+ minutes, and a message to
  an agent waits until its current tool call returns). Tell them to wrap checks in `timeout 120`;
  if one hangs, kill only that process by pid, or stop the agent and finish the frame yourself.

## Findings from vendua-audio-47s

- v1 (calm, 36 s, Adriane narrating) was built end to end and rendered, then rejected as too slow.
  The frenético cut reused every layout, asset and script, and only retimed audio and motion. **Ask
  about pace with a 5-second reference, before the storyboard**: it is the most expensive decision
  to change late.
- The ElevenLabs connector blocked twice: tier (Bruna needs Creator) and an account flag from the
  cloud proxy. Both vanish with the API key in the environment.
- Pronunciation of the brand name is the one thing a script can't verify: Whisper hears stress
  only indirectly. Test it first, by ear.
- Swapping the narrator after the frames were built cost a cue table per frame and four frame
  lengths, not a rebuild, because the frames read their times from `cues.json` values and the
  cuts sit on a fixed grid.
- Six parallel Opus frame agents with one shared brief built most frames in 3–15 minutes; the
  slowest parts were audio generation, review round-trips, one hung agent and seams (frame 1 → 2
  drifted once, by one played bar: write the end state of every seam as numbers in the brief).
- Final frenético cut: 27.19 s, six frames (7.03 / 5.86 / 3.05 / 2.58 / 2.11 / 6.56 s), 24 SFX,
  captions in 27 groups, −14 LUFS.

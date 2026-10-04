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
| SFX            | ElevenLabs Sound Effects, **premium**: soft and tonal, under the voice (recipe below). The hard v2 set (impacts, whips) was rejected as harsh.       |
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
3. **Voices set the pace**: generate every line with `eleven_v3` tags (`[energetic, fast]` is
   what makes it frenético), then run `scripts/build-audio.py voices` (pauses cut to ≤0.14 s, no
   speed-ups). The voice is the clock: each frame is as long as its line plus a short lead and
   tail, and nothing is decided about frame lengths before the takes exist. A line that feels slow
   gets a faster take or fewer words, not a rubberband stretch or a frame that cuts it short.
4. **Words**: Whisper small (faster-whisper, int8) gives word starts. Map them onto the script's
   own spelling and punctuation: captions group on punctuation, and Whisper writes "está" for
   "tá", "PIX" for "Pix", and splits "Vendu-á" into "vendo a" (that split is the stress you
   wanted; glue it back to "Venduá").
5. **Bed**: generate at 128 BPM, measure it (`videos/tools/measure.py tempo`), start it on its first
   beat. Each frame's length is its voice's length rounded **up** to whole eighth notes (0.234375 s),
   so every cut lands on the grid without trimming a word; frame 2's pile lands one note per beat.
6. **Mix**: `scripts/build-audio.py sfx` turns the chosen SFX takes into `audio/sfx/`; `mix` pads
   each frame's voice, ducks the bed under the voices (sidechain threshold 0.02, ratio 4: the bed
   sits 6–8 dB under speech, louder in the gaps), hangs each SFX off the word that triggers it, and
   writes `audio/cues.json` and `audio_meta.json`.
7. **Storyboard**: per frame, the duration, `transition_in`, SFX and Scene lines with the cue times.
   Write seams as numbers (the handoff box, the pile's ten slots, the phone box), not prose.
8. **Frames**: one Opus agent per frame, all in parallel, each editing only its own
   `compositions/frames/NN-*.html`, each starting with "read the shared brief file". When the audio
   changes later, message the same agents with the new cue table; they retime in a minute.
9. **Assemble and check**: run `videos/tools/build-reel.sh videos/<project> --bpm 128`, adding
   `--snapshots DIR` and `--draft OUT.mp4` as needed. It does it in one go (~40 s): assemble,
   vendored GSAP, transitions inject + verify, captions, `hyperframes check`, then
   `videos/tools/cutcheck.py`, which fails on a word, caption or SFX outside its frame, a caption on
   a caption-free frame, a frame mounted off the schedule, a frame that is not whole eighths, or a
   CDN GSAP tag (a caption carried a few frames into the next captioned frame is a warning). Then
   look at the snapshots it takes 0.1 s either side of every cut, plus frame midpoints.
10. **Draft for the author**: `npx hyperframes render --quality draft`, Whisper the draft to
    confirm every line sits in its frame, send it with a contact sheet. Only after "render it":
    `--quality high`, then loudness (below), then commit `renders/<name>.mp4`.

## Premium SFX (the house sound)

The author's ask, after the v2 cut: "cleaner and more premium" instead of hard effects. What
worked: soft, tonal UI sounds from ElevenLabs Sound Effects, two takes each (`elevenlabs.py sfx
"<prompt>" out.mp3 --seconds N`), the better one picked by ear and by `measure.py levels` (one
tap take came back at −62 dBFS, nearly silent).

| Sound  | s   | Prompt                                                                                                                                                               |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tap    | 0.6 | A soft, premium UI tap: a subtle, crisp, rounded click like a high-end app button, very short and clean, close and dry, no reverb, no harsh transient.               |
| pop    | 0.6 | A soft, premium notification blip: a short, clean, glassy pluck with a gentle round tail, modern minimal UI sound, warm and pleasant, not wooden, not cartoonish.    |
| whoosh | 0.8 | A smooth, silky, premium swoosh for a UI screen transition: soft airy motion that rises and settles, clean and elegant, no rough noise, no wind rumble.              |
| accent | 0.8 | A soft, premium accent for a logo or key moment: a gentle, warm low sine bloom with a delicate glassy shimmer on top, clean, modern, subtle, no boom, no distortion. |
| swipe  | 0.5 | A very soft, smooth swipe of a fingertip across a glass phone screen, subtle and silky, clean, short, no scratch.                                                    |
| pago   | 1.0 | A clean, premium payment-success chime: two soft glassy bell notes rising, bright but gentle, modern banking app, short tail, no reverb wash.                        |
| pedido | 1.4 | An elegant new-order notification for a premium business app: three soft, bright, bell-like glass notes ascending, warm and clean, short and pleasant, no harshness. |
| buzz   | 0.7 | A soft, muted double haptic vibration of a phone on a table, subtle and clean, low hum, very short, no rattle.                                                       |

- `build-audio.py sfx` trims each take to its attack, band-limits it (high-pass 60–200 Hz, low-pass
  4–11 kHz: nothing brittle or boomy), fades it, and limits peaks to −3 dB. The pile's four pops are
  one pluck pitched 0/+3/+5/+7 semitones, so a burst of nine reads as a rising phrase, not a click
  track.
- Mix them low: volumes 0.22–0.45 (v2 ran 0.4–0.6 with a 0 dBFS impact), one sound per moment (no
  swipe stacked on a chime), and an accent instead of an impact on the logo and the end-card cut.
- A soft whoosh swells for ~0.15 s before its peak (the v2 whip took 0.25 s): start it that much
  before the cut (`WHOOSH_PEAK`).

## Gotchas that each cost a round on vendua-audio-47s

- Invoke the HyperFrames scripts through `.agents/skills/...`, not the `.claude/skills` symlink:
  some main-guards compare realpaths and silently do nothing.
- Prettier never touches a video project: `.prettierignore` lists `videos/*/`, because the
  HyperFrames scripts parse `frame.md`, `STORYBOARD.md` and `index.html` as text (`transitions.mjs
verify` matches exact lines) and regenerate the JSON and caption files. The Claude Code format
  hook passes `--ignore-path` so this holds from any working directory, and CI's auto-fix skips
  them too. Never run prettier on these files by hand.
- `assemble-index.mjs` writes a jsDelivr GSAP tag; `build-reel.sh` swaps it for the vendored file
  (renders must not need the network), and `cutcheck.py` fails if one is left.
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
- Cuts off the 3-decimal grid (20.859375 s) broke two "nothing crosses the cut" rules once a
  frame grew by an eighth: an SFX placed on the cut was hosted by the frame before (now picked from
  the unrounded time), and the caption skin's 0.3 s tail on the last group showed "no seu celular!"
  over the end card (the last group now ends with its words). Snapshot 0.1 s after every cut.
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
- Let the voice set the pace. On this video the frame lengths were fixed first and three lines were
  sped up (1.08–1.1×) to fit; the author's rule since: generate the takes, then size each frame to
  its line (rounded up to the eighth grid). A pace change is a new take, not a new frame plan.
- Read every line as a stranger would. "E o pedido chega sozinho!" was heard as Venduá delivering
  the order; "E o pedido cai prontinho no seu celular!" says where it lands (the shop's phone,
  ready to accept) and matches the push on screen. Prefer where-it-lands over how-it-travels verbs
  ("chega", "vai", "sai") for anything a viewer could take as logistics.
- A one-line rewrite cost one Bruna batch (4 takes, 2 wordings), a re-Whisper, one more eighth on
  frame 5 and a retime of that frame's cues; nothing else moved, because the later frames are
  frame-relative.
- Final cut (v3): 27.42 s, six frames (7.03 / 5.86 / 3.05 / 2.58 / 2.34 / 6.56 s), 23 SFX,
  captions in 28 groups, −14 LUFS.

## Findings from vendua-lancamento (the ~64 s launch Reel)

- `eleven_v4` takes the same `[energetic, fast]` tags as v3 and doesn't speak them; `Vendu-á` and
  `Du-á` still land the stress. Pass `--model eleven_v4` to `elevenlabs.py tts`.
- When a new project copies the reference's fonts, copy `capture/extracted/page.html` too:
  `captions.mjs` reads the `@font-face` rules there, and without it `hyperframes check` fails
  with `font_family_without_font_face` on `compositions/captions.html`.
- For a story told on real screens, seed one order through the real flow and shoot every screen
  from it (`vendua-lancamento/scripts/capture-shots.mjs`). Then the price, the order number and the
  total match on every screen.
- In-frame screen swaps between two text-heavy screenshots must be near-cuts (opacity over ≤0.06 s,
  with the slide on `y`): a 0.2 s dissolve reads as two chats printed on top of each other.

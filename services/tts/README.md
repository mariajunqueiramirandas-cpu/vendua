# tts

Self-hosted text-to-speech in Brazilian Portuguese ([ADR 0045](../../docs/adr/0045-self-hosted-tts.md)).
It runs Kyutai's [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) (Portuguese, 6 layers) on
CPU, on an inference engine written for it here in C++. Python serves it over HTTP.

**Model license: CC-BY-4.0** (Kyutai). Attribution is this paragraph. Weights, tokenizer and voice
states come from
[kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning),
pinned by revision and sha256 in `tts/fetch.py`. Each voice is a state the model computed from a
recording, under that recording's license ([kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices)):
`cosette` (Expresso) and `jean` (EARS) are non-commercial, so they aren't fetched. `rafael`, the
only native Brazilian voice, comes from Kyutai's own Portuguese release.

## How it fits

```
Core ──bearer──▶ tts :8793 ──▶ audio/ogg (Opus, mono, 24 kHz)
```

Nothing calls it yet. The intended caller is the Vendedor, answering a voice note with one:
`store-whatsapp/gateway.ts` already sends stored audio as a voice note. Texts are replies to
shoppers, so they are never logged or kept here.

## API

| Route            | Auth                 | Body                                  | Returns                                                                 |
| ---------------- | -------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| `POST /v1/speak` | `Bearer $TTS_SECRET` | `{text, voice?, format?, seed?}` JSON | the audio; `x-tts-seconds` is its length                                |
| `GET /healthz`   | none                 |                                       | 200 once warm, `{ok, active, isa, decoder, speech_bits, voice, voices}` |

`format` is `ogg` (default: Ogg/Opus at 32 kbps, what WhatsApp plays as a voice note) or `wav`
(16-bit PCM). `voice` defaults to `TTS_VOICE`. `seed` (0 to 2⁶³) picks another take; without one
the seed follows the text and voice, so the same reply always sounds the same.

Errors are `{error: code}` with a stable status:

| Status | Codes                                                      |
| ------ | ---------------------------------------------------------- |
| 400    | `bad_request`, `unknown_voice`, `empty_text`, `short_body` |
| 401    | `unauthorized`                                             |
| 411    | `length_required`                                          |
| 413    | `too_big` (over 64 KB of JSON), `too_long` (characters)    |
| 500    | `synthesis_failed`                                         |
| 503    | `not_configured`, `warming_up`, `overloaded`, `timeout`    |

## Env

| Var                     | Default        | Notes                                                                              |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `TTS_SECRET`            | —              | unset = every speak call gets 503 (idle)                                           |
| `TTS_ADDR`              | `0.0.0.0:8793` |                                                                                    |
| `TTS_THREADS`           | CPU quota      | follows compose `cpus` (cgroup); split as in "Threads"                             |
| `TTS_MAX_BATCH`         | `8`            | text chunks per speech-model step                                                  |
| `TTS_MAX_ACTIVE`        | `16`           | requests in flight; beyond it, 503 `overloaded`                                    |
| `TTS_MAX_CHARS`         | `2000`         | about 2.5 minutes of speech                                                        |
| `TTS_REQUEST_TIMEOUT_S` | `120`          |                                                                                    |
| `TTS_VOICE`             | `rafael`       | the default voice; `/healthz` lists them all                                       |
| `TTS_OPUS_BITRATE`      | `32000`        |                                                                                    |
| `TTS_SPEECH_BITS`       | `8`            | the speech model's weights: `8`, or `4` (faster, more words missed; see "Numbers") |
| `TTS_ISA`               | best available | `avx2`, `avxvnni`, `avx512` or `amx`, to compare kernels                           |
| `PK_MIMI_MODE`          | timed          | `f32`, `q12` or `q8`: the decoder's matrices (not with AMX)                        |
| `PK_PROFILE`            | —              | `1`: the engine times its sections (`Engine.profile_dump`)                         |

## Text (`tts/text.py`)

The Portuguese tokenizer has no digits, `$` or `%`: "R$ 49,90" is nine byte-fallback tokens the
model rarely saw. So before anything else, a normalizer spells out what a store's reply is full of:

- prices (`R$ 1.249,90` → "mil duzentos e quarenta e nove reais e noventa centavos"), with "um
  milhão **de** reais";
- installments (`10x` → "dez vezes"), percentages, times (`14h30`, `9h`, `08:00`, `24h`), dates
  (`20/10/2026`), ordinals (`1º`, `2ª`, `nº`), quantities (`500g`, `1kg`, `2 L`) and other numbers,
  in Brazilian formatting (`1.234,5`), with agreement where the noun is known ("duas horas");
- phone numbers and CEPs digit by digit, in their groups;
- `c/`, `s/`, `p/`, `Sr.`, `Dra.` and similar, which would otherwise end a sentence;
- dropped: links, emoji, symbols and WhatsApp's `*bold*` `_italic_` `~strike~` markers.

Then pocket-tts's own chunking, ported: sentences packed into chunks of up to 50 tokens, sentences
over that split at commas, a capital first letter and a final period. Each chunk is one sequence
for the engine; a reply's chunks run together and come back in order.

## The engine (`engine/`, C API in `pocket.h`)

Pocket TTS is two models. A speech model (6 transformer layers, d 1024, then a one-step flow head)
turns text and a voice's KV cache into a 32-dim latent every 80 ms. The Mimi decoder (2
transformer layers at 200 Hz with a 250-step window, then SEANet's convolutions) turns latents
into 24 kHz audio. The reference runs both in PyTorch, one step at a time.

The engine runs them as a pipeline. The speech model's thread steps every live sequence at once
(continuous batching: a new sequence's prompt joins the next step), and the decoder's thread
turns each sequence's latents into audio in chunks of 8, with each conv's and the attention's
history kept between chunks. Each has its own thread pool.

**Packing (`tts/pack.py`, at build).** Everything a request would otherwise redo is done once:
int8 weights with one scale per row, laid out for VNNI; constants folded (the attention scale,
Mimi's layer scales and latent denormalization, the flow head's time embedding); the flow head's
seven adaLN projections fused into one matrix; convolutions turned into GEMMs over time-major
buffers; voices as float16 KV caches. The engine maps the file, so voices nobody uses stay on
disk.

**Rotation (QuaRot).** Every matrix of the speech model is stored rotated, W D H / K (H a
Hadamard matrix, D random signs), and the engine turns its input x into x D H as it quantizes it:
a fast Walsh–Hadamard transform, under a microsecond per row. The product is the same, but
neither side keeps the few large values that set its quantization scale, so int8 loses less:
the speech model's hidden states went from 2.85% to 2.39% off float32, and its latents from 1.88%
to 1.38%, for nothing measurable in speed.

**int4 (GPTQ), opt-in.** The transformer's matrices are also stored as 4-bit codes with one scale
per row, half the bytes of int8. Rounding to nearest leaves the hidden states 35% off; GPTQ
(`tts/gptq.py`) quantizes one input column at a time and pushes each column's error onto the
ones left, weighted by the inputs' covariance on 32 calibration replies, each spoken by 3 of the
voices, run through the numpy model. That brings it to 10–12% on every voice. Calibrating on
`rafael` alone gave him 12% and the others 15–20%, and cut short more of their clips. The
kernels take the codes as unsigned (w + 8) against 8-bit activations: on AVX2 `vpmaddubsw`
multiplies them 32 at a time and cannot saturate (a pair is at most 2 × 15 × 127), so four steps
of 8 sum in int16 before one `vpmaddwd`; VNNI sets use `vpdpbusd`.

It isn't the default because it costs words: over 2,450 clips, `stt` misses 14% more words in
int4 than in int8 (below). The loss is in the weights, not the 8-bit activations (2.2% with float
weights), and spread over all the matrices: groups of 128 or 32 instead of per-row scales reach only 10% and 9%, and
int4 in any one kind of matrix alone (just the attention output, 8% of the weights) already
doubles int8's 2.3%. `TTS_SPEECH_BITS=4` trades that for speed; both copies are in the file.

**Kernels.** `libpocket.so` carries four kernel sets, each file built for its instruction set,
and picks one at startup from cpuid: AVX2 (any x86-64 server since 2013), AVX-VNNI (AVX2 with
`vpdpbusd`/`vpdpwssd` on 256-bit registers: Sierra Forest Xeons, which have no AVX-512, and
Alder Lake and later), AVX-512 VNNI, or AMX (Sapphire Rapids and later).

- **Speech model:** int4 weights times 8-bit activations (above), or int8 weights times 12-bit
  activations (AVX2 `vpmaddwd`, VNNI `vpdpwssd`), both after the rotation. The KV cache is
  float16.
- **Decoder transformer and first conv:** int8, 12-bit or float32, whichever is fastest at
  startup, preferring precision within 10%. On AVX2 that's 8-bit activations against 7-bit
  weights (`vpmaddubsw` saturates past that), built at startup from the float32 copy.
- **SEANet convs:** float32 GEMMs (6×16 AVX2 and 12×32 AVX-512 register tiles) with the bias,
  ELU and residual add fused into their epilogues. int8 here puts audible noise into pauses.
- **AMX:** the whole decoder in bfloat16 tiles, from the float32 copy, at 49 dB SNR.
- **Attention:** K and V stay in GEMM panels between chunks. Each query block multiplies only the
  panels its window reaches, and history shifts a whole panel at a time.

**Threads.** The speech model and the decoder get `TTS_THREADS` between them (`split_threads`):
1+1 up to 2 cores, then half each, the decoder taking the odd one. It's the decoder that limits
AVX2 past 2 cores: 1+2 beats 2+1 by 45%. With one reply the decoder splits each matrix across its
threads; with several ready at once, each thread decodes its own reply on a single-threaded copy
that shares the weights, with no syncs between them. Pools spin about 1 ms between jobs, then
sleep.

Tried and not kept: int8 SEANet (noise in pauses); AVX-512 `vdpbf16ps` (slower than float32 FMA
on Sapphire Rapids); Winograd for the 3-tap convs (its transforms cost what it saves); Winograd
F(4,2) for the 2-tap upsampling convs (each conv 25–35% faster alone, nothing end to end: the
2.5× larger transformed weights fall out of cache between chunks); the model file copied into
transparent huge pages (no change); profile-guided optimization (within noise: a speech model step
of 5.35 vs 5.53 ms, the decoder ±3%).

## Numbers

Host: 4 vCPUs of a 2.1 GHz Xeon with AVX-512 VNNI and AMX, a shared VM, so ±15% between runs.
Paths are forced with `TTS_ISA`; AVX2 is what any x86 server has.

Speed, four store replies (34–37 s of audio), as RTFx (seconds of audio per second):

| Path                            | Speech model | 2 cores | 2 cores, 4 at once | 4 cores | 4 cores, 4 at once | First audio |
| ------------------------------- | ------------ | ------- | ------------------ | ------- | ------------------ | ----------- |
| pocket-tts (PyTorch), reference | float32      | 1.7     |                    |         |                    | 166 ms      |
| this engine, AVX2               | int8         | 11.5    | 13.8               | 18.2    | 23.8               | 143 ms      |
|                                 | int4         | 11.4    | 14.3               | 18.8    | 24.7               | 123 ms      |
| this engine, AVX-VNNI           | int8         | 11.9    | 13.9               | 19.4    | 24.5               | 132 ms      |
|                                 | int4         | 12.8    | 15.0               | 20.2    | 30.1               | 110 ms      |
| this engine, AVX-512            | int8         | 16.1    | 20.9               | 26.5    | 34.1               | 103 ms      |
|                                 | int4         | 19.6    | 24.6               | 27.9    | 44.4               | 71 ms       |
| this engine, AMX                | int8         | 19.9    | 26.8               | 32.3    | 53.9               | 88 ms       |
|                                 | int4         | 31.6    | 38.1               | 52.8    | 66.9               | 64 ms       |

"First audio" is with 2 cores and nothing else running. AVX-VNNI is this host running that kernel
set (Sapphire Rapids has the 256-bit VNNI instructions too); a Sierra Forest or Alder Lake core
will differ. int4 pays where the speech model is the bottleneck: on AMX, whose decoder is fast,
one reply comes 1.6× sooner. On AVX2 the decoder sets the pace, and int4 gains almost nothing. In
the image, under `--cpus 2`, a 280-character reply (21.8 s of speech) comes back as Ogg/Opus in
2.0 s on AVX2 and 0.86 s on AMX. Encoding runs while the engine works, so it adds nothing.

With several replies at once, the speech model's thread also decodes ready chunks when it has
nothing to step. With 4 replies at once that's +24% on AVX2 with 2 cores (10.7× → 13.3×), +18%
with 4, +7% on AVX-512, and nothing on AMX, whose decoder never falls behind.

One thread each, per step of the speech model and per second of audio from the decoder:

| Path     | Speech model step, int8 | int4   | Decoder, per audio second                  |
| -------- | ----------------------- | ------ | ------------------------------------------ |
| AVX2     | 5.5 ms                  | 3.7 ms | 75 ms (8-bit; 12-bit 87 ms, float32 99 ms) |
| AVX-VNNI | 5.3 ms                  | 3.3 ms | 71 ms                                      |
| AVX-512  | 4.9 ms                  | 2.8 ms | 47 ms                                      |
| AMX      | 4.9 ms (AVX-512's)      | 2.8 ms | 18 ms                                      |

The engine's first working version took 11.5 ms per step and ~190 ms per audio second on AVX2.
The reference decoder takes 200–400 ms.

Quality. Thirty store replies, two takes each (60 clips, 738 words), were transcribed by
`services/stt`. WER is against the text as spoken:

| Path                                      | WER   | Decoder SNR vs float32 |
| ----------------------------------------- | ----- | ---------------------- |
| pocket-tts (PyTorch, float32), reference  | 4.20% |                        |
| this engine, float32 everywhere           | 4.61% | (vs numpy: ~5e-6 abs)  |
| AVX2, 8-bit decoder (picked on this host) | 4.61% | 29.2 dB                |
| AVX2, 12-bit decoder                      | 4.20% | 37.6 dB                |
| AVX-512                                   | 4.20% | 32.8 dB                |
| AMX                                       | 4.07% | 49.0 dB                |

The spread is ±2 words, and the misses are the same words on every path, the reference
included: "Pix" heard as "PIS", "site" as "CIT", "kit" lost. Those come from the model or the ASR,
not the engine's precision.

`bench.py` runs the larger check: the 98 replies in `bench_replies.txt` (prices, dates, times,
units, phones, loanwords, short and long replies), three takes each in Rafael's voice, through a
32 kbps Ogg/Opus round trip like a WhatsApp voice note, then `services/stt`:

| Path                 | WER   | CER   | Prices heard right | Sign test vs float32 |
| -------------------- | ----- | ----- | ------------------ | -------------------- |
| this engine, float32 | 7.17% | 3.91% | 69/78              |                      |
| AVX2, 8-bit decoder  | 7.45% | 4.41% | 67/78              | p = 0.09             |
| AVX2, 12-bit decoder | 7.60% | 4.45% | 68/78              | p = 0.35             |
| AVX-512              | 7.41% | 4.37% | 66/78              | p = 0.44             |
| AMX                  | 7.53% | 4.40% | 66/78              | p = 0.41             |
| AVX2, rotated int8   | 6.56% | 3.43% | 69/78              | p = 0.54             |

The last row is the speech model as it runs now. The rows above it predate the rotation. No path
is told apart from float32. What's lost is lost on all of them: a sentence skipped or speech
ending early in a few long replies, single letters ("P, M ou G"), English words (Pix, site,
kit, delivery, cashback, smartwatch), and a CEP read digit by digit.

The same 98 replies, one take in each of the 25 voices (2,450 clips, 35,325 words), on AMX:

| Speech model                         | WER    | CER   | Prices heard right | Clips better / worse than int8 |
| ------------------------------------ | ------ | ----- | ------------------ | ------------------------------ |
| int8 (default)                       | 9.80%  | 6.61% | 545/650            |                                |
| int4, GPTQ calibrated on `rafael`    | 11.18% | 7.86% | 523/650            | 421 / 563, p = 7e-6            |
| int4, GPTQ calibrated on every voice | 11.17% | 7.90% | 522/650            | 402 / 544, p = 4e-6            |

Calibrating on every voice spread the loss evenly instead of concentrating it on the voices
furthest from `rafael`: for azelma, int4's WER went from 26.3% back to 20.2%, and int4 clips no
longer come out shorter (median length 1.000× int8's, from 0.986×). It didn't remove the loss.

By voice (one take each, so ±1.5 points):

| Voice            | int8  | int4  |
| ---------------- | ----- | ----- |
| `giovanni`       | 5.2%  | 6.0%  |
| `daan`           | 5.5%  | 6.7%  |
| `peter_yearsley` | 5.7%  | 4.8%  |
| `caro_davy`      | 5.7%  | 6.7%  |
| `mary`           | 6.2%  | 7.6%  |
| `eve`            | 6.3%  | 6.7%  |
| `stuart_bell`    | 6.4%  | 4.2%  |
| `george`         | 6.6%  | 6.1%  |
| `charles`        | 6.8%  | 8.5%  |
| `javert`         | 7.9%  | 8.6%  |
| `rafael`         | 8.1%  | 6.9%  |
| `juergen`        | 8.1%  | 7.7%  |
| `paul`           | 8.7%  | 11.2% |
| `marius`         | 8.7%  | 10.0% |
| `bill_boerst`    | 8.9%  | 11.7% |
| `lola`           | 9.3%  | 11.3% |
| `vera`           | 9.8%  | 10.4% |
| `eponine`        | 10.8% | 14.3% |
| `fantine`        | 11.3% | 13.2% |
| `michael`        | 11.5% | 17.1% |
| `alba`           | 11.5% | 11.3% |
| `jane`           | 11.7% | 13.8% |
| `azelma`         | 16.8% | 20.2% |
| `anna`           | 17.4% | 18.8% |
| `estelle`        | 30.0% | 35.6% |

Voices are the larger lever: `rafael`, the native speaker, is mid-pack, and `estelle` loses
almost a third of the words. A store's voice should come from the top of this table.

Memory: 330 MB resident after replies in one voice with int8 (310 MB with int4). 186 MB of it is
the mapped model file (158 MB with int4). The packed file is 268 MB with 25 voices and both copies
of the speech model, and an unused voice or copy costs disk only. The rest is Python, the engine's
buffers, and the bfloat16 or 7-bit decoder copies.

## Develop

```sh
cd services/tts
python -m venv .venv && .venv/bin/pip install -r requirements.txt
make -C engine -j                                          # build/libpocket.so
.venv/bin/python -m unittest discover -s tests -t .        # no model needed: a tiny random one
.venv/bin/python -m tts.fetch /tmp/hf
.venv/bin/python -m tts.pack /tmp/hf/model.safetensors /tmp/hf/embeddings /tmp/models/pocket.bin
cp /tmp/hf/tokenizer.json /tmp/models/
TTS_SECRET=dev TTS_MODEL_DIR=/tmp/models .venv/bin/python -m tts.server
curl -sS -H 'authorization: Bearer dev' -d '{"text": "Seu pedido saiu para entrega!"}' localhost:8793/v1/speak > reply.ogg
```

`tests/test_engine.py` checks the engine against `tts/reference.py`, a plain numpy Pocket TTS,
on every kernel set the CPU has. `tts.pack --f32 qkv,o,ff,flow,mimi` packs a float32 model to
compare against. `bench.py` (its docstring has the commands) synthesizes `bench_replies.txt` and
scores it with `services/stt`.

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

| Route            | Auth                 | Body                                  | Returns                                             |
| ---------------- | -------------------- | ------------------------------------- | --------------------------------------------------- |
| `POST /v1/speak` | `Bearer $TTS_SECRET` | `{text, voice?, format?, seed?}` JSON | the audio; `x-tts-seconds` is its length            |
| `GET /healthz`   | none                 |                                       | 200 once warm, `{ok, active, isa, decoder, voices}` |

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

| Var                     | Default        | Notes                                                       |
| ----------------------- | -------------- | ----------------------------------------------------------- |
| `TTS_SECRET`            | —              | unset = every speak call gets 503 (idle)                    |
| `TTS_ADDR`              | `0.0.0.0:8793` |                                                             |
| `TTS_THREADS`           | CPU quota      | follows compose `cpus` (cgroup); split as in "Threads"      |
| `TTS_MAX_BATCH`         | `8`            | text chunks per speech-model step                           |
| `TTS_MAX_ACTIVE`        | `16`           | requests in flight; beyond it, 503 `overloaded`             |
| `TTS_MAX_CHARS`         | `2000`         | about 2.5 minutes of speech                                 |
| `TTS_REQUEST_TIMEOUT_S` | `120`          |                                                             |
| `TTS_VOICE`             | `rafael`       | the default voice; `/healthz` lists them all                |
| `TTS_OPUS_BITRATE`      | `32000`        |                                                             |
| `TTS_ISA`               | best available | `avx2`, `avx512` or `amx`, to compare kernels               |
| `PK_MIMI_MODE`          | timed          | `f32`, `q12` or `q8`: the decoder's matrices (not with AMX) |
| `PK_PROFILE`            | —              | `1`: the engine times its sections (`Engine.profile_dump`)  |

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

**Kernels.** `libpocket.so` carries three kernel sets, each file built for its instruction set,
and picks one at startup from cpuid: AVX2 (any x86-64 server since 2013), AVX-512 VNNI, or AMX
(Sapphire Rapids and later).

- **Speech model:** int8 weights times 12-bit activations, on every set (AVX2 `vpmaddwd`, AVX-512
  `vpdpwssd`). Its hidden states are 2.85% off float32, where int8 weights alone give 2.82%.
  8-bit activations were faster but gave 3.95%. The KV cache is float16.
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
AVX2 past 2 cores: 1+2 beats 2+1 by 45%. Pools spin about 1 ms between jobs, then sleep.

Tried and not kept: int8 SEANet (noise in pauses); AVX-512 `vdpbf16ps` (slower than float32 FMA
on Sapphire Rapids); Winograd for the 3-tap convs (its transforms cost what it saves); int4
weights (a quality risk where the speech model isn't the bottleneck).

## Numbers

Host: 4 vCPUs of a 2.1 GHz Xeon with AVX-512 VNNI and AMX, a shared VM, so ±15% between runs.
Paths are forced with `TTS_ISA`; AVX2 is what any x86 server has.

Speed, four store replies (35 s of audio), as RTFx (seconds of audio per second):

| Path                            | 2 cores | 2 cores, 4 at once | 4 cores | 4 cores, 4 at once | First audio |
| ------------------------------- | ------- | ------------------ | ------- | ------------------ | ----------- |
| pocket-tts (PyTorch), reference | 1.7     |                    |         |                    | 166 ms      |
| this engine, AVX2               | 11.2    | 11.0               | 19.2    | 19.0               | 145 ms      |
| this engine, AVX-512            | 16.2    | 16.7               | 26.8    | 29.6               | 97 ms       |
| this engine, AMX                | 21.3    | 27.6               | 33.7    | 54.6               | 82 ms       |

"First audio" is with 2 cores and nothing else running. In the image, under `--cpus 2`, a
280-character reply (21.8 s of speech) comes back as Ogg/Opus in 2.0 s on AVX2 and 0.86 s on
AMX. Encoding runs while the engine works, so it adds nothing.

One thread each, per step of the speech model and per second of audio from the decoder:

| Path    | Speech model step | Decoder, per audio second                     |
| ------- | ----------------- | --------------------------------------------- |
| AVX2    | 4.7–5.1 ms        | 71–75 ms (8-bit; 12-bit 87 ms, float32 99 ms) |
| AVX-512 | ~4.5 ms           | ~56 ms                                        |
| AMX     | ~4.5 ms           | ~20 ms                                        |

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

Memory: 290 MB resident after replies in one voice. 170 MB of it is the mapped model file (the
packed file is 230 MB with 25 voices; an unused voice costs disk only). The rest is Python, the
engine's buffers, and the bfloat16 or 7-bit decoder copies.

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

`tests/test_engine.py` checks the engine against `tests/reference.py`, a plain numpy Pocket TTS,
on every kernel set the CPU has. `tts.pack --f32 qkv,o,ff,flow,mimi` packs a float32 model to
compare against.

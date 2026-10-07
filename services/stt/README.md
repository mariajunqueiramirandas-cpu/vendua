# stt

Self-hosted speech-to-text for the Vendedor's voice notes
([ADR 0037](../../docs/adr/0037-self-hosted-stt.md)). It runs NVIDIA's
[Parakeet-TDT-0.6B-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) on CPU, on an inference
engine written for it here. Python, ONNX Runtime and numpy.

**Model license: CC-BY-4.0** (NVIDIA). Attribution is this paragraph. The ONNX export comes from
[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr) and is pinned by revision and
sha256 in `stt/fetch.py`.

## How it fits

```
shopper voice note → wa-gateway → shopper_media (Postgres)
Core ingest (vendedor/ingest.ts) ──bearer──▶ stt :8792 ──▶ {text, confidence}
```

Core's `transcribe` (`packages/core/src/vendedor/media.ts`) calls it as provider `sidecar`. It
is used by default when `STT_URL` and `STT_SECRET` are set and staff named no `transcribe`
route. Staff set the order of routes in the CRM, under IA → Voz (`agent_runtime.media_routes`,
which Core checks when it's saved). That screen also shows whether this service is up, using
`/healthz`. The service can come first, or after a cloud route as a fallback. The audio never
leaves the host, and transcripts are never logged or stored here.

## API

| Route                 | Auth                 | Body                   | Returns                                   |
| --------------------- | -------------------- | ---------------------- | ----------------------------------------- |
| `POST /v1/transcribe` | `Bearer $STT_SECRET` | the audio file's bytes | `{text, confidence, language, seconds}`   |
| `?words=1`            |                      |                        | adds `words: [{word, start, confidence}]` |
| `GET /healthz`        | none                 |                        | 200 once warm, `{ok, queue, model}`       |

Ogg/Opus voice notes, mp3, m4a/mp4, WebM, FLAC, AMR and WAV are accepted, picked by their
magic bytes. `language` is always `null`: the model picks among its 25 languages but doesn't
say which.

**`confidence`** is calibrated for Core's "below 0.7, ask the shopper to confirm" gate. It is
the lowest word's entropy confidence, mapped so that 0.7 marks the worst 15% of FLEURS pt-BR
transcripts (11.4% mean WER below it, 3.7% above). That ranks bad transcripts better than
`exp(mean log-prob)` (AUROC 0.80 vs 0.77), which never went below 0.9 here and so never tripped
the gate. Word `confidence` is NeMo's Tsallis-entropy measure (α = 1/3, exponential
normalization) before mapping. At word level it flags wrong words about as well as the token
probability does (AUROC 0.861 vs 0.859).

**`x-stt-phrases`** (optional header) boosts phrases the audio likely contains: Core sends the
store's active product names. The value is percent-encoded JSON, an array of at most 300
strings of up to 80 characters; anything else is a 400 `bad_phrases`.

Errors are `{error: code}` with a stable status:

| Status | Codes                                                   |
| ------ | ------------------------------------------------------- |
| 400    | `bad_phrases`, `short_body`                             |
| 401    | `unauthorized`                                          |
| 411    | `length_required`                                       |
| 413    | `too_big` (bytes), `too_long` (seconds)                 |
| 422    | `empty`, `undecodable`                                  |
| 503    | `not_configured`, `warming_up`, `overloaded`, `timeout` |

## Env

| Var                     | Default        | Notes                                                 |
| ----------------------- | -------------- | ----------------------------------------------------- |
| `STT_SECRET`            | —              | unset = every transcribe call gets 503 (idle)         |
| `STT_ADDR`              | `0.0.0.0:8792` |                                                       |
| `STT_THREADS`           | CPU quota      | ORT intra-op threads; follows compose `cpus` (cgroup) |
| `STT_MAX_BATCH`         | `8`            | requests per encoder run                              |
| `STT_MAX_WAIT_MS`       | `0`            | wait for a fuller batch; 0 = batch only what queued   |
| `STT_MAX_QUEUE`         | `64`           | beyond it, 503 `overloaded`                           |
| `STT_MAX_SECONDS`       | `200`          | Core stores voice notes up to 180 s                   |
| `STT_MAX_BYTES`         | `10485760`     | Core stores up to 8 MB                                |
| `STT_REQUEST_TIMEOUT_S` | `120`          |                                                       |
| `LOG_LEVEL`             | `info`         | `debug` adds a line per batch (size, padding, RTFx)   |

Build args:

- `STT_MODEL`: `parakeet-tdt-0.6b-v3` (default) or `parakeet-tdt-0.6b-v3-ptbr`, the Brazilian
  Portuguese fine-tune (see "Numbers").
- `STT_REDUCE_RANGE`: `auto`, `0` or `1`; see "The compile step".

## The engine

The time per voice note splits into feature extraction (2%), the FastConformer encoder (93%)
and the TDT decoder loop (5%), measured on the reference pipeline. So most of the work went
into the encoder.

### The compile step (`stt/compile.py`, at image build)

The community int8 export quantizes the Conformer's 48 pointwise (1×1) convolutions as
`ConvInteger`, with **uint8** weights. ONNX Runtime runs `ConvInteger` through im2col and an
int32→float `Cast`, which was half the encoder's time. u8×u8 also misses the u8×s8 kernels that
VNNI and AMX accelerate. That export ends up slower than fp32 and less accurate.

The compiler starts from the fp32 export instead:

1. It rewrites every 1×1 `Conv1d` as `Transpose → MatMul → Transpose`. ORT's transpose
   optimizer cancels those Transposes against the ones around the conv module.
2. It quantizes dynamically: MatMul only, per output channel, with **signed** int8 weights.
   Depthwise convs and attention score products stay fp32.
3. It turns on `reduce_range` only when the building host has no VNNI. Without VNNI, u8×s8
   saturates int16 intermediates. Dokploy builds on the host it runs on.
4. It lifts the decoder and joint weights out of ONNX into `decoder.npz`, pre-folded (see
   below).

| Encoder (same 20 FLEURS clips, 288 s audio, 4 cores) | Encoder time | Encoder RTFx | Error vs fp32 |
| ---------------------------------------------------- | ------------ | ------------ | ------------- |
| fp32 export                                          | 16.3 s       | 17.7         | —             |
| community int8 export                                | 21.1 s       | 13.7         | 0.498         |
| **compiled int8**                                    | **6.0 s**    | **48.3**     | **0.128**     |

The error column is the relative L2 error of the encoder output. Cosine similarity to fp32 is
0.992 for the compiled model and 0.868 for the community one.

### The decoder (`stt/decoder.py`)

The reference loop runs the whole `decoder_joint` graph at every frame step: the 2-layer LSTM
prediction network, both joint projections and the output head, for one utterance at a time.
This decoder runs the same greedy TDT search with the work split by what actually changes:

- The joint's encoder projection (1024→640) runs once, as one GEMM over every frame of the batch.
- The prediction network runs only when a non-blank token is emitted. A blank changes nothing,
  so its output is cached. The start state (blank fed from zeros) is computed at load.
- Layer 0's input term is `embedding @ W_ih + biases`, a function of the token alone. It is
  folded into an 8193×2560 lookup table at compile time. Layer 1's two GEMMs are fused into one.
- All live utterances step together, so the 640×8198 output head is one GEMM per step instead
  of one GEMV per utterance.

Results are identical to the reference: same tokens and frames on 60/60 FLEURS clips, and
log-probs within 1e-6. `tests/test_decoder.py` checks this on random models built with the
export's graph structure. Batched decoding is 3× faster than one utterance at a time. Each step
is memory-bound: 21 MB of fp32 head weights at about 77 GB/s. An int8 head was measured at only
about 25% faster per step and isn't exact, so it was left out.

### Serving (`stt/batcher.py`, `stt/server.py`)

- **Continuous batching.** One thread owns the cores. An idle engine takes a request at once,
  and requests that queue during a run go into the next batch. A batch is the oldest request
  plus the queued ones nearest it in length, capped by count and by padded seconds.
- **Audio is decoded in-process** with PyAV (libav). An ffmpeg subprocess cost 177 ms per 14 s
  voice note, mostly process start-up and resampling. PyAV takes 53 ms. The demuxer is picked
  from the file's magic bytes, so libav never probes, and nested protocol opens are refused, so
  playlists or concat files can't make it read other files or URLs. Opus decodes at 48 kHz and
  goes to 16 kHz through an exact 3:1 polyphase decimator (`audio.decimate3`); other rates use
  libswresample.
- **Leading and trailing silence is trimmed** (`audio.speech_span`), keeping 0.5 s of padding.
  It uses frame energy against the clip's own noise floor, and doesn't cut when speech and
  floor aren't clearly apart.
- **Notes over 30 s are cut at their quietest pauses** into 15–30 s chunks (`audio.chunks`).
  The chunks are decoded in the same batch and stitched back together.
- **Phrase boosting** (`stt/boost.py`): a token automaton over a character trie of the
  phrases, in four casings, so any tokenization of a name matches. Pieces that start a phrase
  at a word boundary get +1.5 log-prob, and pieces that continue one get +3.0. The bonus
  decides the greedy step only; reported probabilities stay the model's. Each phrase list is
  built once (LRU) on the request thread.
- **The thread count follows the container's CPU quota** (cgroup `cpu.max`), so compose's
  `cpus` sizes the engine.

## Numbers

Measured with `python bench.py <models> <dir> [--limit N] [--no-trim]`. The FLEURS pt-BR test
set is 919 clips and 3.2 h, re-encoded as 24 kbps Ogg/Opus like WhatsApp voice notes.

Speed, first host (4 cores of a Xeon with AVX-512 VNNI and AMX, WAV input):

| Pipeline                                  | RTFx | ms per clip |
| ----------------------------------------- | ---- | ----------- |
| onnx-asr, community int8 (first 40 clips) | 12.6 | ~1200       |
| this engine, batch 1                      | 30.8 | 412         |
| this engine, batch 8                      | 60.0 | 211         |

Later runs were on a second host: a 2.8 GHz Xeon without AMX and with a 33 MB L3, about half
as fast. Each comparison below was made on a single host.

| Change, full FLEURS Opus set, batch 8 | WER          | Speed              |
| ------------------------------------- | ------------ | ------------------ |
| base (WAV input)                      | 5.08%        | RTFx 28.9          |
| Opus, ffmpeg subprocess               | 5.03%        | 177 ms/note decode |
| Opus, PyAV + decimator                | 5.08% (1)    | 53 ms/note decode  |
| + trimming (keeps 89% of the audio)   | 5.11 → 4.66% | RTFx 27.7 → 29.3   |

(1) 236 transcripts differ, 48 better and 55 worse: a coin flip (sign test p ≈ 0.55), not a loss.

Long notes, built by joining FLEURS clips with 0.4 s gaps. WER is shown whole, then for the
same clips decoded one by one:

| Note length | Without chunking | With chunking | Clips one by one |
| ----------- | ---------------- | ------------- | ---------------- |
| ~120 s      | 5.38%            | 2.99%         | 3.23%            |
| ~180 s      | 7.37%            | 6.89%         | 6.32%            |

A 180 s note takes 12.1 s instead of 19.4 s when chunked.

Phrase boosting (150 FLEURS clips; each clip's proper nouns stand in for unusual product names,
plus 60 distractor names from other clips per catalog):

| Boost (start, step) | Names recognized | WER   | False names | Time |
| ------------------- | ---------------- | ----- | ----------- | ---- |
| none                | 75.7%            | 4.58% | 0           | 74 s |
| 1.5, 3.0 (default)  | 81.3%            | 4.06% | 0           | 72 s |
| 3.0, 5.0            | 82.0%            | 4.00% | 0           | 72 s |

Base model vs the pt-BR fine-tune (TAGARELA podcasts), 100 clips each:

| Model                  | CORAA (spontaneous pt-BR) | FLEURS (read, Opus) |
| ---------------------- | ------------------------- | ------------------- |
| parakeet-tdt-0.6b-v3   | 12.32%                    | 4.40%               |
| ...-ptbr (`STT_MODEL`) | 7.51%                     | 6.08%               |

Voice notes are spontaneous speech, where the fine-tune is 39% better. It is worse on read
speech, and it is one person's model, so it is opt-in until real voice notes decide.

Tried and not kept:

- **int8 joint head:** about 25% faster per step, but not exact.
- **Attention rewrite:** folding 1/√d into the query and dropping the post-softmax mask pass
  was within noise (±10%) over four alternating runs.

## Develop

```sh
cd services/stt
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -t .      # no model needed
.venv/bin/python -m stt.fetch /tmp/pv3 && .venv/bin/python -m stt.compile /tmp/pv3 /tmp/models
# the pt-BR fine-tune: stt.fetch /tmp/ptbr parakeet-tdt-0.6b-v3-ptbr; stt.compile /tmp/ptbr /tmp/m parakeet-tdt-0.6b-v3-ptbr
STT_SECRET=dev STT_MODEL_DIR=/tmp/models .venv/bin/python -m stt.server
curl -sS -H 'authorization: Bearer dev' --data-binary @note.ogg localhost:8792/v1/transcribe
```

Compiling needs about 6 GB of RAM for the fp32 model. Serving needs about 1.5 GB.

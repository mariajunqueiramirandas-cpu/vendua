# stt

Self-hosted speech-to-text for the Vendedor's voice notes
([ADR 0035](../../docs/adr/0035-self-hosted-stt.md)). It runs NVIDIA's
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
route. It can also be listed among the cloud routes in `agent_runtime.media_routes`, first or as
a fallback. The audio never leaves the host, and transcripts are never logged or stored here.

## API

| Route                 | Auth                 | Body                   | Returns                                 |
| --------------------- | -------------------- | ---------------------- | --------------------------------------- |
| `POST /v1/transcribe` | `Bearer $STT_SECRET` | the audio file's bytes | `{text, confidence, language, seconds}` |
| `?words=1`            |                      |                        | adds `words: [{word, start}]` (seconds) |
| `GET /healthz`        | none                 |                        | 200 once warm, `{ok, queue}`            |

Any format ffmpeg reads works: Ogg/Opus voice notes, mp3, m4a, wav. 16 kHz mono WAV skips
ffmpeg. `confidence` is `exp(mean token log-prob)`, the same scale Core derives from Whisper's
`avg_logprob`. `language` is always `null`: the model picks among its 25 languages but doesn't
say which.

Errors are `{error: code}` with a stable status:

| Status | Codes                                                   |
| ------ | ------------------------------------------------------- |
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

Build arg `STT_REDUCE_RANGE` (`auto`, `0` or `1`): see "The compile step".

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
- **ffmpeg runs per request,** in a subprocess limited to `pipe:` I/O, so a malformed file
  can't crash the server or make it open files or URLs. The number of concurrent decodes is
  bounded.
- **The thread count follows the container's CPU quota** (cgroup `cpu.max`), so compose's
  `cpus` sizes the engine.

## Numbers

FLEURS pt-BR test set: 919 clips, 3.2 h of audio. Measured on 4 cores of a Xeon with AVX-512
VNNI and AMX, with `python bench.py <models> <fleurs/pt_br> <batch>`:

| Pipeline                                  | RTFx | ms per clip |
| ----------------------------------------- | ---- | ----------- |
| onnx-asr, community int8 (first 40 clips) | 12.6 | ~1200       |
| this engine, batch 1                      | 30.8 | 412         |
| this engine, batch 8                      | 60.0 | 211         |

WER on this set is still to be measured: the first run's TSV parsing was wrong (fixed in
`bench.py`).

## Develop

```sh
cd services/stt
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -t .      # no model needed
.venv/bin/python -m stt.fetch /tmp/pv3 && .venv/bin/python -m stt.compile /tmp/pv3 /tmp/models
STT_SECRET=dev STT_MODEL_DIR=/tmp/models .venv/bin/python -m stt.server
curl -sS -H 'authorization: Bearer dev' --data-binary @note.ogg localhost:8792/v1/transcribe
```

Compiling needs about 6 GB of RAM for the fp32 model. Serving needs about 1.5 GB.

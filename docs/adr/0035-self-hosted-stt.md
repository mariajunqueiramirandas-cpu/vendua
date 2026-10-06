# ADR 0035: Shoppers' voice notes are transcribed on our own hardware

- Status: Accepted (implemented 2026-10-06, `services/stt`)
- Date: 2026-10-06

## Context

The Vendedor ([ADR 0031](0031-vendedor.md)) reads a shopper's voice note as its transcript.
`vendedor/media.ts` sends the audio to whichever cloud route staff list in
`agent_runtime.media_routes` (OpenAI or ElevenLabs). With no route set, the agent is told it
couldn't understand the audio and asks the shopper to type. Every note is a per-minute charge
and a shopper's voice on a third party's servers. `zdr` only records what staff believe that
account's retention terms are.

Brazilian WhatsApp shoppers send a lot of voice notes. They are short (Core caps them at 180 s),
mostly pt-BR and often noisy, and they reach a VPS that has no GPU.

## Options (open-weight STT, October 2026)

FLEURS pt-BR WER and relative speed come from the per-language table at
[models.handy.computer](https://models.handy.computer/languages/pt). The speed column is RTFx on
one laptop GPU, for comparison between models only.

| Model                    | Params | License    | pt WER | Speed | Note                                             |
| ------------------------ | ------ | ---------- | ------ | ----- | ------------------------------------------------ |
| Voxtral Small 2507       | 24B    | Apache-2.0 | 3.74   | —     | needs a datacenter GPU                           |
| Voxtral Mini 3B 2507     | 3B     | Apache-2.0 | 3.84   | 1.3×  | LLM decoder                                      |
| Voxtral Mini 4B Realtime | 4B     | Apache-2.0 | 3.87   | 0.9×  | streaming, 240 ms–2.4 s delay, vLLM              |
| Whisper large-v3         | 1.55B  | MIT        | 3.88   | 2.1×  | hallucinates on silence                          |
| Whisper large-v3-turbo   | 809M   | MIT        | 4.17   | 3.4×  | 4-layer decoder                                  |
| Qwen3-ASR-1.7B           | 1.7B   | Apache-2.0 | 4.37   | 3.8×  | 52 languages                                     |
| Canary-1B-v2             | 1B     | CC-BY-4.0  | 4.50   | 13.2× | AED decoder, 25 European languages               |
| **Parakeet-TDT-0.6B-v3** | 600M   | CC-BY-4.0  | 4.96   | 12.5× | transducer, 25 European languages, punctuation   |
| Granite Speech 4.1 2B    | 2B     | Apache-2.0 | —      | —     | tops the English Open ASR leaderboard; pt listed |

## Decision

**Parakeet-TDT-0.6B-v3, self-hosted on CPU, behind a `stt` sidecar** (`services/stt`), with an
inference engine written for it.

- **Speed on CPU decides it.** A voice note has to come back within the shopper's patience on a
  VPS with no GPU. The models ahead of it on WER either decode autoregressively with a large
  decoder (Whisper, Voxtral, Qwen3-ASR, Granite) or need a GPU. Parakeet's FastConformer encoder
  runs once, and its TDT decoder skips frames.
- **A transducer doesn't hallucinate.** Whisper is known to invent text on silence or noise; in
  Portuguese the classic is "Legendas pela comunidade Amara.org". A transducer emits blanks
  instead. For a seller that acts on what the shopper said, a wrong confident sentence is worse
  than an admitted gap.
- **Punctuation, capitalization and word timings are built in**, and it detects its 25 languages
  itself, Portuguese included.
- **About 1 WER point** behind the best open models on FLEURS pt-BR. The confidence Core already
  acts on (below 0.7, the agent confirms) covers the hard notes.
- **The data stays here.** Retention terms stop being a question because no third party gets
  the audio.
- **The engine is ours** because the available int8 export is slower than fp32 on x86 and much
  less accurate. The compile step and decoder are described in `services/stt/README.md`.

**Core calls it as transcription provider `sidecar`.** When staff named no `transcribe` route
and `STT_URL` plus `STT_SECRET` are set, it is the default. Staff can still list cloud routes
before it, after it as a fallback, or instead of it.

**One process owns the cores.** Requests queue and leave in continuous batches. The compose
service gets `cpus: 2` by default so a burst of notes can't starve Core or Postgres, and the
engine sizes its threads to that quota.

## Consequences

- The `stt` image is about 1 GB compressed (2.5 GB on disk). Its first build downloads the 2.5 GB fp32 export (pinned by
  revision and sha256) and needs about 6 GB of RAM to compile. Later builds reuse that layer.
- The compiled model matches the build host's CPU. Building elsewhere for a host without VNNI
  needs `--build-arg STT_REDUCE_RANGE=1`.
- `language` comes back `null`, because the model doesn't report the language it detected.
- **Upgrade path:** Canary-1B-v2 runs on the same preprocessor and encoder stack, with
  better pt WER (4.50). Its autoregressive decoder would need its own loop. A GPU host could run
  Voxtral Mini or Whisper turbo behind the same `/v1/transcribe` contract.
- CC-BY-4.0 requires attribution, which is in `services/stt/README.md`.

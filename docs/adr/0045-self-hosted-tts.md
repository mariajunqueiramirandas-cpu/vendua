# ADR 0045: Replies can be spoken, on our own hardware

- Status: Accepted (service built 2026-10-16, `services/tts`; not yet called by Core)
- Date: 2026-10-16

## Context

Brazilian shoppers talk to stores in voice notes, and since [ADR 0037](0037-self-hosted-stt.md)
the Vendedor understands them. It still answers in text. Core can already send audio as a
WhatsApp voice note (`store-whatsapp/gateway.ts`, `ptt: true`), so speaking a reply only needs
the voice.

Cloud TTS is billed per character and sends every reply, with shoppers' names, addresses and
orders, to another company. The VPS has no GPU, and `stt` already uses 2 of its cores. A voice
model here has to be faster than real time on about 2 CPU cores, sound Brazilian, and allow
commercial use.

## Options (open-weight TTS with Portuguese, October 2026)

| Model             | Size   | License                     | Against                                                                                   |
| ----------------- | ------ | --------------------------- | ----------------------------------------------------------------------------------------- |
| Kyutai Pocket TTS | 110M   | CC-BY-4.0 weights, MIT code | ~2× real time on 2 cores in PyTorch (measured: 1.7×)                                      |
| Supertonic 3      | ~99M   | OpenRAIL-M                  | Repo archived; the license bans undisclosed machine-generated content; preset voices only |
| Kokoro-82M        | 82M    | Apache-2.0                  | Its pt-BR voices are ungraded and go through espeak-ng; reviewers hear a foreign accent   |
| Piper             | 15–30M | voices MIT, engine GPL-3.0  | Older VITS sound, male pt-BR voices only, engine looking for maintainers                  |
| MOSS-TTS-Nano     | 100M   | Apache-2.0 (README hedges)  | No CPU numbers, license unclear                                                           |
| Qwen3-TTS 0.6B    | 600M   | Apache-2.0                  | 2–3× slower than real time on 4 vCPUs                                                     |

Ruled out: XTTS-v2, Fish Audio S2, Voxtral TTS and MMS-TTS (non-commercial); Kitten TTS and NeuTTS
Nano (no Portuguese).

## Decision

**Pocket TTS, Portuguese, 6 layers, on an inference engine of our own.** It is the one candidate
that is small, commercially licensed, maintained, streams, ships a Brazilian voice (`rafael`)
and has a 24-layer sibling if quality ever needs it. Its weakness was speed: the reference
PyTorch code makes 1.7 seconds of audio per second on 2 cores, too slow for a reply that should
arrive while the shopper is still in the chat.

So `services/tts` runs it on a C++ engine built for this model (`services/tts/README.md` has the
design and every number):

- **Same output as the reference.** Tests check the engine against a plain numpy Pocket TTS on
  every kernel set the CPU has. Transcribed by `stt`, its speech has the reference's WER (4.1–4.6%
  vs 4.2% on 738 words).
- **6.6× the reference's speed on the CPUs every server has (AVX2):** 11× real time on 2 cores,
  19× on 4. With AVX-512 it's 16× and 27–30×; with AMX, 21–28× and 34–55×. A 22-second reply
  is ready in 2 s on AVX2 and under 1 s on AMX.
- **Kernels picked at startup** from the CPU (AVX2, AVX-VNNI, AVX-512 or AMX), so one image runs on
  whatever host the VPS is.
- **The speech model in 4 bits.** Its matrices are Hadamard-rotated (QuaRot), which also makes
  int8 more precise than before, and quantized to int4 by GPTQ at build time, halving what each
  step reads. Transcribed by `stt`, the int4 voice is not told apart from float32 (sign test over
  294 clips), and its spectrum is within 0.2 dB. `TTS_SPEECH_BITS=8` goes back to int8 without a
  rebuild.
- **A Brazilian-Portuguese normalizer** in front: the tokenizer has no digits, so prices,
  installments, times and dates are spelled out ("R$ 49,90 em 10x" → "quarenta e nove reais e
  noventa centavos em dez vezes").
- **Same shape as `stt`:** an internal HTTP sidecar behind a bearer secret, idle without it, Ogg/
  Opus out (what WhatsApp plays as a voice note), and texts never logged.

Voices: 25 of Kyutai's 27 Portuguese voice states ship. `cosette` and `jean` come from
non-commercial recordings, so they don't. `rafael` is the only native speaker; the others are
English, French, Italian, Spanish, German and Dutch speakers' voices speaking Portuguese.

## Consequences

- About 300 MB of RAM and the cores compose gives it. Under load, throughput grows with cores
  until the decoder saturates them.
- The engine is ours to maintain: ~4,000 lines of C++ for one model. A new Pocket TTS release is
  a re-pack if its shapes stay the same. Tests against the numpy reference catch a packing or
  kernel mistake, and the WER check in the README catches an audible one.
- Nothing calls it yet. Wiring it into the Vendedor (when to answer in voice, which voice a store
  gets, caching repeated replies) is a product decision for its own change. Until then the service
  isn't deployed: `docker compose --profile tts up tts` runs it locally.
- Voice cloning, for a store's own voice, needs Kyutai's gated weights and the speaker's consent.
  It would add an audio encoder to the engine and is not part of this.

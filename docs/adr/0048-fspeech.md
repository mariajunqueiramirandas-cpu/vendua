# ADR 0048: fSpeech speaks for the stores

- Status: Accepted (2026-11-25)
- Date: 2026-11-25
- Supersedes: [ADR 0045](0045-self-hosted-tts.md)

## Context

[ADR 0045](0045-self-hosted-tts.md) built a self-hosted voice (`services/tts`, Kyutai's Pocket
TTS on our own engine), but nothing called it. The only spoken path in Core was the Vendedor's
voice reply ([ADR 0031](0031-vendedor.md)): with the store's `voiceReplies` on, a shopper who
sent a voice note got an audio answer. `vendedor/media.ts` could only speak through OpenAI, with no
default route, and no screen turned `voiceReplies` on. The kitchen and pickup screens read tickets
with the device's own voice, which on many Android tablets is robotic or not pt-BR at all.

fSpeech is the founder's own pt-BR engine: a C++23 runtime for gradium's `phonon-40m-pt` (a
Continuous Audio Language Model with a one-step flow head and the Mimi codec), with twelve
native Brazilian voices. It is to be Venduá's one voice, wherever a voice helps.

## Decision

**fSpeech is the TTS sidecar, kept in its own private repo.** The engine and its HTTP sidecar
live in `fSpeech` (`server/`), whose CI publishes `ghcr.io/<owner>/fspeech`. Venduá's stack runs
that image as `tts` (`docker-stack.yml`). This repo holds only the client, the settings, the
screens and the wiring, so the engine stays private.

**The sidecar keeps ADR 0045's contract.** `POST /v1/speak` with `Bearer $TTS_SECRET` and
`{text, voice?, format?: ogg | mp3 | wav, seed?}` returns the audio with `x-tts-seconds`.
`GET /healthz` lists the voices as `{id, name, gender, age, description}`, under ASCII ids
(`manuela-lu` for Manuela-Lu). Texts are never logged or kept. The same text in the same voice
always sounds the same: the default seed follows the voice and the text, and the engine steps
each stream alone, so what else is in flight never changes a reply. That is why the samples and
announcements can be cached.

**Core speaks through it by default.** In `vendedor/media.ts`, `speak` takes a `sidecar`
provider, used when staff saved no speak route and `TTS_URL` and `TTS_SECRET` are set, the way
STT does ([ADR 0037](0037-self-hosted-stt.md)). The store's voice goes first, then the route's,
and a voice the model no longer has falls back to the sidecar's default rather than to text. Any
failure still sends the reply as text (`voicePass`, unchanged).

**Where a voice helps, now:**

- The Vendedor answers a voice note with one, in the voice the store picked
  (`settings.speechVoice`, `''` = `TTS_VOICE`). Admin → Duá → Configurar → "Respostas em áudio"
  has the switch and the picker, and each voice plays the store's own greeting
  (`GET /admin/v1/vendedor/voices`, `…/voices/:id/sample`, MP3 for every browser).
- The kitchen and pickup screens' announcements are spoken in the store's voice
  (`POST /admin/v1/speech`, at most 300 characters, rate-limited, never cached by the browser
  because a pickup call can name the customer). Offline, or when Core can't speak, the device's
  voice says the line, as before.
- The CRM's IA → Voz shows the speech server's state beside the STT one.

Not yet: Duá's replies to merchants on Venduá's WhatsApp, the CRM agent's to leads, and the
storefront chat, which needs a Kernel audio part. Each needs its own outbound audio path (the
platform outbox and the CRM channel only send text today) and a product call on when to speak.

## Measurements

Every number below comes from one cloud container (Intel Sapphire Rapids, 4 vCPU). The quality
check sent 98 store replies × 12 voices through a 32 kbps Ogg/Opus round trip, like a WhatsApp
voice note, then through our own STT (`fspeech/server/bench.py`):

|                     | fSpeech (phonon-40m-pt) | Pocket TTS (ADR 0045, int8) |
| ------------------- | ----------------------- | --------------------------- |
| WER over all voices | 2.46% (1.63% to 3.18%)  | 9.8%                        |
| Prices heard right  | 311 / 312               |                             |
| Endings kept        | 1171 / 1176             |                             |
| Native pt-BR voices | 12                      | 1 (`rafael`)                |

On speed, a 9-second reply comes back in 1.8 s from a container capped at 2 CPUs. With 4 requests
at once on 4 vCPUs, throughput is 18× real time. The newest instructions aren't the fastest: on
this CPU the AVX2 kernels ran the pipeline 1.4–1.7× faster than AVX-512 or AMX. So the engine
times each kernel set at start and keeps the fastest (`FSPEECH_ISA` forces one).

## Consequences

- **The weights are CC BY-NC 4.0** (gradium/phonon-40m-pt). Speaking for paying stores relies on
  the founder's commercial agreement with gradium. Without it, this service can't run in
  production.
- The host needs a registry login that can read the private package (docs/deploy/dokploy.md,
  "Spoken replies"). A Venduá deploy pulls fSpeech's `:main` again, and `FSPEECH_IMAGE` pins a
  commit's image.
- `services/tts` and its CI job are gone. Its contract lives on in fSpeech's sidecar.
- Turning the replies on stays the merchant's choice: `voiceReplies` still defaults to off.

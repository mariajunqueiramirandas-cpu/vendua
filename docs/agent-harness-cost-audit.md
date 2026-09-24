# Agent harness — token-cost audit

Applied the token-efficiency playbook (map → measure → rank → safe changes →
flags/proposals → report). Target: lower price-weighted token cost per
completed task with no measurable quality drop. Default deployment:
`gemini` driver, `gemini-3.5-flash-lite` (in $0.30/M, cached $0.03/M,
out $2.50/M — output is 8.3x input price).

## 1. Harness map

Request assembly per turn (`runner.ts` → `llm.ts` → generateContent):

```
systemInstruction  = buildSystemPrompt(kind, pitch, memory, {goal, bookingUrl})
                     base lines + pitch/guardrails + per-kind playbook
tools              = toolsFor(kind) — REGISTRY schemas (13–16 tools/kind)
contents           = [ context(user) , ...turn history ]
                     context = contextFor(): LEAD row json · GOAL · PLANO ·
                     DOSSIÊ(≤6 notes ×800ch) · BOOKING_URL · CANAIS ·
                     THREAD(last 12) · SEGMENTOS/BRIEFS (strategist)
                     history = assistant turns (text + toolCalls w/
                     thoughtSignature) + tool results (full out JSON) +
                     nudge/reflection user turns
```

Already correct (playbook traps avoided): Gemini `thoughtSignature`
replayed verbatim per functionCall; deterministic serialization
(JSON.stringify field order is stable — byte-identical prefixes);
journal keeps full tool outputs (audit) while replay truncation
(REPLAY_OUT_MAX=3000) bounds *resume* history; per-lead/per-run content
is confined to the context message, not scattered through the system
prompt (exception: BOOKING_URL — see flags).

## 2. Baseline

Measured with `bun measure-harness.ts` (char pass) + Gemini countTokens
API (exact, `gemini-3.5-flash-lite`):

| kind | system | tools | ctx | turn-1 request | turns |
|---|---|---|---|---|---|
| triage | ~1193 | ~3070 | ~970 | **4866 tok** | ≤12 |
| reply | 1899 | 1992 | ~970 | **4861 tok** | ≤14 |
| outreach | ~1300 | ~2766 | ~970 | **4704 tok** | ≤12 |
| discovery | ~2144 | ~3039 | ~800 | **5722 tok** | ≤30 |
| strategist | ~898 | ~324 | ~640 | **2063 tok** | ≤10 |

### Cost by source × billing type (Gemini, per run — modeled)

Input billing splits into **fresh** (first turn, uncached; post-miss
everything) and **cached** (longest shared prefix on later turns —
implicit caching is on by default; min prefix ≈1–4K tok, our static
prefix is ~3.9–5.7K so prefix hits are plausible). Output = text +
tool-call args + thoughts, billed at 8.3x input.

| source | share | billing type |
|---|---|---|
| static prefix (system+tools) | ~3.9–5.7K/turn → 39–90% of input | fresh turn 1; cached after |
| context (LEAD/THREAD/…) | ~1K/turn → 10–20% | fresh turn 1; cached after |
| tool outputs in history | dominates growth — one 6-url read_pages ≈ 52K tok resent every later turn | fresh once, then cached |
| model output | ~5–15K/run | out rate (8.3x) |

Modeled reply run (14 turns, ~2K/turn history growth): **uncached**
≈ 277K in + ~6K out ≈ **$0.098**; **with prefix hits** ≈ 55K-billed in +
6K out ≈ **$0.031**. Discovery is read_pages-driven: a single unslimmed
call can add ~52K tok to every later turn — the run-level dominant
variable.

## 3. Ranked opportunities

| # | change | est. saving | quality risk | status |
|---|---|---|---|---|
| 1 | `slimToolOutputs`: bound model-facing tool results (journal stays full) | history-heavy runs: ~30–60% of input tokens (≈5x on resubmits even cached) | medium — page tails may hide contacts (mitigated: foundContacts/nav/errors already extracted; re-read cached) | **flagged** |
| 2 | `staticSystem`: BOOKING_URL out of the system prompt | turn-1 static ~4–5.7K→~10% when cross-run cache hits; kills per-lead prompt uniqueness | low-medium — model must read the context field (it was already duplicated there) | **flagged** |
| 3 | cached/cost telemetry | prerequisite — no spend | none | **done** |
| 4 | anthropic cache_control breakpoints | ~90% off static prefix when that driver runs | none | **done** (dormant driver) |
| 5 | tool-description slimming (~1–2K/request) | ~20–40% of static prefix | medium — terse-than-trained descriptions risk misuse | proposal |
| 6 | LEAD↔PLANO duplication (agent_plan twice in context) | ~0.3–0.5K/turn | low | proposal |
| 7 | explicit Gemini cache | ~none — implicit already on; adds storage fee + ops | — | **not recommended** |
| 8 | model routing / thinkingBudget | unknown — needs sim scores | high | proposal only |
| 9 | in-run history compaction (summarize old outs) | beyond #1 | high — no read-back path | proposal only |
| 10 | OpenRouter reasoning_details replay | correctness for reasoning models | — | gap (below) |

## 4. Changes made (commits on this branch)

1. `3755ff9` telemetry — `LlmResult.cachedTokensIn/cacheWriteTokensIn`
   per driver; journal `usage.*` per model step; `agent_runs.tokens_cached`
   (mig. 0028); Runs board shows cached split. `costUsd` now estimated
   from a built-in price table (`config.pricing` overrides; OpenRouter's
   reported cost still wins; unknown models → null).
2. `4b50311` anthropic cache breakpoints — ephemeral `cache_control` on
   last tool + system block.
3. `f326012` harness flags — `config.harness.slimToolOutputs` +
   `staticSystem`, both default OFF.
4. `f987091` sim `--harness` flag — A/B path.

### System-prompt diff (staticSystem=on)

Only one line is affected (the meeting goal line, messaging kinds):

- REWRITE: `envie o link de agendamento exatamente como está: {url}` →
  `envie o link do campo BOOKING_URL do contexto exatamente como está —
  se o campo disser '(não configurado)', request_human em vez de inventar um`
  — the URL moved to where it already lived (context `BOOKING_URL:` line);
  removes the per-lead signed token from the cacheable prefix.
- KEEP: every other line (pitch, memory, per-kind playbooks) — static
  per kind already.

## 5. Test plan for flagged changes

`bun run sim` drives real runs + a judge against isolated `vendua_sim`:

```sh
bun run sim -- --all                                   # baseline
bun run sim -- --all --harness slimToolOutputs         # flag A/B
bun run sim -- --all --harness staticSystem
bun run sim -- --all --harness slimToolOutputs,staticSystem
```

Compare `sim_runs.score` + `tokens_in/out/cached` + `sim-results/*.json`.
Pass criteria: judge score within baseline noise, no missing BOOKING_URL
sends (staticSystem), discovery runs still find contacts (slimToolOutputs).
Rollback = flip the integration config JSON — no redeploy.

## 6. Gaps / notes

- `tokens_cached` starts counting from this deploy — no historical hit rate.
- Implicit-cache min for 3.5-flash-lite isn't published; 3.5-flash is 4096.
  Prefixes ~3.9–5.7K are likely eligible; telemetry will tell.
- `thoughtsTokenCount` is billed as output — the journal records it inside
  tokensOut; watch it on real runs before proposing thinkingBudget=0.
- OpenRouter/OpenAI drivers don't replay provider reasoning items
  (non-Gemini `reasoning_details` are dropped between turns) — same class
  of bug thoughtSignature fixed on Gemini; left as a known gap.
- countTokens ≈ billed, not identical; numbers marked "~" are estimates.
- `staticSystem` prompt line references BOOKING_URL in context — if a
  deployment someday removes the context line, the meeting goal breaks;
  the flag's docstring calls this out.

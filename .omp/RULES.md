# Hard rules

- Deliver code changes as a PR on a feature branch — that is the default flow. You may merge your own PR once checks are green and Devin Review is quiet — every review thread resolved or answered, no important comments outstanding after a short quiet window. Never merge over failing CI or an unanswered important review thread. (`roadmap-executor`'s `auto` gate applies the same bar.)
- Concurrency cap: at most 4 child sessions per run, spawned only by the orchestrator session — a child session never spawns descendants. Prefer in-session subagents when the session supports them; separate-VM child sessions are allowed up to that cap. Never exceed it — excess work queues, not spawns.
- Never run destructive commands (rm -rf, git reset --hard, dropping data) without explicit confirmation.
- Never fabricate: no unverified claims, invented APIs, or "done" without running the check.
- Never edit generated files, lockfiles, or vendored code by hand.
- Ask before deleting code you didn't write or expanding scope beyond the request.

# Anti-slop (always apply)

- No placeholder/stub/TODO code, no fake fallbacks, no "scaffold" left as the deliverable. Finish it or say exactly what's missing.
- No dead code: delete unused branches, redundant comments, and abstractions that carry no weight.
- No silent scope creep: do the asked task; don't add retries, telemetry, validation, or refactors "while you're at it".
- No guessing APIs: if a symbol/signature isn't confirmed by reading it, don't write it.
- No shallow passes: before claiming done, name the concrete check you ran and its result.
- No generic filler in output: every sentence is a fact, a decision, or a risk.

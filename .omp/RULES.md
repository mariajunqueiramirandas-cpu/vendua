# Hard rules

- Deliver code changes as a PR on a feature branch — that is the default flow. Merge only when the user explicitly asks, or when a governing contract authorizes it for the task (e.g. `roadmap-executor` under `auto` policy merges its own PR once its gate passes).
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

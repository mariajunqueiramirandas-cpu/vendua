# ADR 0015 — One agent, several jobs

Status: accepted — supersedes the playbook overrides and `agent_autonomy` of ADR 0014

## Context

ADR 0014 exposed each run kind as a separately configured "playbook"
(`agent_playbooks`: enabled, step budget, model, monid cap, instructions per
kind) next to `agent_autonomy`, `pitch.hardRules` and
`guardrails.firstContactDraftOnly`. Staff saw ~50 knobs across six Estúdio tabs,
overlapping on/off switches (a disabled playbook blocked staff runs, parked
inbound mail and dropped lead-promised callbacks, while autonomy `off` did not),
and four places to write instructions. The knobs that actually shape behaviour —
the per-kind prompts — were never editable anyway.

## Decision

1. **Jobs stay in code.** `agent/jobs.ts` (`JOBS`) holds step budget, default
   monid cap, parallel tools, finish gate and debrief per run kind. The
   per-kind prompts in `prompts.ts` are fixed. Nothing about a job is a setting.
2. **One `agent` setting** (validated in `validateSetting`, normalized by
   `normalizeAgent` in `agent/policy.ts`):

   ```ts
   type AgentSetting = {
     level: 'off' | 'copilot' | 'supervised' | 'autopilot'; // the preset slider
     jobs: { reply: boolean; outreach: boolean; discovery: boolean; strategist: boolean };
     instructions: string; // ≤ 8000 chars, in every run's system prompt
     weeklyDiscoveryUsd: number; // 0..50 — strategist self-approval budget
   };
   ```

   `GET /control/v1/agent/config` returns it with defaults applied.

3. **Send policy is the preset alone.** `copilot`/`off` draft everything,
   `supervised` drafts first contact, `autopilot` sends within guardrails.
   `firstContactDraftOnly` is gone (supervised without it was autopilot).
4. **Switches park automation only.** Preset `off` or a job switched off parks
   automation-marked work (`params.auto` / inbound origin) of that kind —
   `parked()` / `parkPolicyTx()` in `policy.ts` is the single predicate the
   claim, drain, orphan sweep, wakeup and cadence sweeps share. Staff-triggered
   runs and lead-promised callbacks always run.
5. **One model** — the LLM connection's. Per-kind model overrides are gone.
6. `pitch` keeps the voice (product, offer, audience, tone, offerRange, goal);
   `guardrails` keeps the code-enforced limits. The Estúdio has four tabs:
   agente (preset + jobs + voice + instructions), limites, memória, agenda.

Migration `0043_agent_setting.sql` builds `agent` from the old keys (supervised
with `firstContactDraftOnly: false` → autopilot; hard rules and any
per-playbook instructions become `instructions`), then drops `agent_autonomy`,
`agent_playbooks`, `pitch.hardRules` and `guardrails.firstContactDraftOnly`.

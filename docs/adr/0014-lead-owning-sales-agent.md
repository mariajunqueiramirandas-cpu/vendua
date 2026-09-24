# ADR 0014: A lead-owning sales agent with one autonomy policy

- Status: Accepted
- Date: 2026-09-24

## Context

The sales agent grew as five prompt-per-trigger run kinds (`triage`, `reply`,
`outreach`, `discovery`, `strategist`) fired by sweeps and webhooks. A review
found it robust but weak as an agent:

- follow-up runs were unbound to a thread and had no tool to read the
  conversation — they wrote to leads blind;
- whether the agent would send was the emergent result of ~15 knobs across
  lead, thread, run and global scopes (`agent_mode`, `firstContactDraftOnly`,
  `draftOnly`, `discoveryAutoContact`, `firstContactDelayMin = 0` …), and the
  defaults were inverted (inbound leads drafted, discovered leads auto);
- per-lead memory was a plan checklist plus the last 6 notes; global memory was
  a FIFO of discovery stat lines injected into negotiation prompts;
- runs executed one at a time in FIFO order behind a shared 14-RPM limiter, so
  live replies queued behind discovery;
- follow-up provenance (`auto`, `agent`, `requested`, `regenerate`, `cadence`)
  was an implicit state machine spread over four files;
- staff corrections (edits, rejections) were discarded.

## Decision

See [architecture/17](../architecture/17-sales-agent.md). In short:

1. **One `lead` run kind driven by events** (`inbound`, `wakeup`,
   `first_contact`, `staff`, `assist`, `regenerate`, `manager`,
   `meeting_booked`, `bounce`), serial per lead, always given the full
   cross-channel conversation and a durable **case file**.
2. **One autonomy level per lead** (`off | suggest | supervised | autonomous`)
   with per-source defaults, and one `decide()` mapping (level, action class)
   to send/draft behind the unchanged hard guardrails.
3. **Wakeups are `cadence` or `commitment`** — a fresh inbound cancels only
   cadence work. This replaces every provenance marker.
4. **A daily `manager` agent** replaces the weekly strategist and may act on
   the pipeline within the same policy.
5. **Split memory** (case file / doctrine / discovery field notes / playbook),
   **live vs batch lanes**, **per-kind model routing**, and **learning signals**
   (edited approvals, rejection reasons, outcomes per prompt version + model).

The runtime (queue, claim fencing, journal replay, idempotency, cost caps) is
kept as is.

## Consequences

### Positive

- "Will the agent send this?" has one answer, previewable in Config.
- Follow-ups, callbacks and staff instructions read the whole conversation.
- The four-file provenance state machine collapses to one enum.
- Staff steer in plain language (instruct box) instead of knobs.

### Negative / costs

- A one-shot migration rewrites historical `agent_runs` kinds/params and lead
  columns; old journals keep their original tool names.
- Model-flagged classes (`sensitive`, `confidence`) depend on the model
  reporting honestly — the default `supervised` level still drafts first
  contact and channel switches deterministically.
- Evals stay manual (`bun run sim`), by choice: no model tokens in CI.

## Alternatives considered

- **Keep the run kinds, patch context gaps** — fixes the blind follow-up but
  leaves the knob sprawl and the provenance state machine.
- **A single long-lived agent process per lead** — needs a new runtime; the
  event-per-run model reuses the proven `agent_runs` machinery.

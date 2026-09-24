import type { AgentMessage, AgentTool, LlmProvider, LlmResult, ToolCall } from './llm.ts';

/**
 * agent/scripted-provider — a deterministic `LlmProvider` for golden evals.
 * It replays a fixed script of turns (one per chat() call) and RECORDS
 * every request it received, so a test can assert both halves of the loop:
 * the scripted "model" drove real tool effects in the DB, and the runner's
 * feedback (tool results, nudges) reached the next request.
 *
 * Unlike the `mock` driver — which answers without memory — this provider
 * is also the probe: `requests[i]` is exactly what turn `i` saw.
 * Free by construction: no network, no keys, `bun test` only.
 */

export interface ScriptedTurn {
  /** Assistant text for this turn (null when the model stays silent). */
  text?: string | null;
  /** Tool calls the turn emits, executed in order. */
  toolCalls?: { name: string; args?: Record<string, unknown> }[];
  /** Reported token usage — feeds the token→USD estimate path when
   *  costUsd is unset. */
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
}

export interface RecordedRequest {
  system: string;
  /** Snapshot — the runner appends to this array between calls. */
  messages: AgentMessage[];
  tools: AgentTool[];
}

export interface ScriptedProvider extends LlmProvider {
  readonly requests: RecordedRequest[];
  /** How many script turns have been consumed so far. */
  readonly turns: number;
}

/** `name` defaults to 'eval:scripted' — an unmatched model in
 *  estimateModelCostUsd's rate table, so nonzero token counts on a turn
 *  still land a plausible costUsd (the cost-cap eval relies on it). */
export function scriptedProvider(script: ScriptedTurn[], name = 'eval:scripted'): ScriptedProvider {
  const requests: RecordedRequest[] = [];
  let turns = 0;
  return {
    name,
    requests,
    get turns() {
      return turns;
    },
    async chat({ system, messages, tools }): Promise<LlmResult> {
      requests.push({
        system,
        messages: messages.map((m) => ({ ...m })),
        tools: tools.map((t) => ({ ...t })),
      });
      const turn = script[turns] ?? { text: 'ok' };
      turns++;
      const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((t, i) => ({
        id: `scripted-${turns}-${i}`,
        name: t.name,
        args: t.args ?? {},
      }));
      return {
        text: turn.text ?? null,
        toolCalls,
        tokensIn: turn.tokensIn ?? 0,
        tokensOut: turn.tokensOut ?? 0,
        costUsd: turn.costUsd ?? null,
      };
    },
  };
}

import type { AgentMessage, AgentTool, LlmProvider, LlmResult, ToolCall } from './llm.ts';

/** Deterministic `LlmProvider` for golden evals — replays scripted turns and
 *  records every request so a test can assert both halves of the loop. */

export interface ScriptedTurn {
  text?: string | null;
  toolCalls?: { name: string; args?: Record<string, unknown> }[];
  /** Reported token usage — feeds the token→USD estimate when costUsd is unset. */
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
}

export interface RecordedRequest {
  system: string;
  /** Snapshot — the runner mutates this array between calls. */
  messages: AgentMessage[];
  tools: AgentTool[];
}

export interface ScriptedProvider extends LlmProvider {
  readonly requests: RecordedRequest[];
  readonly turns: number;
}

/** 'eval:scripted' is unmatched in the cost rate table — nonzero tokens still
 *  land a plausible costUsd (the cost-cap eval relies on it). */
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
        // deep snapshot — the runner mutates nested args/toolCalls between turns
        messages: structuredClone(messages),
        tools: structuredClone(tools),
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

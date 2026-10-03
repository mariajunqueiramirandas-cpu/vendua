import type { Json, ModelResponse, Usage } from '../../types.ts';
import { ProviderError } from '../gateway.ts';
import type { ProviderAdapter, ProviderRequest } from '../types.ts';

export interface ScriptedOutput {
  text?: string;
  toolCalls?: { name: string; args: Json }[];
  usage?: Partial<Usage>;
  delayMs?: number;
  error?: { status: number; message: string };
}

export interface ScriptedAdapter extends ProviderAdapter {
  /** Every request received, in order. */
  readonly requests: ProviderRequest[];
}

/** Deterministic adapter for tests and cassettes. Past the end of a list it answers `''`. */
export function scriptedAdapter(
  script: ScriptedOutput[] | ((req: ProviderRequest, i: number) => ScriptedOutput),
  id = 'scripted',
): ScriptedAdapter {
  const requests: ProviderRequest[] = [];
  return {
    id,
    requests,
    async generate(req, signal): Promise<ModelResponse> {
      const i = requests.length;
      requests.push(structuredClone(req));
      const out: ScriptedOutput =
        typeof script === 'function' ? script(req, i) : (script[i] ?? { text: '' });
      if (signal.aborted) throw signal.reason;
      if (out.delayMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, out.delayMs);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              reject(signal.reason);
            },
            { once: true },
          );
        });
      }
      if (out.error) {
        throw new ProviderError(`${id} ${out.error.status}: ${out.error.message}`, {
          status: out.error.status,
        });
      }
      const toolCalls = (out.toolCalls ?? []).map((c, j) => ({
        id: `call_${i}_${j}`,
        name: c.name,
        args: c.args,
      }));
      return {
        text: out.text ?? '',
        toolCalls,
        usage: {
          inputTokens: out.usage?.inputTokens ?? 0,
          outputTokens: out.usage?.outputTokens ?? 0,
          cacheReadTokens: out.usage?.cacheReadTokens ?? 0,
          cacheWriteTokens: out.usage?.cacheWriteTokens ?? 0,
          costUsd: out.usage?.costUsd ?? 0,
        },
        provider: id,
        model: req.model,
        latencyMs: out.delayMs ?? 0,
        finish: toolCalls.length ? 'tool_calls' : 'stop',
      };
    },
  };
}

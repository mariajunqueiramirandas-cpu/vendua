import { OpenRouter } from '@openrouter/sdk';
import type { IntegrationRow } from '../modules/integrations.ts';

/**
 * agent/llm — the provider-agnostic model layer. `LlmProvider` is a small
 * tool-use chat interface; drivers: `openrouter` (official @openrouter/sdk,
 * the default), `anthropic` and `openai` (raw fetch), and `mock`
 * (deterministic, scriptable — dev and tests).
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type AgentMessage =
  | { role: 'user' | 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface LlmResult {
  text: string | null;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  /** USD cost when the provider reports it (OpenRouter does). */
  costUsd: number | null;
}

export interface LlmProvider {
  name: string;
  chat(input: { system: string; messages: AgentMessage[]; tools: AgentTool[] }): Promise<LlmResult>;
}

// ---------------------------------------------------------------------------
// openrouter — official SDK, OpenAI-compatible tool calling
// ---------------------------------------------------------------------------

function openrouterProvider(
  config: Record<string, unknown>,
  secretRef: string | null,
): LlmProvider {
  const apiKey = secretRef ? process.env[secretRef] : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(`missing API key — set ${secretRef ?? 'OPENROUTER_API_KEY'}`);
  }
  const model =
    typeof config.model === 'string' && config.model ? config.model : 'anthropic/claude-sonnet-4.5';
  const client = new OpenRouter({ apiKey });
  return {
    name: `openrouter:${model}`,
    async chat({ system, messages, tools }) {
      const orMessages: unknown[] = [{ role: 'system', content: system }];
      for (const m of messages) {
        if (m.role === 'tool') {
          orMessages.push({ role: 'tool', toolCallId: m.toolCallId, content: m.content });
        } else if (m.role === 'assistant' && m.toolCalls?.length) {
          orMessages.push({
            role: 'assistant',
            content: m.content || null,
            toolCalls: m.toolCalls.map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.name, arguments: JSON.stringify(t.args) },
            })),
          });
        } else {
          orMessages.push({ role: m.role, content: m.content });
        }
      }
      // stream:false inside chatRequest → the response is ChatResult; the
      // SDK's union type only narrows on a top-level `stream` flag, so the
      // cast is the honest read of what came back.
      const res = (await client.chat.send({
        chatRequest: {
          model,
          messages: orMessages as never,
          tools: tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          stream: false,
        },
      })) as {
        choices?: {
          message?: {
            content?: string | { type: string; text?: string }[] | null;
            toolCalls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: { promptTokens?: number; completionTokens?: number; cost?: number };
      };
      const choice = res.choices?.[0];
      const msg = choice?.message as
        | {
            content?: string | { type: string; text?: string }[] | null;
            toolCalls?: { id: string; function: { name: string; arguments: string } }[];
          }
        | undefined;
      const content = msg?.content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((c) => c.text ?? '').join('')
            : null;
      const toolCalls = (msg?.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
      }));
      return {
        text,
        toolCalls,
        tokensIn: res.usage?.promptTokens ?? 0,
        tokensOut: res.usage?.completionTokens ?? 0,
        costUsd: typeof res.usage?.cost === 'number' ? res.usage.cost : null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// anthropic / openai — thin fetch drivers, same normalized shape
// ---------------------------------------------------------------------------

function anthropicProvider(config: Record<string, unknown>, secretRef: string | null): LlmProvider {
  const apiKey = secretRef ? process.env[secretRef] : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error(`missing API key — set ${secretRef ?? 'ANTHROPIC_API_KEY'}`);
  const model =
    typeof config.model === 'string' && config.model ? config.model : 'claude-sonnet-4-5';
  return {
    name: `anthropic:${model}`,
    async chat({ system, messages, tools }) {
      const amMessages = messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: [
              ...(m.content ? [{ type: 'text', text: m.content }] : []),
              ...m.toolCalls.map((t) => ({
                type: 'tool_use',
                id: t.id,
                name: t.name,
                input: t.args,
              })),
            ],
          };
        }
        return { role: m.role, content: m.content };
      });
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system,
          messages: amMessages,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as {
        content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      const toolCalls = (data.content ?? [])
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id!,
          name: b.name!,
          args: (b.input ?? {}) as Record<string, unknown>,
        }));
      return {
        text: text || null,
        toolCalls,
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
        costUsd: null,
      };
    },
  };
}

function openaiProvider(config: Record<string, unknown>, secretRef: string | null): LlmProvider {
  const apiKey = secretRef ? process.env[secretRef] : process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`missing API key — set ${secretRef ?? 'OPENAI_API_KEY'}`);
  const model = typeof config.model === 'string' && config.model ? config.model : 'gpt-4o-mini';
  return {
    name: `openai:${model}`,
    async chat({ system, messages, tools }) {
      const oaMessages = [
        { role: 'system', content: system },
        ...messages.map((m) =>
          m.role === 'tool'
            ? { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
            : m.role === 'assistant' && m.toolCalls?.length
              ? {
                  role: 'assistant',
                  content: m.content || null,
                  tool_calls: m.toolCalls.map((t) => ({
                    id: t.id,
                    type: 'function',
                    function: { name: t.name, arguments: JSON.stringify(t.args) },
                  })),
                }
              : { role: m.role, content: m.content },
        ),
      ];
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: oaMessages,
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = data.choices?.[0]?.message;
      return {
        text: msg?.content ?? null,
        toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
        })),
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        costUsd: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// mock — deterministic scripted provider for dev and tests. The script comes
// from run params (`script`) or integration config: an array of steps, each
// {text?, toolCalls?: [{name, args}]}, consumed in order per chat() call.
// ---------------------------------------------------------------------------

export interface MockStep {
  text?: string;
  toolCalls?: { name: string; args?: Record<string, unknown> }[];
}

export function mockProvider(script: MockStep[]): LlmProvider {
  let calls = 0;
  return {
    name: 'mock',
    async chat() {
      const step = script[calls] ?? { text: 'ok' };
      calls++;
      return {
        text: step.text ?? null,
        toolCalls: (step.toolCalls ?? []).map((t, i) => ({
          id: `mock-${calls}-${i}`,
          name: t.name,
          args: t.args ?? {},
        })),
        tokensIn: 0,
        tokensOut: 0,
        costUsd: null,
      };
    },
  };
}

/** Resolve the active LLM provider for a run: enabled 'llm' integration's
 *  driver, or `mock` when none is configured (dev default). Run params may
 *  carry a `script` that a mock driver consumes. */
export function providerFor(
  integration: IntegrationRow | null,
  runParams: Record<string, unknown> = {},
): LlmProvider {
  const driver = integration?.driver ?? 'mock';
  const config = integration?.config ?? {};
  const secretRef = integration?.secret_ref ?? null;
  switch (driver) {
    case 'openrouter':
      return openrouterProvider(config, secretRef);
    case 'anthropic':
      return anthropicProvider(config, secretRef);
    case 'openai':
      return openaiProvider(config, secretRef);
    case 'mock': {
      const script = (runParams.script ?? config.script ?? []) as MockStep[];
      return mockProvider(script);
    }
    default:
      throw new Error(`unknown llm driver: ${driver}`);
  }
}

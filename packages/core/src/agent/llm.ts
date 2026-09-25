import { OpenRouter } from '@openrouter/sdk';
import type { IntegrationRow } from '../modules/integrations.ts';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini-signed call — replay verbatim on the functionCall part or the API 400s. */
  thoughtSignature?: string;
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

// cost estimation — providers that don't report USD get tokens × per-1M list prices so cost caps still fire
const MODEL_USD_PER_1M: Record<string, { in: number; out: number }> = {
  'gemini-3.5-flash-lite': { in: 0.1, out: 0.4 },
  'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
};
const FALLBACK_USD_PER_1M = { in: 1.0, out: 4.0 };

export function estimateModelCostUsd(
  providerName: string,
  tokensIn: number,
  tokensOut: number,
): number {
  // strip the FIRST segment only — openrouter model ids can contain ':'
  const model = providerName.includes(':')
    ? providerName.slice(providerName.indexOf(':') + 1)
    : providerName;
  const rate =
    MODEL_USD_PER_1M[model] ?? (model.endsWith(':free') ? { in: 0, out: 0 } : FALLBACK_USD_PER_1M);
  return (tokensIn * rate.in + tokensOut * rate.out) / 1_000_000;
}

// rate limiting — module-level slot chain spaces calls to RPM; retries honor Retry-After
const slotChains = new Map<string, Promise<void>>();
const lastCallAt = new Map<string, number>();
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function takeSlot(key: string, minGapMs: number) {
  const cur = (slotChains.get(key) ?? Promise.resolve()).then(async () => {
    const wait = (lastCallAt.get(key) ?? 0) + minGapMs - Date.now();
    if (wait > 0) await sleepMs(wait);
    lastCallAt.set(key, Date.now());
  });
  slotChains.set(key, cur);
  await cur;
}

const RETRYABLE = /429|quota|rate.?limit|resource_exhausted|overload|temporarily|5\d\d/i;

// hard bound per provider call — a hung socket would stall the run forever; config may override via timeoutMs
const LLM_CALL_TIMEOUT_MS = 120_000;

// AbortSignal.timeout needs a valid positive int32 — invalid config falls back to the default
const configTimeoutMs = (config: Record<string, unknown>): number =>
  typeof config.timeoutMs === 'number' &&
  Number.isInteger(config.timeoutMs) &&
  config.timeoutMs > 0 &&
  config.timeoutMs <= 2_147_483_647
    ? config.timeoutMs
    : LLM_CALL_TIMEOUT_MS;

function retryAfterMs(e: unknown): number | null {
  const headers = (e as { headers?: Headers }).headers;
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 90_000);
  // Retry-After also allows an HTTP-date.
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), 90_000) : null;
}

// runs fn through the slot chain; retries 429/5xx honoring Retry-After
async function llmCall<T>(key: string, minGapMs: number, fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 6;
  for (let attempt = 0; ; attempt++) {
    await takeSlot(key, minGapMs);
    try {
      return await fn();
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      const retryable =
        status === 429 ||
        (typeof status === 'number' && status >= 500) ||
        // a hung provider socket is transient like a 5xx — retry
        (e as { name?: string }).name === 'TimeoutError' ||
        RETRYABLE.test(e instanceof Error ? e.message : String(e));
      if (!retryable || attempt >= maxAttempts - 1) throw e;
      await sleepMs(retryAfterMs(e) ?? Math.min(5_000 * 2 ** attempt, 60_000));
    }
  }
}

// throws a headers-carrying error on non-2xx so llmCall can read Retry-After
async function llmFetch(
  url: string,
  init: RequestInit,
  label: string,
  timeoutMs = LLM_CALL_TIMEOUT_MS,
): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const e = new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`) as Error & {
      headers?: Headers;
    };
    e.headers = res.headers;
    throw e;
  }
  return res;
}

// openrouter — official SDK
function openrouterProvider(
  config: Record<string, unknown>,
  secretRef: string | null,
): LlmProvider {
  const apiKey = secretRef ? process.env[secretRef] : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(`missing API key — set ${secretRef ?? 'OPENROUTER_API_KEY'}`);
  }
  const model =
    typeof config.model === 'string' && config.model ? config.model : 'liquid/lfm-2.5-2.6b:free';
  const client = new OpenRouter({ apiKey, timeoutMs: configTimeoutMs(config) });
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
      // the SDK narrows on a top-level stream flag, so the cast is the honest read
      const res = (await llmCall('openrouter', 0, () =>
        client.chat.send({
          chatRequest: {
            model,
            messages: orMessages as never,
            tools: tools.map((t) => ({
              type: 'function' as const,
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            stream: false,
          },
        }),
      )) as {
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

// gemini generateContent — functionResponses merge into one user turn; thoughtSignature replays verbatim
function geminiProvider(config: Record<string, unknown>, secretRef: string | null): LlmProvider {
  const apiKey = secretRef ? process.env[secretRef] : process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(`missing API key — set ${secretRef ?? 'GEMINI_API_KEY'}`);
  const model =
    typeof config.model === 'string' && config.model ? config.model : 'gemini-3.5-flash-lite';
  // free tier caps at 15 RPM — space calls to `rpm` (config override for paid tiers).
  const rpm = typeof config.rpm === 'number' && config.rpm > 0 ? config.rpm : 14;
  const minGapMs = 60_000 / rpm;
  type Part = Record<string, unknown>;
  return {
    name: `gemini:${model}`,
    async chat({ system, messages, tools }) {
      const contents: { role: string; parts: Part[] }[] = [];
      for (const m of messages) {
        if (m.role === 'tool') {
          // functionResponse joins the pending all-responses user turn, else a fresh one
          let turn = contents[contents.length - 1];
          if (!turn || turn.role !== 'user' || !turn.parts.every((p) => 'functionResponse' in p)) {
            turn = { role: 'user', parts: [] };
            contents.push(turn);
          }
          // functionResponse.response must be an object — wrap arrays/strings under result
          let result: unknown = m.content;
          try {
            result = JSON.parse(m.content);
          } catch {
            /* plain string */
          }
          if (typeof result !== 'object' || result === null || Array.isArray(result)) {
            result = { result };
          }
          turn.parts.push({
            functionResponse: { name: m.name, id: m.toolCallId, response: result },
          });
          continue;
        }
        if (m.role === 'assistant') {
          const parts: Part[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const t of m.toolCalls ?? [])
            parts.push({
              functionCall: { name: t.name, args: t.args, id: t.id },
              ...(t.thoughtSignature ? { thoughtSignature: t.thoughtSignature } : {}),
            });
          if (parts.length) contents.push({ role: 'model', parts });
          continue;
        }
        contents.push({ role: 'user', parts: [{ text: m.content }] });
      }
      const data = await llmCall('gemini', minGapMs, async () => {
        // body read stays inside the retry wrapper — a stalled body retries like a stalled request
        const res = await llmFetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            // header auth — a ?key= query param lands in proxy/server logs.
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents,
              tools: tools.length
                ? [
                    {
                      functionDeclarations: tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                      })),
                    },
                  ]
                : undefined,
            }),
          },
          'gemini',
          configTimeoutMs(config),
        );
        return (await res.json()) as {
          candidates?: {
            content?: {
              parts?: {
                text?: string;
                functionCall?: { name?: string; args?: unknown; id?: string };
                thoughtSignature?: string;
              }[];
            };
            finishReason?: string;
          }[];
          promptFeedback?: { blockReason?: string };
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
          };
        };
      });
      const cand = data.candidates?.[0];
      if (!cand) {
        throw new Error(
          `gemini returned no candidate${data.promptFeedback?.blockReason ? ` — blocked: ${data.promptFeedback.blockReason}` : ''}`,
        );
      }
      const parts = cand.content?.parts ?? [];
      // empty STOP is legal 'done' only mid-run (tool results in history) — first-turn empty means the model produced nothing
      if (
        !parts.some((p) => p.text || p.functionCall) &&
        !(cand.finishReason === 'STOP' && messages.some((m) => m.role === 'tool'))
      ) {
        throw new Error(`gemini returned empty candidate — ${cand.finishReason ?? 'no reason'}`);
      }
      const text = parts.map((p) => p.text ?? '').join('') || null;
      const toolCalls = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({
          id: p.functionCall!.id ?? `gem-${i}`,
          name: p.functionCall!.name!,
          args: (p.functionCall!.args ?? {}) as Record<string, unknown>,
          ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}),
        }));
      const u = data.usageMetadata;
      return {
        text,
        toolCalls,
        tokensIn: u?.promptTokenCount ?? 0,
        tokensOut: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
        costUsd: null,
      };
    },
  };
}

// anthropic / openai — thin fetch drivers
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
      const data = await llmCall('anthropic', 0, async () => {
        const res = await llmFetch(
          'https://api.anthropic.com/v1/messages',
          {
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
          },
          'anthropic',
          configTimeoutMs(config),
        );
        return (await res.json()) as {
          content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      });
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
      const data = await llmCall('openai', 0, async () => {
        const res = await llmFetch(
          'https://api.openai.com/v1/chat/completions',
          {
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
          },
          'openai',
          configTimeoutMs(config),
        );
        return (await res.json()) as {
          choices?: {
            message?: {
              content?: string | null;
              tool_calls?: { id: string; function: { name: string; arguments: string } }[];
            };
          }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
      });
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

// mock — deterministic scripted provider; steps consumed in order per chat()
export interface MockStep {
  text?: string;
  toolCalls?: { name: string; args?: Record<string, unknown> }[];
  /** sleep before this step lands — demo pacing for live-looking scripted runs. */
  delayMs?: number;
  /** reported token usage — exercises the cost-estimation path without a live provider. */
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number | null;
}

export function mockProvider(script: MockStep[], name = 'mock'): LlmProvider {
  let calls = 0;
  return {
    name,
    async chat() {
      const step = script[calls] ?? { text: 'ok' };
      calls++;
      if (step.delayMs && step.delayMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(step.delayMs as number, 30000)));
      }
      return {
        text: step.text ?? null,
        toolCalls: (step.toolCalls ?? []).map((t, i) => ({
          id: `mock-${calls}-${i}`,
          name: t.name,
          args: t.args ?? {},
        })),
        tokensIn: step.tokensIn ?? 0,
        tokensOut: step.tokensOut ?? 0,
        costUsd: step.costUsd ?? null,
      };
    },
  };
}

// test seam — a scripted provider reachable by every run kind; production never sets it
let testProvider: LlmProvider | null = null;

/** Test-only provider override — consulted by providerFor ahead of every
 *  driver. Pass null to restore. */
export function setTestProvider(provider: LlmProvider | null): void {
  testProvider = provider;
}

// provider for a run — integration driver, or mock (params/config may carry a script)
export function providerFor(
  integration: IntegrationRow | null,
  runParams: Record<string, unknown> = {},
): LlmProvider {
  if (testProvider) return testProvider;
  const driver = integration?.driver ?? 'mock';
  const config = integration?.config ?? {};
  const secretRef = integration?.secret_ref ?? null;
  switch (driver) {
    case 'gemini':
      return geminiProvider(config, secretRef);
    case 'openrouter':
      return openrouterProvider(config, secretRef);
    case 'anthropic':
      return anthropicProvider(config, secretRef);
    case 'openai':
      return openaiProvider(config, secretRef);
    case 'mock': {
      const script = (runParams.script ?? config.script ?? []) as MockStep[];
      // tests may masquerade the mock as a priced driver — provider.name keys the rate lookup
      const name = (runParams.providerName ?? config.providerName) as string | undefined;
      return mockProvider(script, name ?? 'mock');
    }
    default:
      throw new Error(`unknown llm driver: ${driver}`);
  }
}

import { OpenRouter } from '@openrouter/sdk';
import type { IntegrationRow } from '../modules/integrations.ts';

/**
 * agent/llm — the provider-agnostic model layer. `LlmProvider` is a small
 * tool-use chat interface; drivers: `gemini` (AI Studio generateContent —
 * the default deployment driver), `openrouter` (official @openrouter/sdk),
 * `anthropic` and `openai` (raw fetch), and `mock` (deterministic,
 * scriptable — dev and tests).
 */

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Gemini 3 signs model-emitted function calls; the signature must be
   *  replayed verbatim on the functionCall part in subsequent history or the
   *  API 400s. Other drivers ignore it. */
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
  /** Total prompt tokens billed this call — cache hits INCLUDED (every
   *  provider counts them inside its input total). */
  tokensIn: number;
  tokensOut: number;
  /** Input tokens served from a provider cache read — billed at the
   *  cached rate (~10x cheaper than fresh input). */
  cachedTokensIn: number;
  /** Input tokens written to a provider cache this call — Anthropic
   *  charges 5m-cache creation at 1.25x input; Gemini/OpenAI implicit
   *  caches have no write fee. */
  cacheWriteTokensIn: number;
  /** USD cost — provider-reported when available (OpenRouter), else the
   *  published-price estimate from the built-in table or config.pricing.
   *  Null when the model has no known price. */
  costUsd: number | null;
}

/** Published paid-tier USD per 1M tokens for the driver default models.
 *  Order matters: prefix matching is first-hit, so longer ids come first.
 *  `write` is Anthropic's 5m-cache creation rate; provider implicit caches
 *  (Gemini/OpenAI) charge nothing to write. Overridable per integration
 *  via `config.pricing = {in, cached, write, out}` — full rows only, and
 *  prices drift: refresh this table when the deployment changes tiers. */
const PRICE_TABLE: { match: string; in: number; cached: number; write: number; out: number }[] = [
  { match: 'gemini-3.5-flash-lite', in: 0.3, cached: 0.03, write: 0, out: 2.5 },
  { match: 'gemini-3.5-flash', in: 1.5, cached: 0.15, write: 0, out: 9.0 },
  { match: 'gemini-3.1-flash-lite', in: 0.25, cached: 0.025, write: 0, out: 1.5 },
  { match: 'gemini-2.5-flash-lite', in: 0.1, cached: 0.01, write: 0, out: 0.4 },
  { match: 'gemini-2.5-flash', in: 0.3, cached: 0.03, write: 0, out: 2.5 },
  { match: 'gemini-2.5-pro', in: 1.25, cached: 0.125, write: 0, out: 10.0 },
  { match: 'claude-sonnet-4-5', in: 3.0, cached: 0.3, write: 3.75, out: 15.0 },
  { match: 'claude-sonnet-4-6', in: 3.0, cached: 0.3, write: 3.75, out: 15.0 },
  { match: 'claude-haiku-4-5', in: 1.0, cached: 0.1, write: 1.25, out: 5.0 },
  { match: 'gpt-4o-mini', in: 0.15, cached: 0.075, write: 0, out: 0.6 },
  { match: 'gpt-4o', in: 5.0, cached: 1.25, write: 0, out: 15.0 },
];

function pricingFor(model: string, config: Record<string, unknown>) {
  const c = config.pricing as
    | { in?: unknown; cached?: unknown; write?: unknown; out?: unknown }
    | undefined;
  if (c && typeof c.in === 'number' && typeof c.out === 'number') {
    return {
      in: c.in,
      cached: typeof c.cached === 'number' ? c.cached : c.in,
      write: typeof c.write === 'number' ? c.write : 0,
      out: c.out,
    };
  }
  for (const row of PRICE_TABLE) if (model.startsWith(row.match)) return row;
  return null;
}

/** Bill-shaped estimate: (total input − cache reads − cache writes) at the
 *  fresh rate + reads at the cached rate + writes at the write rate +
 *  output at the output rate. Null without a known price — an honest gap
 *  beats a fabricated number. */
function estimateCostUsd(
  model: string,
  config: Record<string, unknown>,
  u: { tokensIn: number; tokensOut: number; cachedTokensIn: number; cacheWriteTokensIn: number },
): number | null {
  const p = pricingFor(model, config);
  if (!p) return null;
  const fresh = Math.max(0, u.tokensIn - u.cachedTokensIn - u.cacheWriteTokensIn);
  return (
    (fresh * p.in +
      u.cachedTokensIn * p.cached +
      u.cacheWriteTokensIn * p.write +
      u.tokensOut * p.out) /
    1_000_000
  );
}

export interface LlmProvider {
  name: string;
  chat(input: { system: string; messages: AgentMessage[]; tools: AgentTool[] }): Promise<LlmResult>;
}

// ---------------------------------------------------------------------------
// rate limiting — providerFor builds a fresh provider per run, so the throttle
// lives at module level and keys by driver: a shared slot chain spaces calls
// to at most RPM, and every call retries 429/5xx honoring Retry-After. This is
// what keeps parallel drain batches, the sim persona, and the judge under
// Gemini's free-tier 15 RPM cap instead of every caller bursting at once.
// ---------------------------------------------------------------------------

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

/** Calls `fn` through the driver's slot chain, retrying provider-side 429/5xx
 *  up to 6 attempts (Retry-After header first, else capped exp. backoff).
 *  Non-retryable errors (400s, auth) throw on the first pass. */
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
        RETRYABLE.test(e instanceof Error ? e.message : String(e));
      if (!retryable || attempt >= maxAttempts - 1) throw e;
      await sleepMs(retryAfterMs(e) ?? Math.min(5_000 * 2 ** attempt, 60_000));
    }
  }
}

/** fetch wrapper that throws a headers-carrying error on non-2xx so llmCall
 *  can read Retry-After. */
async function llmFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const e = new Error(`${label} ${res.status}: ${(await res.text()).slice(0, 300)}`) as Error & {
      headers?: Headers;
    };
    e.headers = res.headers;
    throw e;
  }
  return res;
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
    typeof config.model === 'string' && config.model ? config.model : 'liquid/lfm-2.5-2.6b:free';
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
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          cost?: number;
          promptTokensDetails?: { cachedTokens?: number };
          // raw OpenRouter passthrough names, when the SDK leaves them as-is
          prompt_tokens_details?: { cached_tokens?: number };
        };
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
      const cachedTokensIn =
        res.usage?.promptTokensDetails?.cachedTokens ??
        res.usage?.prompt_tokens_details?.cached_tokens ??
        0;
      const u = {
        tokensIn: res.usage?.promptTokens ?? 0,
        tokensOut: res.usage?.completionTokens ?? 0,
        cachedTokensIn,
        cacheWriteTokensIn: 0,
      };
      return {
        text,
        toolCalls,
        ...u,
        costUsd:
          typeof res.usage?.cost === 'number'
            ? res.usage.cost
            : estimateCostUsd(model, config, u),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// gemini — AI Studio generateContent. Gemini turns are (role, parts[]) with
// roles user/model only: function calls ride in model parts and EVERY
// functionResponse for a model turn's calls must sit in the single user turn
// that follows — consecutive `tool` messages therefore merge into one user
// turn. Gemini 3 also requires each functionCall part's thoughtSignature
// replayed verbatim (captured on ToolCall.thoughtSignature), and echoes
// its own call ids — we pass both back through.
// ---------------------------------------------------------------------------

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
          // tool result → functionResponse part in the pending user turn (the
          // previous one when it's all functionResponses, else a fresh one).
          let turn = contents[contents.length - 1];
          if (!turn || turn.role !== 'user' || !turn.parts.every((p) => 'functionResponse' in p)) {
            turn = { role: 'user', parts: [] };
            contents.push(turn);
          }
          // response must be an object — the tool log stores a JSON string,
          // so parse back and wrap anything that isn't a plain object (tools
          // like search_leads return arrays) under `result`.
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
      const res = await llmCall('gemini', minGapMs, () =>
        llmFetch(
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
        ),
      );
      const data = (await res.json()) as {
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
          cachedContentTokenCount?: number;
        };
      };
      const cand = data.candidates?.[0];
      if (!cand) {
        throw new Error(
          `gemini returned no candidate${data.promptFeedback?.blockReason ? ` — blocked: ${data.promptFeedback.blockReason}` : ''}`,
        );
      }
      const parts = cand.content?.parts ?? [];
      // An empty STOP candidate is a legal 'done' ONLY mid-run, after the
      // model already acted (tool results in history prove it). Empty STOP on
      // the first turn means the model silently produced nothing — keep it a
      // visible error so the run fails instead of ending a real conversation
      // with no answer. Abnormal finishes (SAFETY/RECITATION) always throw.
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
      const u = {
        tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
        tokensOut:
          (data.usageMetadata?.candidatesTokenCount ?? 0) +
          (data.usageMetadata?.thoughtsTokenCount ?? 0),
        cachedTokensIn: data.usageMetadata?.cachedContentTokenCount ?? 0,
        cacheWriteTokensIn: 0,
      };
      return {
        text,
        toolCalls,
        ...u,
        costUsd: estimateCostUsd(model, config, u),
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
      const res = await llmCall('anthropic', 0, () =>
        llmFetch(
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
        ),
      );
      const data = (await res.json()) as {
        content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
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
      const u = {
        // Anthropic bills cached input outside input_tokens — fold it in
        // so tokensIn stays the total-prompt count like every other driver.
        tokensIn:
          (data.usage?.input_tokens ?? 0) +
          (data.usage?.cache_read_input_tokens ?? 0) +
          (data.usage?.cache_creation_input_tokens ?? 0),
        tokensOut: data.usage?.output_tokens ?? 0,
        cachedTokensIn: data.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokensIn: data.usage?.cache_creation_input_tokens ?? 0,
      };
      return {
        text: text || null,
        toolCalls,
        ...u,
        costUsd: estimateCostUsd(model, config, u),
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
      const res = await llmCall('openai', 0, () =>
        llmFetch(
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
        ),
      );
      const data = (await res.json()) as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
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
        cachedTokensIn: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokensIn: 0,
        costUsd: estimateCostUsd(model, config, {
          tokensIn: data.usage?.prompt_tokens ?? 0,
          tokensOut: data.usage?.completion_tokens ?? 0,
          cachedTokensIn: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokensIn: 0,
        }),
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
  /** Dev/demo pacing — sleep before this step lands, so scripted runs read
   *  live on the launch stage (and in recordings) instead of flashing past. */
  delayMs?: number;
}

export function mockProvider(script: MockStep[]): LlmProvider {
  let calls = 0;
  return {
    name: 'mock',
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
        tokensIn: 0,
        tokensOut: 0,
        cachedTokensIn: 0,
        cacheWriteTokensIn: 0,
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
      return mockProvider(script);
    }
    default:
      throw new Error(`unknown llm driver: ${driver}`);
  }
}

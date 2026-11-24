import type { ChatMessage, Json, ModelResponse, Part, ToolCall } from '../../types.ts';
import { ProviderError, postJson, withTimeout, type FetchLike } from '../gateway.ts';
import type { ProviderAdapter, ProviderRequest } from '../types.ts';

/**
 * Chat Completions with function calling: OpenAI (`https://api.openai.com/v1`), OpenRouter
 * (`https://openrouter.ai/api/v1`), Gemini's compatible endpoint
 * (`https://generativelanguage.googleapis.com/v1beta/openai`) and Mistral's native Chat API.
 *
 * OpenRouter only routes to zero-data-retention endpoints when the request asks for it: pass
 * `zdrBody: { provider: { zdr: true, data_collection: 'deny' } }` and it is merged into requests
 * whose route has `zdr: true`; a route with `zdr: false` gets OpenRouter's default routing.
 */
export interface OpenAiCompatibleOpts {
  id: string;
  baseUrl: string;
  apiKey: string;
  headers?: Record<string, string>;
  /** Merged into the top level of every request body. */
  extraBody?: Record<string, unknown> | ((req: ProviderRequest) => Record<string, unknown>);
  /** Merged after `extraBody` into requests whose route has `zdr: true`. */
  zdrBody?: Record<string, unknown>;
  /** Merged last into requests whose route pins an `endpoint` (OpenRouter: provider order). */
  endpointBody?: (endpoint: string) => Record<string, unknown>;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Newer OpenAI models take `max_completion_tokens`. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Total output allowance when the model also reasons inside the API's token limit. */
  outputTokens?: NonNullable<ProviderAdapter['outputTokens']>;
  /** Send system blocks as parts with `cache_control` (OpenRouter → Anthropic models). */
  cacheMarkers?: boolean;
  /** Use the native Mistral format for tool history and response chunks. */
  messageFormat?: 'mistral';
}

interface OaToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  /** Gemini's thought signature rides here and must be replayed. */
  extra_content?: unknown;
}

interface OaResponse {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: {
      content?: string | { type?: string; text?: string }[] | null;
      tool_calls?: OaToolCall[];
    };
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    cost?: number;
  };
  error?: { message?: string; code?: number | string };
}

type OaPart = { [k: string]: unknown };

function partOf(p: Part): OaPart | null {
  if (p.type === 'text') return p.text ? { type: 'text', text: p.text } : null;
  if (p.type === 'image') {
    const url = p.data ? `data:${p.mediaType};base64,${p.data}` : p.url;
    if (url) return { type: 'image_url', image_url: { url } };
    return p.description ? { type: 'text', text: `[image: ${p.description}]` } : null;
  }
  if (p.data) {
    return {
      type: 'input_audio',
      input_audio: { data: p.data, format: p.mediaType.split('/')[1] },
    };
  }
  return p.transcript ? { type: 'text', text: `[audio: ${p.transcript}]` } : null;
}

function parseArgs(raw: string | undefined): Json {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Json;
  } catch {
    return raw;
  }
}

const MAX_EXTRA = 1000;

/** Mistral requires nine alphanumeric characters, including for calls made by a fallback. */
function mistralCallIds(messages: ChatMessage[]): Map<string, string> {
  const ids = new Set(
    messages.flatMap((m) => {
      if (m.role === 'assistant') return m.toolCalls.map((c) => c.id);
      return m.role === 'tool' ? [m.callId] : [];
    }),
  );
  const remapped = new Map<string, string>();
  let next = 0;
  for (const id of ids) {
    if (/^[a-z0-9]{9}$/i.test(id)) continue;
    let candidate: string;
    do candidate = String(++next).padStart(9, '0');
    while (ids.has(candidate));
    remapped.set(id, candidate);
  }
  return remapped;
}

export function openAiCompatibleAdapter(opts: OpenAiCompatibleOpts): ProviderAdapter {
  const fetchFn: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const baseUrl = opts.baseUrl.replace(/\/$/, '');
  const mistral = opts.messageFormat === 'mistral';
  // provider-specific tool-call fields to echo back on the next step, by call id
  const extras = new Map<string, unknown>();

  // `provider` objects merge, so a pinned endpoint keeps the retention rules of extraBody/zdrBody
  function routing(req: ProviderRequest): { [k: string]: unknown } {
    const parts = [
      typeof opts.extraBody === 'function' ? opts.extraBody(req) : opts.extraBody,
      req.zdr === true ? opts.zdrBody : undefined,
      req.endpoint && opts.endpointBody ? opts.endpointBody(req.endpoint) : undefined,
    ];
    const out: { [k: string]: unknown } = {};
    for (const part of parts)
      for (const [k, v] of Object.entries(part ?? {}))
        out[k] =
          k === 'provider' && typeof v === 'object' && v && typeof out[k] === 'object'
            ? { ...(out[k] as object), ...v }
            : v;
    return out;
  }

  function body(req: ProviderRequest): { [k: string]: unknown } {
    const messages: { [k: string]: unknown }[] = [];
    const callIds = mistral ? mistralCallIds(req.messages) : null;
    const system = req.system.filter((b) => b.text);
    if (system.length) {
      if (opts.cacheMarkers) {
        const cached = system.flatMap((b, i) => (b.cache ? [i] : []));
        const keep = new Set(cached.slice(-4));
        messages.push({
          role: 'system',
          content: system.map((b, i) => ({
            type: 'text',
            text: b.text,
            ...(keep.has(i) ? { cache_control: { type: 'ephemeral' } } : {}),
          })),
        });
      } else {
        messages.push({ role: 'system', content: system.map((b) => b.text).join('\n\n') });
      }
    }
    function mergeUserContent(prev: unknown, next: string | OaPart[]): string | OaPart[] {
      if (typeof prev === 'string' && typeof next === 'string') return `${prev}\n\n${next}`;
      const a: OaPart[] =
        typeof prev === 'string' ? [{ type: 'text', text: prev }] : Array.isArray(prev) ? prev : [];
      const b: OaPart[] = typeof next === 'string' ? [{ type: 'text', text: next }] : next;
      return [...a, ...b];
    }

    function pushUser(content: string | OaPart[]): void {
      if (!mistral) {
        messages.push({ role: 'user', content });
        return;
      }
      // Mistral rejects `user` directly after `tool` ("Unexpected role 'user' after role 'tool'").
      if (messages[messages.length - 1]?.role === 'tool')
        messages.push({ role: 'assistant', content: 'OK.' });
      const tail = messages[messages.length - 1];
      if (tail?.role === 'user') tail.content = mergeUserContent(tail.content, content);
      else messages.push({ role: 'user', content });
    }

    for (const m of req.messages) {
      if (m.role === 'user') {
        const parts = m.parts.map(partOf).filter((p): p is OaPart => p !== null);
        if (parts.length === 0) continue;
        const textOnly = parts.every((p) => p.type === 'text');
        pushUser(textOnly ? parts.map((p) => p.text as string).join('\n') : parts);
      } else if (m.role === 'tool') {
        messages.push({
          role: 'tool',
          tool_call_id: callIds?.get(m.callId) ?? m.callId,
          ...(mistral && m.name ? { name: m.name } : {}),
          content: m.isError ? `Error: ${m.content}` : m.content,
        });
      } else {
        messages.push({
          role: 'assistant',
          // Mistral's tool-call messages cannot also carry a text preamble.
          ...(mistral && m.toolCalls.length ? {} : { content: m.text || null }),
          ...(m.toolCalls.length
            ? {
                tool_calls: m.toolCalls.map((c) => {
                  const extra = extras.get(c.id);
                  return {
                    id: callIds?.get(c.id) ?? c.id,
                    type: 'function',
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                    ...(extra === undefined ? {} : { extra_content: extra }),
                  };
                }),
              }
            : {}),
        });
      }
    }
    if (req.volatile) {
      if (mistral && messages[messages.length - 1]?.role === 'tool') {
        // Keep tool-loop steps ending on `tool` so Mistral never sees `user` after `tool`.
        const last = messages[messages.length - 1]!;
        last.content =
          typeof last.content === 'string' && last.content
            ? `${last.content}\n\n${req.volatile}`
            : req.volatile;
      } else {
        pushUser(req.volatile);
      }
    }

    return {
      model: req.model,
      messages,
      [opts.maxTokensField ?? 'max_tokens']: opts.outputTokens?.(req) ?? req.maxTokens,
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
      ...routing(req),
    };
  }

  return {
    id: opts.id,
    ...(opts.outputTokens ? { outputTokens: opts.outputTokens } : {}),
    async generate(req, signal): Promise<ModelResponse> {
      const t0 = Date.now();
      const data = (await postJson(
        fetchFn,
        `${baseUrl}/chat/completions`,
        { authorization: `Bearer ${opts.apiKey}`, ...opts.headers },
        body(req),
        withTimeout(signal, opts.timeoutMs),
        opts.id,
      )) as OaResponse;
      const choice = data.choices?.[0];
      if (!choice?.message) {
        const code = data.error?.code;
        throw new ProviderError(`${opts.id}: ${data.error?.message ?? 'no choices in response'}`, {
          ...(typeof code === 'number' ? { status: code } : {}),
        });
      }
      const msg = choice.message;
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => {
        const id = tc.id || `call_${i}`;
        if (tc.extra_content !== undefined) {
          extras.set(id, tc.extra_content);
          if (extras.size > MAX_EXTRA) extras.delete(extras.keys().next().value!);
        }
        return { id, name: tc.function?.name ?? '', args: parseArgs(tc.function?.arguments) };
      });
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c) => (!mistral || c.type === 'text' ? (c.text ?? '') : '')).join('')
            : '';
      const u = data.usage ?? {};
      const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
      const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
      return {
        text,
        toolCalls,
        usage: {
          // prompt_tokens counts cached tokens too; Usage.inputTokens is the uncached rest
          inputTokens: Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite),
          outputTokens: u.completion_tokens ?? 0,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          costUsd: typeof u.cost === 'number' ? u.cost : 0,
        },
        provider: opts.id,
        model: data.model ?? req.model,
        latencyMs: Date.now() - t0,
        finish:
          toolCalls.length > 0 ||
          choice.finish_reason === 'tool_calls' ||
          choice.finish_reason === 'function_call'
            ? 'tool_calls'
            : choice.finish_reason === 'length'
              ? 'length'
              : 'stop',
      };
    },
  };
}

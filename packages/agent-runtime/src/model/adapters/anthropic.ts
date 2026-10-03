import type { Json, ModelResponse, Part, ToolCall } from '../../types.ts';
import { postJson, withTimeout, type FetchLike } from '../gateway.ts';
import type { ProviderAdapter, ProviderRequest } from '../types.ts';

export interface AnthropicAdapterOpts {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
  id?: string;
  timeoutMs?: number;
  /**
   * A breakpoint on the last transcript block (before the volatile text), so the growing
   * conversation is cached between the steps of a turn. Takes one of the four breakpoints.
   */
  cacheConversation?: boolean;
}

type Block = { [k: string]: unknown };
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

interface AnthropicResponse {
  model?: string;
  content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

const MAX_BREAKPOINTS = 4;
const EPHEMERAL = { type: 'ephemeral' } as const;

function partBlock(p: Part): Block | null {
  if (p.type === 'text') return p.text ? { type: 'text', text: p.text } : null;
  if (p.type === 'image') {
    if (p.data) {
      return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } };
    }
    if (p.url) return { type: 'image', source: { type: 'url', url: p.url } };
    return p.description ? { type: 'text', text: `[image: ${p.description}]` } : null;
  }
  return p.transcript ? { type: 'text', text: `[audio: ${p.transcript}]` } : null;
}

function inputObject(args: Json): Json {
  return args && typeof args === 'object' && !Array.isArray(args) ? args : { value: args };
}

/** The Messages API body for a request; exported for snapshot tests. */
export function anthropicBody(
  req: ProviderRequest,
  opts: { cacheConversation?: boolean } = {},
): { [k: string]: unknown } {
  const messages: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage['role'], blocks: Block[]) => {
    if (blocks.length === 0) return;
    const last = messages[messages.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const m of req.messages) {
    if (m.role === 'user') {
      push(
        'user',
        m.parts.map(partBlock).filter((b): b is Block => b !== null),
      );
    } else if (m.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: m.callId,
          content: m.content,
          ...(m.isError ? { is_error: true } : {}),
        },
      ]);
    } else {
      push('assistant', [
        ...(m.text ? [{ type: 'text', text: m.text }] : []),
        ...m.toolCalls.map((c) => ({
          type: 'tool_use',
          id: c.id,
          name: c.name,
          input: inputObject(c.args),
        })),
      ]);
    }
  }

  const lastBlock = messages[messages.length - 1]?.content.at(-1);
  const conversationBreakpoint = (opts.cacheConversation ?? true) && lastBlock !== undefined;
  if (conversationBreakpoint) lastBlock.cache_control = EPHEMERAL;

  // volatile goes after the breakpoint so the cached prefix stays byte-stable
  if (req.volatile) {
    const last = messages[messages.length - 1];
    const block = { type: 'text', text: req.volatile };
    if (last?.role === 'user') last.content.push(block);
    else messages.push({ role: 'user', content: [block] });
  }

  const system = req.system.filter((b) => b.text);
  const cached = system.flatMap((b, i) => (b.cache ? [i] : []));
  const keep = new Set(cached.slice(-(MAX_BREAKPOINTS - (conversationBreakpoint ? 1 : 0))));

  return {
    model: req.model,
    max_tokens: req.maxTokens,
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(system.length
      ? {
          system: system.map((b, i) => ({
            type: 'text',
            text: b.text,
            ...(keep.has(i) ? { cache_control: EPHEMERAL } : {}),
          })),
        }
      : {}),
    messages,
    ...(req.tools.length
      ? {
          tools: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }
      : {}),
  };
}

export function anthropicAdapter(opts: AnthropicAdapterOpts): ProviderAdapter {
  const fetchFn: FetchLike = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const id = opts.id ?? 'anthropic';
  return {
    id,
    async generate(req, signal): Promise<ModelResponse> {
      const t0 = Date.now();
      const data = (await postJson(
        fetchFn,
        `${baseUrl}/v1/messages`,
        { 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
        anthropicBody(req, opts),
        withTimeout(signal, opts.timeoutMs),
        id,
      )) as AnthropicResponse;
      const content = data.content ?? [];
      const toolCalls: ToolCall[] = content
        .filter((b) => b.type === 'tool_use')
        .map((b, i) => ({
          id: b.id ?? `call_${i}`,
          name: b.name ?? '',
          args: (b.input ?? {}) as Json,
        }));
      const u = data.usage ?? {};
      return {
        text: content
          .filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join(''),
        toolCalls,
        usage: {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          costUsd: 0,
        },
        provider: id,
        model: data.model ?? req.model,
        latencyMs: Date.now() - t0,
        finish:
          data.stop_reason === 'tool_use'
            ? 'tool_calls'
            : data.stop_reason === 'max_tokens'
              ? 'length'
              : 'stop',
      };
    },
  };
}

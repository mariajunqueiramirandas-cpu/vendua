import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import {
  costUsd,
  ProviderError,
  retryAfterMs,
  type Json,
  type ModelResponse,
  type Part,
  type ProviderAdapter,
  type ProviderRequest,
  type ToolCall,
} from '@vendua/agent-runtime';
import {
  ANTHROPIC_LONG_PRICING,
  ANTHROPIC_MODEL,
  ANTHROPIC_PRICING,
  anthropicClient,
  DEFAULT_EFFORT,
  LONG_PROMPT_TOKENS,
  refusalOf,
  THINKING_HEADROOM,
} from '../platform/anthropic.ts';

// The runtime's model gateway on the Anthropic SDK. It lives in Core because the runtime takes no
// npm dependency (ADR 0030 decision 11). The gateway owns retries, timeouts and the fallback
// chain, so the client retries nothing and every failure leaves as a `ProviderError`. Every call
// runs ANTHROPIC_MODEL whatever the route names; the route picks the effort.

export interface AnthropicAdapterOpts {
  apiKey: string;
  baseUrl?: string;
  fetch?: ClientOptions['fetch'];
  id?: string;
  timeoutMs?: number;
  /**
   * A breakpoint on the last transcript block (before the volatile text), so the growing
   * conversation is cached between the steps of a turn. Takes one of the four breakpoints.
   */
  cacheConversation?: boolean;
}

type Block =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;
interface Turn {
  role: 'user' | 'assistant';
  content: Block[];
}

const MAX_BREAKPOINTS = 4;
const EPHEMERAL: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };
const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function partBlock(p: Part): Block | null {
  if (p.type === 'text') return p.text ? { type: 'text', text: p.text } : null;
  if (p.type === 'image') {
    if (p.data && IMAGE_TYPES.has(p.mediaType)) {
      const media_type = p.mediaType as Anthropic.Base64ImageSource['media_type'];
      return { type: 'image', source: { type: 'base64', media_type, data: p.data } };
    }
    if (p.url) return { type: 'image', source: { type: 'url', url: p.url } };
    return p.description ? { type: 'text', text: `[image: ${p.description}]` } : null;
  }
  return p.transcript ? { type: 'text', text: `[audio: ${p.transcript}]` } : null;
}

function inputObject(args: Json): { [k: string]: unknown } {
  return args && typeof args === 'object' && !Array.isArray(args) ? args : { value: args };
}

/**
 * The Messages API body for a request; exported for snapshot tests. Thinking blocks are never
 * replayed: the volatile text changes every step, which voids them under Haiku 5.5's history
 * check, and a transcript without them is accepted. No temperature either: Haiku 5.5 400s on any
 * but the default, and the guards ask for 0.
 */
export function anthropicBody(
  req: ProviderRequest,
  opts: { cacheConversation?: boolean } = {},
): Anthropic.MessageCreateParamsNonStreaming {
  const messages: Turn[] = [];
  const push = (role: Turn['role'], blocks: Block[]) => {
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
        ...(m.text ? [{ type: 'text' as const, text: m.text }] : []),
        ...m.toolCalls.map((c) => ({
          type: 'tool_use' as const,
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
    const block: Anthropic.TextBlockParam = { type: 'text', text: req.volatile };
    if (last?.role === 'user') last.content.push(block);
    else messages.push({ role: 'user', content: [block] });
  }

  const system = req.system.filter((b) => b.text);
  const cached = system.flatMap((b, i) => (b.cache ? [i] : []));
  const keep = new Set(cached.slice(-(MAX_BREAKPOINTS - (conversationBreakpoint ? 1 : 0))));

  return {
    model: ANTHROPIC_MODEL,
    max_tokens: outputTokens(req),
    output_config: { effort: req.effort ?? DEFAULT_EFFORT },
    ...(system.length
      ? {
          system: system.map((b, i) => ({
            type: 'text' as const,
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
            input_schema: t.parameters as Anthropic.Tool.InputSchema,
          })),
        }
      : {}),
  };
}

/** the reply's limit plus room for the thinking Haiku 5.5 always does first */
export const outputTokens = (req: ProviderRequest) =>
  req.maxTokens + THINKING_HEADROOM[req.effort ?? DEFAULT_EFFORT];

function providerError(id: string, err: unknown): unknown {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError(`${id}: timeout`, { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError(`${id}: ${err.message}`, { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.APIError && err.status !== undefined) {
    const retryAfter = err.headers ? retryAfterMs(err.headers) : undefined;
    const request = err.requestID ? ` (${err.requestID})` : '';
    return new ProviderError(`${id} ${err.message.slice(0, 300)}${request}`, {
      status: err.status,
      cause: err,
      ...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
    });
  }
  return err;
}

export function anthropicAdapter(opts: AnthropicAdapterOpts): ProviderAdapter {
  const id = opts.id ?? 'anthropic';
  const client = anthropicClient({
    apiKey: opts.apiKey,
    // the gateway's signal carries the route's timeout; this only keeps the SDK from refusing a
    // large max_tokens without streaming
    timeoutMs: opts.timeoutMs ?? 10 * 60_000,
    maxRetries: 0,
    ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return {
    id,
    outputTokens,
    async generate(req, signal): Promise<ModelResponse> {
      const t0 = Date.now();
      let msg: Anthropic.Message;
      try {
        msg = await client.messages.create(anthropicBody(req, opts), { signal });
      } catch (err) {
        // the gateway tells a timeout from a hedge's abort by the signal's reason
        if (signal.aborted) throw signal.reason ?? err;
        throw providerError(id, err);
      }
      // the provider answered and declined: not its health, so the gateway tries the next route
      const refusal = refusalOf(msg);
      if (refusal) throw new ProviderError(`${id}: ${refusal}`, { retryable: false });

      const toolCalls: ToolCall[] = [];
      let text = '';
      for (const b of msg.content) {
        if (b.type === 'text') text += b.text;
        else if (b.type === 'tool_use') {
          toolCalls.push({ id: b.id, name: b.name, args: (b.input ?? {}) as Json });
        }
      }
      const u = msg.usage;
      const usage = {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      };
      const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
      return {
        text,
        toolCalls,
        // priced here, not by the route: the route's model and price may name another model
        usage: {
          ...usage,
          costUsd: costUsd(
            usage,
            prompt > LONG_PROMPT_TOKENS ? ANTHROPIC_LONG_PRICING : ANTHROPIC_PRICING,
          ),
        },
        provider: id,
        model: msg.model || ANTHROPIC_MODEL,
        latencyMs: Date.now() - t0,
        finish:
          msg.stop_reason === 'tool_use'
            ? 'tool_calls'
            : msg.stop_reason === 'max_tokens' ||
                msg.stop_reason === 'model_context_window_exceeded'
              ? 'length'
              : 'stop',
      };
    },
  };
}

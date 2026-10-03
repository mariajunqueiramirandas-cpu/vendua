import type { Span, SpanAttributes, Telemetry } from '../ports.ts';

// GenAI spans go through these adapters (the OpenTelemetry GenAI conventions are still marked
// Development). Spans carry metadata only: content and personal data stay in the log, under RLS.

const KEY = /^(?:gen_ai|vendua)\./;
const MAX_STRING = 200;

/** Keeps `gen_ai.*` and `vendua.*` keys with short values; drops everything else. */
export function metadataOnly(attrs: SpanAttributes): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || !KEY.test(k)) continue;
    if (typeof v === 'string' && v.length > MAX_STRING) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/** The error's type only: messages can quote a shopper or a tool's input. */
export function errorType(e: unknown): string {
  if (e instanceof Error) return e.name || 'Error';
  return typeof e;
}

const noopSpan: Span = { setAttributes: () => {}, end: () => {} };

export const noopTelemetry: Telemetry = { span: () => noopSpan };

export interface RecordedSpan {
  id: number;
  name: string;
  attrs: Record<string, string | number | boolean>;
  parent: number | null;
  startedAt: number;
  durationMs: number | null;
  error: string | null;
  ended: boolean;
}

export interface MemoryTelemetry extends Telemetry {
  readonly spans: RecordedSpan[];
  named(name: string): RecordedSpan[];
  parentOf(s: RecordedSpan): RecordedSpan | null;
}

/** Records spans for tests; attributes go through the same metadata filter as export. */
export function memoryTelemetry(now: () => number = () => performance.now()): MemoryTelemetry {
  const spans: RecordedSpan[] = [];
  const ids = new WeakMap<Span, number>();
  return {
    spans,
    named: (name) => spans.filter((s) => s.name === name),
    parentOf: (s) => (s.parent === null ? null : (spans.find((x) => x.id === s.parent) ?? null)),
    span(name, attrs, parent) {
      const rec: RecordedSpan = {
        id: spans.length + 1,
        name,
        attrs: metadataOnly(attrs),
        parent: parent ? (ids.get(parent) ?? null) : null,
        startedAt: now(),
        durationMs: null,
        error: null,
        ended: false,
      };
      spans.push(rec);
      const span: Span = {
        setAttributes: (a) => Object.assign(rec.attrs, metadataOnly(a)),
        end: (error) => {
          if (rec.ended) return;
          rec.ended = true;
          rec.durationMs = now() - rec.startedAt;
          if (error !== undefined) rec.error = errorType(error);
        },
      };
      ids.set(span, rec.id);
      return span;
    },
  };
}

// ── OpenTelemetry, duck-typed: no dependency on @opentelemetry packages ─────

export interface OtelSpanLike {
  setAttribute(key: string, value: string | number | boolean): unknown;
  setAttributes?(attrs: Record<string, string | number | boolean>): unknown;
  recordException(exception: { name: string; message: string }): unknown;
  setStatus(status: { code: number; message?: string }): unknown;
  end(): unknown;
}

export interface OtelTracerLike {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean>; kind?: number },
    context?: unknown,
  ): OtelSpanLike;
}

export interface OtelOpts {
  /**
   * Builds the parent context for a child span, e.g.
   * `(parent) => trace.setSpan(context.active(), parent)`. Without it children are started in
   * the active context.
   */
  contextWith?: (parent: OtelSpanLike) => unknown;
}

const SPAN_KIND_INTERNAL = 0;
const STATUS_ERROR = 2;

/** Exports the runtime's spans to an OpenTelemetry tracer the host configured. */
export function otelTelemetry(tracer: OtelTracerLike, opts: OtelOpts = {}): Telemetry {
  const inner = new WeakMap<Span, OtelSpanLike>();
  return {
    span(name, attrs, parent) {
      const p = parent ? inner.get(parent) : undefined;
      const ctx = p && opts.contextWith ? opts.contextWith(p) : undefined;
      const os = tracer.startSpan(
        name,
        { attributes: metadataOnly(attrs), kind: SPAN_KIND_INTERNAL },
        ctx,
      );
      let ended = false;
      const span: Span = {
        setAttributes: (a) => {
          const m = metadataOnly(a);
          if (os.setAttributes) os.setAttributes(m);
          else for (const [k, v] of Object.entries(m)) os.setAttribute(k, v);
        },
        end: (error) => {
          if (ended) return;
          ended = true;
          if (error !== undefined) {
            const type = errorType(error);
            os.setAttribute('error.type', type);
            os.recordException({ name: type, message: type });
            os.setStatus({ code: STATUS_ERROR, message: type });
          }
          os.end();
        },
      };
      inner.set(span, os);
      return span;
    },
  };
}

/** One line per ended span, for hosts with no trace backend yet (ADR 0030 open decision 4). */
export function logTelemetry(
  log: (line: string, data: Record<string, unknown>) => void,
  now: () => number = () => performance.now(),
): Telemetry {
  return {
    span(name, attrs) {
      const t0 = now();
      const rec = metadataOnly(attrs);
      let ended = false;
      return {
        setAttributes: (a) => Object.assign(rec, metadataOnly(a)),
        end: (error) => {
          if (ended) return;
          ended = true;
          const ms = Math.round(now() - t0);
          const err = error !== undefined ? errorType(error) : null;
          const kv = Object.entries(rec)
            .map(
              ([k, v]) => `${k}=${typeof v === 'string' && /\s/.test(v) ? JSON.stringify(v) : v}`,
            )
            .join(' ');
          log(`span ${name} ${ms}ms${err ? ` error=${err}` : ''}${kv ? ` ${kv}` : ''}`, {
            span: name,
            durationMs: ms,
            ...(err ? { error: err } : {}),
            ...rec,
          });
        },
      };
    },
  };
}

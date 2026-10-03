import type { AgentEvent, Card, ChatMessage, Json, JsonObject, ToolCall, Usage } from '../types.ts';
import { ZERO_USAGE, addUsage } from '../types.ts';

export interface Figure {
  id: string;
  /** Core's value, e.g. cents for money. */
  value: Json;
  /** Core's formatting, what the shopper reads. */
  text: string;
  kind: 'money' | 'time' | 'duration' | 'product' | 'count' | 'text';
  sourceSeq: number;
}

export interface TranscriptEntry {
  seq: number;
  turnId: string | null;
  step: string | null;
  message: ChatMessage;
  /** An assistant text that reached the shopper. */
  sent?: boolean;
}

export interface MemoryView {
  key: string;
  value: Json;
  sensitive: boolean;
}

/** The runtime's fold of an actor's log. Agents add their own under `custom`. */
export interface ConversationState {
  turns: number;
  transcript: TranscriptEntry[];
  summary: string | null;
  compactedThroughSeq: number;
  /** Inbound mailbox ids already in the transcript, so a re-taken batch isn't repeated. */
  seenInputs: string[];
  chart: { state: string; slots: Record<string, Json> };
  ledger: Record<string, Figure>;
  aliases: Record<string, { kind: string; id: string }>;
  aliasCounters: Record<string, number>;
  externals: Record<string, Json>;
  /** Cards tools attached that ride on the next reply. */
  pendingCards: Card[];
  loadedSkills: string[];
  owner: 'agent' | 'human';
  handoffReason: string | null;
  lastInputAt: string | null;
  lastReplyAt: string | null;
  repliedSinceLastInput: boolean;
  /** Guard blocks in the current turn; escalation rules read it. */
  guardBlocks: number;
  openTurn: { id: string; version: string; batch: string[]; startSeq: number } | null;
  lastTurnEndedAt: string | null;
  usage: Usage;
  context: { tenant: Json; subject: Json; tenantHash: string; subjectHash: string };
  memory: MemoryView[];
  custom: Json;
}

export interface BatchItem {
  id: string;
  kind: string;
  source: string;
  payload: Json;
  /** The input as the model reads it, built by the definition when the turn started. */
  input: ChatMessage | null;
}

export function initialState(chartInitial: string, custom: Json): ConversationState {
  return {
    turns: 0,
    transcript: [],
    summary: null,
    compactedThroughSeq: 0,
    seenInputs: [],
    chart: { state: chartInitial, slots: {} },
    ledger: {},
    aliases: {},
    aliasCounters: {},
    externals: {},
    pendingCards: [],
    loadedSkills: [],
    owner: 'agent',
    handoffReason: null,
    lastInputAt: null,
    lastReplyAt: null,
    repliedSinceLastInput: true,
    guardBlocks: 0,
    openTurn: null,
    lastTurnEndedAt: null,
    usage: ZERO_USAGE,
    context: { tenant: null, subject: null, tenantHash: '', subjectHash: '' },
    memory: [],
    custom,
  };
}

const SEEN_INPUTS_KEPT = 200;

function obj(p: Json): JsonObject {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

function str(v: Json | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

function push(s: ConversationState, e: AgentEvent, message: ChatMessage): void {
  s.transcript.push({ seq: e.seq, turnId: e.turnId, step: e.step, message });
}

/** Folds one event into the runtime state, mutating `s`. Unknown types are ignored. */
export function applyEvent(s: ConversationState, e: AgentEvent): void {
  const p = obj(e.payload);
  switch (e.type) {
    case 'turn.started': {
      const batch = (Array.isArray(p.batch) ? p.batch : []) as unknown as BatchItem[];
      s.turns += 1;
      s.guardBlocks = 0;
      s.openTurn = {
        id: e.turnId ?? '',
        version: e.version,
        batch: batch.map((b) => b.id),
        startSeq: e.seq,
      };
      let sawInput = false;
      for (const b of batch) {
        if (s.seenInputs.includes(b.id)) continue;
        s.seenInputs.push(b.id);
        if (b.input) {
          push(s, e, b.input);
          sawInput = true;
        }
      }
      if (s.seenInputs.length > SEEN_INPUTS_KEPT)
        s.seenInputs.splice(0, s.seenInputs.length - SEEN_INPUTS_KEPT);
      if (sawInput) {
        s.repliedSinceLastInput = false;
        s.lastInputAt = e.at.toISOString();
      }
      break;
    }
    case 'context.loaded': {
      if ('tenant' in p) s.context.tenant = p.tenant ?? null;
      if ('subject' in p) s.context.subject = p.subject ?? null;
      s.context.tenantHash = str(p.tenantHash) ?? s.context.tenantHash;
      s.context.subjectHash = str(p.subjectHash) ?? s.context.subjectHash;
      if (Array.isArray(p.memory)) s.memory = p.memory as unknown as MemoryView[];
      break;
    }
    case 'model.responded': {
      const out = obj(p.output ?? null);
      const toolCalls = (Array.isArray(out.toolCalls)
        ? out.toolCalls
        : []) as unknown as ToolCall[];
      push(s, e, { role: 'assistant', text: str(out.text) ?? '', toolCalls });
      if (p.usage) s.usage = addUsage(s.usage, p.usage as unknown as Usage);
      break;
    }
    case 'tool.returned': {
      push(s, e, {
        role: 'tool',
        callId: str(p.callId) ?? '',
        name: str(p.name) ?? '',
        content: str(p.content) ?? '',
        isError: p.ok === false,
      });
      break;
    }
    case 'guard.blocked': {
      s.guardBlocks += 1;
      // a blocked tool call answers its call id; a blocked bare reply needs a note the model reads
      if (typeof p.callId === 'string') {
        push(s, e, {
          role: 'tool',
          callId: p.callId,
          name: str(p.tool) ?? 'reply',
          content: `BLOQUEADO (${str(p.guard) ?? 'guard'}): ${str(p.feedback) ?? ''}`,
          isError: true,
        });
      } else {
        push(s, e, {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: `[runtime] Sua última resposta não foi enviada (${str(p.guard) ?? 'guard'}): ${str(p.feedback) ?? ''}`,
            },
          ],
        });
      }
      break;
    }
    case 'ledger.recorded': {
      const figures = (Array.isArray(p.figures) ? p.figures : []) as unknown as Omit<
        Figure,
        'sourceSeq'
      >[];
      for (const f of figures) s.ledger[f.id] = { ...f, sourceSeq: e.seq };
      break;
    }
    case 'alias.assigned': {
      const alias = str(p.alias);
      const kind = str(p.kind);
      const id = str(p.id);
      if (alias && kind && id) {
        s.aliases[alias] = { kind, id };
        const n = Number(alias.replace(/^\D+/, ''));
        const prefix = alias.replace(/\d+$/, '');
        if (Number.isFinite(n)) s.aliasCounters[prefix] = Math.max(s.aliasCounters[prefix] ?? 0, n);
      }
      break;
    }
    case 'external.recorded': {
      const key = str(p.key);
      if (key) s.externals[key] = p.result ?? null;
      break;
    }
    case 'card.attached': {
      if (p.card && typeof p.card === 'object') s.pendingCards.push(p.card as unknown as Card);
      break;
    }
    case 'message.sent': {
      s.pendingCards = [];
      const modelStep = str(p.modelStep);
      if (modelStep)
        for (const t of s.transcript)
          if (t.turnId === e.turnId && t.step === modelStep) t.sent = true;
      s.repliedSinceLastInput = true;
      s.lastReplyAt = e.at.toISOString();
      break;
    }
    case 'state.changed': {
      const to = str(p.to);
      if (to) s.chart.state = to;
      break;
    }
    case 'slot.set': {
      const name = str(p.name);
      if (name) {
        if (p.value === null) delete s.chart.slots[name];
        else s.chart.slots[name] = p.value ?? null;
      }
      break;
    }
    case 'skill.loaded': {
      const id = str(p.id);
      if (id && !s.loadedSkills.includes(id)) s.loadedSkills.push(id);
      break;
    }
    case 'handoff.started': {
      s.owner = 'human';
      s.handoffReason = str(p.reason);
      break;
    }
    case 'handoff.ended': {
      s.owner = 'agent';
      s.handoffReason = null;
      break;
    }
    case 'memory.accepted': {
      const key = str(p.key);
      if (key) {
        s.memory = s.memory.filter((m) => m.key !== key);
        s.memory.push({ key, value: p.value ?? null, sensitive: p.sensitive === true });
      }
      break;
    }
    case 'memory.forgotten': {
      const key = str(p.key);
      if (key) s.memory = s.memory.filter((m) => m.key !== key);
      break;
    }
    case 'memory.compacted': {
      const through = typeof p.throughSeq === 'number' ? p.throughSeq : 0;
      s.summary = str(p.summary);
      s.compactedThroughSeq = through;
      s.transcript = s.transcript.filter((t) => t.seq > through);
      break;
    }
    case 'turn.superseded':
    case 'turn.ended':
    case 'turn.failed': {
      s.openTurn = null;
      s.lastTurnEndedAt = e.at.toISOString();
      if (e.type !== 'turn.ended') {
        // the model must not believe it said what never reached the shopper
        for (const t of s.transcript)
          if (t.turnId === e.turnId && t.message.role === 'assistant' && !t.sent && t.message.text)
            t.message = { ...t.message, text: '' };
      }
      if (e.type === 'turn.failed') s.repliedSinceLastInput = true;
      break;
    }
  }
}

/** Calls in assistant messages that never got a result (a superseded turn, a crash). */
export function danglingCalls(transcript: TranscriptEntry[]): ToolCall[] {
  const answered = new Set<string>();
  for (const t of transcript) if (t.message.role === 'tool') answered.add(t.message.callId);
  const out: ToolCall[] = [];
  for (const t of transcript)
    if (t.message.role === 'assistant')
      for (const c of t.message.toolCalls) if (!answered.has(c.id)) out.push(c);
  return out;
}

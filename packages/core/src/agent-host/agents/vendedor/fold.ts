import {
  defineGuard,
  type AgentEvent,
  type ChatMessage,
  type ConversationState,
  type InputGuard,
  type Json,
  type JsonObject,
} from '@vendua/agent-runtime';
import type { CartBrief } from './shared.ts';

// The Vendedor's own fold over the log: what Core showed of the cart, who spoke last, whether a
// proactive touch is owed, and what this turn found the menu lacking. Kinds of mailbox rows it
// reads (all written by `dispatchTx`):
//   message.inbound   a shopper's message, already turned into text by the ingest
//   merchant.message  the store answered (typed on the phone or in the admin)
//   timer.slow        "quando eu demorar" ran out; timer.handback the store's window lapsed
//   timer.recovery    a sacola stopped; timer.pix_expired; timer.back_in_stock
//   webhook.order     an order of this thread changed state
//   presence.typing   the shopper is typing or recording (only extends the quiet window)

export const PROACTIVE = ['timer.recovery', 'timer.pix_expired', 'timer.back_in_stock'] as const;
export const INPUT_KINDS = ['message.inbound', 'merchant.message'] as const;

export interface VendedorCustom {
  cart: CartBrief | null;
  lastShopperAt: string | null;
  lastMerchantAt: string | null;
  proactive: string | null;
  order: { id: string; number: number; state: string } | null;
  suggestion: { offered: string | null; declined: string[] };
  turnId: string | null;
  demand: { kind: 'unmet' | 'out_of_zone'; term: string }[];
  knowledgeUsed: string[];
  verifierBlocks: number;
  /** a tool handed the thread to the store in this turn; the end hook moves the floor */
  handoff: { turnId: string; reason: string } | null;
}

export const INITIAL: VendedorCustom = {
  cart: null,
  lastShopperAt: null,
  lastMerchantAt: null,
  proactive: null,
  order: null,
  suggestion: { offered: null, declined: [] },
  turnId: null,
  demand: [],
  knowledgeUsed: [],
  verifierBlocks: 0,
  handoff: null,
};

const obj = (v: Json | undefined): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};

const later = (a: string | null, b: string) => (!a || b > a ? b : a);

export function custom(s: Readonly<ConversationState>): VendedorCustom {
  return { ...INITIAL, ...(s.custom as unknown as Partial<VendedorCustom>) };
}

export function applyCustom(prev: Json, e: AgentEvent): Json {
  const c: VendedorCustom = structuredClone({
    ...INITIAL,
    ...(prev as unknown as Partial<VendedorCustom>),
  });
  const p = obj(e.payload);
  switch (e.type) {
    case 'turn.started': {
      c.turnId = e.turnId;
      c.demand = [];
      c.knowledgeUsed = [];
      for (const b of (Array.isArray(p.batch) ? p.batch : []) as JsonObject[]) {
        const at =
          typeof obj(b.payload).at === 'string' ? String(obj(b.payload).at) : e.at.toISOString();
        if (b.kind === 'message.inbound') c.lastShopperAt = later(c.lastShopperAt, at);
        else if (b.kind === 'merchant.message') c.lastMerchantAt = later(c.lastMerchantAt, at);
        else if ((PROACTIVE as readonly string[]).includes(String(b.kind)))
          c.proactive = String(b.kind);
        else if (b.kind === 'webhook.order') {
          const o = obj(b.payload);
          if (typeof o.orderId === 'string' && typeof o.number === 'number')
            c.order = { id: o.orderId, number: o.number, state: String(o.state ?? '') };
        }
      }
      break;
    }
    case 'context.loaded': {
      const subj = obj(p.subject);
      if (subj.cart && typeof subj.cart === 'object') c.cart = subj.cart as unknown as CartBrief;
      if (subj.order && typeof subj.order === 'object')
        c.order = subj.order as unknown as VendedorCustom['order'];
      break;
    }
    case 'tool.returned': {
      if (p.ok !== true) break;
      const d = obj(p.data);
      if (d.cart && typeof d.cart === 'object') c.cart = d.cart as unknown as CartBrief;
      if (d.demand && typeof d.demand === 'object')
        c.demand.push(d.demand as unknown as VendedorCustom['demand'][number]);
      if (Array.isArray(d.knowledgeIds)) c.knowledgeUsed.push(...(d.knowledgeIds as string[]));
      if (d.order && typeof d.order === 'object') {
        c.order = d.order as unknown as VendedorCustom['order'];
        c.suggestion = { offered: null, declined: [] };
      }
      if (typeof d.suggested === 'string') c.suggestion.offered = d.suggested;
      const h = obj(d.handoff);
      if (typeof h.reason === 'string' && e.turnId)
        c.handoff = { turnId: e.turnId, reason: h.reason };
      if (typeof d.declined === 'string' && !c.suggestion.declined.includes(d.declined))
        c.suggestion.declined.push(d.declined);
      break;
    }
    case 'guard.blocked':
      if (p.stage === 'output') c.verifierBlocks += 1;
      break;
    case 'message.sent':
      c.proactive = null;
      break;
  }
  return c as unknown as Json;
}

/** Floors where it writes (see `vendedor/floor.ts`). */
const writes = (f: unknown) => f === 'agent' || f === 'rehearsal';

/**
 * Done when someone else holds the floor, or when the shopper's last message has an answer
 * (its own reply, or the store's). A proactive touch is owed until it's sent.
 */
export function finished(s: Readonly<ConversationState>): boolean {
  if (!writes(obj(s.context.subject as Json).floor)) return true;
  const c = custom(s);
  if (c.proactive) return false;
  if (!c.lastShopperAt) return true;
  if (s.lastReplyAt && s.lastReplyAt >= c.lastShopperAt) return true;
  return !!c.lastMerchantAt && c.lastMerchantAt >= c.lastShopperAt;
}

/** What the shopper sent (untrusted: their words, a transcript, what a photo shows) and Core's notes on it. */
function inbound(p: JsonObject): { said: string; notes: string[] } {
  const kind = String(p.kind ?? 'text');
  const text = typeof p.text === 'string' ? p.text : '';
  const said: string[] = [];
  const notes: string[] = [];
  if (typeof p.quoted === 'string' && p.quoted)
    said.push(`(respondendo a: "${p.quoted.slice(0, 200)}")`);
  switch (kind) {
    case 'audio': {
      const conf = typeof p.confidence === 'number' ? p.confidence : null;
      if (typeof p.transcript === 'string' && p.transcript) {
        said.push(p.transcript);
        notes.push(
          conf !== null && conf < 0.7
            ? 'Mensagem de áudio, transcrição incerta: confirme o que entendeu antes de seguir.'
            : 'Mensagem de áudio (transcrita).',
        );
      } else notes.push('Áudio que não deu para entender: peça para escrever ou mandar de novo.');
      break;
    }
    case 'image':
      if (typeof p.description === 'string') said.push(`(foto) ${p.description}`);
      if (text) said.push(text);
      notes.push(
        `O cliente mandou uma foto.${
          Array.isArray(p.candidates) && p.candidates.length
            ? ` Parecidos no cardápio: ${(p.candidates as string[]).join(', ')} (confirme com o cliente).`
            : ''
        }${p.receipt === true ? ' Parece um comprovante: nunca é prova de pagamento.' : ''}`,
      );
      break;
    case 'location':
      notes.push('O cliente mandou a localização: use quote_delivery com use_pin.');
      break;
    case 'sticker':
      notes.push('O cliente mandou uma figurinha.');
      break;
    case 'reaction':
      notes.push(`O cliente reagiu com ${typeof p.emoji === 'string' ? p.emoji : 'um emoji'}.`);
      break;
    case 'document':
    case 'contact':
    case 'video':
      notes.push(
        `O cliente mandou ${kind === 'document' ? 'um documento' : kind === 'contact' ? 'um contato' : 'um vídeo'}: você não abre isso; se parecer importante, passe para a loja.`,
      );
      if (text) said.push(text);
      break;
    default:
      said.push(text);
  }
  // nothing the shopper writes can pass for Core's own notes
  return { said: said.join('\n').replace(/^\s*\[sistema\]/gim, '[sistema?]'), notes };
}

export function toInput(
  msg: { kind: string; source: string; payload: Json },
  s: Readonly<ConversationState>,
): ChatMessage | null {
  const p = obj(msg.payload);
  const sys = (text: string): ChatMessage => ({
    role: 'user',
    parts: [{ type: 'text', text: `[sistema] ${text}` }],
  });
  switch (msg.kind) {
    case 'message.inbound': {
      const { said, notes } = inbound(p);
      return {
        role: 'user',
        parts: [
          ...(said ? [{ type: 'text' as const, text: said }] : []),
          ...notes.map((n) => ({ type: 'text' as const, text: `[sistema] ${n}` })),
        ],
      };
    }
    case 'merchant.message':
      return {
        role: 'user',
        parts: [
          {
            type: 'text',
            text: (typeof p.text === 'string' ? p.text : '').replace(
              /^\s*\[sistema\]/gim,
              '[sistema?]',
            ),
          },
        ],
      };
    case 'timer.recovery':
      return sys(
        'A sacola deste cliente parou. Mande UMA mensagem curta e gentil lembrando, sem pressionar. Se a loja permitir, você pode usar offer_incentive com motivo recovery.',
      );
    case 'timer.pix_expired':
      return sys(
        `O Pix do pedido #${String(p.number ?? '')} expirou sem pagamento. Ofereça um código novo com send_pix, uma vez só.`,
      );
    case 'timer.back_in_stock':
      return sys(
        `${String(p.name ?? 'O produto')} que o cliente pediu para avisar voltou ao cardápio. Avise em uma mensagem curta.`,
      );
    case 'webhook.order':
      return sys(
        `Pedido #${String(p.number ?? '')}: ${String(p.label ?? p.state ?? '')}. A loja já avisa o cliente; não repita.`,
      );
    case 'timer.slow':
    case 'timer.handback':
    case 'presence.typing':
    case 'runtime.handback':
      return null;
    default:
      void s;
      return null;
  }
}

/** Shopper and store text enter as data, fenced apart; the base rules say never to obey them. */
export const fenceInput: InputGuard = defineGuard({
  id: 'fence_input',
  stage: 'input',
  run: (parts, ctx) =>
    parts.map((part) => {
      if (part.type !== 'text' || part.text.startsWith('[sistema] ')) return part;
      const tag =
        ctx.kind === 'message.inbound'
          ? 'mensagem_do_cliente'
          : ctx.kind === 'merchant.message'
            ? 'mensagem_da_loja'
            : null;
      if (!tag) return part;
      const clean = part.text.replaceAll(`</${tag}>`, '').replaceAll(`<${tag}>`, '');
      return { ...part, text: `<${tag}>\n${clean}\n</${tag}>` };
    }),
});

import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type CaixaDetail,
  type PdvDiscountIn,
  type PdvLineIn,
  type PdvQuote,
  type PdvState,
  type TabDetail,
} from '../../lib/api.ts';
import { usePollWhenOffline } from '../../lib/live.ts';
import { qk } from '../../lib/query.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { payError } from '../../ui/PaymentChip.tsx';

// The PDV's data: Core's state (caixa, tables, open comandas), its quotes and the ticket the
// counter is ringing up. The ticket holds only what was picked; every figure is Core's.

export function usePdvState() {
  const poll = usePollWhenOffline(30_000, 5 * 60_000);
  return useQuery({ queryKey: qk.pdv.state, queryFn: api.pdv.state, refetchInterval: poll });
}

export function useCaixa() {
  return useQuery({
    queryKey: qk.pdv.caixa,
    queryFn: api.pdv.caixa,
    select: (d) => d.caixa,
  });
}

export function useTab(id: string, ways = 0) {
  const poll = usePollWhenOffline(30_000);
  return useQuery({
    queryKey: qk.pdv.tab(id, ways),
    queryFn: () => api.pdv.tab(id, ways || undefined),
    select: (d) => d.tab,
    refetchInterval: poll,
    ...(ways ? { placeholderData: keepPreviousData } : {}),
  });
}

/** A write answered with the comanda: show it now, and let the lists catch up. */
export function putTab(qc: QueryClient, tab: TabDetail) {
  qc.setQueryData(qk.pdv.tab(tab.id), { tab: { ...tab, split: null } });
  void qc.invalidateQueries({ queryKey: ['pdv', 'tab', tab.id] });
  void qc.invalidateQueries({ queryKey: qk.pdv.state });
}

export function putCaixa(qc: QueryClient, caixa: CaixaDetail | null) {
  qc.setQueryData(qk.pdv.caixa, { caixa });
  qc.setQueryData<PdvState>(qk.pdv.state, (s) => (s ? { ...s, caixa } : s));
  void qc.invalidateQueries({ queryKey: ['pdv'] });
}

// ── the ticket ─────────────────────────────────────────────────────────────

export interface PickedLine {
  key: string;
  productId: string;
  /** the name as picked, shown until Core's quote names the line */
  name: string;
  qty: number;
  modifiers: { id: string; qty: number; name: string }[];
  combo: { slotId: string; productId: string; qty: number; name: string }[];
  note: string;
}

export const toLineIn = (l: PickedLine): PdvLineIn => ({
  productId: l.productId,
  qty: l.qty,
  ...(l.modifiers.length ? { modifiers: l.modifiers.map((m) => ({ id: m.id, qty: m.qty })) } : {}),
  ...(l.combo.length
    ? {
        comboSelections: l.combo.map((c) => ({
          slotId: c.slotId,
          productId: c.productId,
          qty: c.qty,
        })),
      }
    : {}),
  ...(l.note.trim() ? { note: l.note.trim() } : {}),
});

const sameChoice = (a: PickedLine, b: Omit<PickedLine, 'key' | 'qty'>) =>
  a.productId === b.productId &&
  !a.note &&
  !b.note &&
  JSON.stringify(a.modifiers.map((m) => [m.id, m.qty])) ===
    JSON.stringify(b.modifiers.map((m) => [m.id, m.qty])) &&
  JSON.stringify(a.combo.map((c) => [c.slotId, c.productId, c.qty])) ===
    JSON.stringify(b.combo.map((c) => [c.slotId, c.productId, c.qty]));

const read = (key: string): PickedLine[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as PickedLine[]) : [];
  } catch {
    return [];
  }
};

/** What's being rung up, kept on this device (a reload or a trip to the caixa loses nothing). */
export function useTicket(storageKey: string) {
  const [lines, setLines] = useState<PickedLine[]>(() => read(storageKey));
  useEffect(() => setLines(read(storageKey)), [storageKey]);
  useEffect(() => {
    try {
      if (lines.length) localStorage.setItem(storageKey, JSON.stringify(lines));
      else localStorage.removeItem(storageKey);
    } catch {
      /* private mode: the ticket lives in memory only */
    }
  }, [lines, storageKey]);

  const add = useCallback((l: Omit<PickedLine, 'key'>) => {
    setLines((ls) => {
      const i = ls.findIndex((x) => sameChoice(x, l));
      if (i >= 0)
        return ls.map((x, j) => (j === i ? { ...x, qty: Math.min(99, x.qty + l.qty) } : x));
      if (ls.length >= 100) return ls;
      return [...ls, { ...l, key: crypto.randomUUID() }];
    });
  }, []);
  const setQty = useCallback(
    (key: string, qty: number) =>
      setLines((ls) =>
        qty <= 0
          ? ls.filter((l) => l.key !== key)
          : ls.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)),
      ),
    [],
  );
  const setNote = useCallback(
    (key: string, note: string) =>
      setLines((ls) => ls.map((l) => (l.key === key ? { ...l, note: note.slice(0, 140) } : l))),
    [],
  );
  const remove = useCallback(
    (key: string) => setLines((ls) => ls.filter((l) => l.key !== key)),
    [],
  );
  const clear = useCallback(() => setLines([]), []);
  const restore = useCallback((ls: PickedLine[]) => setLines(ls), []);
  return { lines, add, setQty, setNote, remove, clear, restore };
}
export type Ticket = ReturnType<typeof useTicket>;

function useDebounced<T>(v: T, ms: number) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Core prices the ticket (POST /pdv/quote) a beat after the last tap; the screen only shows it. */
export function useQuote(lines: PickedLine[], discount: PdvDiscountIn | null) {
  const body = useMemo(
    () => JSON.stringify({ lines: lines.map(toLineIn), ...(discount ? { discount } : {}) }),
    [lines, discount],
  );
  const asked = useDebounced(body, 250);
  const q = useQuery({
    queryKey: qk.pdvQuote(asked),
    queryFn: () => api.pdv.quote(JSON.parse(asked) as Parameters<typeof api.pdv.quote>[0]),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  const quote: PdvQuote | null = lines.length ? (q.data?.quote ?? null) : null;
  // the total on screen is the one for these exact lines (a sale is refused on any other)
  const fresh = !!quote && asked === body && !q.isPlaceholderData && !q.error;
  const err = lines.length && asked === body ? q.error : null;
  const line =
    err instanceof ApiError && typeof err.details?.line === 'number' ? err.details.line : null;
  return {
    quote,
    fresh,
    body,
    pending: lines.length > 0 && !fresh && !err,
    error: err,
    errorLine: line,
    refetch: q.refetch,
  };
}

export function usePutQuote() {
  const qc = useQueryClient();
  return (body: string, quote: PdvQuote) => qc.setQueryData(qk.pdvQuote(body), { quote });
}

// ── words for Core's answers ───────────────────────────────────────────────

const PDV_ERRORS: Record<string, string> = {
  CAIXA_CLOSED: 'O caixa está fechado. Abra o caixa para receber.',
  CAIXA_OPEN: 'Já tem um caixa aberto. A tela foi atualizada.',
  PRICES_CHANGED: 'Os preços mudaram agora há pouco. Confira o novo total e cobre de novo.',
  PAYMENT_MISMATCH: 'Os pagamentos não fecham com o total. Confira os valores.',
  INVALID_PAYMENT:
    'Confira o pagamento: valor maior que zero, e o recebido em dinheiro cobrindo o valor.',
  ALREADY_PAID: 'Esse pedido já está pago.',
  PAYMENT_ONLINE: 'Esse pedido é pago pelo Mercado Pago: não se recebe no caixa.',
  ORDER_ON_TAB: 'Esse pedido é de uma comanda: receba pela comanda.',
  TABLE_BUSY: 'Essa mesa já tem uma comanda aberta.',
  TABLE_LABEL_TAKEN: 'Já existe uma mesa com esse nome.',
  TOO_MANY_TABLES: 'Chegou ao limite de mesas da loja.',
  OVERPAY: 'O valor passa do que falta na comanda.',
  TAB_UNPAID: 'Ainda falta receber nessa comanda.',
  TAB_OVERPAID:
    'A comanda ficaria paga a mais. Um gerente estorna um pagamento e você recebe o valor certo.',
  PAYMENT_PDV: 'Esse pedido foi pago no caixa: o pagamento é do caixa.',
  TAB_HAS_PAYMENTS: 'Essa comanda já tem pagamentos: estorne eles antes de cancelar.',
  PAYMENT_LOCKED: 'Esse pagamento não pode mais ser estornado: a comanda já fechou.',
  TAB_CLOSED: 'Essa comanda já foi fechada. A tela foi atualizada.',
  INSUFFICIENT_CASH: 'Não tem tanto dinheiro na gaveta para essa sangria.',
  PRODUCT_NOT_FOUND: 'Esse produto não existe mais no cardápio. Tire ele da conta.',
  SOLD_OUT: 'Esse produto está esgotado ou fora do horário agora.',
  OUT_OF_STOCK: 'Não tem estoque para essa quantidade.',
  INVALID_MODIFIER: 'As opções desse item mudaram. Tire e escolha de novo.',
  MODIFIER_REQUIRED: 'Falta escolher uma opção obrigatória desse item.',
  MODIFIER_LIMIT: 'Esse item tem opções demais escolhidas.',
  INVALID_COMBO: 'O kit mudou. Tire e escolha de novo.',
  COMBO_SLOT_COUNT: 'Falta escolher os itens do kit.',
  COMBO_ITEM_LIMIT: 'Esse kit aceita menos de um mesmo item.',
  COMBO_ITEM_SOLD_OUT: 'Um item do kit acabou. Tire e escolha de novo.',
  INVALID_QTY: 'A quantidade vai de 1 a 99.',
  INVALID_PHONE: 'Digite o celular com DDD, como (22) 99999-0000.',
  FORBIDDEN: 'Só gerentes e donos podem fazer isso.',
};

export function pdvError(e: unknown): string {
  if (e instanceof ApiError && e.status < 500 && PDV_ERRORS[e.code]) return PDV_ERRORS[e.code]!;
  return e instanceof ApiError && e.status >= 400 && e.status < 500 ? payError(e) : messageOf(e);
}

export const isCode = (e: unknown, code: string): e is ApiError =>
  e instanceof ApiError && e.code === code;

import { useCallback, useSyncExternalStore } from 'react';
import { ApiError, type TableInfo, type VenduaApi } from './api.ts';
import { showError, showInfo } from './errors.ts';

// Kernel 1.22 (ADR 0036) — the table whose QR code opened the store. The provider reads
// `?mesa=<token>` once, asks Core what it names and keeps it for the browser session
// (sessionStorage: a new visit is not at the table). Checkout reads the token; store code sees
// only `useTable()`, never the token.

const TABLE_KEY = 'vendua.table';
const TOKEN_RE = /^vqr\.[A-Za-z0-9._-]{8,196}$/;

export interface TableSession extends TableInfo {
  token: string;
}

let mem: TableSession | null = null;
let memOnly = false;
let lastRaw: string | null | undefined;
let lastParsed: TableSession | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function parse(raw: string | null): TableSession | null {
  if (raw === lastRaw) return lastParsed;
  lastRaw = raw;
  lastParsed = null;
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Record<keyof TableSession, unknown>> | null;
    if (
      v &&
      typeof v.token === 'string' &&
      TOKEN_RE.test(v.token) &&
      typeof v.label === 'string' &&
      v.label.trim()
    )
      lastParsed = {
        token: v.token,
        label: v.label.slice(0, 40),
        ordering: v.ordering === true,
        reason:
          typeof v.reason === 'string' ? (v.reason.slice(0, 20) as TableInfo['reason']) : null,
      };
  } catch {
    /* a malformed copy reads as no table */
  }
  return lastParsed;
}

/** The table this tab is at (null = none). */
export function currentTable(): TableSession | null {
  if (memOnly) return mem;
  try {
    return parse(globalThis.sessionStorage?.getItem(TABLE_KEY) ?? null);
  } catch {
    return mem;
  }
}

export function setTable(t: TableSession | null) {
  mem = t;
  try {
    const s = globalThis.sessionStorage;
    if (!s) throw new Error('no storage');
    if (t) s.setItem(TABLE_KEY, JSON.stringify(t));
    else s.removeItem(TABLE_KEY);
    memOnly = false;
  } catch {
    // private mode: the table lasts for this page
    memOnly = true;
  }
  notify();
}

export const isTableToken = (t: string) => TOKEN_RE.test(t);

/** "Mesa 5" from a bare number; the store's own label otherwise ("Varanda 2"). */
export function tableName(label: string): string {
  const l = label.trim();
  return /^\d+$/.test(l) ? `Mesa ${l}` : l;
}

/** Why a table can't take an order right now, in words (null = it can). */
export function tableHint(t: TableInfo): string | null {
  if (t.ordering) return null;
  if (t.reason === 'closed')
    return 'A loja está fechada agora, então os pedidos pela mesa estão parados. O cardápio continua aqui.';
  if (t.reason === 'paused')
    return 'A loja pausou os pedidos por alguns instantes. O cardápio continua aqui.';
  return 'Esta loja não está recebendo pedidos pela mesa agora. Chame a equipe para pedir.';
}

const GONE = {
  title: 'Esse QR code não vale mais',
  body: 'Peça à equipe o QR code atual da mesa. O cardápio continua aqui.',
};

/** Boot: `?mesa=<token>` names a table — kept, stripped from the address bar, announced. Without
 *  one, a table kept earlier in this tab is asked again quietly (its state may have changed). */
export function takeTableLink(api: VenduaApi): void {
  const loc = globalThis.location;
  const asked = loc ? new URLSearchParams(loc.search).get('mesa') : null;
  const strip = () => {
    const l = globalThis.location;
    if (!l) return;
    const params = new URLSearchParams(l.search);
    if (!params.has('mesa')) return;
    params.delete('mesa');
    const rest = params.toString();
    globalThis.history?.replaceState(
      globalThis.history.state,
      '',
      `${l.pathname}${rest ? `?${rest}` : ''}${l.hash}`,
    );
  };
  const kept = currentTable();
  if (asked === null) {
    if (!kept) return;
    api.table(kept.token).then(
      ({ table }) => {
        if (currentTable()?.token === kept.token) setTable({ ...table, token: kept.token });
      },
      (err: unknown) => {
        if (err instanceof ApiError && err.status === 404 && currentTable()?.token === kept.token) {
          setTable(null);
          showInfo('table', GONE.title, GONE.body);
        }
      },
    );
    return;
  }
  const token = asked.trim();
  if (!isTableToken(token)) {
    strip();
    showInfo('table', GONE.title, GONE.body);
    return;
  }
  api.table(token).then(
    ({ table }) => {
      strip();
      setTable({ ...table, token });
      showInfo('table', `Você está na ${tableName(table.label)}`, tableHint(table) ?? undefined);
    },
    (err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
        strip();
        if (kept?.token === token) setTable(null);
        showInfo('table', GONE.title, GONE.body);
        return;
      }
      // the param stays: a reload asks again
      showError(err);
    },
  );
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const publicView = new WeakMap<TableSession, TableInfo>();
const view = (t: TableSession | null): TableInfo | null => {
  if (!t) return null;
  let v = publicView.get(t);
  if (!v) publicView.set(t, (v = { label: t.label, ordering: t.ordering, reason: t.reason }));
  return v;
};

/** The Kernel's own view, with the token (checkout sends it). */
export function useTableSession(): TableSession | null {
  return useSyncExternalStore(subscribe, currentTable, () => null);
}

/** Kernel 1.22 — the table whose QR code opened the store (ADR 0036), for this browser session:
 *  `label` ("Mesa 5"), `ordering` (false = browse only) and `reason` (`off` | `closed` |
 *  `paused`). `leave()` = "não estou na mesa": checkout goes back to delivery and pickup.
 *  Checkout itself is the Kernel's; this is read-only. */
export function useTable(): { table: TableInfo | null; leave: () => void } {
  const t = useSyncExternalStore(subscribe, currentTable, () => null);
  const leave = useCallback(() => setTable(null), []);
  return { table: view(t), leave };
}

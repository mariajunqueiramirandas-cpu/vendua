import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_TEMPLATES } from '@vendua/kernel/sdk-catalog';
import type { ComponentType } from '@vendua/templates';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type Appearance as AppearanceData,
  type PageTemplate,
  type StoreTokens,
  type TemplateSection,
} from '../../lib/api.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { messageOf } from '../../ui/feedback.tsx';
import { toast } from '../../ui/Toast.tsx';
import { readable } from './Colors.tsx';

// The page editor's state: one document (every template + the colours) with undo/redo,
// what's selected, and publishing. Edits are drafts in this tab (and in localStorage, so
// a reload or a wrong tap on the tab bar loses nothing) until "publicar".

export type PageId = 'home' | 'catalog' | 'product';
/** a template: one of the pages, or the layout every page shares (topo e rodapé) */
export type TplId = PageId | 'layout';

export const PAGES: { id: PageId; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'catalog', label: 'Cardápio' },
  { id: 'product', label: 'Produto' },
];
export const TPLS: TplId[] = ['home', 'catalog', 'product', 'layout'];
export const tplLabel = (t: TplId) =>
  t === 'layout' ? 'Topo e rodapé' : PAGES.find((p) => p.id === t)!.label;

export type Selection = { kind: 'section'; tpl: TplId; id: string } | { kind: 'style' } | null;

type Drafts = Record<TplId, PageTemplate>;
type Doc = { drafts: Drafts; tokens: StoreTokens | null };
type History = { doc: Doc; past: Doc[]; future: Doc[]; key: string | null; at: number };

/** Deep equality that ignores key order: Core stores templates as jsonb, which reorders keys. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) =>
    same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
// typing in one field is one step to undo, not one per keystroke
const COALESCE_MS = 1200;
const MAX_STEPS = 100;

type Saved = {
  pages: Partial<
    Record<
      TplId,
      {
        version: number;
        template: PageTemplate;
        /** a page never published has version 0 whatever the Kernel's default is: the
         *  default the draft was made on, so a newer one isn't overwritten */
        base?: PageTemplate;
      }
    >
  >;
  tokens: StoreTokens | null;
  /** the published colours the draft was made on: newer ones from elsewhere win */
  tokensVersion?: number | null;
};
const storageKey = (storeId: string) => `vendua-aparencia:${storeId}`;
function readSaved(storeId: string): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(storeId));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function useEditor(data: AppearanceData, storeId: string) {
  const qc = useQueryClient();
  const base = useMemo(() => {
    const out = {} as Record<TplId, { version: number; template: PageTemplate }>;
    for (const t of TPLS) {
      const row = data.pages.find((x) => x.page === t);
      out[t] = row
        ? { version: row.version, template: row.template }
        : // the Kernel's own fallback for a page the store never customized
          { version: 0, template: DEFAULT_TEMPLATES[t]! };
    }
    return out;
  }, [data.pages]);
  const [frameTokens, setFrameTokens] = useState<StoreTokens | null>(null);
  const baseTokens = data.tokens?.tokens ?? frameTokens;

  // drafts left in this browser come back while the page they were made on is still current
  const [restored] = useState(() => {
    const saved = readSaved(storeId);
    const pages: TplId[] = [];
    const drafts = Object.fromEntries(
      TPLS.map((t) => {
        const s = saved?.pages[t];
        const current =
          s && s.version === base[t].version && (s.version !== 0 || same(s.base, base[t].template));
        if (current && !same(s.template, base[t].template)) {
          pages.push(t);
          return [t, s.template];
        }
        return [t, base[t].template];
      }),
    ) as Drafts;
    const savedTokens =
      saved?.tokens && saved.tokensVersion === (data.tokens?.version ?? null) ? saved.tokens : null;
    const tokens = savedTokens ?? data.tokens?.tokens ?? null;
    return { doc: { drafts, tokens }, any: pages.length > 0 || !!savedTokens };
  });
  const [h, setH] = useState<History>({
    doc: restored.doc,
    past: [],
    future: [],
    key: null,
    at: 0,
  });
  const { drafts, tokens } = h.doc;

  const change = useCallback((fn: (d: Doc) => Doc, key?: string) => {
    setH((h) => {
      const next = fn(h.doc);
      if (next === h.doc) return h;
      const now = Date.now();
      const merge = !!key && h.key === key && now - h.at < COALESCE_MS;
      return {
        doc: next,
        past: merge ? h.past : [...h.past, h.doc].slice(-MAX_STEPS),
        future: [],
        key: key ?? null,
        at: now,
      };
    });
  }, []);
  const undo = useCallback(
    () =>
      setH((h) =>
        h.past.length
          ? {
              doc: h.past.at(-1)!,
              past: h.past.slice(0, -1),
              future: [h.doc, ...h.future],
              key: null,
              at: 0,
            }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setH((h) =>
        h.future.length
          ? {
              doc: h.future[0]!,
              past: [...h.past, h.doc],
              future: h.future.slice(1),
              key: null,
              at: 0,
            }
          : h,
      ),
    [],
  );

  // a newer version (another device, a restore, our own publish) replaces only untouched pages
  const prevBase = useRef(base);
  useEffect(() => {
    const was = prevBase.current;
    prevBase.current = base;
    if (was === base) return;
    setH((h) => {
      const d = { ...h.doc.drafts };
      for (const t of TPLS) if (same(d[t], was[t].template)) d[t] = base[t].template;
      return { ...h, doc: { ...h.doc, drafts: d } };
    });
  }, [base]);
  // the frame reports the colours in force when Core has none of its own yet
  useEffect(() => {
    if (!tokens && baseTokens) setH((h) => ({ ...h, doc: { ...h.doc, tokens: baseTokens } }));
  }, [tokens, baseTokens]);

  const dirtyTpl = (t: TplId) => !same(drafts[t], base[t].template);
  const dirtyTpls = TPLS.filter(dirtyTpl);
  const tokensDirty = !!tokens && !same(tokens, baseTokens);
  const dirty = dirtyTpls.length > 0 || tokensDirty;
  const tokensOk = !tokens || readable(tokens);
  /** a section changed since it was published (a new one counts) */
  const dirtySection = (t: TplId, s: TemplateSection) =>
    !same(
      s,
      base[t].template.sections.find((x) => x.id === s.id),
    );

  // keep unpublished work in this browser; a clean editor leaves nothing behind. Writes wait
  // for a pause in typing, and one still waiting is flushed when the screen or the tab goes.
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    const write = () => {
      pending.current = null;
      try {
        if (!dirty) return localStorage.removeItem(storageKey(storeId));
        const saved: Saved = {
          pages: {},
          tokens: tokensDirty ? tokens : null,
          tokensVersion: data.tokens?.version ?? null,
        };
        for (const p of dirtyTpls)
          saved.pages[p] = {
            version: base[p].version,
            template: drafts[p],
            ...(base[p].version === 0 ? { base: base[p].template } : {}),
          };
        localStorage.setItem(storageKey(storeId), JSON.stringify(saved));
      } catch {
        // storage full or blocked: the draft still lives in this tab
      }
    };
    pending.current = write;
    const t = setTimeout(write, 400);
    return () => clearTimeout(t);
  }, [h.doc, base, baseTokens, data.tokens?.version, storeId]);
  useEffect(() => {
    const flush = () => pending.current?.();
    addEventListener('pagehide', flush);
    return () => {
      removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // ── selection ────────────────────────────────────────────────────────────
  const [page, setPageState] = useState<PageId>('home');
  const [picked, setSel] = useState<Selection>(null);
  const setPage = (p: PageId) => {
    setPageState(p);
    // a layout part (topo, rodapé) is on every page and stays selected
    setSel((s) => (s?.kind === 'section' && s.tpl !== 'layout' ? null : s));
  };
  const selected =
    picked?.kind === 'section'
      ? (drafts[picked.tpl].sections.find((x) => x.id === picked.id) ?? null)
      : null;
  // a part that undo (or another device's version) took away is no longer selected
  const sel: Selection = picked?.kind === 'section' && !selected ? null : picked;
  // what's on the page, top to bottom as the customer sees it: the shared top, the page's
  // own parts, the shared footer (the layout's page-content slot is where the page goes)
  const layoutSecs = drafts.layout.sections;
  const slot = layoutSecs.findIndex((x) => x.type === 'sdk:page-content');
  const parts = {
    top: slot < 0 ? layoutSecs : layoutSecs.slice(0, slot),
    page: drafts[page].sections,
    bottom: slot < 0 ? [] : layoutSecs.slice(slot + 1),
  };
  const order: { tpl: TplId; sec: TemplateSection }[] = [
    ...parts.top.map((sec) => ({ tpl: 'layout' as const, sec })),
    ...parts.page.map((sec) => ({ tpl: page, sec })),
    ...parts.bottom.map((sec) => ({ tpl: 'layout' as const, sec })),
  ];
  /** the part before or after the selected one, in reading order */
  const neighbour = (d: -1 | 1): Selection => {
    if (sel?.kind !== 'section') return null;
    const i = order.findIndex((x) => x.tpl === sel.tpl && x.sec.id === sel.id);
    const n = i < 0 ? undefined : order[i + d];
    return n ? { kind: 'section', tpl: n.tpl, id: n.sec.id } : null;
  };

  /** a section id from the frame: this page's own first, else the shared layout */
  const locate = (id: string): Selection => {
    if (drafts[page].sections.some((x) => x.id === id)) return { kind: 'section', tpl: page, id };
    // the page's own content wrapper isn't a part to edit: its parts are
    if (drafts.layout.sections.some((x) => x.id === id && x.type !== 'sdk:page-content'))
      return { kind: 'section', tpl: 'layout', id };
    return null;
  };

  // ── section operations ───────────────────────────────────────────────────
  const setSections = (t: TplId, fn: (s: TemplateSection[]) => TemplateSection[], key?: string) =>
    change(
      (d) => ({
        ...d,
        drafts: { ...d.drafts, [t]: { ...d.drafts[t], sections: fn(d.drafts[t].sections) } },
      }),
      key,
    );
  const move = (t: TplId, id: string, dir: -1 | 1) =>
    setSections(t, (ss) => {
      const i = ss.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ss.length) return ss;
      const n = [...ss];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const toggle = (t: TplId, id: string) =>
    setSections(t, (ss) => ss.map((x) => (x.id === id ? hidden(x, !x.disabled) : x)));
  const remove = (t: TplId, id: string) => {
    const at = drafts[t].sections.findIndex((x) => x.id === id);
    const gone = drafts[t].sections[at];
    if (!gone) return;
    setSections(t, (ss) => ss.filter((x) => x.id !== id));
    setSel(null);
    toast('Parte tirada da página', {
      // puts back just this part, keeping whatever was edited since
      undo: () =>
        setSections(t, (ss) =>
          ss.some((x) => x.id === id) ? ss : [...ss.slice(0, at), gone, ...ss.slice(at)],
        ),
    });
  };
  const add = (type: ComponentType, where: 'page' | 'layout') => {
    const t: TplId = where === 'layout' ? 'layout' : page;
    const id = `${type.replace(/^sdk:/, '')}-${Math.random().toString(36).slice(2, 6)}`;
    setSections(t, (ss) => {
      // in the layout, a new part goes above the page's own content
      const at = t === 'layout' ? ss.findIndex((x) => x.type === 'sdk:page-content') : ss.length;
      const n = [...ss];
      n.splice(at < 0 ? ss.length : at, 0, {
        id,
        type,
        settings:
          type === 'sdk:rich-text'
            ? { title: 'Um título', body: 'Conte aqui algo sobre a sua loja.' }
            : {},
      });
      return n;
    });
    setSel({ kind: 'section', tpl: t, id });
  };
  const setSettings = (t: TplId, id: string, v: Record<string, unknown>) =>
    setSections(
      t,
      (ss) => ss.map((x) => (x.id === id ? { ...x, settings: v } : x)),
      `s:${t}:${id}`,
    );
  const setTokens = (next: StoreTokens) => change((d) => ({ ...d, tokens: next }), 'tokens');
  const discard = () => {
    change(() => ({
      drafts: Object.fromEntries(TPLS.map((t) => [t, base[t].template])) as Drafts,
      tokens: baseTokens,
    }));
    setSel(null);
    toast('Mudanças descartadas', { undo });
  };

  // ── publish ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<'idle' | 'publishing' | 'live'>('idle');
  const publish = useMutation({
    mutationFn: async () => {
      for (const t of dirtyTpls) await api.savePage(t, drafts[t], base[t].version);
      if (tokensDirty && tokens) await api.saveTokens(tokens);
      return { colours: tokensDirty };
    },
    onMutate: () => setPhase('publishing'),
    onSuccess: async ({ colours }) => {
      await qc.invalidateQueries({ queryKey: qk.appearance });
      setPhase('live');
      toast(
        colours
          ? 'Página no ar ✓ As cores entram na próxima atualização da loja.'
          : 'Sua página está no ar ✓',
        { action: { label: 'ver a loja', run: () => window.open(data.url, '_blank') } },
      );
      setTimeout(() => setPhase('idle'), 4000);
    },
    onError: async (e) => {
      setPhase('idle');
      // pages saved before the failure have new versions: a retry needs them as its base
      await qc.invalidateQueries({ queryKey: qk.appearance });
      toast.error(messageOf(e));
    },
  });

  return {
    drafts,
    tokens,
    baseTokens,
    setFrameTokens,
    restored: restored.any,
    page,
    setPage,
    sel,
    setSel,
    selected,
    locate,
    parts,
    neighbour,
    move,
    toggle,
    remove,
    add,
    setSettings,
    setTokens,
    discard,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    dirty,
    dirtyTpls,
    dirtyTpl,
    dirtySection,
    tokensDirty,
    tokensOk,
    phase,
    publish,
  };
}
export type Editor = ReturnType<typeof useEditor>;

/** `disabled` is present only when true — templates stay minimal. */
function hidden(s: TemplateSection, on: boolean): TemplateSection {
  const { disabled: _drop, ...rest } = s;
  return on ? { ...rest, disabled: true } : rest;
}

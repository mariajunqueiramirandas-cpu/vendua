import { useSyncExternalStore } from 'react';
import {
  validateTemplate,
  validateTokens,
  type PageId,
  type StorefrontTokens,
  type TemplateSet,
} from '@vendua/templates';
import { PREVIEW_MESSAGE, PREVIEW_QUERY_PARAM } from './preview-protocol.ts';

// Editor preview (Kernel 1.4): the merchant admin frames the real storefront with
// `?vendua-preview=1` and posts draft templates, so edits show before "publicar".
// Only a framed page opted in by the query listens; drafts never leave this tab.
// Messages: parent → { type: 'vendua:preview', templates?, tokens?, selected? };
//           frame  → { type: 'vendua:preview-ready', tokens, paths } | { type: 'vendua:preview-select', id }.
// `tokens` in ready are the ones in force, so the editor starts from the real look.
// Any page can frame a store with the query, so drafts are taken only from the merchant
// admin's origin, which Core reports (setPreviewOrigin); until then the frame stays inert.

const active =
  typeof window !== 'undefined' &&
  window.parent !== window &&
  new URLSearchParams(window.location.search).has(PREVIEW_QUERY_PARAM);

let drafts: TemplateSet | null = null;
let draftTokens: StorefrontTokens | null = null;
let current: StorefrontTokens | null = null;
let paths: Record<string, string> | null = null;
let adminOrigin: string | null = null;
const listeners = new Set<() => void>();
let started = false;

export function isPreview(): boolean {
  return active;
}

function start() {
  if (!active || started) return;
  started = true;
  const style = document.createElement('style');
  document.head.appendChild(style);
  window.addEventListener('message', (e) => {
    const d = e.data as {
      type?: unknown;
      templates?: unknown;
      tokens?: unknown;
      selected?: unknown;
    } | null;
    if (!d || d.type !== PREVIEW_MESSAGE.draft || e.source !== window.parent) return;
    if (!adminOrigin || e.origin !== adminOrigin) return;
    if (d.templates && typeof d.templates === 'object') {
      const next: TemplateSet = {};
      for (const [page, t] of Object.entries(d.templates as Record<string, unknown>)) {
        const v = validateTemplate(t, page as PageId);
        if (v.ok) next[page as PageId] = v.template;
      }
      drafts = next;
      for (const l of listeners) l();
    }
    if (d.tokens !== undefined) {
      // same gate as Core: an unreadable palette never renders, even as a draft
      const v = d.tokens === null ? null : validateTokens(d.tokens);
      draftTokens = v && v.ok ? v.tokens : null;
      for (const l of listeners) l();
    }
    if (typeof d.selected === 'string' || d.selected === null) {
      const id = typeof d.selected === 'string' ? d.selected.replace(/[^a-z0-9_-]/gi, '') : '';
      style.textContent = id
        ? `[data-section-id="${id}"] > * { outline: 3px solid #d9f875; outline-offset: -3px; }`
        : '';
      if (id)
        document
          .querySelector(`[data-section-id="${id}"] > *`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
  // tapping a section selects it in the editor instead of navigating
  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element | null)?.closest?.('[data-section-id]');
      if (!el || !adminOrigin) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage(
        { type: PREVIEW_MESSAGE.select, id: el.getAttribute('data-section-id') },
        adminOrigin,
      );
    },
    true,
  );
  announce();
}

function announce() {
  if (!adminOrigin) return;
  window.parent.postMessage({ type: PREVIEW_MESSAGE.ready, tokens: current, paths }, adminOrigin);
}

/** The merchant admin's origin, from Core — the only parent the preview listens to. */
export function setPreviewOrigin(origin: string | null | undefined) {
  let next: string | null = null;
  try {
    next = origin ? new URL(origin).origin : null;
  } catch {
    next = null;
  }
  if (next === 'null') next = null;
  if (next === adminOrigin) return;
  adminOrigin = next;
  if (started) announce();
}

/** The provider reports the tokens in force and the store's routes; the editor starts from them. */
export function reportPreview(t: StorefrontTokens, p: Record<string, string>) {
  current = t;
  paths = p;
  // effects run child-first, so the frame may have announced itself before this
  if (started) announce();
}

const subscribe = (fn: () => void) => {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Draft templates from the editor while previewing; null otherwise. */
export function usePreviewTemplates(): TemplateSet | null {
  return useSyncExternalStore(
    subscribe,
    () => drafts,
    () => null,
  );
}

/** Draft tokens from the editor while previewing; null otherwise. */
export function usePreviewTokens(): StorefrontTokens | null {
  return useSyncExternalStore(
    subscribe,
    () => draftTokens,
    () => null,
  );
}

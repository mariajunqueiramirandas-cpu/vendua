import { useSyncExternalStore } from 'react';
import { validateTemplate, type PageId, type TemplateSet } from '@vendua/templates';

// Editor preview (Kernel 1.4): the merchant admin frames the real storefront with
// `?vendua-preview=1` and posts draft templates, so edits show before "publicar".
// Only a framed page opted in by the query listens; drafts never leave this tab.
// Messages: parent → { type: 'vendua:preview', templates?, selected? };
//           frame  → { type: 'vendua:preview-ready' } | { type: 'vendua:preview-select', id }.

const active =
  typeof window !== 'undefined' &&
  window.parent !== window &&
  new URLSearchParams(window.location.search).has('vendua-preview');

let drafts: TemplateSet | null = null;
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
    const d = e.data as { type?: unknown; templates?: unknown; selected?: unknown } | null;
    if (!d || d.type !== 'vendua:preview' || e.source !== window.parent) return;
    if (d.templates && typeof d.templates === 'object') {
      const next: TemplateSet = {};
      for (const [page, t] of Object.entries(d.templates as Record<string, unknown>)) {
        const v = validateTemplate(t, page as PageId);
        if (v.ok) next[page as PageId] = v.template;
      }
      drafts = next;
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
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage(
        { type: 'vendua:preview-select', id: el.getAttribute('data-section-id') },
        '*',
      );
    },
    true,
  );
  window.parent.postMessage({ type: 'vendua:preview-ready' }, '*');
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

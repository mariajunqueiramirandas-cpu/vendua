import { useEffect } from 'react';
import type { StoreProfile } from './api.ts';
import { useStore } from './hooks.ts';

// The document's title and description, per page. The edge serves the same store title
// (`name — tagline`) in the first HTML; once mounted, each page sets its own here.

/** A template page's title: `name — tagline`, or the name. */
export function storeTitle(store: Pick<StoreProfile, 'name' | 'tagline'>): string {
  return store.tagline ? `${store.name} — ${store.tagline}` : store.name;
}

export function storeDescription(
  store: Pick<StoreProfile, 'description' | 'tagline'> | null | undefined,
): string | null {
  return store?.description || store?.tagline || null;
}

// only tags the store's index.html (or the edge) put there: a page never adds head tags
function setContent(selector: string, value: string): void {
  document.head?.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', value);
}

/** Sets `document.title`, and `description` / `og:title` / `og:description` when the page has
 *  those tags. Nothing until a title is known: a loading page keeps the one it had. */
export function useDocumentMeta(meta: { title?: string | null; description?: string | null }) {
  const { title, description } = meta;
  useEffect(() => {
    if (!title || typeof document === 'undefined') return;
    document.title = title;
    setContent('meta[property="og:title"]', title);
    if (description) {
      setContent('meta[name="description"]', description);
      setContent('meta[property="og:description"]', description);
    }
  }, [title, description]);
}

/** A Kernel page's title: `Sacola · <store>`, `Pedido #12 · <store>` (null = not known yet). */
export function usePageTitle(label: string | null | undefined) {
  const { store } = useStore();
  useDocumentMeta({
    title: store && label ? `${label} · ${store.name}` : null,
    description: storeDescription(store),
  });
}

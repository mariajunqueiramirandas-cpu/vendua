// The toast region lives in the top layer (a manual popover) so no stacking context —
// the banner stack's, a sticky header's, the bag bar's — can cover it. A modal sheet makes
// everything outside it inert, top layer included, so while one is open it hosts the region.

let host: HTMLElement | null = null;
const listeners = new Set<() => void>();

const supported = () =>
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function attachToastRegion(el: HTMLElement | null) {
  if (!el || !supported()) return;
  try {
    if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    if (!el.matches(':popover-open')) el.showPopover();
  } catch {
    /* not in the document yet, or no top layer — the fixed region still shows */
  }
}

/** the open modal sheet the toasts render into (null: the page) */
export const toastHost = () => host;

export function setToastHost(el: HTMLElement | null) {
  if (host === el) return;
  host = el;
  for (const l of listeners) l();
}

export function subscribeToastHost(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

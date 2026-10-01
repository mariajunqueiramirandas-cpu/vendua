// The toast region lives in the top layer (a manual popover) so no stacking context —
// the banner stack's, a sticky header's, the bag bar's — can cover it. A modal sheet opened
// later lands above it; the sheet calls raiseToasts() to put the toasts back on top.

let region: HTMLElement | null = null;

const supported = () =>
  typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function attachToastRegion(el: HTMLElement | null) {
  region = el;
  if (!el || !supported()) return;
  try {
    if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual');
    if (!el.matches(':popover-open')) el.showPopover();
  } catch {
    /* not in the document yet, or no top layer — the fixed region still shows */
  }
}

export function raiseToasts() {
  const el = region;
  if (!el?.isConnected || !supported()) return;
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  } catch {
    /* ignore */
  }
}

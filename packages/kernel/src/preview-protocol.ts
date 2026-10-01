// The editor-preview protocol (Kernel 1.4) as data, so the merchant admin imports the same
// strings the storefront listens for (`@vendua/kernel/sdk-catalog`). Pure: no DOM, no React.

/** `?vendua-preview=1` on a framed storefront turns the preview on. */
export const PREVIEW_QUERY_PARAM = 'vendua-preview';

export const PREVIEW_MESSAGE = {
  /** parent → frame: `{ type, templates?, tokens?, selected? }` */
  draft: 'vendua:preview',
  /** frame → parent: `{ type, tokens, paths }` */
  ready: 'vendua:preview-ready',
  /** frame → parent: `{ type, id }` — a section was tapped */
  select: 'vendua:preview-select',
} as const;

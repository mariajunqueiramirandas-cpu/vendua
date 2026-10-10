// Venduá tokens (apps/admin, site/) at video scale.
export const C = {
  night: '#0a100d',
  forestDeep: '#0d2a23',
  forest: '#123c32',
  lime: '#d9f875',
  cream: '#f7f4ea',
  surface: '#fffdf8',
  muted: '#b9c6bf',
  bubbleMe: '#d9fdd3',
  chatWall: '#efe9d8',
} as const;

export const FONT = {
  display: "'Space Grotesk', system-ui, sans-serif",
  body: "'Figtree', system-ui, sans-serif",
} as const;

// Instagram Stories: the top ~250 px and bottom ~360 px sit under the app's UI.
export const SAFE = { top: 250, bottom: 1560, left: 64, right: 1016 } as const;
export const W = 1080;
export const H = 1920;
export const FPS = 30;

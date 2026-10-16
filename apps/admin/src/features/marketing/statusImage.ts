import { DEFAULT_TOKENS, type StorefrontTokens } from '@vendua/templates';
import { mediaUrl } from '../../lib/media.ts';

// Status do dia (0124): one 1080×1920 image per product, in the store's own look — its colours,
// fonts and corner radius from the storefront tokens. It prints the strings Core gives (name,
// price labels, address); it never formats a number itself.

export interface StatusItem {
  name: string;
  priceLabel: string;
  compareAtLabel: string | null;
  imageUrl: string | null;
}

const W = 1080;
const H = 1920;

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = mediaUrl(src);
  });
}

const loaded = new Set<string>();
/** the store's own web fonts, so the canvas draws in them (once per page) */
async function loadFonts(t: StorefrontTokens) {
  for (const f of t.font.srcs ?? []) {
    const key = `${f.family}|${f.src}|${f.weight ?? ''}|${f.style ?? ''}`;
    if (loaded.has(key)) continue;
    loaded.add(key);
    try {
      const face = new FontFace(f.family, `url(${JSON.stringify(f.src)})`, {
        ...(f.weight !== undefined ? { weight: String(f.weight) } : {}),
        ...(f.style ? { style: f.style } : {}),
      });
      document.fonts.add(await face.load());
    } catch {
      /* the stack's fallback draws it */
    }
  }
  await document.fonts.ready;
}

const px = (v: string, fallback: number) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Lines of `text` that fit `width` in the context's current font, at most `max` lines. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > width && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  if (out.length > max) {
    const kept = out.slice(0, max);
    let last = kept[max - 1]!;
    while (last && g.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    kept[max - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return out;
}

export async function renderStatusImage(p: {
  tokens: StorefrontTokens | null;
  storeName: string;
  host: string;
  item: StatusItem;
}): Promise<Blob> {
  const t = p.tokens ?? DEFAULT_TOKENS;
  await loadFonts(t);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const radius = Math.min(96, px(t.radius.lg, 16) * 3);
  const display = t.font.display;
  const body = t.font.body;

  g.fillStyle = t.color.bg;
  g.fillRect(0, 0, W, H);

  // the store's name, small, at the top
  g.fillStyle = t.color.muted;
  g.font = `600 40px ${body}`;
  g.textAlign = 'center';
  g.fillText(p.storeName.toUpperCase().slice(0, 40), W / 2, 150);

  // the photo, or the accent with the product's initial
  const side = W - 120;
  const top = 220;
  g.save();
  g.beginPath();
  g.roundRect(60, top, side, side, radius);
  g.clip();
  let drew = false;
  if (p.item.imageUrl) {
    try {
      const img = await loadImg(p.item.imageUrl);
      const s = Math.max(side / img.width, side / img.height);
      g.drawImage(
        img,
        60 + (side - img.width * s) / 2,
        top + (side - img.height * s) / 2,
        img.width * s,
        img.height * s,
      );
      drew = true;
    } catch {
      /* drawn without the photo */
    }
  }
  if (!drew) {
    g.fillStyle = t.color.surface;
    g.fillRect(60, top, side, side);
    g.fillStyle = t.color.accent;
    g.font = `700 420px ${display}`;
    g.textBaseline = 'middle';
    g.fillText(p.item.name.trim().charAt(0).toUpperCase(), W / 2, top + side / 2);
    g.textBaseline = 'alphabetic';
  }
  g.restore();

  // the name
  g.fillStyle = t.color.text;
  g.font = `700 84px ${display}`;
  const lines = wrap(g, p.item.name, W - 160, 2);
  let y = top + side + 140;
  for (const l of lines) {
    g.fillText(l, W / 2, y);
    y += 96;
  }

  // the price, in the accent
  g.font = `700 76px ${body}`;
  const priceW = g.measureText(p.item.priceLabel).width + 120;
  const pillY = y - 10;
  g.fillStyle = t.color.accent;
  g.beginPath();
  g.roundRect((W - priceW) / 2, pillY, priceW, 128, 64);
  g.fill();
  g.fillStyle = t.color.onAccent;
  g.textBaseline = 'middle';
  g.fillText(p.item.priceLabel, W / 2, pillY + 66);
  g.textBaseline = 'alphabetic';
  if (p.item.compareAtLabel) {
    g.fillStyle = t.color.muted;
    g.font = `500 48px ${body}`;
    const cy = pillY + 200;
    g.fillText(p.item.compareAtLabel, W / 2, cy);
    const w = g.measureText(p.item.compareAtLabel).width;
    g.fillRect(W / 2 - w / 2, cy - 16, w, 4);
  }

  // how to order
  g.fillStyle = t.color.text;
  g.font = `600 52px ${body}`;
  g.fillText('Peça pelo link da loja', W / 2, H - 170);
  g.fillStyle = t.color.muted;
  g.font = `500 42px ${body}`;
  g.fillText(p.host.slice(0, 44), W / 2, H - 105);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('canvas export failed');
  return blob;
}

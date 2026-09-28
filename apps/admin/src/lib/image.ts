// Photos are prepared on the phone before upload: oriented, cropped to the
// storefront's aspect, optionally "clareada", resized, re-encoded (which drops EXIF,
// GPS included) and sampled for a dominant colour the tile shows while loading.

export interface Crop {
  /** 0–1 fractions of the source */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Prepared {
  blob: Blob;
  width: number;
  height: number;
  dominant: string | null;
}

export async function loadBitmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** centered crop of the requested aspect (w/h) */
export function centerCrop(srcW: number, srcH: number, aspect: number): Crop {
  const src = srcW / srcH;
  if (src > aspect) {
    const w = (srcH * aspect) / srcW;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = srcW / aspect / srcH;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

/** exposure + white balance only (gray-world + percentile stretch), never a filter look */
function enhance(data: ImageData) {
  const d = data.data;
  const hist = new Uint32Array(256);
  let r = 0,
    g = 0,
    b = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i]!;
    g += d[i + 1]!;
    b += d[i + 2]!;
    hist[Math.round(0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!)]!++;
  }
  const avg = (r + g + b) / (3 * n);
  // gentle: halfway to neutral so warm food photos stay warm
  const kr = 1 + (avg / (r / n) - 1) * 0.5;
  const kg = 1 + (avg / (g / n) - 1) * 0.5;
  const kb = 1 + (avg / (b / n) - 1) * 0.5;
  let acc = 0,
    lo = 0,
    hi = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i]!;
    if (acc < n * 0.01) lo = i;
    if (acc < n * 0.99) hi = i;
  }
  const span = Math.max(40, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    for (const [o, k] of [
      [0, kr],
      [1, kg],
      [2, kb],
    ] as const) {
      const v = ((d[i + o]! * k - lo) * 255) / span;
      d[i + o] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

function dominantOf(ctx: CanvasRenderingContext2D, w: number, h: number): string | null {
  try {
    const small = document.createElement('canvas');
    small.width = 12;
    small.height = 12;
    const s = small.getContext('2d')!;
    s.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, 12, 12);
    const d = s.getImageData(0, 0, 12, 12).data;
    let r = 0,
      g = 0,
      b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
    }
    const n = d.length / 4;
    const hex = (v: number) =>
      Math.round(v / n)
        .toString(16)
        .padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

export async function prepareImage(
  bitmap: ImageBitmap,
  crop: Crop,
  opts: { maxSide?: number; enhance?: boolean; quality?: number } = {},
): Promise<Prepared> {
  const maxSide = opts.maxSide ?? 1600;
  const sx = crop.x * bitmap.width;
  const sy = crop.y * bitmap.height;
  const sw = crop.w * bitmap.width;
  const sh = crop.h * bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
  if (opts.enhance) {
    const data = ctx.getImageData(0, 0, w, h);
    enhance(data);
    ctx.putImageData(data, 0, 0);
  }
  const dominant = dominantOf(ctx, w, h);
  const encode = (type: string, q: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let q = opts.quality ?? 0.85;
  let blob = await encode('image/webp', q);
  if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg', q);
  // stay under Core's 2 MB cap
  while (blob && blob.size > 1_900_000 && q > 0.4) {
    q -= 0.15;
    blob = await encode(blob.type, q);
  }
  if (!blob) throw new Error('não foi possível preparar a foto');
  return { blob, width: w, height: h, dominant };
}

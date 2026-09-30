import { HttpError } from '../platform/http.ts';

// Server-side image pipeline for POST /media. The admin already resizes in the browser, but
// a direct API upload (or an old client) must not publish a phone's EXIF — GPS included — so
// every image is decoded and re-encoded here: re-encoding writes pixels only, no metadata.
// Bun.Image applies the EXIF orientation on decode (probed on 1.4.2: an orientation-6 JPEG
// decodes rotated), so the stored pixels are upright without the tag.

export const MEDIA_LONG_EDGE = 2048;
export const MEDIA_WIDTHS = [320, 480, 640, 960, 1280] as const;
const QUALITY = 82;
/** decode guard: a small file can still claim a huge canvas */
const MAX_PIXELS = 20_000_000;
const MAX_STORED = 2 * 1024 * 1024;

interface BunImage {
  metadata(): Promise<{ width: number; height: number; format: string }>;
  resize(w: number, h?: number): BunImage;
  webp(o?: { quality?: number }): BunImage;
  bytes(): Promise<Uint8Array>;
}
type BunImageCtor = new (bytes: Uint8Array) => BunImage;
const Img = (Bun as unknown as { Image: BunImageCtor }).Image;

export interface ProcessedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  variants: { width: number; bytes: Uint8Array }[];
}

function undecodable(): never {
  throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'the file is not an image we can read');
}

export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  let meta: { width: number; height: number };
  try {
    meta = await new Img(input).metadata();
  } catch {
    undecodable();
  }
  if (!(meta.width > 0 && meta.height > 0)) undecodable();
  if (meta.width * meta.height > MAX_PIXELS)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'the image has too many pixels');
  const scale = Math.min(1, MEDIA_LONG_EDGE / Math.max(meta.width, meta.height));
  const width = Math.max(1, Math.round(meta.width * scale));
  const height = Math.max(1, Math.round(meta.height * scale));
  const encode = async (src: Uint8Array, w: number, h: number) => {
    try {
      // a fresh pipeline per output: operations queue on the instance
      return await new Img(src).resize(w, h).webp({ quality: QUALITY }).bytes();
    } catch {
      undecodable();
    }
  };
  // the only decode of the upload; variants come from the capped copy (≤ 2048 on a side)
  const bytes = await encode(input, width, height);
  if (bytes.byteLength > MAX_STORED)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'image is larger than 2 MB after processing');
  const variants: ProcessedImage['variants'] = [];
  for (const w of MEDIA_WIDTHS) {
    // the original already serves its own width
    if (w >= width) break;
    variants.push({
      width: w,
      bytes: await encode(bytes, w, Math.max(1, Math.round((height * w) / width))),
    });
  }
  return { bytes, width, height, variants };
}

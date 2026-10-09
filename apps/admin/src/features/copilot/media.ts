import { ApiError, type CopilotMediaIn } from '../../lib/api.ts';
import { loadBitmap, prepareImage } from '../../lib/image.ts';
import { messageOf } from '../../ui/feedback.tsx';

// Voice and photos for Duá: the phone records and shrinks, Core hears and reads.

/** a voice message stops (and goes) by itself here */
export const VOICE_MAX_S = 120;
/** shorter than this is a mis-tap, not a message */
export const VOICE_MIN_S = 0.7;
/** Core's cap on the decoded bytes, voice or photo */
const MAX_BYTES = 2_000_000;

export type PhotoMime = Extract<CopilotMediaIn, { kind: 'image' }>['mime'];

export interface Photo {
  blob: Blob;
  mime: PhotoMime;
  /** an object URL for the chip; revoke it when the photo goes */
  url: string;
}

export interface Voice {
  blob: Blob;
  mime: string;
  seconds: number;
}

export const canRecord = () =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder === 'function' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

/** "1:07" */
export const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** ≤ 1600 px on the long edge, re-encoded (no EXIF, no GPS) */
export async function shrinkPhoto(file: Blob): Promise<Photo> {
  let bmp: ImageBitmap;
  try {
    bmp = await loadBitmap(file);
  } catch {
    throw new Error('Não deu para abrir essa foto. Tente outra.');
  }
  let blob: Blob;
  try {
    ({ blob } = await prepareImage(bmp, { x: 0, y: 0, w: 1, h: 1 }));
  } catch {
    throw new Error('Não deu para preparar essa foto. Tente outra.');
  } finally {
    bmp.close();
  }
  if (blob.size > MAX_BYTES) throw new Error('A foto ficou grande demais. Tente outra.');
  const mime: PhotoMime = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
  return { blob, mime, url: URL.createObjectURL(blob) };
}

export const tooBig = (b: Blob) => b.size > MAX_BYTES;

/** the bytes as base64, no `data:` prefix */
export function base64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      res(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => rej(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

const WORDS: Record<string, string> = {
  VOICE_UNHEARD: 'Não deu para entender o áudio. Grave de novo, mais perto do celular.',
  IMAGE_UNREAD: 'Não consegui ver a foto. Tente outra, com mais luz.',
  MEDIA_UNAVAILABLE: 'Áudio e foto estão fora do ar agora. Escreva a mensagem.',
  RATE_LIMITED: 'Chegou ao limite de áudios e fotos de hoje. Escreva a mensagem.',
  PAYLOAD_TOO_LARGE: 'Ficou grande demais. Grave um áudio mais curto ou mande outra foto.',
  UNSUPPORTED_MEDIA: 'Esse formato não dá. Tente outra foto ou grave de novo.',
};

/** what a failed voice or photo send says, in a short line */
export function mediaError(e: unknown): string {
  if (e instanceof ApiError) return WORDS[e.code] ?? messageOf(e);
  if (e instanceof Error && e.message) return e.message;
  return 'Não deu certo. Tente de novo.';
}

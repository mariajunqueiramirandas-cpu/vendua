// system.Chat's capture (Kernel 1.24): a voice message from the microphone and a photo shrunk
// in the browser. The Kernel encodes and sends; this only records and shrinks.

/** the recorder's formats in order of preference (Safari records only mp4) */
const VOICE_MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
/** a take shorter than this is a mis-tap, never sent */
export const MIN_VOICE_SECONDS = 0.7;

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

function recorderMime(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return VOICE_MIMES.find((m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  });
}

export interface Take {
  blob: Blob;
  seconds: number;
}

export interface Recording {
  /** stops and hands the take over; null for a mis-tap */
  stop: () => Promise<Take | null>;
  /** stops and throws the take away */
  cancel: () => void;
}

/** why the microphone didn't open: `denied` (the shopper or the browser said no) or `none` */
export class MicError extends Error {
  constructor(readonly reason: 'denied' | 'none') {
    super(reason);
  }
}

export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw new MicError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'none');
  }
  const release = () => stream.getTracks().forEach((t) => t.stop());
  const mimeType = recorderMime();
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32000,
    });
  } catch {
    release();
    throw new MicError('none');
  }
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      release();
      resolve(new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }));
    };
  });
  const started = Date.now();
  rec.start();
  return {
    stop: async () => {
      const seconds = (Date.now() - started) / 1000;
      if (rec.state !== 'inactive') rec.stop();
      const blob = await done;
      return seconds < MIN_VOICE_SECONDS || blob.size === 0 ? null : { blob, seconds };
    },
    cancel: () => {
      rec.ondataavailable = null;
      if (rec.state !== 'inactive') rec.stop();
      else release();
    },
  };
}

/** A photo as a JPEG at most `max` px on its long edge. Always re-encoded: that also drops the
 *  file's metadata (a phone photo's location) before it leaves the browser. */
export async function shrinkPhoto(file: Blob, max = 1600, quality = 0.85): Promise<Blob> {
  const src = await decode(file);
  try {
    const scale = Math.min(1, max / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    // JPEG has no transparency: a PNG's clear pixels would turn black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src.image, 0, 0, w, h);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!out) throw new Error('could not encode');
    return out;
  } finally {
    src.close();
  }
}

async function decode(
  file: Blob,
): Promise<{ image: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* the <img> path below decodes what the bitmap path can't */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return {
    image: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

/** seconds as m:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

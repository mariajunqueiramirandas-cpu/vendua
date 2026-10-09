import { sniffImage } from '../admin/media.ts';
import { HttpError } from '../platform/http.ts';

// A voice message or a photo sent to Duá as JSON (`data` in base64): the admin's Copilot and the
// store chat on the site. The bytes are checked here; what they say is read later.

/** what a browser's MediaRecorder writes, and the files phones share (spaces already removed, so
 *  the value also fits shopper_media's mime check) */
const VOICE_MIME =
  /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a)(;codecs="?[a-z0-9.,']{1,40}"?)?$/;
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface MediaUpload {
  kind: 'voice' | 'image';
  mime: string;
  bytes: Uint8Array;
  /** a voice message's length as the client measured it */
  seconds: number | null;
  /** a photo's caption */
  caption: string | null;
}

const bad = (field: string, message: string) =>
  new HttpError(422, 'BAD_REQUEST', message, { field });

/** `{ kind, mime, data, seconds?, text? }` → checked bytes; 413/415/422 on anything off. */
export function mediaUpload(
  body: Record<string, unknown>,
  o: { maxBytes: number; maxCaption: number },
): MediaUpload {
  const kind = body.kind;
  if (kind !== 'voice' && kind !== 'image') throw bad('kind', 'kind must be voice or image');
  const mime = typeof body.mime === 'string' ? body.mime.replace(/\s+/g, '').toLowerCase() : '';
  if (kind === 'voice' ? !VOICE_MIME.test(mime) : !IMAGE_MIMES.includes(mime))
    throw new HttpError(
      415,
      'UNSUPPORTED_MEDIA',
      kind === 'voice'
        ? 'send webm, ogg, mp4, mpeg or wav audio'
        : 'send a jpeg, png or webp image',
    );
  const data = body.data;
  if (typeof data !== 'string' || !data) throw bad('data', 'data must be base64');
  // the decoded size, before decoding: 4 characters carry 3 bytes
  if (Math.floor((data.length * 3) / 4) > o.maxBytes + 2)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `the file is larger than ${o.maxBytes} bytes`);
  if (data.length % 4 !== 0 || !BASE64.test(data)) throw bad('data', 'data must be base64');
  const bytes = new Uint8Array(Buffer.from(data, 'base64'));
  if (!bytes.byteLength) throw bad('data', 'the file is empty');
  if (bytes.byteLength > o.maxBytes)
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `the file is larger than ${o.maxBytes} bytes`);
  if (kind === 'image' && sniffImage(bytes) !== mime)
    throw new HttpError(415, 'UNSUPPORTED_MEDIA', 'the file is not the image type it claims');
  let seconds: number | null = null;
  if (body.seconds !== undefined && body.seconds !== null) {
    if (typeof body.seconds !== 'number' || !(body.seconds >= 0 && body.seconds <= 600))
      throw bad('seconds', 'seconds must be a number from 0 to 600');
    seconds = Math.round(body.seconds);
  }
  let caption: string | null = null;
  if (body.text !== undefined && body.text !== null) {
    if (kind !== 'image') throw bad('text', 'only a photo takes a caption');
    if (typeof body.text !== 'string' || body.text.length > o.maxCaption)
      throw bad('text', `text must have at most ${o.maxCaption} characters`);
    caption = body.text.trim() || null;
  }
  return { kind, mime, bytes, seconds, caption };
}

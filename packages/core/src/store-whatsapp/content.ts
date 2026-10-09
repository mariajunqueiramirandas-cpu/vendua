// What a WhatsApp message holds, as a Vendedor conversation records it (ADR 0031). Pure: the
// gateway stores it, Core reads it. Everything is bounded to what shopper_messages accepts.

export type ChatKind =
  | 'text'
  | 'audio'
  | 'image'
  | 'location'
  | 'sticker'
  | 'reaction'
  | 'contact'
  | 'document'
  | 'video'
  | 'other'
  /** the owner's #pessoal / #cliente / #dua, typed on the store's phone */
  | 'command';

export interface ChatContent {
  kind: ChatKind;
  body: string | null;
  meta: Record<string, unknown>;
  quotedId: string | null;
  /** audio and images are downloaded (bounded); the rest is only recorded */
  media: {
    type: 'audio' | 'image';
    mime: string;
    seconds: number | null;
    size: number | null;
  } | null;
}

export const MAX_BODY = 4000;
export const MAX_PROFILE_NAME = 80;
export const MAX_AUDIO_SECONDS = 180;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** shopper_media's own cap */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const IMAGES_PER_MINUTE = 3;

const MIME = /^[a-z]+\/[a-z0-9.+-]{1,60}(;.{0,60})?$/;

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : null;

const num = (v: unknown): number | null => {
  // protobuf longs arrive as numbers, strings or Long objects
  const n = typeof v === 'object' && v !== null ? Number(String(v)) : Number(v);
  return v != null && Number.isFinite(n) ? n : null;
};

const mimeOr = (v: unknown, fallback: string) =>
  typeof v === 'string' && MIME.test(v.toLowerCase()) ? v.toLowerCase() : fallback;

const waId = (v: unknown) => (typeof v === 'string' && v.length <= 64 && v ? v : null);

type Rec = Record<string, unknown>;

/** The normalized content of one message (baileys `normalizeMessageContent` already applied);
 *  null for what isn't a conversation message (protocol, key distribution, poll votes, edits…). */
export function parseContent(message: unknown): ChatContent | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Rec;
  const quoted = (inner: unknown) =>
    waId(((inner as Rec | undefined)?.contextInfo as Rec | undefined)?.stanzaId);
  const base = (kind: ChatKind, inner: unknown, body: string | null, meta: Rec = {}) => ({
    kind,
    body: body?.slice(0, MAX_BODY) ?? null,
    meta,
    quotedId: quoted(inner),
    media: null,
  });
  if (typeof m.conversation === 'string' && m.conversation)
    return base('text', null, m.conversation);
  const ext = m.extendedTextMessage as Rec | undefined;
  if (typeof ext?.text === 'string' && ext.text) return base('text', ext, ext.text);
  const image = m.imageMessage as Rec | undefined;
  if (image) {
    const mime = mimeOr(image.mimetype, 'image/jpeg');
    const caption = str(image.caption, MAX_BODY);
    return {
      ...base('image', image, caption, { mime, caption }),
      media: { type: 'image', mime, seconds: null, size: num(image.fileLength) },
    };
  }
  const audio = m.audioMessage as Rec | undefined;
  if (audio) {
    const mime = mimeOr(audio.mimetype, 'audio/ogg; codecs=opus');
    const seconds = num(audio.seconds);
    return {
      ...base('audio', audio, null, { mime, seconds, ptt: !!audio.ptt }),
      media: { type: 'audio', mime, seconds, size: num(audio.fileLength) },
    };
  }
  const loc = (m.locationMessage ?? m.liveLocationMessage) as Rec | undefined;
  if (loc) {
    return base('location', loc, null, {
      lat: num(loc.degreesLatitude),
      lng: num(loc.degreesLongitude),
      name: str(loc.name, 200),
      address: str(loc.address, 300),
    });
  }
  const reaction = m.reactionMessage as Rec | undefined;
  if (reaction) {
    return {
      ...base('reaction', null, null, {
        emoji: typeof reaction.text === 'string' ? reaction.text.slice(0, 16) : '',
        target: waId((reaction.key as Rec | undefined)?.id),
      }),
    };
  }
  const sticker = m.stickerMessage as Rec | undefined;
  if (sticker)
    return base('sticker', sticker, null, { mime: mimeOr(sticker.mimetype, 'image/webp') });
  const contact = m.contactMessage as Rec | undefined;
  const contacts = m.contactsArrayMessage as Rec | undefined;
  if (contact || contacts) {
    const n = Array.isArray(contacts?.contacts) ? contacts.contacts.length : 1;
    return base('contact', contact ?? contacts, null, { count: Math.min(n, 1000) });
  }
  const doc = m.documentMessage as Rec | undefined;
  if (doc) {
    return base('document', doc, str(doc.caption, MAX_BODY), {
      mime: mimeOr(doc.mimetype, 'application/octet-stream'),
      fileName: str(doc.fileName, 120),
    });
  }
  const video = (m.videoMessage ?? m.ptvMessage) as Rec | undefined;
  if (video) {
    return base('video', video, str(video.caption, MAX_BODY), {
      mime: mimeOr(video.mimetype, 'video/mp4'),
      seconds: num(video.seconds),
    });
  }
  for (const k of OTHER) if (m[k]) return base('other', m[k], null, { type: k.slice(0, 40) });
  return null;
}

export type PhoneCommand = 'pessoal' | 'cliente' | 'dua';

const COMMAND = /^\s*#(pessoal|cliente|du[aá])\s*$/i;

/** The owner's command when a message is nothing but one. */
export function phoneCommand(text: string | null | undefined): PhoneCommand | null {
  const m = COMMAND.exec((text ?? '').normalize('NFC'));
  if (!m) return null;
  const w = m[1]!.toLowerCase();
  return w === 'pessoal' || w === 'cliente' ? w : 'dua';
}

export function commandContent(command: PhoneCommand): ChatContent {
  return { kind: 'command', body: command, meta: {}, quotedId: null, media: null };
}

/** shown to the shopper as a message, but nothing the Vendedor reads */
const OTHER = [
  'pollCreationMessage',
  'pollCreationMessageV2',
  'pollCreationMessageV3',
  'eventMessage',
  'productMessage',
  'orderMessage',
  'groupInviteMessage',
  'listResponseMessage',
  'buttonsResponseMessage',
  'templateButtonReplyMessage',
  'interactiveResponseMessage',
] as const;

import type { ModelGateway } from '@vendua/agent-runtime';
import { shrinkImage } from '../admin/media.ts';
import { emitAdminTx } from '../admin/live.ts';
import { dispatchTx } from '../agent-host/dispatch.ts';
import { COPILOT_AGENT_ID, COPILOT_SUBJECT } from '../agent-host/agents/copilot/shared.ts';
import { HEARD_UNSURE, LOW_CONFIDENCE } from '../platform-whatsapp/dua-text.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import { readStaffPhoto, type MediaProviders } from '../vendedor/media.ts';

// Voice messages and photos for Duá Copilot, from either door (the admin, WhatsApp). The network
// calls happen before the caller's transaction: a voice message becomes its transcript, a photo a
// reading of what it shows and every word in it. The model only ever gets text, as the Vendedor
// does with shoppers' notes and photos; the photo itself stays in copilot_media for the screen.

/** Voice + photo messages per person per day, both doors together: each is a paid call. */
export const MEDIA_PER_DAY = 60;
/** what a photo is shrunk to before it's read and kept */
const PHOTO_EDGE = 1600;
const MAX_TEXT = 2000;
/** the model's input: the reading plus the caption, inside copilot_messages' own room */
const MAX_INPUT = 4000;
export const PHOTO_TAG = '[foto enviada; leitura automática, pode ter erros]';

/** What a message says, ready for copilotInboundTx. */
export interface Heard {
  kind: 'text' | 'voice' | 'image';
  /** what the model reads */
  input: string;
  /** what the conversation shows: the words, the transcript, the caption ('' for none) */
  shown: string;
  /** the photo as kept (WebP) */
  photo: Uint8Array | null;
}

const productNames = (sql: Sql, tenantId: string) =>
  withTenant(
    sql,
    tenantId,
    (tx) => tx<{ name: string }[]>`
      select name from products where tenant_id = ${tenantId} order by name limit 200`,
  )
    .then((rows) => rows.map((r) => r.name))
    // a hint: never blocks the note
    .catch(() => [] as string[]);

/** A voice message, transcribed with the store's product names as hints; null if unheard. */
export async function hearVoice(
  sql: Sql,
  media: Pick<MediaProviders, 'transcribe'>,
  tenantId: string,
  bytes: Uint8Array,
  mime: string,
): Promise<Heard | null> {
  const t = await media.transcribe(bytes, mime, { phrases: await productNames(sql, tenantId) });
  const said = t?.text.trim().slice(0, MAX_TEXT);
  if (!said) return null;
  const unsure = t!.confidence == null || t!.confidence < LOW_CONFIDENCE;
  return {
    kind: 'voice',
    input: unsure ? `${HEARD_UNSURE} ${said}` : said,
    shown: said,
    photo: null,
  };
}

/**
 * A photo, shrunk to an upright metadata-free WebP and read. Throws the HttpError of an image
 * that can't be decoded; null when no model could read it.
 */
export async function seePhoto(
  gateway: ModelGateway,
  tenantId: string,
  bytes: Uint8Array,
  caption: string,
): Promise<Heard | null> {
  const photo = await shrinkImage(bytes, PHOTO_EDGE);
  const r = await readStaffPhoto(gateway, tenantId, photo, 'image/webp');
  if (!r) return null;
  const said = caption.trim().slice(0, MAX_TEXT);
  // the photo's own words can't open or close the reading, so nothing in it passes for the ask
  const inert = (t: string) => t.replace(/\[\s*(fim da foto|foto enviada)/gi, '($1');
  const head = [PHOTO_TAG, `O que mostra: ${inert(r.description)}`];
  const tail = ['[fim da foto]', ...(said ? [said] : [])];
  // the caption is the person's ask and the marker frames it: the photo's text gives way
  const room = MAX_INPUT - [...head, ...tail].join('\n').length - 'Texto na foto:\n'.length - 2;
  const text = inert(r.text).slice(0, Math.max(0, room));
  return {
    kind: 'image',
    input: [...head, text ? `Texto na foto:\n${text}` : 'Sem texto legível.', ...tail].join('\n'),
    shown: said,
    photo,
  };
}

/** Voice and photo messages this person sent today, both doors. */
export async function mediaToday(tx: Sql, tenantId: string, userId: string): Promise<number> {
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from copilot_messages
    where tenant_id = ${tenantId} and user_id = ${userId} and author = 'merchant'
      and kind in ('voice', 'image') and created_at > now() - interval '1 day'`;
  return r?.n ?? 0;
}

/**
 * The message joins the person's conversation and the copilot hears it: one row (plus its
 * photo) and one mailbox row, in the caller's transaction (the one producer, ADR 0030).
 */
export async function copilotInboundTx(
  tx: Sql,
  o: {
    tenantId: string;
    userId: string;
    channel: 'admin' | 'whatsapp';
    heard: Heard;
    screen?: string | null;
    source: string;
    /** default `copilot:<message id>`, as a typed message's */
    dedupeKey?: string;
  },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into copilot_messages (tenant_id, user_id, author, body, channel, kind, screen)
    values (${o.tenantId}, ${o.userId}, 'merchant', ${o.heard.shown}, ${o.channel},
            ${o.heard.kind}, ${o.screen ?? null})
    returning id`;
  if (o.heard.photo)
    await tx`
      insert into copilot_media (tenant_id, user_id, message_id, mime, bytes)
      values (${o.tenantId}, ${o.userId}, ${row!.id}, 'image/webp', ${Buffer.from(o.heard.photo)})`;
  await dispatchTx(tx, {
    actor: {
      tenantId: o.tenantId,
      agentId: COPILOT_AGENT_ID,
      subject: { kind: COPILOT_SUBJECT, id: o.userId },
    },
    kind: 'message.inbound',
    source: o.source,
    dedupeKey: o.dedupeKey ?? `copilot:${row!.id}`,
    payload: {
      messageId: row!.id,
      kind: o.heard.kind,
      text: o.heard.input,
      at: new Date().toISOString(),
    },
  });
  await emitAdminTx(tx, o.tenantId, 'copilot', o.userId);
  return row!.id;
}

import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { HEARD_UNSURE, LOW_CONFIDENCE } from '../platform-whatsapp/dua-text.ts';
import { MAX_AUDIO_SECONDS, MAX_MEDIA_BYTES } from '../store-whatsapp/content.ts';
import { controlTx } from '../modules/control.ts';
import { MAX_SPEAK_CHARS, mediaProviders, type MediaProviders } from '../vendedor/media.ts';
import { agentSettingTx, type AgentVoice } from './policy.ts';

// The sales agent's voice on WhatsApp (ADR 0048). A lead's voice note reaches the agent as its
// transcript, marked "[áudio] …". The agent answers a voice note with one, and may send one now and
// then on its own. When it may is decided here, in code: never to a lead who hasn't written, never
// with a link, never long, and a proactive one at most once a day per lead. The sound is made just
// before dispatch (prepareVoiceNote). A voice that can't be made sends the same words as text.

const vlog = log.child({ mod: 'crm-voice' });

/** What a heard voice note's transcript starts with in the lead's message. */
export const AUDIO_MARK = '[áudio]';
/** A voice note longer than this many characters (about 40 s spoken) goes as text. */
export const MAX_VOICE_CHARS = 600;
const PROACTIVE_GAP_H = 24;
// the words a lead says that the STT should catch (its x-stt-phrases boost)
const PHRASES = ['Venduá', 'Duá', 'iFood', 'Pix', 'cardápio', 'WhatsApp', 'delivery', 'Instagram'];

let configured: MediaProviders | null | undefined;
/** Tests inject their media here; Core uses its TTS and STT routes. */
export function configureCrmVoice(media: MediaProviders | null | undefined): void {
  configured = media;
}
const mediaFor = (sql: Sql) => (configured !== undefined ? configured : mediaProviders(sql));

/** A lead's voice note as the message body the agent reads, or the bare mark if unheard. */
export async function hearLeadVoiceNote(
  sql: Sql,
  audio: Uint8Array,
  mime: string,
  ears?: Pick<MediaProviders, 'transcribe'> | null,
): Promise<string> {
  const media = ears !== undefined ? ears : mediaFor(sql);
  const heard = media
    ? await media.transcribe(audio, mime, { phrases: PHRASES }).catch((err) => {
        vlog.warn({ err: String(err) }, 'lead voice note not transcribed');
        return null;
      })
    : null;
  const text = heard?.text.trim();
  if (!text) return AUDIO_MARK;
  const unsure = heard!.confidence !== null && heard!.confidence < LOW_CONFIDENCE;
  return `${unsure ? HEARD_UNSURE : AUDIO_MARK} ${text}`.slice(0, 8000);
}

/** What Core's own socket hands the CRM for a lead's message (crm/channels/whatsapp.ts). */
export interface SocketMedia {
  type: 'audio' | 'image';
  mime: string;
  seconds: number | null;
  size: number | null;
  download(maxBytes: number): Promise<Uint8Array>;
}

/** A lead's message from Core's socket as the CRM stores it: a voice note becomes its transcript. */
export async function leadMessageBody(
  sql: Sql,
  text: string,
  media: SocketMedia | undefined,
  ears?: Pick<MediaProviders, 'transcribe'> | null,
): Promise<{ body: string; audio: boolean }> {
  if (media?.type !== 'audio') return { body: text, audio: false };
  if ((media.seconds ?? 0) > MAX_AUDIO_SECONDS || (media.size ?? 0) > MAX_MEDIA_BYTES)
    return { body: AUDIO_MARK, audio: true };
  const bytes = await media.download(MAX_MEDIA_BYTES).catch((err) => {
    vlog.warn({ err: String(err) }, 'lead voice note not downloaded');
    return null;
  });
  if (!bytes?.length) return { body: AUDIO_MARK, audio: true };
  return { body: await hearLeadVoiceNote(sql, bytes, media.mime, ears), audio: true };
}

const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|br|app|io|net|org)\b/i;

/**
 * Whether the agent's next WhatsApp message to this thread goes as a voice note. `requested` is
 * the agent asking for one on its own; a voice note from the lead is answered with one unless the
 * staff switched that off. Inside the compose tx.
 */
export async function voiceDecisionTx(
  tx: Sql,
  input: {
    threadId: string;
    channel: string;
    body: string;
    requested: boolean;
    /** the message being decided, already written: not its own history */
    messageId?: string;
  },
  voice?: AgentVoice,
): Promise<boolean> {
  if (input.channel !== 'whatsapp') return false;
  const v = voice ?? (await agentSettingTx(tx)).voice;
  if (!v.replies && !v.proactive) return false;
  const body = input.body.trim();
  if (!body || body.length > Math.min(MAX_VOICE_CHARS, MAX_SPEAK_CHARS) || LINK.test(body))
    return false;
  const [s] = await tx<
    {
      last_in_audio: boolean | null;
      inbound: number;
      recent_out_audio: number;
      last_out_audio: boolean | null;
    }[]
  >`
    select
      (select m.audio from lead_messages m
        where m.thread_id = ${input.threadId} and m.direction = 'in'
        order by m.created_at desc, m.id desc limit 1) as last_in_audio,
      (select count(*)::int from lead_messages m
        where m.thread_id = ${input.threadId} and m.direction = 'in' and not m.historical) as inbound,
      (select count(*)::int from lead_messages m
        where m.thread_id = ${input.threadId} and m.direction = 'out' and m.audio
          and m.id is distinct from ${input.messageId ?? null}::uuid
          and m.status in ('queued', 'sending', 'sent', 'delivered')
          and m.created_at > now() - make_interval(hours => ${PROACTIVE_GAP_H})) as recent_out_audio,
      (select m.audio from lead_messages m
        where m.thread_id = ${input.threadId} and m.direction = 'out'
          and m.id is distinct from ${input.messageId ?? null}::uuid
          and m.status in ('queued', 'sending', 'sent', 'delivered')
        order by m.created_at desc, m.id desc limit 1) as last_out_audio`;
  // never a voice note to someone who hasn't written to us
  if (!s || s.inbound === 0) return false;
  if (s.last_in_audio && v.replies) return true;
  return input.requested && v.proactive && s.recent_out_audio === 0 && !s.last_out_audio;
}

/**
 * Makes a queued voice note's sound before its dispatch claim (no HTTP inside a tx). Nothing to
 * do once made, or for a text message. When no voice can be made, the message goes as text.
 */
export async function prepareVoiceNote(sql: Sql, messageId: string): Promise<void> {
  const [m] = await controlTx(
    sql,
    (tx) => tx<{ body: string; made: boolean }[]>`
      select m.body, exists (select 1 from lead_audio a where a.message_id = m.id) as made
      from lead_messages m
      where m.id = ${messageId} and m.audio and m.direction = 'out' and m.status = 'queued'`,
  );
  if (!m || m.made) return;
  const speechVoice = (await controlTx(sql, agentSettingTx)).voice.speechVoice;
  const media = mediaFor(sql);
  const s = media
    ? await media
        .speak(m.body, { voice: speechVoice || undefined, format: 'ogg' })
        .catch(() => null)
    : null;
  await controlTx(sql, async (tx) => {
    if (s) {
      await tx`
        insert into lead_audio (message_id, mime, bytes, seconds)
        values (${messageId}, ${s.mime}, ${Buffer.from(s.bytes)}, ${Math.min(600, s.seconds)})
        on conflict (message_id) do nothing`;
      // sent long ago, the sound isn't needed: what it said stays in the message
      await tx`
        delete from lead_audio where message_id in (
          select message_id from lead_audio
          where created_at < now() - interval '30 days' limit 50)`;
    } else {
      vlog.warn({ messageId }, 'no voice for the agent; sending as text');
      await tx`update lead_messages set audio = false, updated_at = now()
               where id = ${messageId} and status = 'queued'`;
    }
  });
}

/** After compose: marks the agent's message a voice note when voiceDecisionTx allows it. */
export async function markVoiceTx(
  tx: Sql,
  message: { id: string; threadId: string; body: string },
  channel: string,
  requested: boolean,
): Promise<boolean> {
  const audio = await voiceDecisionTx(tx, {
    threadId: message.threadId,
    channel,
    body: message.body,
    requested,
    messageId: message.id,
  });
  if (audio) await tx`update lead_messages set audio = true where id = ${message.id}`;
  return audio;
}

/** The voice note a claimed message sends, if it has one. */
export async function voiceNoteTx(
  tx: Sql,
  messageId: string,
): Promise<{ bytes: Uint8Array; mime: string; seconds: number } | null> {
  const [a] = await tx<{ bytes: Buffer; mime: string; seconds: number | null }[]>`
    select a.bytes, a.mime, a.seconds from lead_audio a
    join lead_messages m on m.id = a.message_id
    where a.message_id = ${messageId} and m.audio`;
  return a ? { bytes: new Uint8Array(a.bytes), mime: a.mime, seconds: a.seconds ?? 0 } : null;
}

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { deliverQueued } from '../src/crm/outbox.ts';
import { ingestInbound } from '../src/crm/inbound.ts';
import {
  AUDIO_MARK,
  configureCrmVoice,
  leadMessageBody,
  voiceDecisionTx,
  type SocketMedia,
} from '../src/crm/voice.ts';
import { controlTx } from '../src/modules/control.ts';
import { validateSetting } from '../src/modules/integrations.ts';
import { HEARD_UNSURE } from '../src/platform-whatsapp/dua-text.ts';
import { leadVoiceFromInbox } from '../src/platform-whatsapp/inbox.ts';
import { enqueuePlatformWaTx } from '../src/platform-whatsapp/outbox.ts';
import type { MediaProviders } from '../src/vendedor/media.ts';
import { call, crmBench, OWNER_URL, say } from './crm-harness.ts';

// The sales agent's WhatsApp voice notes (ADR 0048): a lead's is heard as its transcript, one is
// answered with one, the agent may send one on its own within limits code enforces, and a voice
// that can't be made sends the same words as text.

describe.skipIf(!OWNER_URL)('CRM sales agent voice notes (db)', () => {
  const b = crmBench('crm-voice');
  const { sql, appSql, mine, settings, lead, runtime, settle, outbound } = b;
  const spoken: { text: string; voice: string | undefined; format: string | undefined }[] = [];
  let speaking = true;
  let heard: { text: string; confidence: number | null } | null = {
    text: 'quanto custa o plano?',
    confidence: 0.92,
  };
  const media: MediaProviders = {
    transcribe: async () => (heard ? { ...heard, language: 'pt' } : null),
    speak: async (text, opts) => {
      spoken.push({ text, voice: opts?.voice, format: opts?.format });
      return speaking
        ? { bytes: new Uint8Array([79, 103, 103, 83]), mime: 'audio/ogg; codecs=opus', seconds: 3 }
        : null;
    },
  };
  const note = (over: Partial<SocketMedia> = {}): SocketMedia => ({
    type: 'audio',
    mime: 'audio/ogg; codecs=opus',
    seconds: 4,
    size: 4,
    download: async () => new Uint8Array([1, 2, 3, 4]),
    ...over,
  });
  const voiceNoteIn = (whatsapp: string, body = '[áudio] quanto custa o plano?') =>
    ingestInbound(appSql, {
      channel: 'whatsapp',
      from: whatsapp,
      body,
      providerMessageId: `crm-voice-${crypto.randomUUID()}`,
      audio: true,
    });
  const textIn = (whatsapp: string, body = 'oi, quero saber do plano') =>
    ingestInbound(appSql, {
      channel: 'whatsapp',
      from: whatsapp,
      body,
      providerMessageId: `crm-voice-${crypto.randomUUID()}`,
    });
  const lastOut = async (leadId: string) => {
    const [m] = await sql<{ id: string; audio: boolean; status: string; thread_id: string }[]>`
      select m.id, m.audio, m.status, m.thread_id from lead_messages m
      join lead_threads t on t.id = m.thread_id
      where t.lead_id = ${leadId} and m.direction = 'out' order by m.created_at desc limit 1`;
    return m!;
  };

  beforeAll(async () => {
    await b.setup();
    configureCrmVoice(media);
  });
  afterAll(async () => {
    configureCrmVoice(undefined);
    await b.teardown();
  });
  beforeEach(() => {
    mine.clear();
    spoken.length = 0;
    speaking = true;
    heard = { text: 'quanto custa o plano?', confidence: 0.92 };
  });

  test('a lead voice note is heard as its transcript, marked', async () => {
    expect(await leadMessageBody(appSql, '[áudio]', note())).toEqual({
      body: '[áudio] quanto custa o plano?',
      audio: true,
    });
    heard = { text: 'quero o plano do meio', confidence: 0.3 };
    expect((await leadMessageBody(appSql, '[áudio]', note())).body).toBe(
      `${HEARD_UNSURE} quero o plano do meio`,
    );
    // unheard, too long or not fetched: the bare mark, still a voice note
    heard = null;
    expect(await leadMessageBody(appSql, '[áudio]', note())).toEqual({
      body: AUDIO_MARK,
      audio: true,
    });
    expect((await leadMessageBody(appSql, '[áudio]', note({ seconds: 900 }))).body).toBe(
      AUDIO_MARK,
    );
    const broken = note({ download: async () => Promise.reject(new Error('timeout')) });
    expect((await leadMessageBody(appSql, '[áudio]', broken)).body).toBe(AUDIO_MARK);
    // a text message passes through
    expect(await leadMessageBody(appSql, 'oi', undefined)).toEqual({ body: 'oi', audio: false });
    expect(
      await leadMessageBody(appSql, '[imagem]', note({ type: 'image', mime: 'image/jpeg' })),
    ).toEqual({ body: '[imagem]', audio: false });
  });

  test('the gateway path hears the note it stored', async () => {
    const [m] = await sql<{ id: string }[]>`
      insert into platform_wa_media (session, mime, bytes, seconds)
      values ('vendua', 'audio/ogg', ${Buffer.from([1, 2, 3])}, 4) returning id`;
    const row = {
      id: 'x',
      session: 'vendua',
      kind: 'message' as const,
      from_jid: '5511@s.whatsapp.net',
      alt_jid: null,
      phone: null,
      push_name: null,
      body: '[áudio]',
      media_id: m!.id,
      provider_id: 'p',
      from_me: false,
      sent_at: null,
      pairs: null,
      attempts: 0,
    };
    const deps = { sql: appSql, jobsSql: appSql, media };
    expect(await leadVoiceFromInbox(deps, row)).toBe('[áudio] quanto custa o plano?');
    expect(await leadVoiceFromInbox(deps, { ...row, media_id: null, body: 'oi' })).toBeNull();
    expect(
      await leadVoiceFromInbox(deps, { ...row, media_id: null, body: '[áudio não baixado]' }),
    ).toBe(AUDIO_MARK);
    await sql`delete from platform_wa_media where id = ${m!.id}`;
  });

  test('a voice note is answered with one: made before dispatch, sent as a voice note', async () => {
    await settings(
      'autopilot',
      {},
      { voice: { replies: true, proactive: true, speechVoice: 'kaua' } },
    );
    const l = await lead();
    expect('ignored' in (await voiceNoteIn(l.whatsapp!))).toBe(false);
    const { rt, adapter } = runtime([
      call('send_message', { body: 'Oi! É bem simples, te explico rapidinho.' }),
      say('ok'),
    ]);
    await settle(rt);
    // the agent read the transcript, and its tool learned it went as audio
    expect(JSON.stringify(adapter.requests[0])).toContain('[áudio] quanto custa o plano?');
    const out = await lastOut(l.id);
    expect(out).toMatchObject({ audio: true, status: 'queued' });
    await deliverQueued(appSql);
    expect(await lastOut(l.id)).toMatchObject({ audio: true, status: 'sent' });
    // (the outbox sends every queued message: only this test's own text is checked)
    expect(spoken.filter((x) => x.text === 'Oi! É bem simples, te explico rapidinho.')).toEqual([
      { text: 'Oi! É bem simples, te explico rapidinho.', voice: 'kaua', format: 'ogg' },
    ]);
    const [a] = await sql<
      { seconds: number }[]
    >`select seconds from lead_audio where message_id = ${out.id}`;
    expect(a?.seconds).toBe(3);

    // the next turn's history says it went as audio
    await textIn(l.whatsapp!, 'legal, e tem teste grátis?');
    const second = runtime([say('ok')]);
    await settle(second.rt);
    expect(JSON.stringify(second.adapter.requests[0])).toContain('em áudio');
  });

  test('no voice: the same words go as text', async () => {
    await settings('autopilot');
    const l = await lead();
    await voiceNoteIn(l.whatsapp!);
    speaking = false;
    const { rt } = runtime([call('send_message', { body: 'Oi! Te explico já.' }), say('ok')]);
    await settle(rt);
    expect((await lastOut(l.id)).audio).toBe(true);
    await deliverQueued(appSql);
    expect(await lastOut(l.id)).toMatchObject({ audio: false, status: 'sent' });
    expect(spoken.filter((x) => x.text === 'Oi! Te explico já.')).toHaveLength(1);
  });

  test('when the agent may speak: code decides, not the model', async () => {
    await settings('autopilot');
    const l = await lead();
    const decide = (threadId: string, body: string, requested: boolean, voice?: never) =>
      controlTx(appSql, (tx) =>
        voiceDecisionTx(tx, { threadId, channel: 'whatsapp', body, requested }, voice),
      );
    // the lead typed: text, unless the agent asks
    await textIn(l.whatsapp!);
    const { rt } = runtime([
      call('send_message', { body: 'Oi! Tudo bem?', audio: true }),
      say('ok'),
    ]);
    await settle(rt);
    const first = await lastOut(l.id);
    expect(first.audio).toBe(true); // asked, the lead had written, none sent today
    const t = first.thread_id;
    // a proactive one at most once a day, and never right after another
    expect(await decide(t, 'Mais uma coisa!', true)).toBe(false);
    expect(await decide(t, 'Mais uma coisa!', false)).toBe(false);
    // never with a link, never long, never on another channel
    await sql`update lead_messages set audio = false where id = ${first.id}`;
    expect(await decide(t, 'Olha aqui: https://vendua.com.br/comecar', true)).toBe(false);
    expect(await decide(t, 'a'.repeat(601), true)).toBe(false);
    expect(
      await controlTx(appSql, (tx) =>
        voiceDecisionTx(tx, { threadId: t, channel: 'instagram', body: 'oi', requested: true }),
      ),
    ).toBe(false);
    // the lead's voice note is answered with one; switched off, it isn't
    await voiceNoteIn(l.whatsapp!);
    expect(await decide(t, 'Claro!', false)).toBe(true);
    await settings('autopilot', {}, { voice: { replies: false, proactive: false } });
    expect(await decide(t, 'Claro!', false)).toBe(false);

    // never to a lead who hasn't written (a cold first contact)
    await settings('autopilot');
    const cold = await lead();
    const [thread] = await controlTx(
      appSql,
      (tx) =>
        tx<{ id: string }[]>`
        insert into lead_threads (lead_id, channel) values (${cold.id}, 'whatsapp') returning id`,
    );
    expect(await decide(thread!.id, 'Oi! Sou da Venduá.', true)).toBe(false);
  });

  test('the gateway outbox carries the voice note; an older sender still has the text', async () => {
    const out = await controlTx(appSql, (tx) =>
      enqueuePlatformWaTx(tx, {
        to: '5511987654321',
        body: 'Oi! É bem simples.',
        purpose: 'crm',
        dedupeKey: `crm-voice-${crypto.randomUUID()}`,
        voice: {
          bytes: new Uint8Array([79, 103, 103, 83]),
          mime: 'audio/ogg; codecs=opus',
          seconds: 3,
        },
      }),
    );
    const [row] = await sql<{ body: string; mime: string; seconds: number }[]>`
      select o.body, m.mime, m.seconds from platform_wa_outbox o
      join platform_wa_media m on m.id = o.media_id where o.id = ${out.id}`;
    expect(row).toEqual({ body: 'Oi! É bem simples.', mime: 'audio/ogg; codecs=opus', seconds: 3 });
    await sql`delete from platform_wa_outbox where id = ${out.id}`;
  });

  test('the voice setting is checked when saved', () => {
    const field = (voice: unknown) => {
      try {
        validateSetting('agent', { level: 'autopilot', voice });
        return null;
      } catch (e) {
        return (e as { details?: { field?: string } }).details?.field ?? String(e);
      }
    };
    expect(field({ replies: true, proactive: false, speechVoice: 'manuela-lu' })).toBeNull();
    expect(field({ speechVoice: '' })).toBeNull();
    expect(field('sim')).toBe('voice');
    expect(field({ replies: 'yes' })).toBe('voice.replies');
    expect(field({ speechVoice: 'Kauã' })).toBe('voice.speechVoice');
    expect(field({ loud: true })).toBe('voice.loud');
  });
});

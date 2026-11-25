import { HttpError, bodyJson, windowCounter } from '../platform/http.ts';
import { withTenant } from '../platform/db.ts';
import { SPEECH_VOICE, ttsStatus, type Speech } from '../vendedor/media.ts';
import { introduction, loadAgent } from '../vendedor/settings.ts';
import { need, text, type AdminCtx, type AdminDeps } from './context.ts';

// The store's spoken voice (ADR 0048): the voices the TTS sidecar has, a sample of each in the
// store's own greeting, and the kitchen's announcements spoken by it instead of the device.
// Nothing here writes: the merchant's pick is `speechVoice` in the Vendedor's settings.

/** a kitchen line ("Pedido 42. Duas pizzas, uma sem cebola.") or a pickup call */
export const MAX_ANNOUNCEMENT_CHARS = 300;

const allowSamples = windowCounter({ windowMs: 10 * 60_000, max: 40 });
const allowSpeech = windowCounter({ windowMs: 10 * 60_000, max: 200 });

/** The same text in the same voice is the same audio: kitchens repeat "Pedido 12 atrasado". */
class SpeechCache {
  private items = new Map<string, Speech>();
  constructor(private max: number) {}
  get(key: string): Speech | undefined {
    const v = this.items.get(key);
    if (v) {
      this.items.delete(key);
      this.items.set(key, v);
    }
    return v;
  }
  set(key: string, v: Speech): void {
    this.items.delete(key);
    this.items.set(key, v);
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value!);
  }
}

export function mountSpeech(d: AdminDeps) {
  const { admin } = d;
  const media = () => d.copilotMedia.media;
  const cache = new SpeechCache(256);

  const audio = (c: AdminCtx, s: Speech, cacheable: boolean) => {
    c.header('content-type', s.mime);
    c.header('cache-control', cacheable ? 'private, max-age=86400' : 'no-store');
    c.header('x-content-type-options', 'nosniff');
    c.header('x-speech-seconds', String(s.seconds));
    return c.body(s.bytes as unknown as ArrayBuffer);
  };

  const speak = async (key: string, line: string, voice: string | undefined) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const m = media();
    const s = m ? await m.speak(line, { voice, format: 'mp3' }) : null;
    if (!s) throw new HttpError(503, 'SPEECH_UNAVAILABLE', 'a voz não está disponível agora');
    cache.set(key, s);
    return s;
  };

  // what the voice picker lists: the sidecar's voices, or none (the switch then explains why)
  admin.get('/vendedor/voices', async (c) => {
    need(c, 'manager');
    const tts = await ttsStatus();
    const available = tts.reachable || ((await media()?.canSpeak?.()) ?? false);
    c.header('cache-control', 'no-store');
    return c.json({
      available,
      default: tts.voice,
      voices: tts.voices,
    });
  });

  // a voice heard before it's picked: the store's real greeting in it
  admin.get('/vendedor/voices/:id/sample', async (c) => {
    const m = need(c, 'manager');
    const t = c.get('tenant');
    const id = c.req.param('id');
    if (!SPEECH_VOICE.test(id)) throw new HttpError(404, 'NOT_FOUND', 'unknown voice');
    if (!allowSamples(`${t.id}|${m.userId}`))
      throw new HttpError(429, 'RATE_LIMITED', 'too many samples — wait a few minutes');
    const line = await withTenant(d.sql, t.id, async (tx) => {
      const agent = await loadAgent(tx, t.id);
      const [tenant] = await tx<{ name: string }[]>`select name from tenants where id = ${t.id}`;
      const intro = introduction(agent.settings, (tenant?.name ?? '').slice(0, 80));
      return `Oi! Aqui é ${intro}. Como posso te ajudar hoje?`;
    });
    return audio(c, await speak(`${t.id}|sample|${id}|${line}`, line, id), true);
  });

  // the kitchen and pickup screens' announcements, in the store's voice (the device's own voice
  // is the fallback there). POST: the line may name the customer, and a URL ends up in logs.
  admin.post('/speech', async (c) => {
    const m = need(c, 'attendant');
    const t = c.get('tenant');
    const body = await bodyJson(c);
    const line = text(body.text, 'text', MAX_ANNOUNCEMENT_CHARS, 1);
    if (!/\p{L}/u.test(line))
      throw new HttpError(422, 'BAD_REQUEST', 'nothing to say', { field: 'text' });
    if (!allowSpeech(`${t.id}|${m.userId}`))
      throw new HttpError(429, 'RATE_LIMITED', 'too many announcements — wait a few minutes');
    const voice = await withTenant(
      d.sql,
      t.id,
      async (tx) => (await loadAgent(tx, t.id)).settings.speechVoice,
    );
    return audio(c, await speak(`${t.id}|${voice}|${line}`, line, voice || undefined), false);
  });
}

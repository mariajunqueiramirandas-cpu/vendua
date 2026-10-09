import { dispatchTx } from '../agent-host/dispatch.ts';
import { COPILOT_AGENT_ID, COPILOT_SUBJECT } from '../agent-host/agents/copilot/shared.ts';
import { decideTx } from '../copilot/actions.ts';
import {
  MEDIA_PER_DAY,
  copilotInboundTx,
  hearVoice,
  takeMediaCallTx,
  seePhoto,
  type Heard,
} from '../copilot/media.ts';
import { copilotView, resetConversationTx } from '../copilot/view.ts';
import { requireFeature } from '../modules/billing/plans.ts';
import { mediaUpload } from '../modules/media-upload.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import {
  HttpError,
  bodyJson,
  checkKey,
  idempotencyFingerprint,
  uuidParam,
} from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { isObj, need, oneOf, optText, text, type AdminDeps, type Merchant } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Duá Copilot in the admin (ADR 0034). Each person has their own conversation; a message is a
// mailbox row for the copilot agent, written in the same transaction (the one producer, ADR
// 0030); a proposal's card is decided here and nowhere else.

// an admin path, nothing that could carry a host or a query
const SCREEN = /^\/[a-z0-9/_-]{0,199}$/;
/** a voice message or a photo, decoded (the app's 4 MiB body cap holds its base64) */
const MEDIA_MAX = 2 * 1024 * 1024;
const MEDIA_JSON_MAX = 3 * 1024 * 1024;

function screenOf(v: unknown): string | null {
  const screen = optText(v, 'screen', 200) ?? null;
  if (screen && !SCREEN.test(screen))
    throw new HttpError(422, 'BAD_REQUEST', 'screen must be an admin path', { field: 'screen' });
  return screen;
}

export function mountCopilot(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const gate = (tx: Sql, tenantId: string) => requireFeature(tx, tenantId, 'copilot');
  const { media, gateway } = d.copilotMedia;
  // the screen offers the mic and the camera only when Core can hear and see
  const view = async (tx: Sql, t: Tenant, m: Merchant) => ({
    ...(await copilotView(tx, t.id, m)),
    media: {
      voice: !!media && ((await media.canTranscribe?.()) ?? true),
      image: !!gateway,
    },
  });

  admin.get(
    '/copilot',
    read('manager', async (tx, t, m) => {
      await gate(tx, t.id);
      return view(tx, t, m);
    }),
  );

  admin.post(
    '/copilot/messages',
    write('manager', async (tx, t, m, c) => {
      await gate(tx, t.id);
      const body = await bodyJson(c);
      const msg = text(body.text, 'text', 2000, 1);
      const screen = screenOf(body.screen);
      const [row] = await tx<{ id: string }[]>`
        insert into copilot_messages (tenant_id, user_id, author, body, screen)
        values (${t.id}, ${m.userId}, 'merchant', ${msg}, ${screen})
        returning id`;
      await dispatchTx(tx, {
        actor: {
          tenantId: t.id,
          agentId: COPILOT_AGENT_ID,
          subject: { kind: COPILOT_SUBJECT, id: m.userId },
        },
        kind: 'message.inbound',
        source: `admin:${m.userId}`,
        dedupeKey: `copilot:${row!.id}`,
        payload: { messageId: row!.id, kind: 'text', text: msg, at: new Date().toISOString() },
      });
      await emitAdminTx(tx, t.id, 'copilot', m.userId);
      return { status: 201, body: await view(tx, t, m) };
    }),
  );

  // a voice message or a photo: heard or read before the claim (a paid call never holds a tx
  // open), then the same message + mailbox row as a typed one
  admin.post('/copilot/messages/media', async (c) => {
    const m = need(c, 'manager');
    const t = c.get('tenant');
    const key = c.req.header('idempotency-key');
    checkKey(key);
    // a retry replays the stored answer before anything is heard or read again (POST /media's
    // rule): only to the caller and route that stored it
    const [done] = await withTenant(
      d.sql,
      t.id,
      (tx) => tx<{ response: unknown; status_code: number }[]>`
        select response, status_code from idempotency_keys
        where tenant_id = ${t.id} and key = ${key} and response is not null
          and (fingerprint is null or fingerprint = ${idempotencyFingerprint(c)})`,
    );
    if (done)
      return c.json(done.response as object, done.status_code as 201, {
        'x-idempotent-replay': 'true',
      });
    const body = await bodyJson(c, MEDIA_JSON_MAX);
    const up = mediaUpload(body, { maxBytes: MEDIA_MAX, maxCaption: 2000 });
    const screen = screenOf(body.screen);
    if (up.kind === 'voice' ? !media : !gateway)
      throw new HttpError(503, 'MEDIA_UNAVAILABLE', `${up.kind} messages are off here`);
    await withTenant(d.sql, t.id, async (tx) => {
      await gate(tx, t.id);
      if (!(await takeMediaCallTx(tx, t.id, m.userId, up.kind)))
        throw new HttpError(
          429,
          'RATE_LIMITED',
          `at most ${MEDIA_PER_DAY} voice messages and photos a day`,
        );
    });
    let heard: Heard | null;
    if (up.kind === 'voice') {
      heard = await hearVoice(d.sql, media!, t.id, up.bytes, up.mime);
      if (!heard) throw new HttpError(422, 'VOICE_UNHEARD', 'não deu para entender o áudio');
    } else {
      heard = await seePhoto(gateway!, t.id, up.bytes, up.caption ?? '');
      if (!heard) throw new HttpError(422, 'IMAGE_UNREAD', 'não consegui ver a foto');
    }
    const said = heard;
    return d.idempotency(d.sql, async (_c, tx) => {
      await gate(tx, t.id);
      await copilotInboundTx(tx, {
        tenantId: t.id,
        userId: m.userId,
        channel: 'admin',
        heard: said,
        screen,
        source: `admin:${m.userId}`,
      });
      return { status: 201, body: await view(tx, t, m) };
    })(c);
  });

  // a photo the person sent, to that person alone
  admin.get('/copilot/media/:id', async (c) => {
    const m = need(c, 'manager');
    const t = c.get('tenant');
    const id = uuidParam(c, 'id');
    const row = await withTenant(d.sql, t.id, async (tx) => {
      await gate(tx, t.id);
      const [r] = await tx<{ bytes: Uint8Array }[]>`
        select bytes from copilot_media
        where tenant_id = ${t.id} and id = ${id} and user_id = ${m.userId}`;
      return r;
    });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'not found');
    c.header('content-type', 'image/webp');
    c.header('cache-control', 'private, max-age=86400');
    c.header('x-content-type-options', 'nosniff');
    return c.body(row.bytes as unknown as ArrayBuffer);
  });

  admin.post(
    '/copilot/actions/:id',
    write('manager', async (tx, t, m, c) => {
      await gate(tx, t.id);
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      if (!isObj(body)) throw new HttpError(422, 'BAD_REQUEST', 'expected an object');
      const decision = oneOf(body.decision, 'decision', ['confirm', 'decline'] as const);
      await decideTx(tx, t, m, id, decision);
      return { status: 200, body: await view(tx, t, m) };
    }),
  );

  // "Nova conversa": what Duá remembers of this person's conversation goes; what was applied
  // stays applied (and in "Quem mudou o quê")
  admin.delete(
    '/copilot',
    write('manager', async (tx, t, m) => {
      await resetConversationTx(tx, t.id, m.userId);
      return { status: 200, body: await view(tx, t, m) };
    }),
  );
}

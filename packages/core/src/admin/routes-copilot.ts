import { dispatchTx } from '../agent-host/dispatch.ts';
import { forgetSubjectTx } from '../agent-host/forget.ts';
import { COPILOT_AGENT_ID, COPILOT_SUBJECT } from '../agent-host/agents/copilot/shared.ts';
import { decideTx } from '../copilot/actions.ts';
import { copilotView } from '../copilot/view.ts';
import { requireFeature } from '../modules/billing/plans.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, bodyJson, uuidParam } from '../platform/http.ts';
import { isObj, oneOf, optText, text, type AdminDeps } from './context.ts';
import { handlers } from './handlers.ts';
import { emitAdminTx } from './live.ts';

// Duá Copilot in the admin (ADR 0034). Each person has their own conversation; a message is a
// mailbox row for the copilot agent, written in the same transaction (the one producer, ADR
// 0030); a proposal's card is decided here and nowhere else.

// an admin path, nothing that could carry a host or a query
const SCREEN = /^\/[a-z0-9/_-]{0,199}$/;

export function mountCopilot(d: AdminDeps) {
  const { admin } = d;
  const { read, write } = handlers(d);
  const gate = (tx: Sql, tenantId: string) => requireFeature(tx, tenantId, 'copilot');

  admin.get(
    '/copilot',
    read('manager', async (tx, t, m) => {
      await gate(tx, t.id);
      return copilotView(tx, t.id, m);
    }),
  );

  admin.post(
    '/copilot/messages',
    write('manager', async (tx, t, m, c) => {
      await gate(tx, t.id);
      const body = await bodyJson(c);
      const msg = text(body.text, 'text', 2000, 1);
      const screen = optText(body.screen, 'screen', 200) ?? null;
      if (screen && !SCREEN.test(screen))
        throw new HttpError(422, 'BAD_REQUEST', 'screen must be an admin path', {
          field: 'screen',
        });
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
      return { status: 201, body: await copilotView(tx, t.id, m) };
    }),
  );

  admin.post(
    '/copilot/actions/:id',
    write('manager', async (tx, t, m, c) => {
      await gate(tx, t.id);
      const id = uuidParam(c, 'id');
      const body = await bodyJson(c);
      if (!isObj(body)) throw new HttpError(422, 'BAD_REQUEST', 'expected an object');
      const decision = oneOf(body.decision, 'decision', ['confirm', 'decline'] as const);
      await decideTx(tx, t, m, id, decision);
      return { status: 200, body: await copilotView(tx, t.id, m) };
    }),
  );

  // "Nova conversa": what Duá remembers of this person's conversation goes; what was applied
  // stays applied (and in "Quem mudou o quê")
  admin.delete(
    '/copilot',
    write('manager', async (tx, t, m) => {
      const subject = { kind: COPILOT_SUBJECT, id: m.userId };
      await forgetSubjectTx(tx, t.id, subject, `${COPILOT_SUBJECT}:${m.userId}`);
      await tx`delete from copilot_actions where tenant_id = ${t.id} and user_id = ${m.userId}`;
      await tx`delete from copilot_messages where tenant_id = ${t.id} and user_id = ${m.userId}`;
      await emitAdminTx(tx, t.id, 'copilot', m.userId);
      return { status: 200, body: await copilotView(tx, t.id, m) };
    }),
  );
}

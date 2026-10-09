import type { Sql } from '../../platform/db.ts';
import { HttpError } from '../../platform/http.ts';
import { log } from '../../platform/log.ts';
import { completeTask } from '../activities.ts';
import { claimControl, controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import { ackIncident } from '../fleet/incidents.ts';
import { updateLeadTx } from '../leads.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { approveMessage, rejectMessage } from '../threads.ts';
import { pendingView, say, type CommandCtx, type InteractionResponse } from './commands.ts';
import { renderAnchor } from './deliver.ts';
import { FLAG_EPHEMERAL, fitMessage } from './format.ts';

// Buttons on cards (ADR 0023). Each runs the same function as the CRM button, through the same
// claim, keyed by the Discord interaction id; the reply edits the card in place.

const alog = log.child({ mod: 'discord' });

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CUSTOM_ID = new RegExp(
  `^v1:(draft|handoff|incident):(approve|reject|take|done|ack|resolve):(${ID})$`,
);

export interface Click {
  interactionId: string;
  customId: string;
  /** the clicked message was the ephemeral /pendencias list, not a card */
  fromList: boolean;
}

export interface ActionDeps {
  /** a superseded stale draft queues a regen run — kick the drain like the CRM route */
  kickDrain: () => void;
}

const REASONS: Record<string, string> = {
  MESSAGE_NOT_FOUND: 'esse rascunho não existe mais (já foi resolvido?)',
  LEAD_COST_CAP: 'o lead está no teto de custo — libere no CRM antes de enviar',
  IG_COLD_CAP: 'o limite diário de DMs frias do Instagram foi atingido',
  TASK_NOT_FOUND: 'essa tarefa não existe mais',
  LEAD_NOT_FOUND: 'esse lead não existe mais',
  INCIDENT_NOT_FOUND: 'esse incidente não existe mais',
};

export function refusal(e: unknown): string {
  if (e instanceof HttpError) return REASONS[e.code] ?? e.message;
  return 'algo deu errado — tente pelo CRM';
}

/** A card answered in place; an ephemeral list re-rendered without the handled item. */
async function after(c: CommandCtx, click: Click, anchor: string): Promise<InteractionResponse> {
  if (click.fromList) return { type: 7, data: fitMessage(await pendingView(c)) };
  const card = await renderAnchor(c.sql, c.ctx, anchor);
  return card ? { type: 7, data: card } : { type: 6 };
}

export async function runAction(
  c: CommandCtx,
  click: Click,
  deps: ActionDeps,
): Promise<InteractionResponse> {
  const m = CUSTOM_ID.exec(click.customId);
  if (!m) return say('esse botão é de uma versão antiga do bot — use o CRM');
  const [, family, action, id] = m as unknown as [string, string, string, string];
  const key = `discord:${click.interactionId}`;
  const by = c.staffName;
  try {
    if (family === 'draft' && action === 'approve') {
      const res = await approveMessage(c.sql, id, by, key);
      if (res.status !== 200) {
        const err = (res.body as unknown as { error?: { code?: string; message?: string } }).error;
        return say(REASONS[err?.code ?? ''] ?? err?.message ?? 'o CRM recusou a aprovação');
      }
      if (res.body.stale) deps.kickDrain();
      else {
        const { dispatchMessage } = await import('../../agent/send.ts');
        // the send can take seconds (WhatsApp, email): answer Discord now, send right after
        void dispatchMessage(c.sql, res.body.message.id).catch((e) =>
          alog.error({ err: e, message: id }, 'discord-approved send failed'),
        );
      }
      return after(c, click, `draft:${id}`);
    }
    if (family === 'draft' && action === 'reject') {
      await rejectMessage(c.sql, id, key, by);
      return after(c, click, `draft:${id}`);
    }
    if (family === 'handoff') {
      const task = (
        await controlTx(
          c.sql,
          (tx) => tx<{ lead_id: string; done_at: Date | null }[]>`
            select lead_id, done_at from lead_tasks where id = ${id}
          `,
        )
      )[0];
      if (!task) return say(REASONS.TASK_NOT_FOUND!);
      if (task.done_at) return after(c, click, `handoff:${id}`);
      if (action === 'take') {
        const res = await claimControl(c.sql, key, async (tx) => {
          const lead = await updateLeadTx(tx, task.lead_id, { owner: by.slice(0, 80) }, 'staff');
          await recordStaffEventTx(
            tx,
            'handoff.taken',
            { taskId: id, leadId: task.lead_id, by },
            { dedupeKey: `handoff.taken:${id}:${click.interactionId}` },
          );
          return { status: 200, body: { lead } };
        });
        if (!res.replayed) emitControlEvent('lead.change', task.lead_id);
      } else if (action === 'done') {
        await completeTask(c.sql, id, true, key, by);
      }
      return after(c, click, `handoff:${id}`);
    }
    if (family === 'incident' && (action === 'ack' || action === 'resolve')) {
      await ackIncident(c.sql, id, action === 'ack' ? { ack: true } : { resolved: true }, by, key);
      return click.fromList
        ? say(action === 'ack' ? '👀 reconhecido' : '✅ resolvido')
        : after(c, click, `incident:${id}`);
    }
    return say('ação desconhecida');
  } catch (e) {
    if (!(e instanceof HttpError))
      alog.error({ err: e, customId: click.customId }, 'discord action failed');
    return say(refusal(e));
  }
}

/** Ephemeral answers to a button keep the original message untouched. */
export const isEphemeral = (flags: number | undefined) => ((flags ?? 0) & FLAG_EPHEMERAL) !== 0;

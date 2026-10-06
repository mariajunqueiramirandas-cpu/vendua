import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { recordStaffEventTx } from './staff-events.ts';

export const ACTIVITY_KINDS = [
  'note',
  'call',
  'meeting',
  'state_change',
  'agent',
  'system',
  'meeting_booked',
  'meeting_done',
  'meeting_no_show',
  'meeting_cancelled',
  'blocked',
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityRow {
  id: string;
  lead_id: string;
  kind: ActivityKind;
  body: string | null;
  meta: Record<string, unknown>;
  created_by: 'staff' | 'agent' | 'system';
  at: string;
}

export function activityJson(row: ActivityRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    kind: row.kind,
    body: row.body,
    meta: row.meta ?? {},
    createdBy: row.created_by,
    at: row.at,
  };
}

export async function listActivities(sql: Sql, leadId: string, limit = 200) {
  const rows = await controlTx(
    sql,
    (tx) => tx<ActivityRow[]>`
      select * from lead_activities
      where lead_id = ${leadId}
      order by at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `,
  );
  return rows.map(activityJson);
}

export async function addActivity(
  sql: Sql,
  leadId: string,
  input: {
    kind: ActivityKind;
    body?: string;
    meta?: Record<string, unknown>;
    createdBy?: 'staff' | 'agent' | 'system';
  },
  idemKey: string,
  /** live-claim fence so a reclaimed run can't still mutate */
  guard?: (tx: Sql) => Promise<void>,
): Promise<ClaimResult<{ activity: ReturnType<typeof activityJson> }>> {
  const body = input.body === undefined ? null : str(input.body, 'body', 4000).trim() || null;
  const res = await claimControl(sql, idemKey, async (tx) => {
    await guard?.(tx);
    const exists = await tx`select 1 from leads where id = ${leadId}`;
    if (!exists[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    const rows = await tx<ActivityRow[]>`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${leadId}, ${input.kind}, ${body}, ${tx.json((input.meta ?? {}) as never)},
              ${input.createdBy ?? 'staff'})
      returning *
    `;
    await tx`update leads set updated_at = now() where id = ${leadId}`;
    return { status: 201, body: { activity: activityJson(rows[0]!) } };
  });
  if (!res.replayed) emitControlEvent('lead.change', leadId);
  return res;
}

export interface TaskRow {
  id: string;
  lead_id: string;
  title: string;
  due_at: string | null;
  done_at: string | null;
  created_by: 'staff' | 'agent';
  created_at: string;
}

export function taskJson(row: TaskRow) {
  return {
    id: row.id,
    leadId: row.lead_id,
    title: row.title,
    dueAt: row.due_at,
    doneAt: row.done_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listTasks(
  sql: Sql,
  filter: { leadId?: string; done?: boolean } = {},
): Promise<(ReturnType<typeof taskJson> & { leadName: string; businessName: string | null })[]> {
  const rows = await controlTx(sql, (tx) => {
    const doneCond =
      filter.done === undefined
        ? tx`true`
        : filter.done
          ? tx`t.done_at is not null`
          : tx`t.done_at is null`;
    if (filter.leadId) {
      return tx<(TaskRow & { lead_name: string; business_name: string | null })[]>`
        select t.*, l.name as lead_name, l.business_name
        from lead_tasks t join leads l on l.id = t.lead_id
        where t.lead_id = ${filter.leadId} and ${doneCond}
        order by t.done_at is not null, t.due_at asc nulls last, t.created_at desc
      `;
    }
    return tx<(TaskRow & { lead_name: string; business_name: string | null })[]>`
      select t.*, l.name as lead_name, l.business_name
      from lead_tasks t join leads l on l.id = t.lead_id
      where l.archived_at is null and ${doneCond}
      order by t.done_at is not null, t.due_at asc nulls last, t.created_at desc
    `;
  });
  return rows.map((r) => ({
    ...taskJson(r),
    leadName: r.lead_name,
    businessName: r.business_name,
  }));
}

export async function createTask(
  sql: Sql,
  leadId: string,
  input: { title: string; dueAt?: string | null; createdBy?: 'staff' | 'agent' },
  idemKey: string,
  /** live-claim fence so a reclaimed run can't still mutate */
  guard?: (tx: Sql) => Promise<void>,
): Promise<ClaimResult<{ task: ReturnType<typeof taskJson> }>> {
  const title = str(input.title, 'title', 300).trim();
  if (!title) throw new HttpError(422, 'BAD_REQUEST', 'title is required', { field: 'title' });
  let dueAt: string | null = null;
  if (input.dueAt != null) {
    const d = new Date(input.dueAt);
    if (Number.isNaN(d.getTime())) {
      throw new HttpError(422, 'BAD_REQUEST', 'dueAt must be an ISO-8601 timestamp', {
        field: 'dueAt',
      });
    }
    dueAt = d.toISOString();
  }
  const res = await claimControl(sql, idemKey, async (tx) => {
    await guard?.(tx);
    const exists = await tx`select 1 from leads where id = ${leadId}`;
    if (!exists[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    const rows = await tx<TaskRow[]>`
      insert into lead_tasks (lead_id, title, due_at, created_by)
      values (${leadId}, ${title}, ${dueAt}, ${input.createdBy ?? 'staff'})
      returning *
    `;
    return { status: 201, body: { task: taskJson(rows[0]!) } };
  });
  if (!res.replayed) emitControlEvent('lead.change', leadId);
  return res;
}

export async function completeTask(
  sql: Sql,
  taskId: string,
  done: boolean,
  idemKey: string,
  by: string | null = null,
): Promise<ClaimResult<{ task: ReturnType<typeof taskJson> }>> {
  const res = await claimControl(sql, idemKey, async (tx) => ({
    status: 200,
    body: { task: taskJson(await completeTaskTx(tx, taskId, done, by)) },
  }));
  if (!res.replayed) emitControlEvent('lead.change', res.body.task.leadId);
  return res;
}

async function completeTaskTx(
  tx: Sql,
  taskId: string,
  done: boolean,
  by: string | null,
): Promise<TaskRow> {
  const rows = await tx<TaskRow[]>`
    update lead_tasks set done_at = ${done ? new Date().toISOString() : null}
    where id = ${taskId} returning *
  `;
  if (!rows[0]) throw new HttpError(404, 'TASK_NOT_FOUND', 'task not found');
  // only an agent handoff has a card to close — the runner's '[humano]' cost-cap and
  // failed-run tasks don't; a reopened-and-closed task is still one resolution
  if (done && (await hasHandoffCard(tx, rows[0]))) {
    await recordStaffEventTx(
      tx,
      'handoff.resolved',
      { taskId: rows[0].id, leadId: rows[0].lead_id, by },
      { dedupeKey: `handoff:${rows[0].id}:resolved` },
    );
  }
  return rows[0];
}

const hasHandoffCard = async (tx: Sql, t: Pick<TaskRow, 'id' | 'title'>) =>
  t.title.startsWith('[humano]') &&
  !!(await tx`select 1 from staff_events where anchor = ${`handoff:${t.id}`} limit 1`)[0];

export const TASK_SNOOZES = { '1d': '1 day', '1w': '7 days' } as const;

export interface TaskPatch {
  done?: boolean;
  title?: string;
  dueAt?: string | null;
  /** pushes the due date forward from whichever is later, the due date or now */
  snooze?: keyof typeof TASK_SNOOZES;
}

/** PATCH /tasks/:id body. Without title/dueAt/snooze it is the old done toggle (absent = done). */
export function taskPatch(body: Record<string, unknown>): TaskPatch {
  const out: TaskPatch = {};
  if ('title' in body) {
    const t = str(body.title, 'title', 300).trim();
    if (!t) throw new HttpError(422, 'BAD_REQUEST', 'title is required', { field: 'title' });
    out.title = t;
  }
  if ('dueAt' in body) out.dueAt = taskDueAt(body.dueAt);
  if ('snooze' in body) {
    if (typeof body.snooze !== 'string' || !Object.hasOwn(TASK_SNOOZES, body.snooze)) {
      throw new HttpError(422, 'BAD_REQUEST', 'snooze must be 1d or 1w', { field: 'snooze' });
    }
    if ('dueAt' in out) {
      throw new HttpError(422, 'BAD_REQUEST', 'send dueAt or snooze, not both', {
        field: 'snooze',
      });
    }
    out.snooze = body.snooze as keyof typeof TASK_SNOOZES;
  }
  if ('done' in body) {
    if (typeof body.done !== 'boolean') {
      throw new HttpError(422, 'BAD_REQUEST', 'done must be a boolean', { field: 'done' });
    }
    out.done = body.done;
  } else if (!Object.keys(out).length) {
    out.done = true;
  }
  return out;
}

/** ISO-8601 within a sane window, or null to clear. */
export function taskDueAt(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(str(v, 'dueAt', 60));
  const y = d.getUTCFullYear();
  if (Number.isNaN(d.getTime()) || y < 2000 || y > 2100) {
    throw new HttpError(422, 'BAD_REQUEST', 'dueAt must be an ISO-8601 timestamp', {
      field: 'dueAt',
    });
  }
  return d.toISOString();
}

export async function patchTask(
  sql: Sql,
  taskId: string,
  patch: TaskPatch,
  idemKey: string,
  by: string | null = null,
): Promise<ClaimResult<{ task: ReturnType<typeof taskJson> }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const cur = (await tx<TaskRow[]>`select * from lead_tasks where id = ${taskId}`)[0];
    if (!cur) throw new HttpError(404, 'TASK_NOT_FOUND', 'task not found');
    // completing a handoff looks for the '[humano]' prefix: its title stays the agent's
    if (
      patch.title !== undefined &&
      patch.title !== cur.title &&
      cur.title.startsWith('[humano]')
    ) {
      throw new HttpError(409, 'TASK_LOCKED', 'tarefas [humano] do agente não mudam de título', {
        field: 'title',
      });
    }
    let row = cur;
    if (patch.title !== undefined || patch.dueAt !== undefined || patch.snooze) {
      const interval = patch.snooze ? TASK_SNOOZES[patch.snooze] : null;
      row = (
        await tx<TaskRow[]>`
          update lead_tasks set
            title = ${patch.title ?? cur.title},
            due_at = case
              when ${interval}::interval is not null
                then greatest(coalesce(due_at, now()), now()) + ${interval}::interval
              when ${patch.dueAt !== undefined} then ${patch.dueAt ?? null}::timestamptz
              else due_at end
          where id = ${taskId} returning *
        `
      )[0]!;
    }
    if (patch.done !== undefined) row = await completeTaskTx(tx, taskId, patch.done, by);
    return { status: 200, body: { task: taskJson(row) } };
  });
  if (!res.replayed) emitControlEvent('lead.change', res.body.task.leadId);
  return res;
}

export async function deleteTask(
  sql: Sql,
  taskId: string,
  idemKey: string,
): Promise<ClaimResult<{ ok: true; leadId: string }>> {
  const res = await claimControl(sql, idemKey, async (tx) => {
    const cur = (await tx<TaskRow[]>`select * from lead_tasks where id = ${taskId}`)[0];
    if (!cur) throw new HttpError(404, 'TASK_NOT_FOUND', 'task not found');
    // an open handoff's Discord card would wait forever — it closes by completing the task
    if (!cur.done_at && (await hasHandoffCard(tx, cur))) {
      throw new HttpError(
        409,
        'TASK_LOCKED',
        'conclua o pedido de ajuda do agente em vez de apagar',
      );
    }
    await tx`delete from lead_tasks where id = ${taskId}`;
    return { status: 200, body: { ok: true as const, leadId: cur.lead_id } };
  });
  if (!res.replayed) emitControlEvent('lead.change', res.body.leadId);
  return res;
}

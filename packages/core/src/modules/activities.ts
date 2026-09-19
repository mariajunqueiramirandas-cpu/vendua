import type { Sql } from '../platform/db.ts';
import { HttpError, str } from '../platform/http.ts';
import { claimControl, controlTx, type ClaimResult } from './control.ts';

/**
 * activities module — the lead timeline and follow-up tasks.
 * `lead_activities` is the single history stream (notes, touchpoints, state
 * changes, agent actions); `lead_tasks` holds open/done follow-ups that both
 * staff and the agent create.
 */

export const ACTIVITY_KINDS = [
  'note',
  'call',
  'meeting',
  'state_change',
  'agent',
  'system',
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
): Promise<ClaimResult<{ activity: ReturnType<typeof activityJson> }>> {
  const body = input.body === undefined ? null : str(input.body, 'body', 4000).trim() || null;
  return claimControl(sql, idemKey, async (tx) => {
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
}

// ---------------------------------------------------------------------------

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
    if (filter.leadId) {
      return tx<(TaskRow & { lead_name: string; business_name: string | null })[]>`
        select t.*, l.name as lead_name, l.business_name
        from lead_tasks t join leads l on l.id = t.lead_id
        where t.lead_id = ${filter.leadId}
        order by t.done_at is not null, t.due_at asc nulls last, t.created_at desc
      `;
    }
    return tx<(TaskRow & { lead_name: string; business_name: string | null })[]>`
      select t.*, l.name as lead_name, l.business_name
      from lead_tasks t join leads l on l.id = t.lead_id
      where l.archived_at is null
        and (${filter.done === undefined ? true : filter.done ? tx`t.done_at is not null` : tx`t.done_at is null`})
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
  return claimControl(sql, idemKey, async (tx) => {
    const exists = await tx`select 1 from leads where id = ${leadId}`;
    if (!exists[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    const rows = await tx<TaskRow[]>`
      insert into lead_tasks (lead_id, title, due_at, created_by)
      values (${leadId}, ${title}, ${dueAt}, ${input.createdBy ?? 'staff'})
      returning *
    `;
    return { status: 201, body: { task: taskJson(rows[0]!) } };
  });
}

export async function completeTask(
  sql: Sql,
  taskId: string,
  done: boolean,
  idemKey: string,
): Promise<ClaimResult<{ task: ReturnType<typeof taskJson> }>> {
  return claimControl(sql, idemKey, async (tx) => {
    const rows = await tx<TaskRow[]>`
      update lead_tasks set done_at = ${done ? new Date().toISOString() : null}
      where id = ${taskId} returning *
    `;
    if (!rows[0]) throw new HttpError(404, 'TASK_NOT_FOUND', 'task not found');
    return { status: 200, body: { task: taskJson(rows[0]!) } };
  });
}

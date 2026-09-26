import type { Sql } from '../platform/db.ts';
import { DEFAULT_GUARDRAILS, getSettingTx, type Guardrails } from '../modules/integrations.ts';

/** Latest and next occurrence of a local wall-clock time in the workspace timezone
 *  (guardrails.timezone): daily at `hour`, or weekly on `weekday` (0 = Sunday). */
export async function anchorTx(
  tx: Sql,
  spec: { hour: number; weekday?: number },
): Promise<{ last: Date; next: Date; timezone: string }> {
  const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
  const tz = g.timezone ?? DEFAULT_GUARDRAILS.timezone;
  const wd = spec.weekday ?? null;
  const row = (
    await tx<{ last: Date; next: Date }[]>`
      select (a at time zone ${tz}) as last, ((a + st) at time zone ${tz}) as next
      from (
        select case when b <= lt then b else b - st end as a, st
        from (
          select lt,
            date_trunc('day', lt)
              - make_interval(days => case when ${wd}::int is null then 0
                  else ((extract(dow from lt)::int - ${wd}::int + 7) % 7) end)
              + make_interval(hours => ${spec.hour}::int) as b,
            case when ${wd}::int is null then interval '1 day' else interval '7 days' end as st
          from (select now() at time zone ${tz} as lt) p
        ) q
      ) r
    `
  )[0]!;
  return { last: new Date(row.last), next: new Date(row.next), timezone: tz };
}

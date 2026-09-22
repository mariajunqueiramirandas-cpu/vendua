import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Task } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, fmtDateTime } from '../components.tsx';

const DAY = 86_400_000;

function bucket(t: Task): string {
  if (t.doneAt) return 'concluídas';
  if (!t.dueAt) return 'sem prazo';
  const due = new Date(t.dueAt).getTime();
  const now = Date.now();
  const todayEnd = new Date().setHours(23, 59, 59, 999);
  if (due < now) return 'atrasadas';
  if (due <= todayEnd) return 'hoje';
  if (due <= now + 7 * DAY) return 'esta semana';
  return 'mais tarde';
}
const ORDER = ['atrasadas', 'hoje', 'esta semana', 'mais tarde', 'sem prazo', 'concluídas'];

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showDone, setShowDone] = useState(false);

  // A response is usable only for the filter it was fetched under: reject
  // it when that filter is no longer displayed, but otherwise an older
  // same-filter success still commits unless a newer success already did —
  // a failed refresh never discards usable tasks.
  const reqSeq = useRef(0);
  const okSeq = useRef(0);
  const shownFilter = useRef(showDone);
  const load = useCallback(() => {
    shownFilter.current = showDone;
    const seq = ++reqSeq.current;
    const f = showDone;
    api.tasks({ done: f ? undefined : 'false' } as { done?: string }).then((r) => {
      if (f !== shownFilter.current || seq <= okSeq.current) return;
      okSeq.current = seq;
      setTasks(r.tasks);
    });
  }, [showDone]);
  useEffect(load, [load]);
  useEffect(() => onControlEvent('lead.change', load), [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const b = bucket(t);
    groups.set(b, [...(groups.get(b) ?? []), t]);
  }
  const ordered = ORDER.filter((b) => groups.has(b));

  return (
    <Page
      title="Tarefas"
      sub={`${tasks.filter((t) => !t.doneAt).length} abertas`}
      actions={
        <button className="btn" onClick={() => setShowDone(!showDone)}>
          {showDone ? 'só abertas' : 'incluir concluídas'}
        </button>
      }
    >
      {!tasks.length && (
        <Empty
          title="sem tarefas"
          hint="tarefas de follow-up aparecem aqui — criadas por você ou pelo agente"
        />
      )}
      {ordered.length > 0 && (
        <div className="card" style={{ maxInlineSize: 860 }}>
          <table className="tbl">
            <tbody>
              {ordered.map((b) => (
                <Fragment key={b}>
                  <tr className="tgroup">
                    <td colSpan={4}>
                      {b} · {groups.get(b)!.length}
                    </td>
                  </tr>
                  {groups.get(b)!.map((t) => (
                    <tr key={t.id}>
                      <td style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={!!t.doneAt}
                          onChange={(e) => void api.setTaskDone(t.id, e.target.checked).then(load)}
                        />
                      </td>
                      <td
                        style={{
                          textDecoration: t.doneAt ? 'line-through' : undefined,
                          color: t.doneAt ? 'var(--muted)' : undefined,
                        }}
                      >
                        {t.title}
                      </td>
                      <td>
                        <Link to={`/leads/${t.leadId}`}>{t.leadName}</Link>
                        {t.businessName && t.businessName !== t.leadName && (
                          <span style={{ color: 'var(--muted)' }}> · {t.businessName}</span>
                        )}
                      </td>
                      <td className="end">
                        <span
                          className={`due${b === 'atrasadas' ? ' bad' : b === 'hoje' ? ' soon' : ''}`}
                        >
                          {t.doneAt ? `feita ${fmtDateTime(t.doneAt)}` : fmtDateTime(t.dueAt)}
                        </span>
                        {t.createdBy === 'agent' ? (
                          <span className="chip agent" style={{ marginInlineStart: 8 }}>
                            agente
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Task } from '../api.ts';
import { Empty, Page, fmtDateTime } from '../components.tsx';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    api
      .tasks({ done: showDone ? undefined : 'false' } as { done?: string })
      .then((r) => setTasks(r.tasks));
  }, [showDone]);
  useEffect(load, [load]);

  const overdue = (t: Task) => t.dueAt && !t.doneAt && new Date(t.dueAt) < new Date();

  return (
    <Page
      title="Tarefas"
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
      <div className="card" style={{ maxWidth: 860 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>tarefa</th>
              <th>lead</th>
              <th>prazo</th>
              <th>origem</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
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
                  {t.businessName && (
                    <span style={{ color: 'var(--muted)' }}> · {t.businessName}</span>
                  )}
                </td>
                <td
                  className="mono"
                  style={{ color: overdue(t) ? 'var(--red-400)' : 'var(--muted)' }}
                >
                  {fmtDateTime(t.dueAt)}
                </td>
                <td>
                  {t.createdBy === 'agent' ? (
                    <span className="chip agent">agente</span>
                  ) : (
                    <span className="chip">equipe</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

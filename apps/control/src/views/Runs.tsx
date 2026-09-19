import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AgentRun } from '../api.ts';
import { Empty, Page, fmtDateTime, fmtMoney, rel } from '../components.tsx';

const KIND_LABEL: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
};
const STATUS_CHIP: Record<string, string> = {
  queued: 'warn',
  running: 'warn',
  done: '',
  failed: 'bad',
  canceled: 'bad',
};

interface Step {
  type: string;
  name?: string;
  args?: unknown;
  out?: unknown;
  content?: unknown;
  toolCalls?: string[];
}

export default function Runs() {
  const { id } = useParams();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [kind, setKind] = useState('');

  const load = useCallback(() => {
    api.runs({ ...(kind ? { kind } : {}) }).then((r) => setRuns(r.runs));
  }, [kind]);
  useEffect(load, [load]);
  useEffect(() => {
    if (id) {
      const t = setInterval(() => api.run(id).then((r) => setRun(r.run)), 2500);
      api.run(id).then((r) => setRun(r.run));
      return () => clearInterval(t);
    }
    setRun(null);
  }, [id]);

  if (id && run) {
    const steps = (run.steps ?? []) as Step[];
    return (
      <Page
        title={`run ${run.id.slice(0, 8)}`}
        sub={`${KIND_LABEL[run.kind] ?? run.kind} · ${run.status}`}
      >
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="card" style={{ padding: 18 }}>
            <div className="steps">
              {steps.map((s, i) => (
                <div key={i} className={`step ${s.type}`}>
                  <div className="who">
                    {s.type === 'system_prompt'
                      ? 'prompt'
                      : s.type === 'model'
                        ? 'modelo'
                        : `tool · ${s.name}`}
                  </div>
                  {s.type === 'model' && s.content != null && <pre>{String(s.content)}</pre>}
                  {s.type === 'model' && s.toolCalls?.length ? (
                    <pre>→ {s.toolCalls.join(', ')}</pre>
                  ) : null}
                  {s.type === 'tool' && <pre>{JSON.stringify(s.out, null, 1).slice(0, 3000)}</pre>}
                  {s.type === 'system_prompt' && <pre>{String(s.content).slice(0, 1500)}</pre>}
                </div>
              ))}
              {!steps.length && <Empty title="sem passos ainda" />}
            </div>
          </div>
          <div className="card" style={{ padding: 18 }}>
            <b>detalhes</b>
            <table className="tbl" style={{ marginTop: 10 }}>
              <tbody>
                {(
                  [
                    [
                      'status',
                      <span key="s" className={`chip ${STATUS_CHIP[run.status] ?? ''}`}>
                        {run.status}
                      </span>,
                    ],
                    [
                      'lead',
                      run.lead_id ? (
                        <Link key="l" to={`/leads/${run.lead_id}`}>
                          {run.lead_name ?? run.lead_id.slice(0, 8)}
                        </Link>
                      ) : (
                        '—'
                      ),
                    ],
                    ['tokens', `${run.tokens_in} in · ${run.tokens_out} out`],
                    ['custo', fmtMoney(run.cost_cents)],
                    ['início', fmtDateTime(run.started_at)],
                    ['fim', fmtDateTime(run.finished_at)],
                    ...(run.error ? [['erro', run.error] as const] : []),
                  ] as [string, React.ReactNode][]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--muted)' }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 14 }}>
              <Link to="/agente" className="btn ghost">
                ← todos os runs
              </Link>
            </div>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page
      title="Agente"
      sub="cada run é auditado — prompt, chamadas de ferramenta, tokens, custo"
      actions={
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">todos os tipos</option>
          <option value="triage">triagem</option>
          <option value="reply">resposta</option>
          <option value="outreach">alcance</option>
          <option value="discovery">descoberta</option>
        </select>
      }
    >
      {!runs.length && (
        <Empty title="nenhum run" hint="runs aparecem quando o agente tria, responde ou descobre" />
      )}
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>run</th>
              <th>tipo</th>
              <th>status</th>
              <th>lead</th>
              <th>tokens</th>
              <th>custo</th>
              <th>quando</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                className="clickable"
                onClick={() => (location.hash = `#/agente/runs/${r.id}`)}
              >
                <td className="mono">{r.id.slice(0, 8)}</td>
                <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                <td>
                  <span className={`chip ${STATUS_CHIP[r.status] ?? ''}`}>{r.status}</span>
                  {r.error && (
                    <span
                      style={{ color: 'var(--red-400)', fontSize: 'var(--t-2xs)', marginLeft: 6 }}
                    >
                      {r.error.slice(0, 40)}
                    </span>
                  )}
                </td>
                <td>{r.lead_name ?? '—'}</td>
                <td className="mono">{(r.tokens_in + r.tokens_out).toLocaleString('pt-BR')}</td>
                <td className="mono">{fmtMoney(r.cost_cents)}</td>
                <td className="mono">{rel(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

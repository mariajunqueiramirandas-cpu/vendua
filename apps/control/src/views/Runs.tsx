import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type AgentRun } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, fmtDateTime, fmtMoney, rel } from '../components.tsx';

const KIND_LABEL: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
  strategist: 'estrategista',
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
  pending?: boolean;
}

export default function Runs() {
  const { id } = useParams();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [kind, setKind] = useState('');

  const load = useCallback(() => {
    api.runs({ ...(kind ? { kind } : {}) }).then((r) => setRuns(r.runs));
  }, [kind]);
  // Events can overlap detail fetches — drop any response that isn't the
  // newest request, or a stale 'running' snapshot can paint over 'done'.
  const runSeq = useRef(0);
  const loadRun = useCallback(() => {
    if (!id) return;
    const req = ++runSeq.current;
    api.run(id).then((r) => {
      if (req === runSeq.current) setRun(r.run);
    });
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!id) {
      setRun(null);
      return;
    }
    loadRun();
    return undefined;
  }, [id, loadRun]);

  // run.update accelerates the list and the open run — a ref naming another
  // run still refreshes the list, only the detail refetch is skipped.
  useEffect(
    () =>
      onControlEvent('run.update', (e) => {
        load();
        if (!e.ref || e.ref === id) loadRun();
      }),
    [load, loadRun, id],
  );
  // Floor while the stream is dead.
  useEffect(() => {
    const t = setInterval(() => {
      load();
      loadRun();
    }, 60_000);
    return () => clearInterval(t);
  }, [load, loadRun]);

  if (id && run) {
    const steps = (run.steps ?? []) as Step[];
    const active = run.status === 'queued' || run.status === 'running';
    return (
      <Page
        title={`run ${run.id.slice(0, 8)}`}
        sub={`${KIND_LABEL[run.kind] ?? run.kind} · ${run.status}`}
        actions={
          active ? (
            <button className="btn ghost" onClick={() => void api.cancelRun(run.id)}>
              cancelar
            </button>
          ) : undefined
        }
      >
        <div className="grid2" style={{ alignItems: 'start' }}>
          <div className="card pad">
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
                  {s.type === 'tool' &&
                    (s.pending ? (
                      <pre className="pending-step">executando…</pre>
                    ) : (
                      <pre>{JSON.stringify(s.out, null, 1).slice(0, 3000)}</pre>
                    ))}
                  {s.type === 'system_prompt' && <pre>{String(s.content).slice(0, 1500)}</pre>}
                </div>
              ))}
              {!steps.length && <Empty title="sem passos ainda" />}
            </div>
          </div>
          <div className="card pad">
            <div className="card-head">
              <b>detalhes</b>
            </div>
            <table className="tbl">
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
                    ...(run.run_at ? [['agendado p/', fmtDateTime(run.run_at)] as const] : []),
                    ['início', fmtDateTime(run.started_at)],
                    ['fim', fmtDateTime(run.finished_at)],
                    ...(run.error ? [['erro', run.error] as const] : []),
                  ] as [string, React.ReactNode][]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td className="k">{k}</td>
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
          <option value="strategist">estrategista</option>
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
              <th className="num">tokens</th>
              <th className="num">custo</th>
              <th className="num">quando</th>
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
                  {r.status === 'queued' && r.run_at && (
                    <span
                      style={{
                        color: 'var(--muted)',
                        fontSize: 'var(--t-2xs)',
                        marginInlineStart: 6,
                      }}
                    >
                      agenda {fmtDateTime(r.run_at)}
                    </span>
                  )}
                  {r.error && (
                    <span
                      style={{
                        color: 'var(--red-400)',
                        fontSize: 'var(--t-2xs)',
                        marginInlineStart: 6,
                      }}
                    >
                      {r.error.slice(0, 40)}
                    </span>
                  )}
                </td>
                <td>{r.lead_name ?? '—'}</td>
                <td className="num">{(r.tokens_in + r.tokens_out).toLocaleString('pt-BR')}</td>
                <td className="num">{fmtMoney(r.cost_cents)}</td>
                <td className="num">{rel(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}

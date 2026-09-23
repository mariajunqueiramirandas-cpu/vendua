import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PauseCircle, XCircle } from 'lucide-react';
import { api, type AgentRun } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, RUN_KIND_LABEL, fmtDateTime, fmtMoney, rel, relDue } from '../components.tsx';

const STATUS_CHIP: Record<string, string> = {
  queued: 'warn',
  running: 'warn',
  done: '',
  failed: 'bad',
  canceled: 'bad',
};

// Filter strip — 'agendados' is the delayed queue (scheduled=1), not a status:
// it flips the endpoint to run_at ordering and its own pagination cursor.
const VIEWS = [
  ['', 'todos'],
  ['queued', 'na fila'],
  ['running', 'rodando'],
  ['scheduled', 'agendados'],
  ['done', 'feitos'],
  ['failed', 'falhas'],
  ['canceled', 'cancelados'],
] as const;

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
  const nav = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [kind, setKind] = useState('');
  const [view, setView] = useState('');
  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set());

  // Newest-successful wins, scoped to the current filter — an older
  // response may still paint when a newer request failed, but never one
  // whose captured filter no longer matches what's displayed.
  const listSeq = useRef(0);
  const listOk = useRef(0);
  const listView = useRef('');
  const load = useCallback(
    (cur?: string) => {
      const req = ++listSeq.current;
      const reqView = `${kind}|${view}`;
      listView.current = reqView;
      api
        .runs({
          ...(kind ? { kind } : {}),
          ...(view && view !== 'scheduled' ? { status: view } : {}),
          ...(view === 'scheduled' ? { scheduled: '1', status: 'queued', limit: '200' } : {}),
          ...(cur ? { cursor: cur } : {}),
        })
        .then((r) => {
          if (reqView === listView.current && req > listOk.current) {
            listOk.current = req;
            setRuns((rs) => (cur ? [...rs, ...r.runs] : r.runs));
            setCursor(r.nextCursor ?? null);
          }
        });
    },
    [kind, view],
  );
  // Same success-watermark for the detail — a failed newer fetch lets an
  // older good response through, a stale 'running' snapshot still can't
  // paint over 'done'.
  const runSeq = useRef(0);
  const runOk = useRef(0);
  const runFor = useRef('');
  const loadRun = useCallback(() => {
    if (!id) return;
    const req = ++runSeq.current;
    const reqId = id;
    runFor.current = id;
    api.run(id).then((r) => {
      if (reqId === runFor.current && req > runOk.current) {
        runOk.current = req;
        setRun(r.run);
      }
    });
  }, [id]);
  useEffect(() => load(), [load]);
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

  const cancel = (rid: string) =>
    void api.cancelRun(rid).then(() => {
      setCancelledIds((s) => new Set(s).add(rid));
      load();
      loadRun();
    });

  if (id && run) {
    const steps = (run.steps ?? []) as Step[];
    const active =
      (run.status === 'queued' || run.status === 'running') && !cancelledIds.has(run.id);
    const params = Object.entries(run.params ?? {});
    return (
      <Page
        title={`run ${run.id.slice(0, 8)}`}
        sub={`${RUN_KIND_LABEL[run.kind] ?? run.kind} · ${run.status}`}
        actions={
          active ? (
            <button className="btn ghost" onClick={() => cancel(run.id)}>
              <XCircle size={14} /> cancelar
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
                    [
                      'conversa',
                      run.thread_id ? (
                        <Link key="t" to={`/inbox/${run.thread_id}`}>
                          abrir thread
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
            {params.length > 0 && (
              <>
                <div className="sec-t" style={{ marginTop: 14 }}>
                  parâmetros
                </div>
                <table className="tbl">
                  <tbody>
                    {params.map(([k, v]) => (
                      <tr key={k}>
                        <td className="k">{k}</td>
                        <td className="mono" style={{ overflowWrap: 'anywhere' }}>
                          {typeof v === 'string' ? v : JSON.stringify(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
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
      <div className="fchips">
        {VIEWS.map(([v, l]) => (
          <button key={v} className={view === v ? 'sel' : ''} onClick={() => setView(v)}>
            {l}
          </button>
        ))}
      </div>
      {!runs.length && (
        <Empty
          title="nenhum run"
          hint={
            view === 'scheduled'
              ? 'nada agendado — contatos adiados e follow-ups aparecem aqui'
              : 'runs aparecem quando o agente tria, responde ou descobre'
          }
        />
      )}
      {runs.length > 0 && (
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
                <th className="r-act" />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const paused =
                  (r.status === 'queued' || r.status === 'running') &&
                  r.thread_agent_enabled === false;
                const active =
                  (r.status === 'queued' || r.status === 'running') && !cancelledIds.has(r.id);
                return (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/agente/runs/${r.id}`)}>
                    <td className="mono">{r.id.slice(0, 8)}</td>
                    <td>{RUN_KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td>
                      <span className={`chip ${STATUS_CHIP[r.status] ?? ''}`}>{r.status}</span>
                      {paused && (
                        <span
                          className="chip warn"
                          style={{ marginInlineStart: 6 }}
                          title="a conversa está pausada — o run fica na fila até o agente ser reativado nela"
                        >
                          <PauseCircle size={10} /> pausado
                        </span>
                      )}
                      {r.status === 'queued' && r.run_at && !paused && (
                        <span
                          style={{
                            color: 'var(--muted)',
                            fontSize: 'var(--t-2xs)',
                            marginInlineStart: 6,
                          }}
                        >
                          {relDue(r.run_at)}
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
                    <td className="r-act" onClick={(e) => e.stopPropagation()}>
                      {active && (
                        <button
                          className="icon-btn"
                          title="cancelar run"
                          onClick={() => cancel(r.id)}
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="leads-more">
          <button className="btn" onClick={() => load(cursor)}>
            mais
          </button>
        </div>
      )}
    </Page>
  );
}

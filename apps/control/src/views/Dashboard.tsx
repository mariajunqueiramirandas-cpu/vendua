import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Stats } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, fmtMoney } from '../components.tsx';

const STATES = ['lead', 'contacted', 'invited', 'live'] as const;
const STATE_LABEL: Record<string, string> = {
  lead: 'lead',
  contacted: 'contatado',
  invited: 'convidado',
  live: 'ativo',
};
// Funnel reads left→right as deepening commitment: one hue, rising density.
const FILL: Record<string, string> = {
  lead: 'color-mix(in srgb, var(--forest-800) 26%, var(--surface-2))',
  contacted: 'color-mix(in srgb, var(--forest-800) 48%, var(--surface-2))',
  invited: 'color-mix(in srgb, var(--forest-800) 72%, var(--surface-2))',
  live: 'var(--forest-800)',
};

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    api
      .stats()
      .then((stats) => {
        if (seq !== loadSeq.current) return;
        setS(stats);
        setErr('');
      })
      .catch((e) => {
        if (seq === loadSeq.current) setErr(String(e));
      });
  }, []);
  useEffect(load, [load]);
  useEffect(() => onControlEvent(['lead.change', 'run.update', 'draft.change'], load), [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const maxState = Math.max(1, ...STATES.map((st) => s?.everReached[st] ?? 0));

  return (
    <Page title="Painel" sub={s ? `${s.total} leads` : 'carregando…'}>
      {err && <Empty title="não foi possível carregar" hint={err} />}
      {s && (
        <div className="stack">
          <div className="grid4">
            <Link to="/leads" className="card stat lnk">
              <div className="v">{s.total}</div>
              <div className="k">leads ativos</div>
            </Link>
            <Link to="/tarefas" className="card stat lnk">
              <div className="v">{s.openTasks}</div>
              <div className="k">
                tarefas abertas
                {!!s.overdueTasks && <span className="warn-dot"> · {s.overdueTasks} atras.</span>}
              </div>
            </Link>
            <Link to="/aprovacoes" className="card stat lnk">
              <div className="v" style={{ color: s.pendingDrafts ? '#7a5b12' : undefined }}>
                {s.pendingDrafts}
              </div>
              <div className="k">rascunhos p/ aprovar</div>
            </Link>
            <Link to="/descoberta" className="card stat lnk">
              <div className="v">{s.discoveredThisWeek}</div>
              <div className="k">descobertos · 7d</div>
            </Link>
          </div>

          <div className="grid2">
            <div className="card pad">
              <div className="card-head">
                <b>funil</b>
                <span className="note">alcançaram cada estado</span>
              </div>
              <div className="funnel">
                {STATES.map((st) => (
                  <div className="bar" key={st}>
                    <span className="n">{s.everReached[st] ?? 0}</span>
                    <div className="track">
                      <div
                        className="fill"
                        style={{
                          height: `${Math.max(3, ((s.everReached[st] ?? 0) / maxState) * 100)}%`,
                          background: FILL[st],
                        }}
                      />
                    </div>
                    <span className="lbl">{STATE_LABEL[st]}</span>
                  </div>
                ))}
              </div>
              <Link to="/relatorios" className="card-foot">
                previsão ponderada <b>{fmtMoney(s.forecast.weightedCents)}</b>
                {' → relatórios'}
              </Link>
            </div>
            <div className="card pad">
              <div className="card-head">
                <b>agente · 30 dias</b>
              </div>
              <div className="mstats">
                <div>
                  <div className="v">{s.agent30d.runs}</div>
                  <div className="k">runs</div>
                </div>
                <div>
                  <div className="v">{s.agent30d.tokens.toLocaleString('pt-BR')}</div>
                  <div className="k">tokens</div>
                </div>
                <div>
                  <div className="v">{fmtMoney(s.agent30d.costCents)}</div>
                  <div className="k">custo</div>
                </div>
                <div>
                  <div className="v">{s.discoveredThisWeek}</div>
                  <div className="k">descobertos</div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid3">
            <div className="card pad">
              <div className="card-head">
                <b>por segmento</b>
              </div>
              <table className="tbl">
                <tbody>
                  {s.bySegment.slice(0, 8).map((r) => (
                    <tr key={r.key}>
                      <td>{r.key || '—'}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                  {!s.bySegment.length && (
                    <tr>
                      <td style={{ color: 'var(--muted)' }}>sem segmentos ainda</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card pad">
              <div className="card-head">
                <b>por origem</b>
              </div>
              <table className="tbl">
                <tbody>
                  {s.bySource.slice(0, 8).map((r) => (
                    <tr key={r.key}>
                      <td>{r.key || '—'}</td>
                      <td className="num">{r.count}</td>
                    </tr>
                  ))}
                  {!s.bySource.length && (
                    <tr>
                      <td style={{ color: 'var(--muted)' }}>sem origens ainda</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="card pad">
              <div className="card-head">
                <b>valor por estágio</b>
              </div>
              <table className="tbl">
                <tbody>
                  {STATES.map((st) => (
                    <tr key={st}>
                      <td>
                        <Link to="/funil">{STATE_LABEL[st]}</Link>
                      </td>
                      <td className="num">{s.byState[st]?.count ?? 0}</td>
                      <td className="num">{fmtMoney(s.byState[st]?.valueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {!s && !err && <Empty title="carregando…" />}
    </Page>
  );
}

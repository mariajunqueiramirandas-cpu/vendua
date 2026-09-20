import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Stats } from '../api.ts';
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

  useEffect(() => {
    api
      .stats()
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);

  const maxState = Math.max(1, ...STATES.map((st) => s?.everReached[st] ?? 0));

  return (
    <Page title="Painel" sub={s ? `${s.total} leads` : 'carregando…'}>
      {err && <Empty title="não foi possível carregar" hint={err} />}
      {s && (
        <>
          <div className="grid4" style={{ marginBottom: 18 }}>
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

          <div className="grid2" style={{ marginBottom: 18 }}>
            <div className="card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <b>funil</b>
                <span className="mono" style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                  alcançaram cada estado
                </span>
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
              <Link
                to="/relatorios"
                className="mono"
                style={{
                  display: 'block',
                  borderTop: '1px solid var(--line)',
                  marginTop: 12,
                  paddingTop: 10,
                  fontSize: 'var(--t-xs)',
                  color: 'var(--muted)',
                }}
              >
                previsão ponderada{' '}
                <b style={{ color: 'var(--forest-800)' }}>{fmtMoney(s.forecast.weightedCents)}</b>
                {' → relatórios'}
              </Link>
            </div>
            <div className="card" style={{ padding: 18 }}>
              <b>agente · 30 dias</b>
              <div style={{ marginTop: 10, display: 'flex', gap: 24 }}>
                <div>
                  <div className="mono" style={{ fontSize: 'var(--t-lg)' }}>
                    {s.agent30d.runs}
                  </div>
                  <div className="k" style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                    runs
                  </div>
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 'var(--t-lg)' }}>
                    {s.agent30d.tokens.toLocaleString('pt-BR')}
                  </div>
                  <div className="k" style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                    tokens
                  </div>
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 'var(--t-lg)' }}>
                    {fmtMoney(s.agent30d.costCents)}
                  </div>
                  <div className="k" style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                    custo
                  </div>
                </div>
                <div>
                  <div className="mono" style={{ fontSize: 'var(--t-lg)' }}>
                    {s.discoveredThisWeek}
                  </div>
                  <div className="k" style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                    descobertos
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid3">
            <div className="card" style={{ padding: 18 }}>
              <b>por segmento</b>
              <table className="tbl" style={{ marginTop: 10 }}>
                <tbody>
                  {s.bySegment.slice(0, 8).map((r) => (
                    <tr key={r.key}>
                      <td>{r.key || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.count}
                      </td>
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
            <div className="card" style={{ padding: 18 }}>
              <b>por origem</b>
              <table className="tbl" style={{ marginTop: 10 }}>
                <tbody>
                  {s.bySource.slice(0, 8).map((r) => (
                    <tr key={r.key}>
                      <td>{r.key || '—'}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {r.count}
                      </td>
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
            <div className="card" style={{ padding: 18 }}>
              <b>valor por estágio</b>
              <table className="tbl" style={{ marginTop: 10 }}>
                <tbody>
                  {STATES.map((st) => (
                    <tr key={st}>
                      <td>
                        <Link to="/funil">{STATE_LABEL[st]}</Link>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {s.byState[st]?.count ?? 0}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {fmtMoney(s.byState[st]?.valueCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {!s && !err && <Empty title="carregando…" />}
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { api, type AgentRun, type DupeGroup, type LeadListItem } from '../api.ts';
import { Empty, Page, StateChip, rel } from '../components.tsx';

export default function Discovery() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [found, setFound] = useState<LeadListItem[]>([]);
  const [dupes, setDupes] = useState<DupeGroup[]>([]);
  const [f, setF] = useState({ query: '', segment: 'doceria', city: 'Fortaleza' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api.runs({ kind: 'discovery' }).then((r) => setRuns(r.runs));
    api
      .leads({ tag: 'descoberto', limit: '50' })
      .then((r) => setFound(r.leads))
      .catch(() =>
        api.leads({ limit: '50' }).then((r) => setFound(r.leads.filter((l) => l.discoveredVia))),
      );
    api
      .duplicates()
      .then((r) => setDupes(r.groups))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const start = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { runId } = await api.startRun('discovery', {
        query: f.query,
        segment: f.segment,
        city: f.city,
      });
      setMsg(`run ${runId.slice(0, 8)} iniciado — o agente pesquisa e cria leads`);
      setTimeout(load, 3000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'erro');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Descoberta" sub="o agente procura prospects e vira lead">
      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 720 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ flex: 2, minWidth: 220 }}
            placeholder="busca — ex: docerias artesanais com instagram em Fortaleza"
            value={f.query}
            onChange={(e) => setF({ ...f, query: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && !busy && void start()}
          />
          <input
            style={{ width: 130 }}
            placeholder="segmento"
            value={f.segment}
            onChange={(e) => setF({ ...f, segment: e.target.value })}
          />
          <input
            style={{ width: 130 }}
            placeholder="cidade"
            value={f.city}
            onChange={(e) => setF({ ...f, city: e.target.value })}
          />
          <button
            className="btn agent"
            disabled={busy || !f.query.trim()}
            onClick={() => void start()}
          >
            <FlaskConical size={14} /> descobrir
          </button>
        </div>
        {msg && (
          <div style={{ marginTop: 8, fontSize: 'var(--t-xs)', color: 'var(--muted)' }}>{msg}</div>
        )}
      </div>

      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <h3 className="sec-t">leads descobertos</h3>
          <div className="card">
            <table className="tbl">
              <tbody>
                {found.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <a href={`#/leads/${l.id}`}>
                        <b>{l.name}</b>
                      </a>
                      {l.businessName && (
                        <span style={{ color: 'var(--muted)' }}> · {l.businessName}</span>
                      )}
                    </td>
                    <td>
                      <StateChip state={l.state} />
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}
                    >
                      {l.discoveredVia ?? ''}
                    </td>
                    <td className="mono">{rel(l.createdAt)}</td>
                  </tr>
                ))}
                {!found.length && (
                  <tr>
                    <td>
                      <Empty title="nenhum ainda" hint="rode uma descoberta" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {dupes.length > 0 && (
            <>
              <h3 className="sec-t" style={{ marginTop: 18 }}>
                possíveis duplicados
              </h3>
              <div className="card" style={{ padding: 14 }}>
                {dupes.slice(0, 10).map((g, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="chip">{g.field}</span> <span className="mono">{g.value}</span>
                    <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {g.leads.map((l) => (
                        <a
                          key={l.id}
                          href={`#/leads/${l.id}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {l.name}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div>
          <h3 className="sec-t">runs de descoberta</h3>
          <div className="card">
            <table className="tbl">
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`#/agente/runs/${r.id}`} className="mono">
                        {r.id.slice(0, 8)}
                      </a>
                    </td>
                    <td>
                      <span
                        className={`chip ${r.status === 'failed' ? 'bad' : r.status === 'done' ? '' : 'warn'}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 'var(--t-2xs)' }}>
                      {(r.tokens_in + r.tokens_out).toLocaleString('pt-BR')} tok
                    </td>
                    <td className="mono">{rel(r.created_at)}</td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr>
                    <td>
                      <Empty title="nenhum run" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Page>
  );
}

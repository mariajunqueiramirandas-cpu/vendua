import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import {
  api,
  type AgentRun,
  type Brief,
  type DupeGroup,
  type LeadListItem,
  type SegmentStat,
} from '../api.ts';
import { Empty, Page, StateChip, fmtMoney, rel } from '../components.tsx';

export default function Discovery() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [found, setFound] = useState<LeadListItem[]>([]);
  const [dupes, setDupes] = useState<DupeGroup[]>([]);
  const [f, setF] = useState({ query: '', segment: 'doceria', city: 'Fortaleza' });
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [segs, setSegs] = useState<SegmentStat[]>([]);
  const [bf, setBf] = useState({ name: '', query: '', segment: '', city: '', target: '' });
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
    api
      .briefs()
      .then((r) => setBriefs(r.briefs))
      .catch(() => undefined);
    api
      .segments()
      .then((r) => setSegs(r.segments))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  // Leads land in the table as the agent creates them and steps stream into
  // the run — keep polling while a discovery run is live.
  const active = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

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
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'erro');
    } finally {
      setBusy(false);
    }
  };

  const createBrief = async () => {
    setMsg('');
    try {
      await api.createBrief({
        name: bf.name.trim(),
        query: bf.query.trim(),
        ...(bf.segment.trim() && { segment: bf.segment.trim() }),
        ...(bf.city.trim() && { city: bf.city.trim() }),
        ...(bf.target && { target: Number(bf.target) }),
      });
      setBf({ name: '', query: '', segment: '', city: '', target: '' });
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'erro');
    }
  };

  return (
    <Page
      title="Descoberta"
      sub="o agente procura prospects e vira lead"
      actions={
        <Link to="/lancar" className="btn ghost">
          lançar agente →
        </Link>
      }
    >
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

      <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 720 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--t-md)' }}>briefs diários</h3>
        <p className="sub" style={{ marginBottom: 12 }}>
          o agente roda cada brief uma vez por dia; disparar o contato continua manual
        </p>
        {briefs.length > 0 && (
          <table className="tbl" style={{ marginBottom: 12 }}>
            <tbody>
              {briefs.map((b) => (
                <tr key={b.id}>
                  <td>
                    <b>{b.name}</b>
                    <div
                      className="mono"
                      style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}
                    >
                      {b.query}
                    </div>
                  </td>
                  <td className="sub" style={{ whiteSpace: 'nowrap' }}>
                    {[b.segment, b.city].filter(Boolean).join(' · ') || '—'}
                    {b.target ? ` · ≤${b.target}/dia` : ''}
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {rel(b.last_run_at)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className={`btn ${b.enabled ? 'primary' : ''}`}
                        title={b.enabled ? 'ativado — clica pra pausar' : 'pausado'}
                        onClick={() =>
                          void api.patchBrief(b.id, { enabled: !b.enabled }).then(load)
                        }
                      >
                        {b.enabled ? 'ativo' : 'pausado'}
                      </button>
                      <button
                        className="btn"
                        title="remover brief"
                        onClick={() => void api.deleteBrief(b.id).then(load)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ width: 130 }}
            placeholder="nome"
            value={bf.name}
            onChange={(e) => setBf({ ...bf, name: e.target.value })}
          />
          <input
            style={{ flex: 2, minWidth: 200 }}
            placeholder="busca — ex: padarias de bairro sem site"
            value={bf.query}
            onChange={(e) => setBf({ ...bf, query: e.target.value })}
          />
          <input
            style={{ width: 110 }}
            placeholder="segmento"
            value={bf.segment}
            onChange={(e) => setBf({ ...bf, segment: e.target.value })}
          />
          <input
            style={{ width: 110 }}
            placeholder="cidade"
            value={bf.city}
            onChange={(e) => setBf({ ...bf, city: e.target.value })}
          />
          <input
            style={{ width: 80 }}
            type="number"
            min={1}
            max={1000}
            placeholder="alvo"
            value={bf.target}
            onChange={(e) => setBf({ ...bf, target: e.target.value })}
          />
          <button
            className="btn"
            disabled={!bf.name.trim() || !bf.query.trim()}
            onClick={() => void createBrief()}
          >
            <Plus size={14} /> criar
          </button>
        </div>
      </div>

      {segs.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 16, maxWidth: 720 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 'var(--t-md)' }}>o que converte</h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>segmento</th>
                <th>leads</th>
                <th>contatados</th>
                <th>responderam</th>
                <th>ativos</th>
                <th>custo 30d</th>
              </tr>
            </thead>
            <tbody>
              {segs.map((s) => (
                <tr key={s.segment}>
                  <td>{s.segment}</td>
                  <td className="mono">{s.leads}</td>
                  <td className="mono">{s.contacted}</td>
                  <td className="mono">
                    <b>{s.replied}</b>
                    {s.contacted > 0 && (
                      <span className="sub"> · {Math.round((s.replied / s.contacted) * 100)}%</span>
                    )}
                  </td>
                  <td className="mono">{s.live}</td>
                  <td className="mono">{fmtMoney(s.costCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint" style={{ marginTop: 8 }}>
            o agente vê este quadro na busca e reforça o que está convertendo
          </div>
        </div>
      )}

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
                    <td className="mono" title={l.fitReason ?? undefined}>
                      {l.fitScore != null ? `${l.fitScore}/10` : ''}
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
                        className={`chip ${r.status === 'failed' || r.status === 'canceled' ? 'bad' : r.status === 'done' ? '' : 'warn'}`}
                      >
                        {r.status}
                      </span>
                      {(r.status === 'queued' || r.status === 'running') && (
                        <button
                          className="btn ghost"
                          style={{ marginLeft: 6, padding: '2px 8px' }}
                          onClick={() => void api.cancelRun(r.id).then(load)}
                        >
                          cancelar
                        </button>
                      )}
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

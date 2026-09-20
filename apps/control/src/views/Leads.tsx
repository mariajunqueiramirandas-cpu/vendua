import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload, Download, Send } from 'lucide-react';
import { api, type LeadListItem } from '../api.ts';
import { Empty, Page, ScoreBar, StateChip, fmtMoney, rel } from '../components.tsx';

const GOAL_OPTS = [
  ['negotiation', 'fechar negócio'],
  ['meeting', 'marcar reunião'],
] as const;

export default function Leads() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [archived, setArchived] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState<'negotiation' | 'meeting'>('negotiation');
  const [dispatchMsg, setDispatchMsg] = useState('');
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    (cur?: string) => {
      api
        .leads({
          ...(q ? { q } : {}),
          ...(state ? { state } : {}),
          ...(archived ? { archived } : {}),
          ...(cur ? { cursor: cur } : {}),
          limit: '100',
        })
        .then((r) => {
          setLeads((ls) => (cur ? [...ls, ...r.leads] : r.leads));
          setCursor(r.nextCursor);
          setLoading(false);
        });
    },
    [q, state, archived],
  );
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // `/` focuses search, `n` opens new-lead — list-view keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('lead-q')?.focus();
      } else if (e.key === 'n') {
        e.preventDefault();
        setShowNew(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const importCsv = async (file: File) => {
    const csv = await file.text();
    const res = await api.importCsv(csv);
    setImportMsg(`${res.created} criados · ${res.skipped.length} ignorados`);
    load();
  };

  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dispatch = async () => {
    setDispatchBusy(true);
    setDispatchMsg('');
    try {
      const r = await api.dispatch([...sel], goal);
      setDispatchMsg(
        `${r.enqueued} disparado${r.enqueued === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} ignorado${r.skipped.length === 1 ? '' : 's'}` : ''}`,
      );
      setSel(new Set());
    } catch (e) {
      setDispatchMsg(e instanceof Error ? e.message : 'erro');
    } finally {
      setDispatchBusy(false);
    }
  };

  return (
    <Page
      title="Leads"
      actions={
        <>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> importar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])}
          />
          <a className="btn" href="/control/v1/leads/export" download="leads.csv">
            <Download size={14} /> exportar
          </a>
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <Plus size={14} /> novo <span className="kbd">n</span>
          </button>
        </>
      }
    >
      <div className="toolbar">
        <input
          id="lead-q"
          type="search"
          placeholder="buscar…  (/)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">todos os estágios</option>
          <option value="lead">lead</option>
          <option value="contacted">contatado</option>
          <option value="invited">convidado</option>
          <option value="live">ativo</option>
        </select>
        <select value={archived} onChange={(e) => setArchived(e.target.value)}>
          <option value="">ativos</option>
          <option value="only">arquivados</option>
          <option value="all">todos</option>
        </select>
        {importMsg && <span className="sub">{importMsg}</span>}
      </div>

      {sel.size > 0 && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>{sel.size} selecionado{sel.size === 1 ? '' : 's'}</b>
          <span className="sub">objetivo:</span>
          <span className="seg">
            {GOAL_OPTS.map(([v, l]) => (
              <button key={v} className={goal === v ? 'sel' : ''} onClick={() => setGoal(v)}>
                {l}
              </button>
            ))}
          </span>
          <button className="btn agent" disabled={dispatchBusy} onClick={() => void dispatch()}>
            <Send size={14} /> disparar agente
          </button>
          {dispatchMsg && <span className="sub">{dispatchMsg}</span>}
        </div>
      )}

      {loading ? (
        <Empty title="carregando…" />
      ) : !leads.length ? (
        <Empty
          title="nenhum lead"
          hint={q ? 'busca sem resultados — limpe os filtros' : 'crie o primeiro (n)'}
        />
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 24 }}>
                  <input
                    type="checkbox"
                    checked={sel.size > 0 && sel.size === leads.length}
                    onChange={() =>
                      setSel((s) =>
                        s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)),
                      )
                    }
                  />
                </th>
                <th>nome</th>
                <th>negócio</th>
                <th>estágio</th>
                <th>segmento</th>
                <th>cidade</th>
                <th>valor</th>
                <th>fit</th>
                <th>score</th>
                <th>agente</th>
                <th>últ. atividade</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => nav(`/leads/${l.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={sel.has(l.id)}
                      onChange={() => toggleSel(l.id)}
                    />
                  </td>
                  <td>
                    <b>{l.name}</b>
                    {l.unsubscribedAt && (
                      <span className="chip bad" style={{ marginLeft: 6 }}>
                        descadastrado
                      </span>
                    )}
                    {l.emailBouncedAt && (
                      <span className="chip warn" style={{ marginLeft: 4 }}>
                        email bounce
                      </span>
                    )}
                  </td>
                  <td>{l.businessName ?? '—'}</td>
                  <td>
                    <StateChip state={l.state} />
                  </td>
                  <td>{l.segment ?? '—'}</td>
                  <td>{l.city ?? '—'}</td>
                  <td className="mono">{fmtMoney(l.dealValueCents)}</td>
                  <td className="mono" title={l.fitReason ?? undefined}>
                    {l.fitScore != null ? `${l.fitScore}/10` : '—'}
                  </td>
                  <td>
                    <ScoreBar score={l.score} />
                  </td>
                  <td>
                    {l.agentMode !== 'off' ? (
                      <span className="chip agent">{l.agentMode}</span>
                    ) : (
                      <span className="chip">off</span>
                    )}
                  </td>
                  <td className="mono">{rel(l.lastActivityAt ?? l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <button className="btn" onClick={() => load(cursor)}>
            mais
          </button>
        </div>
      )}
      {showNew && (
        <NewLead
          onClose={(created) => {
            setShowNew(false);
            if (created) {
              load();
            }
          }}
        />
      )}
    </Page>
  );
}

function NewLead({ onClose }: { onClose: (created: boolean) => void }) {
  const [f, setF] = useState({
    name: '',
    businessName: '',
    whatsapp: '',
    email: '',
    instagram: '',
    city: '',
    segment: '',
    source: '',
    deal: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createLead({
        name: f.name,
        businessName: f.businessName || null,
        whatsapp: f.whatsapp || null,
        email: f.email || null,
        instagram: f.instagram || null,
        city: f.city || null,
        segment: f.segment || null,
        source: f.source || null,
        dealValueCents: f.deal ? Math.round(Number(f.deal.replace(',', '.')) * 100) : null,
      });
      onClose(true);
      nav(`/leads/${res.lead.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'erro');
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, ph = '') => (
    <div className="field">
      <label>{label}</label>
      <input
        value={f[k]}
        placeholder={ph}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        autoFocus={k === 'name'}
      />
    </div>
  );

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={() => onClose(false)} />
      <div className="drawer" role="dialog" aria-label="novo lead">
        <div className="d-head">
          <b>novo lead</b>
        </div>
        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="d-body">
            {field('name', 'nome *')}
            {field('businessName', 'negócio')}
            {field('whatsapp', 'whatsapp', '+55 85 9…')}
            {field('email', 'email')}
            {field('instagram', 'instagram', '@perfil')}
            <div className="grid2">
              {field('city', 'cidade')}
              {field('segment', 'segmento')}
            </div>
            {field('source', 'origem')}
            {field('deal', 'valor estimado (R$)')}
            {err && <div style={{ color: 'var(--red-400)', fontSize: 'var(--t-xs)' }}>{err}</div>}
          </div>
          <div className="d-foot">
            <button className="btn primary" disabled={busy || !f.name.trim()}>
              criar
            </button>
            <button className="btn ghost" type="button" onClick={() => onClose(false)}>
              cancelar
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

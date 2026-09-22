import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, Pencil, X } from 'lucide-react';
import { api, type Draft } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, rel } from '../components.tsx';

export default function Approvals() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});

  // Newest applied load wins — a stalled earlier response still commits
  // unless a newer SUCCESS already landed; a failed refresh loses nothing.
  const reqSeq = useRef(0);
  const okSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    api.approvals().then((r) => {
      if (seq < okSeq.current) return;
      okSeq.current = seq;
      setDrafts(r.drafts);
    });
  }, []);
  useEffect(load, [load]);
  useEffect(() => onControlEvent('draft.change', load), [load]);
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const approve = async (d: Draft) => {
    const res = await api.approve(d.id);
    setResults((r) => ({
      ...r,
      [d.id]: res.stale
        ? 'rascunho expirado — regenerando contra o estado atual'
        : res.sent?.ok
          ? 'enviado'
          : `falhou: ${res.sent?.reason ?? 'desconhecido'}`,
    }));
    load();
  };
  const reject = async (d: Draft) => {
    await api.reject(d.id);
    load();
  };
  const saveEdit = async (d: Draft) => {
    // Edit = create the replacement draft first, then reject the original —
    // if compose fails the original draft survives and nothing is lost.
    // The audit trail keeps both versions.
    let replacement: string;
    try {
      const res = await api.sendThreadMessage(d.threadId, editBody, false);
      replacement = res.message.id;
    } catch {
      setResults((r) => ({ ...r, [d.id]: 'falhou ao criar rascunho editado — original mantido' }));
      return;
    }
    await api.reject(d.id);
    // "salvar + aprovar" means the edited version goes out — approve the
    // replacement, not just leave it pending for a second pass.
    try {
      const res = await api.approve(replacement);
      setResults((r) => ({
        ...r,
        [d.id]: res.sent?.ok
          ? 'enviado (editado)'
          : `salvo, falhou ao enviar: ${res.sent?.reason ?? 'desconhecido'}`,
      }));
    } catch {
      setResults((r) => ({ ...r, [d.id]: 'salvo como rascunho — aprove na fila' }));
    }
    setEditing(null);
    load();
  };

  return (
    <Page
      title="Aprovações"
      sub={`${drafts.length} rascunho${drafts.length === 1 ? '' : 's'} do agente`}
    >
      {!drafts.length && (
        <Empty title="fila limpa" hint="rascunhos do agente aparecem aqui para revisão" />
      )}
      <div className="appr-list">
        {drafts.map((d) => (
          <div key={d.id} className="card appr-card">
            <div className="appr-head">
              <span className="chip agent">
                <Bot size={11} /> agente
              </span>
              <span className="chip">{d.channel}</span>
              <Link className="appr-lead" to={`/leads/${d.leadId}`}>
                <b>{d.leadName}</b>
              </Link>
              {d.businessName && d.businessName !== d.leadName && (
                <span className="appr-biz">{d.businessName}</span>
              )}
              <span className="appr-time mono">{rel(d.createdAt)}</span>
            </div>
            {editing === d.id ? (
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                style={{ width: '100%', minHeight: 110 }}
                autoFocus
              />
            ) : (
              <div className="d-bubble">{d.body}</div>
            )}
            {results[d.id] && (
              <div className={`appr-res${/falhou/.test(results[d.id]!) ? ' bad' : ''}`}>
                {results[d.id]}
              </div>
            )}
            <div className="appr-acts">
              {editing === d.id ? (
                <>
                  <button className="btn primary" onClick={() => void saveEdit(d)}>
                    <Check size={14} /> salvar + aprovar
                  </button>
                  <button className="btn ghost" onClick={() => setEditing(null)}>
                    cancelar
                  </button>
                </>
              ) : (
                <>
                  <button className="btn agent" onClick={() => void approve(d)}>
                    <Check size={14} /> aprovar
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setEditing(d.id);
                      setEditBody(d.body);
                    }}
                  >
                    <Pencil size={14} /> editar
                  </button>
                  <button className="btn ghost danger" onClick={() => void reject(d)}>
                    <X size={14} /> rejeitar
                  </button>
                  <Link to={`/inbox/${d.threadId}`} className="btn ghost appr-link">
                    ver thread
                  </Link>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, Pencil, X } from 'lucide-react';
import { api, type Draft } from '../api.ts';
import { Empty, Page, rel } from '../components.tsx';

export default function Approvals() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [results, setResults] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api.approvals().then((r) => setDrafts(r.drafts));
  }, []);
  useEffect(load, [load]);

  const approve = async (d: Draft) => {
    const res = await api.approve(d.id);
    setResults((r) => ({ ...r, [d.id]: res.sent.ok ? 'enviado' : `falhou: ${res.sent.reason}` }));
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
        [d.id]: res.sent.ok ? 'enviado (editado)' : `salvo, falhou ao enviar: ${res.sent.reason}`,
      }));
    } catch {
      setResults((r) => ({ ...r, [d.id]: 'salvo como rascunho — aprove na fila' }));
    }
    setEditing(null);
    load();
  };

  return (
    <Page title="Aprovações" sub={`${drafts.length} rascunhos do agente`}>
      {!drafts.length && (
        <Empty title="fila limpa" hint="rascunhos do agente aparecem aqui para revisão" />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 780 }}>
        {drafts.map((d) => (
          <div key={d.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span className="chip agent">
                <Bot size={11} /> agente
              </span>
              <span className="chip">{d.channel}</span>
              <Link to={`/leads/${d.leadId}`}>
                <b>{d.leadName}</b>
              </Link>
              {d.businessName && d.businessName !== d.leadName && (
                <span style={{ color: 'var(--muted)' }}>{d.businessName}</span>
              )}
              <span
                className="mono"
                style={{ marginLeft: 'auto', fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}
              >
                {rel(d.createdAt)}
              </span>
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
              <div style={{ marginTop: 6, fontSize: 'var(--t-xs)', color: 'var(--muted)' }}>
                {results[d.id]}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
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
                  <Link to={`/inbox/${d.threadId}`} className="btn ghost">
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

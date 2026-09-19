import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bot, Send } from 'lucide-react';
import { api, type ThreadItem, type ThreadView } from '../api.ts';
import { Avatar, Empty, Page, StateChip, rel } from '../components.tsx';

const CH_LABEL: Record<string, string> = { email: 'email', whatsapp: 'whats', manual: 'manual' };

export default function InboxView() {
  const { threadId } = useParams();
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [chan, setChan] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState('');
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .threads({ ...(chan ? { channel: chan } : {}), ...(q ? { q } : {}) })
      .then((r) => setThreads(r.threads));
  }, [chan, q]);

  const reqSeq = useRef(0);
  const loadThread = useCallback(() => {
    if (!threadId) {
      setView(null);
      return;
    }
    const req = ++reqSeq.current;
    api.thread(threadId).then((v) => {
      // Drop stale responses — a slower earlier request must never paint
      // over the thread the URL now names (composer would send to threadId
      // while the screen shows another conversation).
      if (req !== reqSeq.current || v.thread.id !== threadId) return;
      setView(v);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    });
  }, [threadId]);
  useEffect(loadThread, [loadThread]);

  const send = async (asDraft: boolean) => {
    const target = view?.thread.id;
    if (!target || target !== threadId || !draft.trim()) return;
    await api.sendThreadMessage(target, draft, !asDraft);
    setDraft('');
    loadThread();
  };

  return (
    <Page title="Inbox">
      <div className="inbox card" style={{ overflow: 'hidden' }}>
        <div className="thread-list">
          <div
            style={{ padding: 10, borderBottom: '1px solid var(--line)', display: 'flex', gap: 6 }}
          >
            <input
              placeholder="buscar…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ flex: 1 }}
            />
            <select value={chan} onChange={(e) => setChan(e.target.value)}>
              <option value="">todos</option>
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="manual">manual</option>
            </select>
          </div>
          {threads.map((t) => (
            <button
              key={t.id}
              className={`thread-row${t.id === threadId ? ' active' : ''}`}
              onClick={() => nav(`/inbox/${t.id}`)}
            >
              <Avatar name={t.leadName} />
              <span className="tr-main">
                <span className="tr-top">
                  <b>{t.leadName}</b>
                  <time>{rel(t.lastMessageAt)}</time>
                </span>
                <span className="last">
                  {t.lastDirection === 'out' ? 'você: ' : ''}
                  {t.lastBody ?? 'sem mensagens'}
                </span>
                <span className="tr-chips">
                  {t.needsReply && <span className="chip warn">responder</span>}
                  {t.pendingDrafts > 0 && (
                    <span className="chip warn">{t.pendingDrafts} rasc.</span>
                  )}
                  {t.agentEnabled && (
                    <span className="chip agent">
                      <Bot size={10} />
                    </span>
                  )}
                  <span className="chip">{CH_LABEL[t.channel]}</span>
                </span>
              </span>
            </button>
          ))}
          {!threads.length && (
            <Empty
              title="inbox vazia"
              hint="conversas chegam via whatsapp/email ou quando o agente inicia contato"
            />
          )}
        </div>

        {!threadId || !view ? (
          <Empty title={threadId ? 'carregando…' : 'escolha uma conversa'} />
        ) : (
          <div className="thread-view">
            <div className="thread-head">
              <Avatar name={view.lead.name} lg />
              <div style={{ minWidth: 0 }}>
                <Link to={`/leads/${view.thread.leadId}`}>
                  <b>{view.lead.name}</b>
                </Link>
                <div
                  style={{
                    fontSize: 'var(--t-2xs)',
                    color: 'var(--muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {view.thread.subject ?? CH_LABEL[view.thread.channel]}
                </div>
              </div>
              <StateChip state={view.lead.state} />
              <label className="tgl" style={{ marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={view.thread.agentEnabled}
                  onChange={(e) =>
                    void api.setThreadAgent(view.thread.id, e.target.checked).then(loadThread)
                  }
                />
                <span className="tk" />
                <span className="lbl">agente</span>
              </label>
            </div>
            <div className="thread-msgs">
              {view.messages.map((m, i) => {
                const day = new Date(m.createdAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'short',
                });
                const prevDay =
                  i > 0
                    ? new Date(view.messages[i - 1]!.createdAt).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                      })
                    : null;
                return (
                  <div key={m.id} style={{ display: 'contents' }}>
                    {day !== prevDay && <div className="day-sep">{day}</div>}
                    <div className={`msg ${m.direction}`}>
                      {m.body}
                      <div className="m-meta">
                        {m.author === 'agent' && (
                          <span className="chip agent" style={{ fontSize: '0.85em' }}>
                            agente
                          </span>
                        )}
                        {m.status === 'draft' && <span className="draft">rascunho</span>}
                        {m.status === 'failed' && (
                          <span style={{ color: 'var(--red-400)' }}>falhou</span>
                        )}
                        {m.status === 'rejected' && (
                          <span style={{ color: 'var(--red-400)' }}>rejeitado</span>
                        )}
                        <span>{rel(m.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="composer">
              <textarea
                placeholder={`responder via ${CH_LABEL[view.thread.channel]}… (ctrl+enter envia, shift+ctrl+enter rascunha)`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey && e.shiftKey) {
                    e.preventDefault();
                    void send(true);
                  } else if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    void send(false);
                  }
                }}
              />
              <button className="btn" onClick={() => void send(true)} disabled={!draft.trim()}>
                rascunho
              </button>
              <button
                className="btn primary"
                onClick={() => void send(false)}
                disabled={!draft.trim()}
              >
                <Send size={14} /> enviar
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

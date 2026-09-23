import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Plus, Send } from 'lucide-react';
import { api, type LeadListItem, type ThreadItem, type ThreadView } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Avatar, Empty, Page, StateChip, rel } from '../components.tsx';

const CH_LABEL: Record<string, string> = { email: 'email', whatsapp: 'whatsapp', manual: 'manual' };
/** Channels a fresh conversation can start on — gated by what the lead card
 *  actually carries (manual is always available: it never dispatches). */
const CH_PICK: { ch: string; has: (l: LeadListItem) => boolean }[] = [
  { ch: 'whatsapp', has: (l) => Boolean(l.whatsapp) },
  { ch: 'email', has: (l) => Boolean(l.email) },
  { ch: 'manual', has: () => true },
];

export default function InboxView() {
  const { threadId } = useParams();
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [chan, setChan] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<ThreadView | null>(null);
  const [draft, setDraft] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [leadQ, setLeadQ] = useState('');
  const [leadHits, setLeadHits] = useState<LeadListItem[]>([]);
  const [assistBusy, setAssistBusy] = useState(false);
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const subjRef = useRef<HTMLInputElement>(null);

  // Newest-successful wins, scoped to the current filter — an older
  // response still commits unless a newer success already landed, but never
  // one whose captured filter is no longer displayed.
  const listSeq = useRef(0);
  const listOk = useRef(0);
  const listFor = useRef('');
  const refreshList = useCallback(() => {
    const f = `${chan}|${q}`;
    listFor.current = f;
    const req = ++listSeq.current;
    api.threads({ ...(chan ? { channel: chan } : {}), ...(q ? { q } : {}) }).then((r) => {
      if (f !== listFor.current || req <= listOk.current) return;
      listOk.current = req;
      setThreads(r.threads);
    });
  }, [chan, q]);
  useEffect(refreshList, [refreshList]);

  // "nova conversa" picker — debounced lead search while the panel is open.
  const pickSeq = useRef(0);
  useEffect(() => {
    if (!newOpen) return;
    const req = ++pickSeq.current;
    const t = setTimeout(() => {
      api
        .leads({ ...(leadQ ? { q: leadQ } : {}) })
        // a slower response for an earlier query can't overwrite the latest
        .then((r) => {
          if (req === pickSeq.current) setLeadHits(r.leads);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [newOpen, leadQ]);

  const openThread = async (leadId: string, channel: string) => {
    const r = await api.newThread(leadId, channel);
    setNewOpen(false);
    setLeadQ('');
    refreshList();
    nav(`/inbox/${r.thread.id}`);
  };

  // Same success-watermark scoped to the URL's thread — a stale response
  // commits only while its thread is still the open one and no newer
  // success landed, so the composer can never send to threadId while the
  // screen shows another conversation.
  const reqSeq = useRef(0);
  const okSeq = useRef(0);
  const viewFor = useRef<string | undefined>(threadId);
  const loadThread = useCallback(() => {
    viewFor.current = threadId;
    if (!threadId) {
      setView(null);
      return;
    }
    const t = threadId;
    const req = ++reqSeq.current;
    api.thread(t).then((v) => {
      if (t !== viewFor.current || req <= okSeq.current) return;
      okSeq.current = req;
      setView(v);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
    });
  }, [threadId]);
  useEffect(loadThread, [loadThread]);

  // thread.message accelerates both reads — a ref naming another thread
  // still refreshes the row, only the open-thread refetch is skipped.
  useEffect(
    () =>
      onControlEvent('thread.message', (e) => {
        refreshList();
        if (!e.ref || e.ref === threadId) loadThread();
      }),
    [refreshList, loadThread, threadId],
  );
  // Floor while the stream is dead — misses nothing, just slower.
  useEffect(() => {
    const t = setInterval(() => {
      refreshList();
      loadThread();
    }, 60_000);
    return () => clearInterval(t);
  }, [refreshList, loadThread]);

  const send = async (asDraft: boolean) => {
    const target = view?.thread.id;
    if (!target || target !== threadId || !draft.trim()) return;
    await api.sendThreadMessage(
      target,
      draft,
      !asDraft,
      subjRef.current?.value.trim() || undefined,
    );
    setDraft('');
    loadThread();
    // the row's last-message preview + rasc. chip go stale otherwise
    refreshList();
  };

  // "agente sugere" — a draftOnly run bound to this thread: the agent reads
  // lead + conversation and leaves a draft in the approvals lane instead of
  // sending. reply when there's an inbound to answer, outreach for the first
  // touch on an empty thread.
  const suggest = () => {
    const v = view;
    if (!v || v.thread.id !== threadId || assistBusy) return;
    setAssistBusy(true);
    const kind = v.messages.some((m) => m.direction === 'in') ? 'reply' : 'outreach';
    const beforeDrafts = v.messages.filter(
      (m) => m.author === 'agent' && m.status === 'draft',
    ).length;
    void api
      .runOnLead(v.lead.id, kind, { draftOnly: true }, v.thread.id)
      .then(() => {
        const deadline = Date.now() + 90_000;
        const tick = () =>
          api
            .thread(v.thread.id)
            .then((t) => {
              if (t.thread.id !== threadId) {
                setAssistBusy(false);
                return;
              }
              const drafts = t.messages.filter(
                (m) => m.author === 'agent' && m.status === 'draft',
              ).length;
              if (drafts > beforeDrafts || Date.now() > deadline) {
                setAssistBusy(false);
                setView(t);
                refreshList();
                setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 30);
                return;
              }
              setTimeout(tick, 4000);
            })
            .catch(() => setAssistBusy(false));
        setTimeout(tick, 3000);
      })
      .catch(() => setAssistBusy(false));
  };

  return (
    <Page title="Inbox">
      {/* has-thread drives the mobile master/detail fold in styles.css */}
      <div className={`inbox card${threadId ? ' has-thread' : ''}`}>
        <div className="thread-list">
          <div className="inbox-tools">
            <input placeholder="buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={chan} onChange={(e) => setChan(e.target.value)}>
              <option value="">todos</option>
              <option value="whatsapp">whatsapp</option>
              <option value="email">email</option>
              <option value="manual">manual</option>
            </select>
            <button
              className={`btn ghost${newOpen ? ' active' : ''}`}
              onClick={() => setNewOpen((o) => !o)}
              aria-label="nova conversa"
              title="nova conversa com um lead"
            >
              <Plus size={14} />
            </button>
          </div>
          {newOpen && (
            <div className="inbox-new">
              <input
                placeholder="buscar lead por nome, negócio ou contato…"
                value={leadQ}
                onChange={(e) => setLeadQ(e.target.value)}
                autoFocus
              />
              <div className="inbox-new-hits">
                {leadHits.map((l) => (
                  <div key={l.id} className="inbox-lead">
                    <div className="inbox-lead-main">
                      <b>{l.name}</b>
                      {l.businessName && l.businessName !== l.name && (
                        <span className="inbox-biz"> · {l.businessName}</span>
                      )}
                    </div>
                    {CH_PICK.map(({ ch, has }) => (
                      <button
                        key={ch}
                        className="btn ghost inbox-chpick"
                        disabled={!has(l)}
                        title={
                          has(l)
                            ? ch === 'whatsapp' && !l.whatsappVerified
                              ? 'whatsapp derivado do telefone — não verificado'
                              : `conversar via ${ch}`
                            : `lead sem ${ch}`
                        }
                        onClick={() => void openThread(l.id, ch)}
                      >
                        {CH_LABEL[ch]}
                      </button>
                    ))}
                  </div>
                ))}
                {!leadHits.length && (
                  <div className="hint inbox-lead-empty">
                    {leadQ ? 'nenhum lead com esse nome' : 'digite para buscar'}
                  </div>
                )}
              </div>
            </div>
          )}
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
              hint="conversas chegam via whatsapp/email, pelo botão + acima, ou quando o agente inicia contato"
            />
          )}
        </div>

        {!threadId || !view ? (
          <Empty title={threadId ? 'carregando…' : 'escolha uma conversa'} />
        ) : (
          <div className="thread-view">
            <div className="thread-head">
              <button
                className="btn ghost m-back"
                onClick={() => nav('/inbox')}
                aria-label="voltar para a lista"
              >
                <ArrowLeft size={16} />
              </button>
              <Avatar name={view.lead.name} lg />
              <div className="thread-id">
                <Link to={`/leads/${view.thread.leadId}`}>
                  <b>{view.lead.name}</b>
                </Link>
                <div className="thread-sub">
                  {view.thread.subject ?? CH_LABEL[view.thread.channel]}
                </div>
              </div>
              <StateChip state={view.lead.state} />
              <label className="tgl">
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
                        {m.author === 'agent' && <span className="chip agent">agente</span>}
                        {m.status === 'draft' && <span className="draft">rascunho</span>}
                        {m.status === 'failed' && (
                          <span className="m-bad" title={m.error ?? undefined}>
                            falhou
                          </span>
                        )}
                        {m.status === 'rejected' && (
                          <span className="m-bad" title={m.error ?? undefined}>
                            rejeitado
                          </span>
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
              {view.thread.channel === 'email' && (
                <input
                  key={view.thread.id}
                  ref={subjRef}
                  className="subj"
                  defaultValue={view.thread.subject ?? ''}
                  placeholder="assunto do email"
                  aria-label="assunto do email"
                  maxLength={200}
                />
              )}
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
              <button
                className="btn ghost"
                onClick={suggest}
                disabled={assistBusy || !view.thread.agentEnabled || !!view.lead.agentPausedAt}
                title={
                  view.lead.agentPausedAt
                    ? 'agente pausado neste lead (handoff) — retome no card do lead'
                    : view.thread.agentEnabled
                      ? 'o agente lê a conversa e deixa um rascunho — nada é enviado'
                      : 'agente pausado nesta conversa — reative o toggle acima para pedir sugestão'
                }
              >
                <Bot size={14} /> {assistBusy ? 'escrevendo…' : 'agente sugere'}
              </button>
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

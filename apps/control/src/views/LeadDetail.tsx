import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Ban, Bot, Link2, Plus, Video } from 'lucide-react';
import {
  api,
  ApiError,
  type Activity,
  type AgentRun,
  type LeadListItem,
  type Meeting,
  type Task,
} from '../api.ts';
import { onControlEvent } from '../events.ts';
import {
  AGENT_GOALS,
  ConfirmBtn,
  Empty,
  LEAD_STATES,
  MEETING_STATUS_LABEL,
  Page,
  RUN_KIND_LABEL,
  ScoreBar,
  fmtDateTime,
  fmtMoney,
} from '../components.tsx';

const KIND_LABEL: Record<string, string> = {
  note: 'nota',
  call: 'liga',
  meeting: 'reunião',
  meeting_booked: 'call marcada',
  meeting_done: 'call feita',
  meeting_no_show: 'no-show',
  meeting_cancelled: 'call cancelada',
  state_change: 'estágio',
  agent: 'agente',
  system: 'sistema',
  blocked: 'envio bloqueado',
};
const AGENT_OPTS: [string, string][] = [
  ['off', 'off'],
  ['draft', 'rascunho'],
  ['auto', 'auto'],
];

// stored websites are free text — linkify only values that normalize to an
// absolute http(s) URL; anything else renders as plain text
function httpUrl(raw: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export default function LeadDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [lead, setLead] = useState<LeadListItem | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<{ id: string; channel: string; agentEnabled: boolean }[]>(
    [],
  );
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [schedRuns, setSchedRuns] = useState<AgentRun[]>([]);
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [actChannel, setActChannel] = useState<'auto' | 'whatsapp' | 'email'>('auto');
  const [notFound, setNotFound] = useState(false);

  // Each endpoint keeps its own applied watermark — an older response still
  // commits unless a newer SUCCESS for that same resource already landed,
  // so one failed endpoint can't discard another's usable data. Only an
  // explicit 404 is a missing lead — a transient refresh failure must not
  // swap the page for the not-found state.
  const reqSeq = useRef(0);
  const okSeq = useRef<Record<string, number>>({});
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    const ok = (k: string) => {
      if (seq < (okSeq.current[k] ?? 0)) return false;
      okSeq.current[k] = seq;
      return true;
    };
    api
      .lead(id)
      .then((r) => {
        if (!ok('lead')) return;
        setNotFound(false);
        setLead(r.lead);
      })
      .catch((e) => {
        if (seq >= (okSeq.current.lead ?? 0) && e instanceof ApiError && e.status === 404)
          setNotFound(true);
      });
    api.activities(id).then((r) => {
      if (ok('acts')) setActs(r.activities);
    });
    api.tasks({ leadId: id }).then((r) => {
      if (ok('tasks')) setTasks(r.tasks);
    });
    api.leadThreads(id).then((r) => {
      if (ok('threads')) setThreads(r.threads);
    });
    api.meetings({ leadId: id, scope: 'all' }).then((r) => {
      if (ok('meetings')) setMeetings(r.meetings);
    });
    // Queued runs with a run_at — the scheduled first contact (or a delayed
    // reply) staff would otherwise have to find on the Runs page.
    api.runs({ lead_id: id, status: 'queued' }).then((r) => {
      if (ok('runs')) setSchedRuns(r.runs.filter((x) => x.run_at));
    });
  }, [id]);
  useEffect(load, [load]);
  // The page renders lead, meetings, and queued runs — all three types map
  // to the same load; a lead.change ref for another lead skips the reload.
  useEffect(
    () =>
      onControlEvent(['lead.change', 'meeting.change', 'run.update'], (e) => {
        if (e.type === 'lead.change' && e.ref && e.ref !== id) return;
        load();
      }),
    [load, id],
  );
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (notFound)
    return (
      <Page title="Lead">
        <Empty title="lead não encontrado" />
      </Page>
    );
  if (!lead)
    return (
      <Page title="Lead">
        <Empty title="carregando…" />
      </Page>
    );

  const patch = (p: Record<string, unknown>) => api.patchLead(lead.id, p).then(load);
  const siteHref = lead.website ? httpUrl(lead.website) : null;
  const addNote = async () => {
    if (!note.trim()) return;
    await api.addActivity(lead.id, 'note', note);
    setNote('');
    load();
  };
  const addTask = async () => {
    if (!taskTitle.trim()) return;
    await api.createTask(lead.id, taskTitle);
    setTaskTitle('');
    load();
  };

  return (
    <Page
      title={lead.name}
      sub={lead.businessName ?? undefined}
      actions={
        <div className="lead-acts">
          {lead.agentMode !== 'off' && (
            <>
              <select
                value={actChannel}
                onChange={(e) => setActChannel(e.target.value as typeof actChannel)}
                title="canal do disparo — auto = o agente escolhe o canal alcançável"
              >
                <option value="auto">canal: auto</option>
                <option value="whatsapp">canal: whatsapp</option>
                <option value="email">canal: email</option>
              </select>
              <button
                className="btn agent"
                title="rodar o agente agora"
                onClick={() =>
                  void api
                    .runOnLead(
                      lead.id,
                      'outreach',
                      actChannel === 'auto' ? {} : { channel: actChannel },
                    )
                    .then(load)
                }
              >
                <Bot size={14} /> agir
              </button>
            </>
          )}
          <ConfirmBtn onConfirm={() => void api.unsubscribe(lead.id).then(load)}>
            <Ban size={14} /> descadastrar
          </ConfirmBtn>
          <ConfirmBtn
            className="danger"
            confirm="arquivar mesmo?"
            onConfirm={() => void api.deleteLead(lead.id).then(() => nav('/leads'))}
          >
            <Archive size={14} /> arquivar
          </ConfirmBtn>
        </div>
      }
    >
      <div className="lead-page">
        <div className="lead-cols">
          <div className="lead-left">
            <div className="card lead-summary" style={{ padding: 18 }}>
              <div className="seg-row">
                <span className="seg" title="estágio do lead">
                  {LEAD_STATES.map(([v, l]) => (
                    <button
                      key={v}
                      className={lead.state === v ? 'sel' : ''}
                      onClick={() => void patch({ state: v })}
                    >
                      {l}
                    </button>
                  ))}
                </span>
                <span className="seg" title="modo do agente">
                  {AGENT_OPTS.map(([v, l]) => (
                    <button
                      key={v}
                      className={lead.agentMode === v ? 'sel' : ''}
                      onClick={() => void patch({ agentMode: v })}
                    >
                      {l}
                    </button>
                  ))}
                </span>
                {lead.agentMode !== 'off' && (
                  <span className="seg" title="objetivo do agente">
                    {AGENT_GOALS.map(([v, l]) => (
                      <button
                        key={v}
                        className={lead.agentGoal === v ? 'sel' : ''}
                        onClick={() => void patch({ agentGoal: v })}
                      >
                        {l}
                      </button>
                    ))}
                  </span>
                )}
                <span style={{ marginLeft: 'auto' }}>
                  <ScoreBar score={lead.score} />
                </span>
              </div>
              <div className="kv">
                {(
                  [
                    ['whatsapp', lead.whatsapp],
                    ['email', lead.email],
                    ['instagram', lead.instagram],
                    ['cidade', lead.city],
                    ['segmento', lead.segment],
                    ['origem', lead.source],
                    ['descoberto via', lead.discoveredVia],
                  ] as [string, string | null][]
                ).map(([k, v]) => (
                  <div key={k}>
                    <div className="k">{k}</div>
                    <div className="v">{v ?? '—'}</div>
                  </div>
                ))}
                <div>
                  <div className="k">site</div>
                  <div className="v">
                    {siteHref ? (
                      <a href={siteHref} target="_blank" rel="noreferrer">
                        {lead.website!.replace(/^https?:\/\//i, '')}
                      </a>
                    ) : (
                      (lead.website ?? '—')
                    )}
                  </div>
                </div>
                <div>
                  <div className="k">valor</div>
                  <div className="v">
                    <MoneyEdit
                      cents={lead.dealValueCents}
                      onSave={(c) => void patch({ dealValueCents: c })}
                    />
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <div
                  className="k"
                  style={{
                    fontSize: 'var(--t-2xs)',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                    marginBottom: 4,
                  }}
                >
                  tags
                </div>
                <TagEditor tags={lead.tags} onSave={(tags) => void patch({ tags })} />
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <div className="sec-t">conversas</div>
              {threads.map((t) => (
                <div key={t.id} className="trow">
                  <span className="chip">{t.channel}</span>
                  <Link to={`/inbox/${t.id}`} className="btn ghost" style={{ padding: '3px 8px' }}>
                    abrir
                  </Link>
                  <label className="tgl" style={{ marginLeft: 'auto' }}>
                    <input
                      type="checkbox"
                      checked={t.agentEnabled}
                      onChange={(e) => void api.setThreadAgent(t.id, e.target.checked).then(load)}
                    />
                    <span className="tk" />
                    <span className="lbl">agente</span>
                  </label>
                </div>
              ))}
              {!threads.length && (
                <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                  nenhuma conversa ainda — o agente cria uma ao primeiro contato
                </div>
              )}
              {schedRuns.map((r) => (
                <div key={r.id} className="trow">
                  <span className="chip">{RUN_KIND_LABEL[r.kind] ?? r.kind}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
                    agenda {fmtDateTime(r.run_at)}
                  </span>
                  <button
                    className="btn ghost"
                    style={{ padding: '3px 8px' }}
                    onClick={() => void api.cancelRun(r.id).then(load)}
                  >
                    cancelar
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {(['whatsapp', 'email', 'manual'] as const)
                  .filter((ch) => !threads.some((t) => t.channel === ch))
                  .map((ch) => (
                    <button
                      key={ch}
                      className="btn ghost"
                      style={{ fontSize: 'var(--t-xs)' }}
                      onClick={() => void api.newThread(id, ch).then(load)}
                    >
                      + {ch}
                    </button>
                  ))}
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <div className="sec-t" style={{ display: 'flex', alignItems: 'center' }}>
                calls
                <CopyLinkBtn leadId={lead.id} />
              </div>
              {meetings.map((m) => (
                <div key={m.id} className="trow">
                  <span style={{ flex: 1 }}>
                    {fmtDateTime(m.startsAt)}
                    <span className={`chip stc-${m.status}`} style={{ marginLeft: 8 }}>
                      {MEETING_STATUS_LABEL[m.status]}
                    </span>
                  </span>
                  {m.roomUrl && m.status === 'scheduled' && (
                    <a
                      className="icon-btn"
                      href={m.roomUrl}
                      target="_blank"
                      rel="noopener"
                      title="abrir sala"
                      aria-label="abrir sala"
                    >
                      <Video size={13} />
                    </a>
                  )}
                  {m.status === 'scheduled' && (
                    <button
                      className="btn ghost"
                      style={{ padding: '2px 8px', fontSize: 'var(--t-2xs)' }}
                      onClick={() =>
                        void api.patchMeeting(m.id, { status: 'cancelled' }).then(load)
                      }
                    >
                      cancelar
                    </button>
                  )}
                </div>
              ))}
              {!meetings.length && (
                <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                  nenhuma call ainda — copie o link e mande pro lead
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 18 }}>
              <div className="sec-t">tarefas</div>
              {tasks.map((t) => {
                const late = t.dueAt && !t.doneAt && new Date(t.dueAt) < new Date();
                return (
                  <div key={t.id} className="trow">
                    <input
                      type="checkbox"
                      checked={!!t.doneAt}
                      onChange={(e) => void api.setTaskDone(t.id, e.target.checked).then(load)}
                    />
                    <span
                      style={{
                        flex: 1,
                        textDecoration: t.doneAt ? 'line-through' : undefined,
                        color: t.doneAt ? 'var(--muted)' : undefined,
                      }}
                    >
                      {t.title}
                    </span>
                    {t.createdBy === 'agent' && (
                      <span className="chip agent" title="tarefa criada pelo agente">
                        agente
                      </span>
                    )}
                    <span className={`due${late ? ' bad' : ''}`}>
                      {late ? 'atrasada · ' : ''}
                      {fmtDateTime(t.dueAt)}
                    </span>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <input
                  placeholder="nova tarefa…"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addTask()}
                  style={{ flex: 1 }}
                />
                <button className="btn" onClick={() => void addTask()}>
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="card lead-timeline" style={{ padding: 18 }}>
            <div className="sec-t">linha do tempo</div>
            <div style={{ display: 'flex', gap: 8, margin: '2px 0 12px' }}>
              <input
                placeholder="anotar…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addNote()}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={() => void addNote()}>
                <Plus size={14} />
              </button>
            </div>
            <div className="steps">
              {acts.map((a) => (
                <div
                  key={a.id}
                  className={`step ${a.createdBy === 'agent' ? 'tool' : a.kind === 'state_change' ? 'model' : ''}`}
                >
                  <div className="who">
                    {a.createdBy === 'agent' ? 'agente' : (KIND_LABEL[a.kind] ?? a.kind)} ·{' '}
                    {fmtDateTime(a.at)}
                  </div>
                  <div>{a.body}</div>
                </div>
              ))}
              {!acts.length && (
                <Empty
                  title="sem atividade"
                  hint="notas, ligações e ações do agente aparecem aqui"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

/** Deal value — reads as a number, edits inline on click. */
function MoneyEdit({
  cents,
  onSave,
}: {
  cents: number | null;
  onSave: (cents: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        className="btn ghost"
        style={{ padding: '2px 8px' }}
        title="clique para editar"
        onClick={() => setEditing(true)}
      >
        <span className="money-v">{fmtMoney(cents)}</span>
      </button>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={cents != null ? (cents / 100).toLocaleString('pt-BR') : ''}
      placeholder="R$"
      style={{ width: 130 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setEditing(false);
        if (e.key !== 'Enter') return;
        const raw = (e.target as HTMLInputElement).value.trim();
        const v = Number(raw.replace(/\./g, '').replace(',', '.'));
        if (raw === '') onSave(null);
        else if (!Number.isNaN(v)) onSave(Math.round(v * 100));
        setEditing(false);
      }}
      onBlur={() => setEditing(false)}
    />
  );
}

/** Mints the per-lead booking link and copies it — token sign happens
 *  server-side so the URL the lead gets is the same one the agent sends. */
function CopyLinkBtn({ leadId }: { leadId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost"
      style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 'var(--t-2xs)' }}
      title="link de agendamento do lead (válido por 30 dias)"
      onClick={() =>
        void api.bookingLink(leadId).then(async (r) => {
          try {
            await navigator.clipboard.writeText(r.url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            window.prompt('copie o link:', r.url);
          }
        })
      }
    >
      <Link2 size={12} /> {copied ? 'copiado!' : 'copiar link'}
    </button>
  );
}

function TagEditor({ tags, onSave }: { tags: string[]; onSave: (t: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  if (!editing) {
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tags.map((t) => (
          <span key={t} className="chip">
            {t}
          </span>
        ))}
        <button
          className="btn ghost"
          style={{ padding: '2px 8px', fontSize: 'var(--t-2xs)' }}
          onClick={() => {
            setVal(tags.join(', '));
            setEditing(true);
          }}
        >
          editar
        </button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="vip, doceria, fortaleza"
        style={{ flex: 1 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(
              val
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            );
            setEditing(false);
          }
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <button
        className="btn"
        onClick={() => {
          onSave(
            val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          );
          setEditing(false);
        }}
      >
        ok
      </button>
    </div>
  );
}

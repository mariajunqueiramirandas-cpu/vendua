import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Archive, Ban, Bot, Plus } from 'lucide-react';
import { api, type Activity, type LeadListItem, type Task } from '../api.ts';
import { Empty, Page, StateChip, fmtDateTime, fmtMoney } from '../components.tsx';

const KIND_LABEL: Record<string, string> = {
  note: 'nota',
  call: 'liga',
  meeting: 'reunião',
  state_change: 'estágio',
  agent: 'agente',
  system: 'sistema',
};

export default function LeadDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [lead, setLead] = useState<LeadListItem | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [threads, setThreads] = useState<{ id: string; channel: string; agentEnabled: boolean }[]>(
    [],
  );
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(() => {
    api
      .lead(id)
      .then((r) => setLead(r.lead))
      .catch(() => setNotFound(true));
    api.activities(id).then((r) => setActs(r.activities));
    api.tasks({ leadId: id }).then((r) => setTasks(r.tasks));
    api.leadThreads(id).then((r) => setThreads(r.threads));
  }, [id]);
  useEffect(load, [load]);

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
        <>
          {lead.agentMode !== 'off' && (
            <button
              className="btn agent"
              title="rodar o agente agora"
              onClick={() => void api.runOnLead(lead.id, 'outreach').then(load)}
            >
              <Bot size={14} /> agir
            </button>
          )}
          <button className="btn" onClick={() => void api.unsubscribe(lead.id).then(load)}>
            <Ban size={14} /> descadastrar
          </button>
          <button
            className="btn danger"
            onClick={() => void api.deleteLead(lead.id).then(() => nav('/leads'))}
          >
            <Archive size={14} /> arquivar
          </button>
        </>
      }
    >
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
              <StateChip state={lead.state} />
              <select value={lead.state} onChange={(e) => void patch({ state: e.target.value })}>
                <option value="lead">lead</option>
                <option value="contacted">contatado</option>
                <option value="invited">convidado</option>
                <option value="live">ativo</option>
              </select>
              <select
                value={lead.agentMode}
                onChange={(e) => void patch({ agentMode: e.target.value })}
                title="modo do agente"
              >
                <option value="off">agente: off</option>
                <option value="draft">agente: rascunho</option>
                <option value="auto">agente: auto</option>
              </select>
              <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
                score {lead.score}
              </span>
            </div>
            <div className="grid2">
              {(
                [
                  ['whatsapp', lead.whatsapp],
                  ['email', lead.email],
                  ['instagram', lead.instagram],
                  ['site', lead.website],
                  ['cidade', lead.city],
                  ['segmento', lead.segment],
                  ['origem', lead.source],
                  ['descoberto via', lead.discoveredVia],
                ] as [string, string | null][]
              ).map(([k, v]) => (
                <div key={k}>
                  <div
                    className="k"
                    style={{
                      fontSize: 'var(--t-2xs)',
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {k}
                  </div>
                  <div>{v ?? '—'}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <div
                className="k"
                style={{
                  fontSize: 'var(--t-2xs)',
                  color: 'var(--muted)',
                  textTransform: 'uppercase',
                }}
              >
                valor
              </div>
              <span className="mono">{fmtMoney(lead.dealValueCents)}</span>
              <input
                style={{ width: 120 }}
                placeholder="R$"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
                    if (!Number.isNaN(v)) void patch({ dealValueCents: Math.round(v * 100) });
                  }
                }}
              />
            </div>
            <div style={{ marginTop: 10 }}>
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

          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <b>conversas</b>
            {threads.map((t) => (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span className="chip">{t.channel}</span>
                <a href={`#/inbox/${t.id}`} style={{ textDecoration: 'underline' }}>
                  abrir thread
                </a>
                <label
                  style={{
                    marginLeft: 'auto',
                    fontSize: 'var(--t-xs)',
                    color: 'var(--muted)',
                    display: 'flex',
                    gap: 5,
                    alignItems: 'center',
                  }}
                >
                  agente
                  <input
                    type="checkbox"
                    checked={t.agentEnabled}
                    onChange={(e) => void api.setThreadAgent(t.id, e.target.checked).then(load)}
                  />
                </label>
              </div>
            ))}
            {!threads.length && (
              <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                nenhuma conversa ainda — o agente cria uma ao primeiro contato
              </div>
            )}
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
            <b>tarefas</b>
            {tasks.map((t) => (
              <div
                key={t.id}
                style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}
              >
                <input
                  type="checkbox"
                  checked={!!t.doneAt}
                  onChange={(e) => void api.setTaskDone(t.id, e.target.checked).then(load)}
                />
                <span
                  style={{
                    textDecoration: t.doneAt ? 'line-through' : undefined,
                    color: t.doneAt ? 'var(--muted)' : undefined,
                  }}
                >
                  {t.title}
                </span>
                <span
                  className="mono"
                  style={{ marginLeft: 'auto', fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}
                >
                  {fmtDateTime(t.dueAt)}
                </span>
              </div>
            ))}
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

        <div className="card" style={{ padding: 18 }}>
          <b>linha do tempo</b>
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 14px' }}>
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
              <Empty title="sem atividade" hint="notas, ligações e ações do agente aparecem aqui" />
            )}
          </div>
        </div>
      </div>
    </Page>
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

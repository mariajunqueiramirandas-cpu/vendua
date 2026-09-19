import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Ban, Bot, Plus } from 'lucide-react';
import { api, type Activity, type LeadListItem, type Task } from '../api.ts';
import { ConfirmBtn, Empty, Page, ScoreBar, fmtDateTime, fmtMoney } from '../components.tsx';

const KIND_LABEL: Record<string, string> = {
  note: 'nota',
  call: 'liga',
  meeting: 'reunião',
  state_change: 'estágio',
  agent: 'agente',
  system: 'sistema',
};
const STATE_OPTS: [string, string][] = [
  ['lead', 'lead'],
  ['contacted', 'contatado'],
  ['invited', 'convidado'],
  ['live', 'ativo'],
];
const AGENT_OPTS: [string, string][] = [
  ['off', 'off'],
  ['draft', 'rascunho'],
  ['auto', 'auto'],
];

// stored websites are free text — linkify only values that normalize to an
// absolute http(s) URL; anything else renders as plain text
function httpUrl(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
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
        </>
      }
    >
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <div className="seg-row">
              <span className="seg" title="estágio do lead">
                {STATE_OPTS.map(([v, l]) => (
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
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
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
              <MoneyEdit
                cents={lead.dealValueCents}
                onSave={(c) => void patch({ dealValueCents: c })}
              />
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

          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <b>conversas</b>
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

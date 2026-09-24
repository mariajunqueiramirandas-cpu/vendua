import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, CheckCircle2, Circle, PauseCircle, SkipForward } from 'lucide-react';
import {
  api,
  ApiError,
  type AgentRun,
  type AutonomyExplanation,
  type AutonomyLevel,
  type LeadFact,
  type LeadListItem,
  type Wakeup,
} from '../api.ts';
import { onControlEvent } from '../events.ts';
import {
  AGENT_GOALS,
  AGENT_GOAL_LABEL,
  AGENT_MODES,
  RUN_KIND_LABEL,
  fmtDateTime,
  fmtUsdCents,
  isLate,
  rel,
  relDue,
} from '../components.tsx';

const LEVEL_LABEL: Record<AutonomyLevel, string> = {
  off: 'off',
  copilot: 'copiloto',
  supervised: 'supervisionado',
  autopilot: 'piloto automático',
};
const LEVEL_NOTE: Record<AutonomyLevel, string> = {
  off: 'o agente só age quando alguém dispara um run',
  copilot: 'roda sozinho, mas toda mensagem vira rascunho',
  supervised: 'primeiro contato passa por aprovação; follow-ups e respostas saem',
  autopilot: 'envia sem aprovação — horário, teto diário e demais limites valem',
};
const SEND_LABEL = {
  auto: 'envia sem aprovação',
  draft: 'vira rascunho',
  blocked: 'envio bloqueado',
} as const;
const SEND_CHIP = { auto: 'agent', draft: 'warn', blocked: 'bad' } as const;

const MODE_NOTE: Record<string, string> = {
  off: 'a equipe toca o lead — o agente não tria nem fala com ele',
  draft: 'o agente prepara mensagens — você aprova cada envio no inbox',
  auto: 'o agente conversa sozinho, dentro das guardrails',
};

const RUN_CHIP: Record<string, string> = {
  queued: 'warn',
  running: 'warn',
  done: '',
  failed: 'bad',
  canceled: 'bad',
};

/** 'loading' stays until the first response; 'missing' = the route doesn't
 *  exist yet (the v2 backend lands in parallel) — a real state, not an error. */
type FetchState = 'loading' | 'ok' | 'missing' | 'error';

export default function LeadAgentPanel({
  lead,
  threads,
  patch,
  onChanged,
}: {
  lead: LeadListItem;
  threads: { id: string; channel: string; agentEnabled: boolean }[];
  patch: (p: Record<string, unknown>) => void;
  onChanged: () => void;
}) {
  const [autonomy, setAutonomy] = useState<AutonomyExplanation | null>(null);
  const [autonomyState, setAutonomyState] = useState<FetchState>('loading');
  const [facts, setFacts] = useState<LeadFact[]>([]);
  const [factsState, setFactsState] = useState<FetchState>('loading');
  const [wakeups, setWakeups] = useState<Wakeup[]>([]);
  const [wakeupsState, setWakeupsState] = useState<FetchState>('loading');
  const [schedRuns, setSchedRuns] = useState<AgentRun[]>([]);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [actChannel, setActChannel] = useState<'auto' | 'whatsapp' | 'email'>('auto');
  const [actErr, setActErr] = useState('');
  const [factErr, setFactErr] = useState('');

  // Latest load wins — responses from before the newest load() (or for the
  // previous lead) are dropped so a slow endpoint can't paint stale data.
  const reqSeq = useRef(0);
  const leadId = lead.id;
  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    const alive = () => seq === reqSeq.current;
    api
      .leadAutonomy(leadId)
      .then((r) => {
        if (!alive()) return;
        setAutonomy(r);
        setAutonomyState('ok');
      })
      .catch((e) => {
        if (!alive()) return;
        setAutonomyState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error');
      });
    api
      .leadFacts(leadId)
      .then((r) => {
        if (!alive()) return;
        setFacts(r.facts);
        setFactsState('ok');
      })
      .catch((e) => {
        if (!alive()) return;
        setFactsState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error');
      });
    api
      .wakeups({ lead_id: leadId, status: 'pending' })
      .then((r) => {
        if (!alive()) return;
        setWakeups(r.wakeups);
        setWakeupsState('ok');
      })
      .catch((e) => {
        if (!alive()) return;
        setWakeupsState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error');
      });
    // Scheduled runs for this lead — scheduled=1 → run_at asc + keyset
    // cursor, so a queue deeper than one page can't hide follow-ups.
    const schedPage = (cursor?: string): Promise<AgentRun[]> =>
      api
        .runs({
          lead_id: leadId,
          status: 'queued',
          scheduled: '1',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        })
        .then((r) =>
          (r.nextCursor ? schedPage(r.nextCursor) : Promise.resolve([] as AgentRun[])).then(
            (rest) => [...r.runs, ...rest],
          ),
        );
    schedPage()
      .then((rs) => {
        if (alive()) setSchedRuns(rs);
      })
      .catch(() => undefined);
    api
      .runs({ lead_id: leadId, limit: '6' })
      .then((r) => {
        if (alive()) setRecentRuns(r.runs);
      })
      .catch(() => undefined);
  }, [leadId]);
  useEffect(load, [load]);
  // lead.change covers the lead itself and wakeup cancels; run.update covers
  // queued/finished runs — both mean this panel's data may have moved.
  useEffect(
    () =>
      onControlEvent(['lead.change', 'run.update'], (e) => {
        if (e.type === 'lead.change' && e.ref && e.ref !== leadId) return;
        load();
      }),
    [load, leadId],
  );
  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const planResolved = lead.agentPlan.filter((s) => s.status !== 'todo').length;
  const agendaEmpty =
    !lead.nextActionAt && !schedRuns.length && wakeupsState === 'ok' && !wakeups.length;

  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="sec-t" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        agente
        {autonomyState === 'ok' && autonomy && (
          <span
            style={{
              marginInlineStart: 'auto',
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <span className="chip agent" title={LEVEL_NOTE[autonomy.level]}>
              {LEVEL_LABEL[autonomy.level]}
            </span>
            <span className={`chip ${SEND_CHIP[autonomy.sendMode]}`}>
              {SEND_LABEL[autonomy.sendMode]}
            </span>
          </span>
        )}
      </div>

      {autonomyState === 'loading' && <div className="agp-none">carregando…</div>}
      {autonomyState === 'missing' && (
        <div className="agp-none">
          a API ainda não expõe a explicação de autonomia — os controles abaixo valem normalmente
        </div>
      )}
      {autonomyState === 'error' && <FetchErr what="a autonomia" retry={load} />}
      {autonomyState === 'ok' && autonomy && (
        <div>
          <div style={{ fontSize: 'var(--t-sm)' }}>
            {autonomy.reasons[0]?.message ??
              (autonomy.canRun ? 'o agente pode agir neste lead' : 'o agente não age neste lead')}
          </div>
          {autonomy.reasons.slice(1).map((r) => (
            <div key={r.code} className="agp-sub">
              · {r.message}
            </div>
          ))}
        </div>
      )}

      <div className="agp-t">controle</div>
      <div className="seg-row" style={{ marginBottom: 8 }}>
        <span className="seg" title="modo do agente">
          {AGENT_MODES.map(([v, l]) => (
            <button
              key={v}
              className={lead.agentMode === v ? 'sel' : ''}
              onClick={() => patch({ agentMode: v })}
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
                onClick={() => patch({ agentGoal: v })}
              >
                {l}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="nl-note">{MODE_NOTE[lead.agentMode]}</div>
      {lead.agentPausedAt ? (
        <div className="trow">
          <span className="chip warn">
            <PauseCircle size={10} /> pausado
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            handoff da equipe — o agente segura este lead
          </span>
          <button
            className="btn ghost"
            style={{ padding: '3px 8px' }}
            title="retomar libera o agente neste lead de novo"
            onClick={() => patch({ agentPaused: false })}
          >
            retomar
          </button>
        </div>
      ) : (
        lead.agentMode !== 'off' && (
          <div className="trow">
            <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
              handoff — pausar o agente e assumir a conversa
            </span>
            <button
              className="btn ghost"
              style={{ padding: '3px 8px' }}
              title="o agente para de agir neste lead até alguém retomar"
              onClick={() => patch({ agentPaused: true })}
            >
              <PauseCircle size={13} /> pausar
            </button>
          </div>
        )
      )}
      {threads.map((t) => (
        <div key={t.id} className="trow">
          <span className="chip">{t.channel}</span>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            {t.agentEnabled ? 'agente lê e responde' : 'agente não entra nesta conversa'}
          </span>
          <label className="tgl">
            <input
              type="checkbox"
              checked={t.agentEnabled}
              onChange={(e) => void api.setThreadAgent(t.id, e.target.checked).then(onChanged)}
            />
            <span className="tk" />
            <span className="lbl">agente</span>
          </label>
        </div>
      ))}
      {lead.agentMode !== 'off' && !lead.unsubscribedAt && !lead.agentPausedAt && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
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
                .then(() => {
                  setActErr('');
                  onChanged();
                })
                .catch((e) => setActErr(e instanceof ApiError ? e.message : 'falha ao disparar'))
            }
          >
            <Bot size={14} /> agir agora
          </button>
          {actErr && (
            <div className="agp-none" style={{ color: 'var(--red-400)' }}>
              {actErr}
            </div>
          )}
        </div>
      )}

      <div className="agp-t">plano</div>
      {lead.agentPlan.length > 0 ? (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span className="chip agent" title="objetivo atual">
              {AGENT_GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
            </span>
            <span
              className="planbar"
              title={`${planResolved} de ${lead.agentPlan.length} etapas resolvidas`}
            >
              <span style={{ width: `${(planResolved / lead.agentPlan.length) * 100}%` }} />
            </span>
            <span className="qmono">
              {planResolved}/{lead.agentPlan.length}
            </span>
          </div>
          {lead.agentPlan.map((s, i) => (
            <div key={i} className={`trow planrow-step ${s.status}`}>
              {s.status === 'done' ? (
                <CheckCircle2 size={15} className="planrow-ico done" />
              ) : s.status === 'skip' ? (
                <SkipForward size={15} className="planrow-ico" />
              ) : (
                <Circle size={15} className="planrow-ico" />
              )}
              <span className="planrow-step-txt">
                <div className="planrow-step-t">{s.step}</div>
                {s.note && <div className="planrow-note">{s.note}</div>}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="agp-none">sem plano — o agente monta um quando o objetivo está claro</div>
      )}

      <div className="agp-t">fatos que o agente sabe</div>
      {factsState === 'loading' && <div className="agp-none">carregando…</div>}
      {factsState === 'missing' && (
        <div className="agp-none">a API ainda não expõe fatos estruturados do lead</div>
      )}
      {factsState === 'error' && <FetchErr what="os fatos" retry={load} />}
      {factsState === 'ok' && (
        <div>
          {facts.map((f) => (
            <FactRow key={f.key} leadId={lead.id} fact={f} onSaved={load} onError={setFactErr} />
          ))}
          {!facts.length && (
            <div className="agp-none">
              nenhum fato ainda — o agente grava aqui o que descobre sobre o lead
            </div>
          )}
          <FactAdd leadId={lead.id} onSaved={load} onError={setFactErr} />
          {factErr && (
            <div className="agp-none" style={{ color: 'var(--red-400)' }}>
              {factErr}
            </div>
          )}
        </div>
      )}

      <div className="agp-t">agenda</div>
      {lead.nextActionAt && (
        <div className="trow">
          <span className="chip">próxima ação</span>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            o que o agente marcou como próximo passo
          </span>
          <span className={`due${isLate(lead.nextActionAt) ? ' bad' : ''}`}>
            {relDue(lead.nextActionAt)} · {fmtDateTime(lead.nextActionAt)}
          </span>
        </div>
      )}
      {schedRuns.map((r) => (
        <div key={r.id} className="trow">
          <span className="chip">{RUN_KIND_LABEL[r.kind] ?? r.kind}</span>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            run na fila · agenda {fmtDateTime(r.run_at)}
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
      {wakeupsState === 'ok' &&
        wakeups.map((w) => (
          <div key={w.id} className="trow" style={{ alignItems: 'flex-start' }}>
            <span className="chip agent">{RUN_KIND_LABEL[w.kind] ?? w.kind}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflowWrap: 'anywhere' }}>{w.focus || 'foco livre'}</div>
              <div className="agp-sub">
                {w.requested
                  ? 'pedido do lead'
                  : w.createdBy === 'staff'
                    ? 'agendado pela equipe'
                    : 'agendado pelo agente'}{' '}
                · {fmtDateTime(w.at)}
              </div>
            </span>
            <span className={`due${isLate(w.at) ? ' bad' : ''}`}>{relDue(w.at)}</span>
            <button
              className="btn ghost"
              style={{ padding: '3px 8px' }}
              title="cancelar este despertar"
              onClick={() => void api.cancelWakeup(w.id).then(load)}
            >
              cancelar
            </button>
          </div>
        ))}
      {wakeupsState === 'missing' && (
        <div className="agp-none">despertares ainda não expostos pela API</div>
      )}
      {wakeupsState === 'error' && <FetchErr what="os despertares" retry={load} />}
      {agendaEmpty && (
        <div className="agp-none">nada agendado — follow-ups e despertares aparecem aqui</div>
      )}

      <div className="agp-t">runs</div>
      {recentRuns.map((r) => (
        <div key={r.id} className="trow">
          <Link to={`/agente/runs/${r.id}`} className="mono" style={{ fontSize: 'var(--t-xs)' }}>
            {r.id.slice(0, 8)}
          </Link>
          <span className="chip">{RUN_KIND_LABEL[r.kind] ?? r.kind}</span>
          <span className={`chip ${RUN_CHIP[r.status] ?? ''}`}>{r.status}</span>
          <span style={{ flex: 1 }} />
          <span className="qmono">{fmtUsdCents(r.cost_cents)}</span>
          <span className="due">{rel(r.created_at)}</span>
        </div>
      ))}
      {!recentRuns.length && <div className="agp-none">nenhum run neste lead ainda</div>}
      <div style={{ marginTop: 10 }}>
        <Link
          to="/agente"
          className="btn ghost"
          style={{ padding: '3px 8px', fontSize: 'var(--t-2xs)' }}
        >
          todos os runs →
        </Link>
      </div>
    </div>
  );
}

/** A structured fact the agent (or staff) knows about the lead. Value edits
 *  inline; confidence and source stay visible so staff can tell agent
 *  guesses from verified notes. */
function FactRow({
  leadId,
  fact,
  onSaved,
  onError,
}: {
  leadId: string;
  fact: LeadFact;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(fact.value);
  const [conf, setConf] = useState(String(fact.confidence));
  const save = () => {
    const c = Number(conf);
    if (conf.trim() && (!Number.isFinite(c) || c < 0 || c > 1)) {
      onError('confiança precisa ser um número de 0 a 1 — ex.: 0.8');
      return;
    }
    api
      .putLeadFact(leadId, fact.key, {
        value: val.trim(),
        ...(conf.trim() ? { confidence: c } : {}),
      })
      .then(() => {
        onError('');
        setEditing(false);
        onSaved();
      })
      .catch((e) => onError(e instanceof ApiError ? e.message : 'falha ao salvar'));
  };
  return (
    <div className="trow" style={{ alignItems: 'flex-start', gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="qmono" style={{ color: 'var(--ink)', fontSize: 'var(--t-xs)' }}>
          {fact.key}
        </span>
        {editing ? (
          <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input
              autoFocus
              value={val}
              maxLength={500}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              style={{ flex: 1 }}
            />
            <input
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              title="confiança 0–1"
              style={{ width: 52 }}
            />
            {/* No blur-save — clicking × while editing must not race a PUT
             *  against the DELETE and resurrect the fact. */}
            <button className="btn ghost" style={{ padding: '1px 8px' }} onClick={save}>
              ok
            </button>
          </span>
        ) : (
          <button
            className="edv"
            style={{ marginTop: 2 }}
            title="clique para editar o valor"
            onClick={() => {
              setVal(fact.value);
              setConf(String(fact.confidence));
              setEditing(true);
            }}
          >
            {fact.value}
          </button>
        )}
      </span>
      <span className="qmono" title={`confiança ${Math.round(fact.confidence * 100)}%`}>
        {Math.round(fact.confidence * 100)}%
      </span>
      <span
        className={`chip${fact.source === 'agent' ? ' agent' : ''}`}
        title={
          fact.source === 'agent'
            ? 'gravado pelo agente'
            : 'anotado pela equipe — o agente lê junto'
        }
      >
        {fact.source === 'agent' ? 'agente' : 'equipe'}
      </span>
      <button
        className="btn ghost"
        style={{ padding: '2px 6px', fontSize: 'var(--t-md)' }}
        title="apagar este fato"
        onClick={() =>
          void api
            .deleteLeadFact(leadId, fact.key)
            .then(() => {
              onError('');
              onSaved();
            })
            .catch((e) => onError(e instanceof ApiError ? e.message : 'falha ao apagar'))
        }
      >
        ×
      </button>
    </div>
  );
}

/** New fact — key in snake_case like the agent writes; confidence optional
 *  (staff notes default to full confidence server-side). */
function FactAdd({
  leadId,
  onSaved,
  onError,
}: {
  leadId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [conf, setConf] = useState('');
  const add = () => {
    const k = key.trim();
    const v = val.trim();
    if (!k || !v) return;
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(k)) {
      onError('a chave precisa ser snake_case — ex.: prefere_whatsapp');
      return;
    }
    const c = Number(conf);
    if (conf.trim() && (!Number.isFinite(c) || c < 0 || c > 1)) {
      onError('confiança precisa ser um número de 0 a 1 — ex.: 0.8');
      return;
    }
    api
      .putLeadFact(leadId, k, {
        value: v,
        ...(conf.trim() ? { confidence: c } : {}),
      })
      .then(() => {
        onError('');
        setKey('');
        setVal('');
        setConf('');
        onSaved();
      })
      .catch((e) => onError(e instanceof ApiError ? e.message : 'falha ao salvar'));
  };
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input
        value={key}
        maxLength={60}
        placeholder="chave_snake_case"
        aria-label="chave do fato"
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        style={{ flex: '0 0 34%' }}
      />
      <input
        value={val}
        maxLength={500}
        placeholder="valor — ex.: prefere whatsapp à tarde"
        aria-label="valor do fato"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        style={{ flex: 1 }}
      />
      <input
        value={conf}
        placeholder="conf"
        aria-label="confiança 0 a 1"
        title="confiança 0–1 (opcional)"
        onChange={(e) => setConf(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add()}
        style={{ width: 52 }}
      />
      <button className="btn" onClick={add} disabled={!key.trim() || !val.trim()}>
        gravar
      </button>
    </div>
  );
}

/** Failed read — the 60s poll and SSE retry on their own, this is the
 *  explicit escape hatch so staff isn't stuck watching a dead section. */
function FetchErr({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="agp-none">
      falha ao ler {what}{' '}
      <button className="btn ghost" style={{ padding: '1px 6px' }} onClick={retry}>
        tentar de novo
      </button>
    </div>
  );
}

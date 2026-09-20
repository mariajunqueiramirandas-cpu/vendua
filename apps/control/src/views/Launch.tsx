import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type AgentRun } from '../api.ts';
import { fmtMoney, rel } from '../components.tsx';

/* Lançar — the agent's stage. A night-forest room inside the cream deck:
   brief on the left, and while a discovery run is live the trajectory
   streams in mono while leads pop in as cream cards. Built for showing
   off — every frame should look like the machine working. */

interface Step {
  type: string;
  name?: string;
  args?: Record<string, unknown>;
  out?: Record<string, unknown> | null;
  content?: unknown;
  toolCalls?: string[];
  pending?: boolean;
}

interface FoundLead {
  key: string;
  name: string;
  city: string | null;
  segment: string | null;
  fitScore: number | null;
  contact: string[];
  duplicate: boolean;
  existingState?: string | undefined;
}

const TARGETS = [3, 5, 10, 15];

const TOOL_LABEL: Record<string, string> = {
  web_search: 'buscando na web',
  extract_page: 'lendo página',
  create_lead: 'criando lead',
  search_leads: 'olhando o CRM',
  get_lead: 'abrindo lead',
  update_lead: 'atualizando lead',
  add_note: 'anotando',
  remember: 'memorizando',
  draft_message: 'redigindo',
  send_message: 'enviando',
};

const argHint = (s: Step): string => {
  const a = s.args ?? {};
  switch (s.name) {
    case 'web_search':
      return String(a.query ?? '');
    case 'extract_page':
      return String(a.url ?? '')
        .replace(/^https?:\/\//, '')
        .slice(0, 60);
    case 'create_lead':
      return [a.name, a.city].filter(Boolean).join(' · ');
    default:
      return '';
  }
};

const outHint = (s: Step): string => {
  const o = s.out;
  if (o == null) return '';
  if (o.duplicate) return 'já estava no CRM';
  const lead = o.lead as { id?: string } | undefined;
  if (s.name === 'create_lead' && lead?.id) return '+ lead';
  if (s.name === 'web_search') {
    const results = o.results;
    if (Array.isArray(results))
      return `${results.length} resultado${results.length === 1 ? '' : 's'}`;
  }
  if (o.blocked) return `bloqueado: ${String(o.reason ?? '').slice(0, 60)}`;
  return 'ok';
};

const fmtClock = (ms: number) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
};

export default function Launch() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const runParam = params.get('run');

  const [segs, setSegs] = useState<string[]>([]);
  const [segment, setSegment] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState('');
  const [target, setTarget] = useState(5);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [recent, setRecent] = useState<AgentRun[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<HTMLDivElement>(null);

  const runId = runParam;

  useEffect(() => {
    api
      .segments()
      .then((r) => setSegs(r.segments.map((s) => s.segment)))
      .catch(() => undefined);
    api
      .runs({ kind: 'discovery' })
      .then((r) => setRecent(r.runs.slice(0, 5)))
      .catch(() => undefined);
  }, []);

  const active = run?.status === 'queued' || run?.status === 'running';
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    let dead = false;
    let t: ReturnType<typeof setInterval> | undefined;
    const tick = () =>
      api
        .run(runId)
        .then((r) => {
          if (dead) return;
          setRun(r.run);
          // Terminal state — nothing left to watch, stop polling.
          if (t && r.run.status !== 'queued' && r.run.status !== 'running') {
            clearInterval(t);
            t = undefined;
          }
        })
        .catch(() => undefined);
    void tick();
    t = setInterval(tick, 1300);
    return () => {
      dead = true;
      if (t) clearInterval(t);
    };
  }, [runId]);

  const steps = useMemo(() => (run?.steps ?? []) as Step[], [run]);
  const leads = useMemo(() => {
    const out: FoundLead[] = [];
    for (const s of steps) {
      if (s.type !== 'tool' || s.name !== 'create_lead' || s.pending) continue;
      const a = s.args ?? {};
      const created = s.out?.lead as { id?: string } | undefined;
      const dup = s.out?.duplicate === true;
      if (!created?.id && !dup) continue;
      const contact = [
        a.whatsapp || a.phone ? 'whatsapp' : '',
        a.email ? 'email' : '',
        a.instagram ? 'instagram' : '',
        a.website ? 'site' : '',
      ].filter(Boolean);
      out.push({
        key: `${out.length}`,
        name: String(a.name ?? '—'),
        city: typeof a.city === 'string' ? a.city : null,
        segment: typeof a.segment === 'string' ? a.segment : null,
        fitScore: typeof a.fitScore === 'number' ? a.fitScore : null,
        contact,
        duplicate: dup,
        existingState: dup
          ? ((s.out?.existing as { state?: string } | undefined)?.state ?? undefined)
          : undefined,
      });
    }
    return out;
  }, [steps]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length]);

  const canLaunch = Boolean(segment.trim() || city.trim() || focus.trim()) && !launching;
  const launch = useCallback(async () => {
    if (!canLaunch) return;
    setLaunching(true);
    setErr('');
    const query =
      focus.trim() ||
      [segment.trim(), city.trim()].filter(Boolean).join(' em ') ||
      'negócios de alimentação no instagram';
    try {
      const r = await api.startRun('discovery', {
        query,
        ...(segment.trim() ? { segment: segment.trim() } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        target,
      });
      setParams({ run: r.runId });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'falhou ao lançar');
    } finally {
      setLaunching(false);
    }
  }, [canLaunch, focus, segment, city, target, setParams]);

  const reset = () => setParams({});

  /* -------- render -------- */

  if (runId && run) {
    const elapsed =
      (run.finished_at ? new Date(run.finished_at) : new Date(now)).getTime() -
      new Date(run.started_at ?? run.created_at).getTime();
    const created = leads.filter((l) => !l.duplicate).length;
    const targetN = Number((run.params ?? {}).target) || target;
    return (
      <div className="stage">
        <div className="stage-head">
          <span className={`livedot ${active ? 'on' : ''}`} aria-hidden />
          <div className="stage-title">
            {run.status === 'done'
              ? 'a caçada terminou.'
              : run.status === 'failed'
                ? 'a caçada tropeçou.'
                : run.status === 'canceled'
                  ? 'caçada cancelada.'
                  : run.status === 'queued'
                    ? 'acordando o agente…'
                    : 'a máquina está caçando.'}
          </div>
          <span className="mono dim">run {run.id.slice(0, 8)}</span>
          <span className="mono stage-clock">{fmtClock(elapsed)}</span>
          {active && (
            <button className="btn stage-ghost" onClick={() => void api.cancelRun(run.id)}>
              cancelar
            </button>
          )}
        </div>

        {run.status === 'done' || run.status === 'failed' || run.status === 'canceled' ? (
          <div className="stage-end">
            <div className="stage-end-count mono">{created}</div>
            <div className="serif stage-end-line">
              {created === 1
                ? 'lead no CRM.'
                : created
                  ? 'leads no CRM.'
                  : 'nenhum lead dessa vez.'}
            </div>
            <div className="mono dim stage-end-meta">
              {fmtClock(elapsed)} · {run.tokens_in}↑ {run.tokens_out}↓ · {fmtMoney(run.cost_cents)}
              {run.error ? ` · ${run.error}` : ''}
            </div>
            <div className="stage-end-cta">
              {created > 0 && (
                <Link to="/leads" className="btn stage-go">
                  ver leads →
                </Link>
              )}
              <button className="btn stage-ghost" onClick={reset}>
                nova caçada
              </button>
              <Link to={`/agente/runs/${run.id}`} className="btn stage-ghost">
                trajetória completa
              </Link>
            </div>
          </div>
        ) : (
          <div className="stage-live">
            <div className="stage-stream" ref={streamRef} role="log" aria-live="polite">
              <div className="ln dim">
                <span className="ln-g">▸</span> contexto carregado — pitch, memória, guardrails
              </div>
              {steps
                .filter((s) => s.type !== 'system_prompt')
                .map((s, i) =>
                  s.type === 'model' ? (
                    <div key={i} className="ln think">
                      <span className="ln-g">│</span>
                      <span>
                        {String(s.content ?? '')
                          .trim()
                          .split('\n')[0]
                          ?.slice(0, 160) || 'pensando…'}
                      </span>
                      {s.toolCalls?.length ? (
                        <span className="ln-calls">→ {s.toolCalls.join(', ')}</span>
                      ) : null}
                    </div>
                  ) : (
                    <div key={i} className={`ln tool${s.pending ? ' pending' : ''}`}>
                      <span className="ln-g">▸</span>
                      <span className="ln-tool">{TOOL_LABEL[s.name ?? ''] ?? s.name}</span>
                      <span className="ln-arg">{argHint(s)}</span>
                      <span className={`ln-out${s.pending ? ' blink' : ''}`}>
                        {s.pending ? '…' : outHint(s)}
                      </span>
                    </div>
                  ),
                )}
              {run.status === 'queued' && <div className="ln dim blink">aguardando o worker…</div>}
            </div>

            <div className="stage-rail">
              <div className="stage-count mono">
                {created}
                <span className="dim stage-count-of">/ {targetN} leads</span>
              </div>
              <div className="stage-leads">
                {leads.map((l, i) => (
                  <div
                    key={l.key}
                    className={`lcard${l.duplicate ? ' dup' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}
                  >
                    <div className="lcard-name">{l.name}</div>
                    <div className="lcard-meta">
                      {[l.segment, l.city].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="lcard-foot">
                      <span className="lcard-contact">
                        {l.contact.join(' · ') || 'sem contato'}
                      </span>
                      {l.fitScore != null && (
                        <span className="lcard-fit mono">fit {l.fitScore}</span>
                      )}
                      {l.duplicate && <span className="lcard-dup mono">já existia</span>}
                    </div>
                  </div>
                ))}
                {!leads.length && (
                  <div className="stage-leads-empty dim">
                    os leads caem aqui conforme a máquina os cria
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (runId && !run) {
    return (
      <div className="stage">
        <div className="stage-head">
          <span className="livedot on" aria-hidden />
          <div className="stage-title">abrindo a sala…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stage">
      <div className="stage-brief">
        <div className="mono kicker">venduá · descoberta autônoma</div>
        <h1 className="serif stage-h">o que a máquina caça hoje?</h1>

        <div className="brief">
          <label className="brief-row">
            <span className="brief-k mono">segmento</span>
            <span className="brief-v">
              <input
                list="launch-segs"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder="doceria, padaria, marmita…"
              />
              <datalist id="launch-segs">
                {segs.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </span>
          </label>
          <label className="brief-row">
            <span className="brief-k mono">cidade</span>
            <span className="brief-v">
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="fortaleza, são paulo… (vazio = brasil)"
              />
            </span>
          </label>
          <label className="brief-row">
            <span className="brief-k mono">foco</span>
            <span className="brief-v">
              <textarea
                rows={2}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="ex: confeitarias que vendem pelo instagram e não têm site"
              />
            </span>
          </label>
          <div className="brief-row">
            <span className="brief-k mono">meta</span>
            <span className="brief-v seg stage-seg">
              {TARGETS.map((n) => (
                <button
                  key={n}
                  className={n === target ? 'sel' : ''}
                  onClick={() => setTarget(n)}
                  type="button"
                >
                  {n}
                </button>
              ))}
            </span>
          </div>

          {err && <div className="stage-err mono">{err}</div>}

          <button
            className="btn stage-go stage-launch"
            disabled={!canLaunch}
            onClick={() => void launch()}
          >
            {launching ? 'acordando…' : 'lançar a caçada →'}
          </button>
        </div>

        {recent.length > 0 && (
          <div className="stage-recent">
            <div className="mono dim">últimas caçadas</div>
            {recent.map((r) => (
              <button
                key={r.id}
                className="recent-row"
                onClick={() => setParams({ run: r.id })}
                type="button"
              >
                <span className="mono">{rel(r.created_at)}</span>
                <span className={`recent-status ${r.status}`}>{r.status}</span>
                <span className="mono dim">{fmtMoney(r.cost_cents)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

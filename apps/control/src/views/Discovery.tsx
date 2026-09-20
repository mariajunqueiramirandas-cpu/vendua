import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import {
  api,
  ApiError,
  type AgentRun,
  type Brief,
  type DupeGroup,
  type LeadListItem,
  type SegmentStat,
} from '../api.ts';
import { Empty, StateChip, fmtMoney, rel } from '../components.tsx';

/* Descoberta — the launch pad AND the scoreboard. Idle is a dark hero:
   brief on the left, the daily rotation and recent hunts on the right.
   With ?run=<id> the page becomes the machine's stage — the trajectory
   streams while leads materialize as cream cards. */

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

export default function Discovery() {
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');

  /* ---- page data ---- */
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [found, setFound] = useState<LeadListItem[]>([]);
  const [dupes, setDupes] = useState<DupeGroup[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [segs, setSegs] = useState<SegmentStat[]>([]);
  const [bf, setBf] = useState({ name: '', query: '', segment: '', city: '', target: '' });
  const [msg, setMsg] = useState('');

  /* ---- launch brief ---- */
  const [segment, setSegment] = useState('');
  const [city, setCity] = useState('');
  const [focus, setFocus] = useState('');
  const [target, setTarget] = useState(5);
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState('');

  /* ---- watched run ---- */
  const [run, setRun] = useState<AgentRun | null>(null);
  const [runMissing, setRunMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streamRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.runs({ kind: 'discovery' }).then((r) => setRuns(r.runs));
    api
      .leads({ tag: 'descoberto', limit: '50' })
      .then((r) => setFound(r.leads))
      .catch(() =>
        api.leads({ limit: '50' }).then((r) => setFound(r.leads.filter((l) => l.discoveredVia))),
      );
    api
      .duplicates()
      .then((r) => setDupes(r.groups))
      .catch(() => undefined);
    api
      .briefs()
      .then((r) => setBriefs(r.briefs))
      .catch(() => undefined);
    api
      .segments()
      .then((r) => setSegs(r.segments))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  // Leads land in the table as the agent creates them — keep polling while
  // any discovery run is live.
  const anyActive = runs.some((r) => r.status === 'queued' || r.status === 'running');
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [anyActive, load]);

  const liveRun = runs.find((r) => r.status === 'queued' || r.status === 'running');

  /* ---- run watcher ---- */
  const runActive = run?.status === 'queued' || run?.status === 'running';
  useEffect(() => {
    if (!runActive) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [runActive]);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      setRunMissing(false);
      return;
    }
    let dead = false;
    let t: ReturnType<typeof setInterval> | undefined;
    // Overlapping polls resolve out of order — drop any response older than
    // the newest seen, and latch terminal: a delayed 'running' snapshot can't
    // resurrect a finished run after the interval is cleared.
    let seq = 0;
    let seen = 0;
    let terminal = false;
    // 'canceled' lands on the row before the worker persists its final
    // journal — keep polling through a short grace window so late tool
    // results still land in the summary.
    let cancelAt = 0;
    let cancelLen = -1;
    const tick = () => {
      const my = ++seq;
      api
        .run(runId)
        .then((r) => {
          if (dead || my <= seen || terminal) return;
          seen = my;
          const st = r.run.status;
          let latch = st !== 'queued' && st !== 'running';
          if (st === 'canceled') {
            const len = Array.isArray(r.run.steps) ? r.run.steps.length : 0;
            const since = cancelAt ? Date.now() - cancelAt : 0;
            if (!cancelAt) {
              cancelAt = Date.now();
              cancelLen = len;
              latch = false;
            } else if (since < 2000 || (since < 6000 && len > cancelLen)) {
              cancelLen = Math.max(cancelLen, len);
              latch = false;
            }
          }
          setRun(r.run);
          if (latch) {
            terminal = true;
            if (t) {
              clearInterval(t);
              t = undefined;
            }
          }
        })
        .catch((e) => {
          // A 404 is permanent — stop polling instead of spinning on the
          // loading state forever.
          if (dead || !(e instanceof ApiError && e.status === 404)) return;
          setRunMissing(true);
          if (t) {
            clearInterval(t);
            t = undefined;
          }
        });
    };
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
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'falhou ao lançar');
    } finally {
      setLaunching(false);
    }
  }, [canLaunch, focus, segment, city, target, setParams, load]);

  const createBrief = async () => {
    setMsg('');
    try {
      await api.createBrief({
        name: bf.name.trim(),
        query: bf.query.trim(),
        ...(bf.segment.trim() && { segment: bf.segment.trim() }),
        ...(bf.city.trim() && { city: bf.city.trim() }),
        ...(bf.target && { target: Number(bf.target) }),
      });
      setBf({ name: '', query: '', segment: '', city: '', target: '' });
      load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'erro');
    }
  };

  const reset = () => setParams({});

  /* ================= run stage ================= */

  if (runId && run) {
    const elapsed =
      (run.finished_at ? new Date(run.finished_at) : new Date(now)).getTime() -
      new Date(run.started_at ?? run.created_at).getTime();
    const created = leads.filter((l) => !l.duplicate).length;
    const targetN = Number((run.params ?? {}).target) || target;
    return (
      <div className="stage">
        <div className="stage-head">
          <span className={`livedot ${runActive ? 'on' : ''}`} aria-hidden />
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
          {runActive && (
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
              <div className="act-note mono">contexto carregado — pitch, memória, guardrails</div>
              {steps
                .filter((s) => s.type !== 'system_prompt')
                .map((s, i) =>
                  s.type === 'model' ? (
                    <div key={i} className="act think">
                      <span className="serif think-t">
                        {String(s.content ?? '')
                          .trim()
                          .split('\n')[0]
                          ?.slice(0, 160) || 'pensando…'}
                      </span>
                      {s.toolCalls?.length ? (
                        <span className="think-calls mono">→ {s.toolCalls.join(', ')}</span>
                      ) : null}
                    </div>
                  ) : (
                    <div key={i} className={`act tool${s.pending ? ' pending' : ''}`}>
                      <span className="act-dot" aria-hidden />
                      <span className="act-label">{TOOL_LABEL[s.name ?? ''] ?? s.name}</span>
                      <span className="act-arg mono">{argHint(s)}</span>
                      <span className={`act-out mono${s.pending ? ' blink' : ''}`}>
                        {s.pending ? '…' : outHint(s)}
                      </span>
                    </div>
                  ),
                )}
              {run.status === 'queued' && (
                <div className="act-note mono blink">aguardando o worker…</div>
              )}
            </div>

            <div className="stage-rail">
              <div className="stage-count mono">
                {created}
                <span className="dim stage-count-of">/ {targetN} leads</span>
              </div>
              <div className="stage-prog" aria-hidden>
                <div
                  className="stage-prog-fill"
                  style={{ width: `${Math.min(100, (created / Math.max(1, targetN)) * 100)}%` }}
                />
              </div>
              <div className="stage-leads">
                {leads.map((l, i) => (
                  <div
                    key={l.key}
                    className={`lcard${l.duplicate ? ' dup' : ''}`}
                    style={{ animationDelay: `${Math.min(i, 8) * 90}ms` }}
                  >
                    <div className="lcard-top">
                      <div className="lcard-name">{l.name}</div>
                      {l.fitScore != null && <span className="lcard-fit mono">{l.fitScore}</span>}
                    </div>
                    <div className="lcard-meta">
                      {[l.segment, l.city].filter(Boolean).join(' · ') || '—'}
                    </div>
                    <div className="lcard-foot">
                      <span className="lcard-contact">
                        {l.contact.join(' · ') || 'sem contato'}
                      </span>
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
          <span className={`livedot ${runMissing ? '' : 'on'}`} aria-hidden />
          <div className="stage-title">
            {runMissing ? 'essa caçada não existe mais.' : 'abrindo a sala…'}
          </div>
          {runMissing && (
            <button className="btn stage-ghost" onClick={reset}>
              voltar
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ============ idle — the stage IS the page ============ */

  return (
    <div className="stage stage-idle">
      <div className="stage-hero">
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
                    <option key={s.segment} value={s.segment} />
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
                  rows={3}
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
        </div>

        <div className="hrail">
          {liveRun && (
            <button
              className="hcard hcard-live"
              type="button"
              onClick={() => setParams({ run: liveRun.id })}
            >
              <span className="livedot on" aria-hidden />
              <span className="hcard-live-t serif">caçada rolando agora</span>
              <span className="mono dim">assistir →</span>
            </button>
          )}

          <div className="hcard">
            <div className="hcard-t">
              rotina diária
              <span className="mono dim hcard-sub">1x/dia · contato continua manual</span>
            </div>
            {briefs.map((b) => (
              <div className="brow" key={b.id}>
                <div className="brow-main">
                  <b>{b.name}</b>
                  <span className="brow-q mono">{b.query}</span>
                  <span className="brow-meta mono">
                    {[b.segment, b.city].filter(Boolean).join(' · ') || '—'}
                    {b.target ? ` · ≤${b.target}` : ''} · {rel(b.last_run_at)}
                  </span>
                </div>
                <button
                  className={`btn mini ${b.enabled ? 'stage-go' : 'stage-ghost'}`}
                  title={b.enabled ? 'ativa — clica pra pausar' : 'pausada'}
                  onClick={() => void api.patchBrief(b.id, { enabled: !b.enabled }).then(load)}
                >
                  {b.enabled ? 'on' : 'off'}
                </button>
                <button
                  className="btn mini stage-ghost"
                  title="remover brief"
                  onClick={() => void api.deleteBrief(b.id).then(load)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!briefs.length && <div className="brow-empty dim">nenhum brief ainda</div>}
            <div className="bnew">
              <input
                placeholder="nome — ex: docerias fortaleza"
                value={bf.name}
                onChange={(e) => setBf({ ...bf, name: e.target.value })}
              />
              <input
                placeholder="busca — ex: padarias de bairro sem site"
                value={bf.query}
                onChange={(e) => setBf({ ...bf, query: e.target.value })}
              />
              <div className="bnew-row">
                <input
                  placeholder="segmento"
                  value={bf.segment}
                  onChange={(e) => setBf({ ...bf, segment: e.target.value })}
                />
                <input
                  placeholder="cidade"
                  value={bf.city}
                  onChange={(e) => setBf({ ...bf, city: e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  max={1000}
                  placeholder="alvo"
                  value={bf.target}
                  onChange={(e) => setBf({ ...bf, target: e.target.value })}
                />
                <button
                  className="btn mini stage-go"
                  disabled={!bf.name.trim() || !bf.query.trim()}
                  onClick={() => void createBrief()}
                >
                  <Plus size={13} />
                </button>
              </div>
              {msg && <div className="stage-err mono">{msg}</div>}
            </div>
          </div>

          {runs.length > 0 && (
            <div className="hcard">
              <div className="hcard-t">últimas caçadas</div>
              {runs.slice(0, 4).map((r) => (
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

      {/* scoreboard — same dark room, below the fold */}
      <div className="stage-data">
        {segs.length > 0 && (
          <section className="dsec">
            <h2 className="dsec-t serif">o que converte</h2>
            <table className="dtbl">
              <thead>
                <tr>
                  <th>segmento</th>
                  <th>leads</th>
                  <th>contatados</th>
                  <th>responderam</th>
                  <th>ativos</th>
                  <th>custo 30d</th>
                </tr>
              </thead>
              <tbody>
                {segs.map((s) => (
                  <tr key={s.segment}>
                    <td>{s.segment}</td>
                    <td className="mono">{s.leads}</td>
                    <td className="mono">{s.contacted}</td>
                    <td className="mono">
                      <b className="lime">{s.replied}</b>
                      {s.contacted > 0 && (
                        <span className="dim">
                          {' '}
                          · {Math.round((s.replied / s.contacted) * 100)}%
                        </span>
                      )}
                    </td>
                    <td className="mono">{s.live}</td>
                    <td className="mono">{fmtMoney(s.costCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dsec-hint dim">
              o agente vê este quadro na busca e reforça o que está convertendo
            </div>
          </section>
        )}

        <section className="dsec">
          <h2 className="dsec-t serif">leads descobertos</h2>
          {found.length ? (
            <div className="harvest">
              {found.map((l) => (
                <a key={l.id} href={`#/leads/${l.id}`} className="lcard">
                  <div className="lcard-top">
                    <div className="lcard-name">{l.name}</div>
                    {l.fitScore != null && (
                      <span className="lcard-fit mono" title={l.fitReason ?? undefined}>
                        {l.fitScore}
                      </span>
                    )}
                  </div>
                  <div className="lcard-meta">
                    {[l.businessName, l.segment, l.city].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="lcard-foot">
                    <span className="lcard-contact">
                      <StateChip state={l.state} /> {l.discoveredVia ?? ''}
                    </span>
                    <span className="lcard-dup mono">{rel(l.createdAt)}</span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <Empty title="nenhum ainda" hint="rode uma descoberta" />
          )}

          {dupes.length > 0 && (
            <>
              <h3 className="dsec-sub mono dim">possíveis duplicados</h3>
              {dupes.slice(0, 10).map((g, i) => (
                <div key={i} className="drow">
                  <span className="dchip mono">{g.field}</span>{' '}
                  <span className="mono">{g.value}</span>
                  <div className="drow-links">
                    {g.leads.map((l) => (
                      <a key={l.id} href={`#/leads/${l.id}`}>
                        {l.name}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <section className="dsec">
          <h2 className="dsec-t serif">runs de descoberta</h2>
          <table className="dtbl">
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`?run=${r.id}`} className="mono lime">
                      {r.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <span className={`recent-status ${r.status}`}>{r.status}</span>
                    {(r.status === 'queued' || r.status === 'running') && (
                      <button
                        className="btn mini stage-ghost"
                        style={{ marginLeft: 8 }}
                        onClick={() => void api.cancelRun(r.id).then(load)}
                      >
                        cancelar
                      </button>
                    )}
                  </td>
                  <td className="mono dim">
                    {(r.tokens_in + r.tokens_out).toLocaleString('pt-BR')} tok
                  </td>
                  <td className="mono dim">{rel(r.created_at)}</td>
                </tr>
              ))}
              {!runs.length && (
                <tr>
                  <td>
                    <Empty title="nenhum run" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Circle, SkipForward } from 'lucide-react';
import { api, type AgentRun, type LeadListItem } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, fmtDateTime } from '../components.tsx';

const GOAL_LABEL: Record<string, string> = {
  negotiation: 'negócio',
  meeting: 'reunião',
};
const RUN_KIND: Record<string, string> = {
  triage: 'triagem',
  reply: 'resposta',
  outreach: 'alcance',
  discovery: 'descoberta',
};

// One upcoming event: a queued run's run_at, or the lead's next_action_at.
interface Pending {
  at: string;
  what: string;
  leadId: string;
  leadName: string;
  late: boolean;
}

// Countdown to fire: T− until, T+ once overdue.
function tMinus(at: string, now: number): string {
  const d = new Date(at).getTime() - now;
  const m = Math.abs(Math.round(d / 60000));
  const v =
    m >= 1440
      ? `${Math.floor(m / 1440)}d${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}h`
      : m >= 60
        ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
        : `${m}m`;
  return d <= 0 ? `T+${v}` : `T−${v}`;
}

export default function Plan() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [now, setNow] = useState(() => Date.now());

  const loadingRef = useRef(false);

  // silent refresh keeps the queue honest without flickering the page —
  // a completed run disappears on the next tick instead of lingering overdue.
  const load = (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setState('loading');
    // Follow the keyset cursor — a partial page would silently hide plans.
    const all: LeadListItem[] = [];
    const page = (cursor?: string): Promise<void> =>
      api.leads({ limit: '200', ...(cursor ? { cursor } : {}) }).then((r) => {
        all.push(...r.leads);
        return r.nextCursor ? page(r.nextCursor) : undefined;
      });
    // scheduled=1 → run_at asc + keyset cursor — every delayed run is fetched.
    const runsPage = (cursor?: string): Promise<AgentRun[]> =>
      api
        .runs({ status: 'queued', scheduled: '1', limit: '200', ...(cursor ? { cursor } : {}) })
        .then((r) =>
          (r.nextCursor ? runsPage(r.nextCursor) : Promise.resolve([] as AgentRun[])).then(
            (rest) => [...r.runs, ...rest],
          ),
        );
    void Promise.all([page(), runsPage().then((rs) => rs.filter((x) => x.lead_id))])
      .then(([, queued]) => {
        // Commit both datasets together — a failed half can't render beside the
        // error state as if it were complete.
        setLeads(all);
        setRuns(queued);
        setState('ok');
      })
      .catch(() => {
        // A silent refresh failure keeps the last good snapshot; only an
        // explicit load error surfaces the error state.
        if (!silent) setState('error');
      })
      .finally(() => {
        loadingRef.current = false;
      });
  };
  useEffect(() => load(), []);

  // Minute tick: re-derive countdowns and re-fetch while the tab is visible,
  // so a claimed run drops off the queue without a manual reload.
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') load(true);
    }, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The same silent refresh, accelerated — run/lead/draft events trigger it.
  useEffect(
    () =>
      onControlEvent(['run.update', 'lead.change', 'draft.change'], () => {
        if (document.visibilityState === 'visible') load(true);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const byId = new Map(leads.map((l) => [l.id, l]));

  // Mirrors claimRun's suppression predicate — off, archived, unsubscribed —
  // so the queue only shows runs the worker can actually claim.
  const live = (id: string) => {
    const l = byId.get(id);
    return !!l && l.agentMode !== 'off' && !l.archivedAt && !l.unsubscribedAt;
  };

  // Flat timeline: every future agent move, soonest first.
  const pending: Pending[] = [
    ...runs
      .filter((r) => live(r.lead_id!))
      .map((r) => ({
        at: r.run_at!,
        what: `run ${RUN_KIND[r.kind] ?? r.kind}`,
        leadId: r.lead_id!,
        leadName: byId.get(r.lead_id!)?.name ?? r.lead_name ?? 'lead',
        late: new Date(r.run_at!).getTime() <= now,
      })),
    ...leads
      .filter((l) => live(l.id) && l.nextActionAt)
      .map((l) => ({
        at: l.nextActionAt!,
        what: 'follow-up do agente',
        leadId: l.id,
        leadName: l.name,
        late: new Date(l.nextActionAt!).getTime() <= now,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // Leads carrying a plan, most-progressed first.
  const planned = leads
    .filter((l) => live(l.id) && l.agentPlan.length > 0)
    .sort(
      (a, b) =>
        b.agentPlan.filter((s) => s.status !== 'todo').length / b.agentPlan.length -
        a.agentPlan.filter((s) => s.status !== 'todo').length / a.agentPlan.length,
    );

  const late = pending.filter((p) => p.late).length;
  const next = pending[0];

  return (
    <Page
      title="Planos do agente"
      sub="o que o agente vai fazer a seguir e como cada negociação está andando"
    >
      {state === 'error' && (
        <>
          <Empty
            title="não deu pra carregar"
            hint="a lista de leads ou de runs falhou — tenta de novo"
          />
          <button className="btn plan-retry" onClick={() => load()}>
            tentar de novo
          </button>
        </>
      )}
      {state === 'ok' && !pending.length && !planned.length && (
        <Empty
          title="nenhum plano ainda"
          hint="o agente monta um plano por lead no primeiro contato — metas, objeções e próxima ação aparecem aqui"
        />
      )}

      {state === 'ok' && (pending.length > 0 || planned.length > 0) && (
        <>
          <div className="grid4 plan-stats">
            <div className="stat card">
              <div className="v" style={{ color: next?.late ? 'var(--red-400)' : undefined }}>
                {next ? tMinus(next.at, now) : '—'}
              </div>
              <div className="k">próxima ação</div>
              {next && (
                <div className="plan-next">
                  {next.what} · <Link to={`/leads/${next.leadId}`}>{next.leadName}</Link>
                </div>
              )}
            </div>
            <div className="stat card">
              <div className="v">{pending.length}</div>
              <div className="k">na fila</div>
            </div>
            <div className="stat card">
              <div className="v">{planned.length}</div>
              <div className="k">planos em curso</div>
            </div>
            <div className="stat card">
              <div className="v" style={{ color: late ? 'var(--red-400)' : 'var(--muted)' }}>
                {late}
              </div>
              <div className="k">atrasadas</div>
            </div>
          </div>

          <div className="grid2 plan-cols">
            {pending.length > 0 && (
              <section>
                <div className="sec-t">fila</div>
                <div className="card">
                  <table className="tbl">
                    <tbody>
                      {pending.map((p, i) => (
                        <tr key={i}>
                          <td className="qidx">{String(i + 1).padStart(2, '0')}</td>
                          <td className="qt">
                            <span className={p.late ? 'qt late' : 'qt on'}>
                              {tMinus(p.at, now)}
                            </span>
                          </td>
                          <td className="qabs">{fmtDateTime(p.at)}</td>
                          <td className="qwhat">{p.what}</td>
                          <td>
                            <Link to={`/leads/${p.leadId}`}>{p.leadName}</Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {planned.length > 0 && (
              <section>
                <div className="sec-t">planos em curso</div>
                <div className="card plan-card">
                  {planned.map((l) => (
                    <PlanRow key={l.id} lead={l} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </Page>
  );
}

function PlanRow({ lead }: { lead: LeadListItem }) {
  const [open, setOpen] = useState(false);
  // A skipped step is settled, not pending — progress counts resolved steps.
  const resolved = lead.agentPlan.filter((s) => s.status !== 'todo').length;
  const total = lead.agentPlan.length;
  return (
    <div className="planrow">
      <div className="planrow-head">
        <Link to={`/leads/${lead.id}`} className="planrow-name">
          {lead.name}
        </Link>
        <button
          className="btn ghost planrow-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`plano de ${lead.name}`}
        >
          <span className="chip agent" title="objetivo atual">
            {GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
          </span>
          <span className="planbar planrow-bar" title={`${resolved} de ${total} etapas resolvidas`}>
            <span style={{ width: `${(resolved / total) * 100}%` }} />
          </span>
          <span className="qmono">
            {resolved}/{total}
          </span>
          <ChevronDown size={14} className="planrow-chev" />
        </button>
      </div>
      {open && (
        <div className="planrow-steps">
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
      )}
    </div>
  );
}

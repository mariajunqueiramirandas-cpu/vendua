import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Circle, SkipForward } from 'lucide-react';
import { api, type AgentRun, type LeadListItem } from '../api.ts';
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

// Mission-clock countdown: T− until fire, T+ once overdue.
function tMinus(at: string, now: number): string {
  const d = new Date(at).getTime() - now;
  const m = Math.abs(Math.round(d / 60000));
  const v = m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m}m`;
  return d <= 0 ? `T+${v}` : `T−${v}`;
}

export default function Plan() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [now, setNow] = useState(() => Date.now());

  const load = () => {
    setState('loading');
    // Follow the keyset cursor — a partial page would silently hide plans.
    const all: LeadListItem[] = [];
    const page = (cursor?: string): Promise<void> =>
      api.leads({ limit: '200', ...(cursor ? { cursor } : {}) }).then((r) => {
        all.push(...r.leads);
        return r.nextCursor ? page(r.nextCursor) : undefined;
      });
    // scheduled=1 → run_at asc, so if the 200 cap ever truncates it drops the
    // farthest-future rows, never the ones about to fire.
    void Promise.all([
      page(),
      api
        .runs({ status: 'queued', scheduled: '1', limit: '200' })
        .then((r) => r.runs.filter((x) => x.lead_id)),
    ])
      .then(([, queued]) => {
        // Commit both datasets together — a failed half can't render beside the
        // error state as if it were complete.
        setLeads(all);
        setRuns(queued);
        setState('ok');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, []);

  // Re-derive countdowns/lateness on the minute so a deadline crossing shows
  // without a manual reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const byId = new Map(leads.map((l) => [l.id, l]));

  // Flat timeline: every future agent move, soonest first.
  const pending: Pending[] = [
    ...runs
      // claimRun skips leads with the agent off — the queue mirrors it here.
      .filter((r) => byId.get(r.lead_id!)?.agentMode !== 'off')
      .map((r) => ({
        at: r.run_at!,
        what: `run ${RUN_KIND[r.kind] ?? r.kind}`,
        leadId: r.lead_id!,
        leadName: byId.get(r.lead_id!)?.name ?? r.lead_name ?? 'lead',
        late: new Date(r.run_at!).getTime() <= now,
      })),
    ...leads
      .filter((l) => l.agentMode !== 'off' && l.nextActionAt)
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
    .filter((l) => l.agentMode !== 'off' && l.agentPlan.length > 0)
    .sort(
      (a, b) =>
        b.agentPlan.filter((s) => s.status !== 'todo').length / b.agentPlan.length -
        a.agentPlan.filter((s) => s.status !== 'todo').length / a.agentPlan.length,
    );

  const clock = new Date(now).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Page
      title="Planos do agente"
      sub={`${pending.length} ${pending.length === 1 ? 'ação marcada' : 'ações marcadas'} · ${planned.length} ${planned.length === 1 ? 'plano' : 'planos'}`}
    >
      <div className="deck">
        <div className="deck-head">
          <span className="deck-live">
            <span className="deck-dot" />
            console do agente
          </span>
          <span className="deck-clock">{clock}</span>
        </div>

        {state === 'error' && (
          <>
            <Empty
              title="não deu pra carregar"
              hint="a lista de leads ou de runs falhou — tenta de novo"
            />
            <button className="btn" onClick={load} style={{ marginTop: 10 }}>
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

        {state === 'ok' && pending.length > 0 && (
          <>
            <div className="k" style={{ margin: '4px 2px 8px' }}>
              próximas ações
            </div>
            <table className="tbl deck-tbl">
              <tbody>
                {pending.map((p, i) => (
                  <tr key={i}>
                    <td className="deck-idx">{String(i + 1).padStart(2, '0')}</td>
                    <td className="deck-t">
                      <span className={p.late ? 'deck-t late' : 'deck-t on'}>
                        {tMinus(p.at, now)}
                      </span>
                    </td>
                    <td className="deck-abs">{fmtDateTime(p.at)}</td>
                    <td style={{ color: 'var(--muted)' }}>{p.what}</td>
                    <td>
                      <Link to={`/leads/${p.leadId}`}>{p.leadName}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {state === 'ok' && planned.length > 0 && (
          <>
            <div className="k" style={{ margin: '18px 2px 8px' }}>
              planos em curso
            </div>
            {planned.map((l) => (
              <PlanRow key={l.id} lead={l} />
            ))}
          </>
        )}
      </div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link to={`/leads/${lead.id}`} style={{ fontWeight: 600 }}>
          {lead.name}
        </Link>
        <button
          className="btn ghost"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flex: 1,
            minWidth: 0,
            textAlign: 'left',
            padding: '10px 2px',
            fontWeight: 500,
          }}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`plano de ${lead.name}`}
        >
          <span className="chip agent" title="objetivo atual">
            {GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
          </span>
          <span
            className="planbar"
            title={`${resolved} de ${total} etapas resolvidas`}
            style={{ flex: '0 0 64px' }}
          >
            <span style={{ width: `${(resolved / total) * 100}%` }} />
          </span>
          <span className="deck-mono">
            {resolved}/{total}
          </span>
          <ChevronDown
            size={14}
            style={{
              color: 'var(--muted)',
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 150ms cubic-bezier(0.2, 0, 0, 1)',
            }}
          />
        </button>
      </div>
      {open && (
        <div style={{ paddingBottom: 10 }}>
          {lead.agentPlan.map((s, i) => (
            <div key={i} className="trow" style={{ alignItems: 'flex-start', gap: 8 }}>
              {s.status === 'done' ? (
                <CheckCircle2
                  size={15}
                  style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }}
                />
              ) : s.status === 'skip' ? (
                <SkipForward
                  size={15}
                  style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }}
                />
              ) : (
                <Circle size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
              )}
              <span style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    textDecoration: s.status === 'skip' ? 'line-through' : undefined,
                    color: s.status === 'todo' ? undefined : 'var(--muted)',
                  }}
                >
                  {s.step}
                </div>
                {s.note && (
                  <div style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', marginTop: 2 }}>
                    {s.note}
                  </div>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, Circle, SkipForward } from 'lucide-react';
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

// Buckets by when the agent's next move lands: an overdue nextActionAt means
// the sweep is behind; future nextActionAt or a queued run means scheduled;
// the rest carry a plan with no timer armed.
function bucket(l: LeadListItem, runs: AgentRun[], now: number): string {
  if (l.nextActionAt && new Date(l.nextActionAt).getTime() <= now) return 'agora';
  if (l.nextActionAt || runs.length) return 'agendadas';
  return 'sem horário';
}
const ORDER = ['agora', 'agendadas', 'sem horário'];

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
    // Queued runs have no cursor (ordered created_at desc, cap 200) — the set
    // of runs waiting on run_at is small, but the bound is a real limit.
    void Promise.all([
      page(),
      api
        .runs({ status: 'queued', limit: '200' })
        .then((r) => setRuns(r.runs.filter((x) => x.run_at && x.lead_id))),
    ])
      .then(() => {
        setLeads(all);
        setState('ok');
      })
      .catch(() => setState('error'));
  };
  useEffect(load, []);

  // Re-bucket on the minute so an action crossing its deadline moves to agora
  // without a manual reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const runsByLead = new Map<string, AgentRun[]>();
  for (const r of runs) {
    const arr = runsByLead.get(r.lead_id!) ?? [];
    arr.push(r);
    runsByLead.set(r.lead_id!, arr);
  }

  const active = leads.filter(
    (l) =>
      l.agentMode !== 'off' && (l.agentPlan.length > 0 || l.nextActionAt || runsByLead.has(l.id)),
  );
  const groups = new Map<string, LeadListItem[]>();
  for (const l of active) {
    const b = bucket(l, runsByLead.get(l.id) ?? [], now);
    groups.set(b, [...(groups.get(b) ?? []), l]);
  }
  for (const arr of groups.values())
    arr.sort((a, b) => (a.nextActionAt ?? '').localeCompare(b.nextActionAt ?? ''));

  return (
    <Page
      title="Planos do agente"
      sub={`${active.length} ${active.length === 1 ? 'lead sob plano' : 'leads sob plano'}`}
    >
      {state === 'error' && (
        <Empty
          title="não deu pra carregar"
          hint="a lista de leads ou de runs falhou — tenta de novo"
        />
      )}
      {state === 'error' && (
        <button className="btn" onClick={load}>
          tentar de novo
        </button>
      )}
      {state === 'ok' && !active.length && (
        <Empty
          title="nenhum plano ainda"
          hint="o agente monta um plano por lead no primeiro contato — metas, objeções e próxima ação aparecem aqui"
        />
      )}
      {ORDER.filter((b) => groups.has(b)).map((b) => (
        <div key={b} style={{ marginBottom: 18 }}>
          <div className="k" style={{ margin: '0 4px 8px' }}>
            {b} · {groups.get(b)!.length}
          </div>
          <div className="grid2" style={{ alignItems: 'start' }}>
            {groups.get(b)!.map((l) => (
              <LeadPlanCard key={l.id} lead={l} runs={runsByLead.get(l.id) ?? []} />
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}

function LeadPlanCard({ lead, runs }: { lead: LeadListItem; runs: AgentRun[] }) {
  const done = lead.agentPlan.filter((s) => s.status === 'done').length;
  const late = lead.nextActionAt && new Date(lead.nextActionAt).getTime() < Date.now();
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Link to={`/leads/${lead.id}`} style={{ fontWeight: 600 }}>
          {lead.name}
        </Link>
        {lead.businessName && (
          <span
            style={{
              color: 'var(--muted)',
              fontSize: 'var(--t-xs)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {lead.businessName}
          </span>
        )}
        <span className="chip agent" style={{ marginLeft: 'auto' }} title="objetivo atual">
          {GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
        </span>
        {lead.agentPlan.length > 0 && (
          <span
            style={{
              color: 'var(--muted)',
              fontSize: 'var(--t-2xs)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {done}/{lead.agentPlan.length}
          </span>
        )}
      </div>
      {lead.agentPlan.map((s, i) => (
        <div key={i} className="trow" style={{ alignItems: 'flex-start', gap: 8 }}>
          {s.status === 'done' ? (
            <CheckCircle2
              size={15}
              style={{ color: 'var(--forest-800)', flexShrink: 0, marginTop: 2 }}
            />
          ) : s.status === 'skip' ? (
            <SkipForward size={15} style={{ color: 'var(--muted)', flexShrink: 0, marginTop: 2 }} />
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
      {!lead.agentPlan.length && (
        <div style={{ color: 'var(--muted)', fontSize: 'var(--t-sm)', padding: '6px 0' }}>
          sem checklist — só um horário armado
        </div>
      )}
      {runs.map((r) => (
        <div key={r.id} className="trow">
          <span className="chip agent">{RUN_KIND[r.kind] ?? r.kind}</span>
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            run agenda {fmtDateTime(r.run_at)}
          </span>
        </div>
      ))}
      {lead.nextActionAt && (
        <div className="trow">
          <CalendarClock size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
          <span style={{ color: 'var(--muted)', fontSize: 'var(--t-xs)', flex: 1 }}>
            próxima ação · {fmtDateTime(lead.nextActionAt)}
          </span>
          {late && <span className="chip warn">atrasada</span>}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type LeadListItem } from '../api.ts';
import { Empty, Page, StateChip, fmtMoney, rel } from '../components.tsx';

const COLS: { key: LeadListItem['state']; label: string }[] = [
  { key: 'lead', label: 'lead' },
  { key: 'contacted', label: 'contatado' },
  { key: 'invited', label: 'convidado' },
  { key: 'live', label: 'ativo' },
];

export default function BoardView() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const nav = useNavigate();

  const load = useCallback(() => {
    // Follow the keyset cursor — the board IS the pipeline, so a partial page
    // would silently hide leads and misreport column totals.
    const all: LeadListItem[] = [];
    const page = (cursor?: string): Promise<void> =>
      api.leads({ limit: '200', ...(cursor ? { cursor } : {}) }).then((r) => {
        all.push(...r.leads);
        return r.nextCursor ? page(r.nextCursor) : undefined;
      });
    void page().then(() => {
      setLeads(all);
      setLoading(false);
    });
  }, []);
  useEffect(load, [load]);

  const move = async (lead: LeadListItem, state: LeadListItem['state']) => {
    if (lead.state === state) return;
    // Optimistic: the column swap is immediate; a failure snaps it back.
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, state } : l)));
    try {
      await api.patchLead(lead.id, { state });
    } catch {
      load();
    }
  };

  if (loading)
    return (
      <Page title="Funil">
        <Empty title="carregando…" />
      </Page>
    );
  if (!leads.length)
    return (
      <Page title="Funil">
        <Empty title="funil vazio" hint="crie o primeiro lead ou rode uma descoberta" />
      </Page>
    );

  return (
    <Page title="Funil" sub={`${leads.length} leads`}>
      <div className="board">
        {COLS.map((col) => {
          const items = leads.filter((l) => l.state === col.key);
          const sum = items.reduce((acc, l) => acc + (l.dealValueCents ?? 0), 0);
          return (
            <section
              key={col.key}
              className="board-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const lead = leads.find((l) => l.id === dragId);
                if (lead) void move(lead, col.key);
                setDragId(null);
              }}
            >
              <header>
                <h2>{col.label}</h2>
                <span className="n">{items.length}</span>
                {sum > 0 && <span className="sum">{fmtMoney(sum)}</span>}
              </header>
              {items.map((l) => (
                <article
                  key={l.id}
                  className="lead-card"
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onDoubleClick={() => nav(`/leads/${l.id}`)}
                >
                  <div className="top">
                    <span className="name">{l.name}</span>
                    {l.agentMode !== 'off' && <span className="chip agent">agente</span>}
                  </div>
                  {l.businessName && <div className="biz">{l.businessName}</div>}
                  <div className="meta">
                    <StateChip state={l.state} />
                    {l.city && <span className="chip">{l.city}</span>}
                    {l.dealValueCents != null && (
                      <span className="score">{fmtMoney(l.dealValueCents)}</span>
                    )}
                    {l.pendingDrafts > 0 && (
                      <span className="chip warn">{l.pendingDrafts} rasc.</span>
                    )}
                    {l.openTasks > 0 && <span className="chip">{l.openTasks} tarefas</span>}
                    <span className="score" style={{ marginLeft: 'auto' }}>
                      {rel(l.lastActivityAt ?? l.updatedAt)}
                    </span>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </Page>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { api, type LeadListItem } from '../api.ts';
import { Empty, Page, fmtMoney, rel } from '../components.tsx';

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
  const [over, setOver] = useState<string | null>(null);
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

  // Refs, not state: in-flight checks must be synchronous — a move that lands
  // between the chain ending and a state flush would queue a write nothing
  // drains, silently diverging the board from the server.
  const inflightMoves = useRef(new Set<string>());
  const queuedMoves = useRef(new Map<string, LeadListItem['state']>());

  const move = async (lead: LeadListItem, state: LeadListItem['state']) => {
    if (lead.state === state) return;
    // Optimistic: the column swap is immediate; a failure snaps it back.
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, state } : l)));
    // A PATCH is in flight for this lead — fire-and-forget would let a slow
    // earlier write overwrite the newer stage. Queue the latest target; the
    // in-flight chain drains it in order.
    if (inflightMoves.current.has(lead.id)) {
      queuedMoves.current.set(lead.id, state);
      return;
    }
    inflightMoves.current.add(lead.id);
    try {
      let target: LeadListItem['state'] | undefined = state;
      while (target !== undefined) {
        await api.patchLead(lead.id, { state: target });
        target = queuedMoves.current.get(lead.id);
        queuedMoves.current.delete(lead.id);
      }
    } catch {
      load();
    } finally {
      inflightMoves.current.delete(lead.id);
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
              className={`board-col${over === col.key ? ' over' : ''}`}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => setOver(col.key)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
              }}
              onDrop={() => {
                const lead = leads.find((l) => l.id === dragId);
                if (lead) void move(lead, col.key);
                setDragId(null);
                setOver(null);
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
                  className={`lead-card${dragId === l.id ? ' dragging' : ''}`}
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOver(null);
                  }}
                  onDoubleClick={() => nav(`/leads/${l.id}`)}
                  title="duplo clique abre o lead"
                >
                  <div className="top">
                    <span className="name">{l.name}</span>
                    {l.agentMode !== 'off' && <span className="chip agent">agente</span>}
                    <Link
                      className="open"
                      to={`/leads/${l.id}`}
                      title="abrir lead"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ArrowUpRight size={13} />
                    </Link>
                  </div>
                  {l.businessName && l.businessName !== l.name && (
                    <div className="biz">{l.businessName}</div>
                  )}
                  <div className="meta">
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
                    {/* touch can't HTML5-drag — the stage picker is the move affordance */}
                    <select
                      className="mv"
                      value={l.state}
                      title="mover para estágio"
                      aria-label="mover para estágio"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation();
                        void move(l, e.target.value as LeadListItem['state']);
                      }}
                    >
                      {COLS.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
              {!items.length && <div className="col-empty">arraste um lead pra cá</div>}
            </section>
          );
        })}
      </div>
    </Page>
  );
}

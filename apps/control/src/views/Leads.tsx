import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Download,
  Instagram,
  Mail,
  MessageCircle,
  PencilLine,
  Plus,
  Send,
  Upload,
  X,
} from 'lucide-react';
import { api, type LeadListItem, type Stats } from '../api.ts';
import { onControlEvent } from '../events.ts';
import {
  AGENT_GOALS,
  AGENT_MODE_LABEL,
  AGENT_MODES,
  Avatar,
  Empty,
  LEAD_STATES,
  Page,
  ScoreBar,
  StateChip,
  fmtMoney,
  isLate,
  rel,
  relDue,
} from '../components.tsx';

const SORTS = [
  ['new', 'recentes'],
  ['activity', 'últ. atividade'],
  ['score', 'score'],
  ['value', 'valor'],
  ['name', 'nome'],
] as const;
type LeadSort = (typeof SORTS)[number][0];

/** Reachability glyph — lit when the channel exists, amber when the value is
 *  suspect (unverified whatsapp), red when it has failed (email bounce). */
function Chan({
  on,
  tone,
  title,
  icon: Icon,
}: {
  on: boolean;
  tone?: 'warn' | 'bad' | undefined;
  title: string;
  icon: typeof Mail;
}) {
  return (
    <span className={`chan${on ? ' on' : ''}${tone ? ` ${tone}` : ''}`} title={title}>
      <Icon size={13} />
    </span>
  );
}

export default function Leads() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<LeadSort>('new');
  const [archived, setArchived] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [goal, setGoal] = useState<'negotiation' | 'meeting'>('negotiation');
  const [channel, setChannel] = useState<'auto' | 'whatsapp' | 'email'>('auto');
  const [dispatchMsg, setDispatchMsg] = useState('');
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const nav = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  // Bumps on every filter change — a late dispatch result only renders if it
  // still belongs to the filter set it was launched under.
  const filterGen = useRef(0);
  // Last-issued load wins: a stale response must not replace a newer result
  // set under the same filters (it would dispatch hidden leads from `sel`).
  const loadGen = useRef(0);

  const params = useCallback(
    (cur?: string) => ({
      ...(q ? { q } : {}),
      ...(state ? { state } : {}),
      ...(tag ? { tag } : {}),
      ...(archived ? { archived } : {}),
      ...(sort !== 'new' ? { sort } : {}),
      ...(cur ? { cursor: cur } : {}),
      limit: '100',
    }),
    [q, state, tag, archived, sort],
  );
  const load = useCallback(
    (cur?: string) => {
      const gen = ++loadGen.current;
      api.leads(params(cur)).then((r) => {
        if (gen !== loadGen.current) return; // superseded by a newer request
        setLeads((ls) => (cur ? [...ls, ...r.leads] : r.leads));
        setCursor(r.nextCursor);
        setLoading(false);
        if (!cur) {
          // The visible set was replaced — keep only selections that
          // survived, so dispatch never acts on leads staff can't see.
          const ids = new Set(r.leads.map((l) => l.id));
          setSel((s) => new Set([...s].filter((id) => ids.has(id))));
        }
      });
    },
    [params],
  );
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);
  // Stage counts come from stats — pipeline-wide, not just the loaded page.
  const loadStats = useCallback(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);
  useEffect(loadStats, [loadStats]);
  // Refresh preserves the visible depth: pages are re-read from the top and
  // swapped in atomically, so an expanded list refreshes in place instead
  // of collapsing back to page one (and selections survive in the same
  // way the plain load prunes them).
  const refresh = useCallback(() => {
    const depth = Math.max(1, Math.ceil(leads.length / 100));
    const gen = ++loadGen.current;
    const all: LeadListItem[] = [];
    let next: string | null = null;
    const pull = (cur?: string): Promise<void> =>
      api.leads(params(cur)).then((r) => {
        all.push(...r.leads);
        next = r.nextCursor;
        if (r.nextCursor && all.length < depth * 100) return pull(r.nextCursor);
      });
    void pull().then(() => {
      if (gen !== loadGen.current) return;
      setLeads(all);
      setCursor(next);
      setLoading(false);
      const ids = new Set(all.map((l) => l.id));
      setSel((s) => new Set([...s].filter((id) => ids.has(id))));
    });
    loadStats();
  }, [params, leads.length, loadStats]);
  useEffect(() => onControlEvent('lead.change', refresh), [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);
  // Filter changes swap the result set — drop hidden selections so dispatch
  // only ever acts on leads the staff can see selected. The generation bump
  // also invalidates an in-flight dispatch result, which would otherwise
  // land under the new lead set after the filters changed.
  useEffect(() => {
    filterGen.current++;
    setSel(new Set());
    setDispatchMsg('');
  }, [q, state, tag, sort, archived]);

  // `/` focuses search, `n` opens new-lead — list-view keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      if (e.key === '/') {
        e.preventDefault();
        document.getElementById('lead-q')?.focus();
      } else if (e.key === 'n') {
        e.preventDefault();
        setShowNew(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const importCsv = async (file: File) => {
    const csv = await file.text();
    const res = await api.importCsv(csv);
    setImportMsg(`${res.created} criados · ${res.skipped.length} ignorados`);
    load();
    loadStats();
  };

  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const dispatch = async () => {
    const gen = filterGen.current;
    setDispatchBusy(true);
    setDispatchMsg('');
    try {
      const r = await api.dispatch([...sel], goal, channel);
      if (gen !== filterGen.current) return; // filters changed mid-flight — stale result
      const names = new Map(leads.map((l) => [l.id, l.name]));
      const skips = r.skipped
        .map((s) => `${names.get(s.id) ?? s.id.slice(0, 8)}: ${s.reason}`)
        .join(' · ');
      setDispatchMsg(
        `${r.enqueued} disparado${r.enqueued === 1 ? '' : 's'}${r.skipped.length ? ` · ${r.skipped.length} ignorado${r.skipped.length === 1 ? '' : 's'}${skips ? ` (${skips})` : ''}` : ''}`,
      );
      setSel(new Set());
    } catch (e) {
      if (gen !== filterGen.current) return;
      setDispatchMsg(e instanceof Error ? e.message : 'erro');
    } finally {
      setDispatchBusy(false);
    }
  };

  const filtered = !!(q || state || tag || archived);
  const clearFilters = () => {
    setQ('');
    setState('');
    setTag('');
    setArchived('');
  };
  // Values the new-lead datalists offer — what's already in the pipe.
  const knownSegments = [
    ...new Set([
      ...leads.map((l) => l.segment ?? ''),
      ...(stats?.bySegment.map((s) => s.key) ?? []),
    ]),
  ]
    .filter(Boolean)
    .sort();
  const knownSources = [
    ...new Set([...leads.map((l) => l.source ?? ''), ...(stats?.bySource.map((s) => s.key) ?? [])]),
  ]
    .filter(Boolean)
    .sort();
  const knownTags = [...new Set(leads.flatMap((l) => l.tags))].sort();
  const totalCount = Object.values(stats?.byState ?? {}).reduce((a, s) => a + s.count, 0);

  return (
    <Page
      title="Leads"
      sub={stats ? `${totalCount} no pipeline` : undefined}
      actions={
        <div className="leads-acts">
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> importar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])}
          />
          <a className="btn" href="/control/v1/leads/export" download="leads.csv">
            <Download size={14} /> exportar
          </a>
          <button className="btn primary" onClick={() => setShowNew(true)}>
            <Plus size={14} /> novo <span className="kbd">n</span>
          </button>
        </div>
      }
    >
      <div className="fchips">
        <button className={!state ? 'sel' : ''} onClick={() => setState('')}>
          todos <b>{stats ? totalCount : '·'}</b>
        </button>
        {LEAD_STATES.map(([v, l]) => (
          <button
            key={v}
            className={state === v ? 'sel' : ''}
            onClick={() => setState((s) => (s === v ? '' : v))}
          >
            {l} <b>{stats?.byState[v]?.count ?? '·'}</b>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <input
          id="lead-q"
          type="search"
          placeholder="buscar…  (/)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <input
          className="ltag"
          list="lead-tags"
          placeholder="tag…"
          title="filtrar por tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
        <datalist id="lead-tags">
          {knownTags.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select value={sort} onChange={(e) => setSort(e.target.value as LeadSort)} title="ordenar">
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select value={archived} onChange={(e) => setArchived(e.target.value)} title="arquivados">
          <option value="">ativos</option>
          <option value="only">arquivados</option>
          <option value="all">todos</option>
        </select>
        {filtered && (
          <button className="btn ghost" onClick={clearFilters} title="limpar filtros">
            <X size={13} /> limpar
          </button>
        )}
        {importMsg && <span className="leads-sub">{importMsg}</span>}
      </div>

      {dispatchMsg && <div className="leads-msg">{dispatchMsg}</div>}

      {loading ? (
        <Empty title="carregando…" />
      ) : !leads.length ? (
        <div className="empty">
          <span className="serif">{filtered ? 'nada aqui' : 'nenhum lead ainda'}</span>
          <div>
            {filtered
              ? 'nenhum lead corresponde aos filtros'
              : 'importe uma planilha ou cadastre o primeiro'}
          </div>
          <div className="empty-acts">
            {filtered ? (
              <button className="btn" onClick={clearFilters}>
                limpar filtros
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <Upload size={14} /> importar csv
                </button>
                <button className="btn primary" onClick={() => setShowNew(true)}>
                  <Plus size={14} /> novo lead
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="card leads-list">
          <table className="tbl leads-tbl">
            <thead>
              <tr>
                <th className="l-cb">
                  <input
                    type="checkbox"
                    checked={leads.length > 0 && leads.every((l) => sel.has(l.id))}
                    onChange={() =>
                      setSel((s) =>
                        leads.every((l) => s.has(l.id))
                          ? new Set()
                          : new Set(leads.map((l) => l.id)),
                      )
                    }
                  />
                </th>
                <th className="l-name">lead</th>
                <th className="l-stage">estágio</th>
                <th className="l-chan" title="canais de contato cadastrados">
                  canais
                </th>
                <th className="l-agent">agente</th>
                <th className="l-score">score</th>
                <th className="l-fit">fit</th>
                <th className="l-val">valor</th>
                <th className="l-next">próx. ação</th>
                <th className="l-act">últ. atividade</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="clickable" onClick={() => nav(`/leads/${l.id}`)}>
                  <td className="l-cb" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={sel.has(l.id)}
                      onChange={() => toggleSel(l.id)}
                    />
                  </td>
                  <td className="l-name">
                    <Avatar name={l.name} />
                    <span className="who">
                      <span className="nm">
                        <b>{l.name}</b>
                        {l.unsubscribedAt && <span className="chip bad">descadastrado</span>}
                        {l.tags.slice(0, 2).map((t) => (
                          <span key={t} className="chip">
                            {t}
                          </span>
                        ))}
                      </span>
                      <span className="biz">{l.businessName ?? ''}</span>
                    </span>
                  </td>
                  <td className="l-stage">
                    <StateChip state={l.state} />
                  </td>
                  <td className="l-chan">
                    <Chan
                      on={!!l.whatsapp}
                      tone={l.whatsapp && !l.whatsappVerified ? 'warn' : undefined}
                      title={
                        l.whatsapp
                          ? `whatsapp ${l.whatsapp}${l.whatsappVerified ? '' : ' — não verificado'}`
                          : 'sem whatsapp'
                      }
                      icon={MessageCircle}
                    />
                    <Chan
                      on={!!l.email}
                      tone={l.emailBouncedAt ? 'bad' : undefined}
                      title={
                        l.emailBouncedAt
                          ? `email ${l.email} — bounce`
                          : l.email
                            ? `email ${l.email}`
                            : 'sem email'
                      }
                      icon={Mail}
                    />
                    <Chan
                      on={!!l.instagram}
                      title={l.instagram ? `instagram ${l.instagram}` : 'sem instagram'}
                      icon={Instagram}
                    />
                  </td>
                  <td className="l-agent">
                    {l.agentPausedAt ? (
                      <span className="chip warn" title="agente pausado — handoff da equipe">
                        pausado
                      </span>
                    ) : l.agentMode === 'off' ? (
                      <span className="chip">off</span>
                    ) : (
                      <span
                        className="chip agent"
                        title={`agente ${AGENT_MODE_LABEL[l.agentMode]} · ${AGENT_GOALS.find(([v]) => v === l.agentGoal)?.[1]}`}
                      >
                        {AGENT_MODE_LABEL[l.agentMode]}
                      </span>
                    )}
                    {l.pendingDrafts > 0 && (
                      <span className="chip warn" title="rascunhos aguardando aprovação no inbox">
                        <PencilLine size={10} />
                        {l.pendingDrafts}
                      </span>
                    )}
                  </td>
                  <td className="l-score">
                    <ScoreBar score={l.score} />
                  </td>
                  <td className="l-fit mono" title={l.fitReason ?? undefined}>
                    {l.fitScore != null ? `${l.fitScore}/10` : '—'}
                    {l.intentScore != null && (
                      <span className="dim" title={l.intentReason ?? undefined}>
                        {' '}
                        · i{l.intentScore}
                      </span>
                    )}
                  </td>
                  <td className="l-val mono">{fmtMoney(l.dealValueCents)}</td>
                  <td className="l-next">
                    <span className={`due${isLate(l.nextActionAt) ? ' bad' : ''}`}>
                      {relDue(l.nextActionAt)}
                    </span>
                    {l.openTasks > 0 && (
                      <span className="dim" title={`${l.openTasks} tarefa(s) aberta(s)`}>
                        {' '}
                        · {l.openTasks} tar.
                      </span>
                    )}
                  </td>
                  <td className="l-act mono">{rel(l.lastActivityAt ?? l.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <div className="leads-more">
          <button className="btn" onClick={() => load(cursor)}>
            mais
          </button>
        </div>
      )}

      {/* Sticky bottom of the scrollport: pinned while a selection exists, so
          the dispatch controls ride with a long list instead of scrolling away. */}
      {sel.size > 0 && (
        <div className="card leads-bulk">
          <b>
            {sel.size} selecionado{sel.size === 1 ? '' : 's'}
          </b>
          <button className="icon-btn" title="limpar seleção" onClick={() => setSel(new Set())}>
            <X size={13} />
          </button>
          <span className="leads-sub">objetivo:</span>
          <span className="seg">
            {AGENT_GOALS.map(([v, l]) => (
              <button key={v} className={goal === v ? 'sel' : ''} onClick={() => setGoal(v)}>
                {l}
              </button>
            ))}
          </span>
          <span className="leads-sub">canal:</span>
          <span className="seg" title="auto = o agente escolhe o canal alcançável">
            {(['auto', 'whatsapp', 'email'] as const).map((v) => (
              <button key={v} className={channel === v ? 'sel' : ''} onClick={() => setChannel(v)}>
                {v}
              </button>
            ))}
          </span>
          <button className="btn agent" disabled={dispatchBusy} onClick={() => void dispatch()}>
            <Send size={14} /> disparar agente
          </button>
        </div>
      )}

      {showNew && (
        <NewLead
          segments={knownSegments}
          sources={knownSources}
          onCreated={() => {
            load();
            loadStats();
          }}
          onClose={(created) => {
            setShowNew(false);
            if (created) {
              load();
              loadStats();
            }
          }}
        />
      )}
    </Page>
  );
}

const MODE_NOTE: Record<string, string> = {
  off: 'a equipe toca o lead — o agente não tria nem fala com ele',
  draft: 'o agente tria e prepara mensagens — você aprova cada envio no inbox',
  auto: 'o agente tria e conversa sozinho, dentro das guardrails',
};

const EMPTY_FORM = {
  name: '',
  businessName: '',
  whatsapp: '',
  email: '',
  instagram: '',
  city: '',
  segment: '',
  source: '',
  deal: '',
};

function NewLead({
  segments,
  sources,
  onCreated,
  onClose,
}: {
  segments: string[];
  sources: string[];
  onCreated: () => void;
  onClose: (created: boolean) => void;
}) {
  const [f, setF] = useState(EMPTY_FORM);
  const [mode, setMode] = useState<'off' | 'draft' | 'auto'>('draft');
  const [goal, setGoal] = useState<'negotiation' | 'meeting'>('negotiation');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [createdMsg, setCreatedMsg] = useState('');
  const [dupes, setDupes] = useState<LeadListItem[]>([]);
  const nav = useNavigate();

  // Soft duplicate guard — any channel or the name itself is probed against
  // the same q-search the list uses.
  useEffect(() => {
    const probe = [f.whatsapp, f.email, f.instagram]
      .map((v) => v.trim())
      .find((v) => v.length >= 4);
    const term = probe ?? (f.name.trim().length >= 4 ? f.name.trim() : '');
    if (!term) {
      setDupes([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .leads({ q: term, limit: '5' })
        .then((r) => setDupes(r.leads))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [f.name, f.whatsapp, f.email, f.instagram]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  const noChannel = !f.whatsapp.trim() && !f.email.trim() && !f.instagram.trim();

  const submit = async (openAfter: boolean) => {
    if (!f.name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const wa = f.whatsapp.replace(/[^\d+]/g, '');
      const res = await api.createLead({
        name: f.name,
        businessName: f.businessName || null,
        whatsapp: wa || null,
        email: f.email || null,
        instagram: f.instagram.replace(/^@/, '') || null,
        city: f.city || null,
        segment: f.segment || null,
        source: f.source || null,
        dealValueCents: f.deal ? Math.round(Number(f.deal.replace(',', '.')) * 100) : null,
        agentMode: mode,
        ...(mode === 'off' ? { automation: false } : { agentGoal: goal }),
      });
      if (openAfter) {
        onClose(true);
        nav(`/leads/${res.lead.id}`);
      } else {
        // "criar + outro" — the parent reloads the list while this drawer
        // stays open on a blank form.
        onCreated();
        setF(EMPTY_FORM);
        setCreatedMsg('lead criado — cadastre o próximo');
        setDupes([]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'erro');
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, ph = '', list?: string) => (
    <div className="field">
      <label>{label}</label>
      <input
        value={f[k]}
        placeholder={ph}
        {...(list ? { list } : {})}
        onChange={(e) => {
          setF({ ...f, [k]: e.target.value });
          setCreatedMsg('');
        }}
        autoFocus={k === 'name'}
      />
    </div>
  );

  return (
    <>
      <div className="scrim" onClick={() => onClose(false)} />
      <div className="drawer" role="dialog" aria-label="novo lead">
        <div className="d-head">
          <b>novo lead</b>
          <span className="spacer" style={{ flex: 1 }} />
          {createdMsg && <span className="chip agent">{createdMsg}</span>}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(true);
          }}
          style={{ display: 'contents' }}
        >
          <div className="d-body">
            <div className="nl-sec">identidade</div>
            {field('name', 'nome *')}
            {field('businessName', 'negócio')}

            <div className="nl-sec">contato</div>
            {field('whatsapp', 'whatsapp', '+55 85 9…')}
            {field('email', 'email')}
            {field('instagram', 'instagram', '@perfil')}
            {noChannel && (
              <div className="nl-warn">sem canal — o agente não consegue falar com este lead</div>
            )}
            {dupes.length > 0 && (
              <div className="nl-warn">
                possível duplicata:{' '}
                {dupes.slice(0, 3).map((d, i) => (
                  <span key={d.id}>
                    {i > 0 && ' · '}
                    <Link to={`/leads/${d.id}`}>{d.name}</Link>
                  </span>
                ))}
              </div>
            )}

            <div className="nl-sec">contexto</div>
            <div className="grid2">
              {field('city', 'cidade')}
              {field('segment', 'segmento', '', 'lead-segs')}
            </div>
            {field('source', 'origem', 'instagram, indicação, lista…', 'lead-srcs')}
            {field('deal', 'valor estimado (R$)')}
            <datalist id="lead-segs">
              {segments.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <datalist id="lead-srcs">
              {sources.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            <div className="nl-sec">agente</div>
            <div className="field">
              <label>modo</label>
              <span className="seg">
                {AGENT_MODES.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    className={mode === v ? 'sel' : ''}
                    onClick={() => setMode(v)}
                  >
                    {l}
                  </button>
                ))}
              </span>
            </div>
            {mode !== 'off' && (
              <div className="field">
                <label>objetivo</label>
                <span className="seg">
                  {AGENT_GOALS.map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      className={goal === v ? 'sel' : ''}
                      onClick={() => setGoal(v)}
                    >
                      {l}
                    </button>
                  ))}
                </span>
              </div>
            )}
            <div className="nl-note">{MODE_NOTE[mode]}</div>
            {err && <div style={{ color: 'var(--red-400)', fontSize: 'var(--t-xs)' }}>{err}</div>}
          </div>
          <div className="d-foot">
            <button className="btn primary" disabled={busy || !f.name.trim()}>
              criar e abrir
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy || !f.name.trim()}
              onClick={() => void submit(false)}
            >
              criar + outro
            </button>
            <button className="btn ghost" type="button" onClick={() => onClose(false)}>
              cancelar
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

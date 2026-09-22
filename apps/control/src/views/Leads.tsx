import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Upload, Download, Send } from 'lucide-react';
import { api, type LeadListItem } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { Empty, Page, ScoreBar, StateChip, fmtMoney, rel } from '../components.tsx';

const GOAL_OPTS = [
  ['negotiation', 'fechar negócio'],
  ['meeting', 'marcar reunião'],
] as const;

export default function Leads() {
  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
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
      ...(archived ? { archived } : {}),
      ...(cur ? { cursor: cur } : {}),
      limit: '100',
    }),
    [q, state, archived],
  );
  const load = useCallback(
    (cur?: string) => {
      const gen = ++loadGen.current;
      api
        .leads(params(cur))
        .then((r) => {
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
  }, [params, leads.length]);
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
  }, [q, state, archived]);

  // `/` focuses search, `n` opens new-lead — list-view keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
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

  return (
    <Page
      title="Leads"
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
      <div className="toolbar">
        <input
          id="lead-q"
          type="search"
          placeholder="buscar…  (/)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={state} onChange={(e) => setState(e.target.value)}>
          <option value="">todos os estágios</option>
          <option value="lead">lead</option>
          <option value="contacted">contatado</option>
          <option value="invited">convidado</option>
          <option value="live">ativo</option>
        </select>
        <select value={archived} onChange={(e) => setArchived(e.target.value)}>
          <option value="">ativos</option>
          <option value="only">arquivados</option>
          <option value="all">todos</option>
        </select>
        {importMsg && <span className="leads-sub">{importMsg}</span>}
      </div>

      {sel.size > 0 && (
        <div className="card leads-bulk">
          <b>
            {sel.size} selecionado{sel.size === 1 ? '' : 's'}
          </b>
          <span className="leads-sub">objetivo:</span>
          <span className="seg">
            {GOAL_OPTS.map(([v, l]) => (
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
      {/* Result lives outside the selection card — dispatch clears `sel`,
          which would unmount the message in the same render. */}
      {dispatchMsg && <div className="leads-msg">{dispatchMsg}</div>}

      {loading ? (
        <Empty title="carregando…" />
      ) : !leads.length ? (
        <Empty
          title="nenhum lead"
          hint={q ? 'busca sem resultados — limpe os filtros' : 'crie o primeiro (n)'}
        />
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
                <th className="l-name">nome</th>
                <th className="l-biz">negócio</th>
                <th className="l-stage">estágio</th>
                <th className="l-opt">segmento</th>
                <th className="l-opt">cidade</th>
                <th className="l-val">valor</th>
                <th className="l-opt">fit</th>
                <th className="l-score">score</th>
                <th className="l-agent">agente</th>
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
                    <b>{l.name}</b>
                    {l.unsubscribedAt && (
                      <span className="chip bad" style={{ marginLeft: 6 }}>
                        descadastrado
                      </span>
                    )}
                    {l.emailBouncedAt && (
                      <span className="chip warn" style={{ marginLeft: 4 }}>
                        email bounce
                      </span>
                    )}
                  </td>
                  <td className="l-biz">{l.businessName ?? '—'}</td>
                  <td className="l-stage">
                    <StateChip state={l.state} />
                  </td>
                  <td className="l-opt">{l.segment ?? '—'}</td>
                  <td className="l-opt">{l.city ?? '—'}</td>
                  <td className="l-val mono">{fmtMoney(l.dealValueCents)}</td>
                  <td className="l-opt mono" title={l.fitReason ?? undefined}>
                    {l.fitScore != null ? `${l.fitScore}/10` : '—'}
                    {l.intentScore != null && (
                      <span className="dim" title={l.intentReason ?? undefined}>
                        {' '}
                        · i{l.intentScore}
                      </span>
                    )}
                  </td>
                  <td className="l-score">
                    <ScoreBar score={l.score} />
                  </td>
                  <td className="l-agent">
                    {l.agentMode !== 'off' ? (
                      <span className="chip agent">{l.agentMode}</span>
                    ) : (
                      <span className="chip">off</span>
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
      {showNew && (
        <NewLead
          onClose={(created) => {
            setShowNew(false);
            if (created) {
              load();
            }
          }}
        />
      )}
    </Page>
  );
}

function NewLead({ onClose }: { onClose: (created: boolean) => void }) {
  const [f, setF] = useState({
    name: '',
    businessName: '',
    whatsapp: '',
    email: '',
    instagram: '',
    city: '',
    segment: '',
    source: '',
    deal: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [automation, setAutomation] = useState(true);
  const nav = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.createLead({
        name: f.name,
        businessName: f.businessName || null,
        whatsapp: f.whatsapp || null,
        email: f.email || null,
        instagram: f.instagram || null,
        city: f.city || null,
        segment: f.segment || null,
        source: f.source || null,
        dealValueCents: f.deal ? Math.round(Number(f.deal.replace(',', '.')) * 100) : null,
        ...(automation ? {} : { automation: false }),
      });
      onClose(true);
      nav(`/leads/${res.lead.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'erro');
      setBusy(false);
    }
  };

  const field = (k: keyof typeof f, label: string, ph = '') => (
    <div className="field">
      <label>{label}</label>
      <input
        value={f[k]}
        placeholder={ph}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
        autoFocus={k === 'name'}
      />
    </div>
  );

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={() => onClose(false)} />
      <div className="drawer" role="dialog" aria-label="novo lead">
        <div className="d-head">
          <b>novo lead</b>
        </div>
        <form onSubmit={submit} style={{ display: 'contents' }}>
          <div className="d-body">
            {field('name', 'nome *')}
            {field('businessName', 'negócio')}
            {field('whatsapp', 'whatsapp', '+55 85 9…')}
            {field('email', 'email')}
            {field('instagram', 'instagram', '@perfil')}
            <div className="grid2">
              {field('city', 'cidade')}
              {field('segment', 'segmento')}
            </div>
            {field('source', 'origem')}
            {field('deal', 'valor estimado (R$)')}
            <label className="tgl">
              <input
                type="checkbox"
                checked={automation}
                onChange={(e) => setAutomation(e.target.checked)}
              />
              <span className="tk" />
              <span className="lbl">
                {automation ? 'agente acompanha' : 'sem agente — como import'}
              </span>
            </label>
            {err && <div style={{ color: 'var(--red-400)', fontSize: 'var(--t-xs)' }}>{err}</div>}
          </div>
          <div className="d-foot">
            <button className="btn primary" disabled={busy || !f.name.trim()}>
              criar
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

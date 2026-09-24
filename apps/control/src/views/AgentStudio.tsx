import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pin, PinOff } from 'lucide-react';
import {
  api,
  ApiError,
  type AgentPlaybookInfo,
  type AgentAutonomySetting,
  type AutonomyLevel,
  type MemoryItem,
  type MemoryScope,
  type PlaybookKind,
  type PlaybookOverride,
} from '../api.ts';
import { onControlEvent } from '../events.ts';
import {
  ConfirmBtn,
  Page,
  RUN_KIND_LABEL,
  fmtDateTime,
  isLate,
  rel,
  relDue,
} from '../components.tsx';
import { ListEditor, RawJson, TzList, num, str, tzValid } from './settings-bits.tsx';

/** Estúdio — everything the agent is made of, in one place: how far it
 *  decides (autonomia), how it talks (voz), the modes it works in
 *  (playbooks), what it remembers (memória), what it scheduled (agenda),
 *  and the hard limits (regras). Same index-rail grammar as Config; the
 *  agent sections moved out of there because they describe the worker,
 *  not the machine's wiring. The v2 routes land in steps — each endpoint
 *  reports 'loading | ok | missing | err' independently and the cards
 *  degrade into honest states, never fake data. */

const SECTIONS = [
  { key: 'autonomia', label: 'autonomia', sub: 'o que ele decide' },
  { key: 'voz', label: 'voz', sub: 'o pitch' },
  { key: 'playbooks', label: 'playbooks', sub: 'modos de trabalho' },
  { key: 'memoria', label: 'memória', sub: 'o que ele lembra' },
  { key: 'agenda', label: 'agenda', sub: 'retornos marcados' },
  { key: 'regras', label: 'regras', sub: 'limites' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

type Notice = { kind: 'ok' | 'err'; text: string } | null;
type Load = 'loading' | 'ok' | 'missing' | 'err';

/** Endpoint fetch with a success watermark: a late failure can't clobber a
 *  newer success, and a 404 reports 'missing' — a route that hasn't shipped
 *  to this server yet is a state, not an error. */
function useAgent<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [st, setSt] = useState<Load>('loading');
  const seq = useRef(0);
  const okSeq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's choice
  const reload = useCallback(() => {
    const my = ++seq.current;
    void fn()
      .then((d) => {
        if (my > okSeq.current) {
          okSeq.current = my;
          setData(d);
          setSt('ok');
        }
      })
      .catch((e: unknown) => {
        if (my > okSeq.current) {
          okSeq.current = my;
          setSt(e instanceof ApiError && e.status === 404 ? 'missing' : 'err');
        }
      });
  }, deps);
  useEffect(reload, [reload]);
  // write lets a caller push a freshly-saved value into `data` ahead of the
  // next fetch — closes the PUT→refetch window where a stale map shows.
  return { data, st, reload, write: setData };
}

/** The card shown while an endpoint hasn't landed (404) or failed — the
 *  panel states what will live here, never invents content. */
function EndpointCard({
  st,
  title,
  missing,
  onRetry,
}: {
  st: Load;
  title: string;
  missing: string;
  onRetry: () => void;
}) {
  if (st === 'loading') {
    return (
      <div className="empty">
        <span className="serif" style={{ fontSize: 'var(--t-lg)' }}>
          carregando…
        </span>
      </div>
    );
  }
  if (st === 'missing') {
    return (
      <div className="drv">
        <div className="drv-head">
          <span className="dot" />
          <h3>{title}</h3>
          <span className="chip st-off">rota ainda não neste servidor</span>
        </div>
        <div className="hint">{missing}</div>
      </div>
    );
  }
  return (
    <div className="drv warn">
      <div className="drv-head">
        <span className="dot" />
        <h3>{title}</h3>
        <span className="chip st-warn">falha ao ler</span>
      </div>
      <div className="actions" style={{ marginTop: 4 }}>
        <button className="btn" onClick={onRetry}>
          tentar de novo
        </button>
      </div>
    </div>
  );
}

export default function AgentStudio() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice>(null);

  // settings map — pitch, guardrails, agent_memory, agent_playbooks,
  // agent_autonomy all live here; PUT /settings/:key is the write path.
  const settings = useAgent(
    () => api.settings().then((s) => Object.fromEntries(s.settings.map((r) => [r.key, r.value]))),
    [],
  );
  const autonomy = useAgent(() => api.autonomy(), []);
  const playbooks = useAgent(() => api.playbooks().then((r) => r.playbooks), []);
  const memory = useAgent(
    () =>
      Promise.all([
        api.memory({ scope: 'workspace' }),
        api.memory({ scope: 'segment' }),
        api.memory({ scope: 'debrief' }),
      ]).then(([w, s, d]) => ({
        workspace: w.items,
        segment: s.items,
        debrief: d.items,
      })),
    [],
  );

  const reload = useCallback(() => {
    settings.reload();
    autonomy.reload();
    playbooks.reload();
    memory.reload();
  }, [settings, autonomy, playbooks, memory]);

  // PUT /settings/:key sends the WHOLE value — a save must never build on a
  // pre-save map. Writes are serialized (saveQ) and merge off mapRef, which
  // is the freshest local picture: synced from the last fetch and updated
  // optimistically the moment a PUT lands, before the refetch resolves.
  const mapRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (settings.data) mapRef.current = settings.data;
  }, [settings.data]);
  const saveQ = useRef(Promise.resolve());
  const saveSetting = (
    key: string,
    value: unknown | ((cur: unknown) => unknown),
  ): Promise<void> => {
    const task = saveQ.current.then(async () => {
      const v =
        typeof value === 'function'
          ? (value as (cur: unknown) => unknown)(mapRef.current[key])
          : value;
      try {
        await api.putSetting(key, v);
      } catch (e) {
        setNotice({ kind: 'err', text: `${key}: ${e instanceof Error ? e.message : e}` });
        settings.reload(); // resync — the local picture may be stale
        return;
      }
      mapRef.current = { ...mapRef.current, [key]: v };
      settings.write(mapRef.current);
      setNotice({ kind: 'ok', text: `${key} salvo` });
      reload();
    });
    saveQ.current = task;
    return task;
  };

  // Editors that PUT a whole setting only render once settings.st === 'ok' —
  // before that the map is {} and a save would erase what's already stored.
  const settingsOk = settings.st === 'ok';
  const settingsGate = (title: string) => (
    <EndpointCard
      st={settings.st}
      title={title}
      missing="GET /settings ainda não chegou neste servidor — mexer aqui sem ler antes apagaria o que já está salvo."
      onRetry={settings.reload}
    />
  );

  const map = settings.data ?? {};
  const pitch = (map.pitch ?? {}) as Record<string, unknown>;
  const guardrails = (map.guardrails ?? {}) as Record<string, unknown>;
  const memoryV1 = (map.agent_memory ?? { facts: [] }) as { facts: string[] };
  const pbSetting = (map.agent_playbooks ?? {}) as Record<string, unknown>;

  // ---------- section selection (?s=) — same grammar as Config ----------
  const section: SectionKey =
    SECTIONS.find((s) => s.key === searchParams.get('s'))?.key ?? 'autonomia';
  const go = (s: SectionKey) => {
    const next = new URLSearchParams(searchParams);
    if (s === 'autonomia') next.delete('s');
    else next.set('s', s);
    setSearchParams(next);
  };

  const savePlaybook = (kind: PlaybookKind, ov: PlaybookOverride | null) =>
    void saveSetting('agent_playbooks', (cur: unknown) => {
      const next = { ...((cur ?? {}) as Record<string, PlaybookOverride>) };
      if (ov === null) delete next[kind];
      else next[kind] = ov;
      return next;
    });

  const autonomyLevel = autonomy.data?.level;
  const marks: Partial<Record<SectionKey, 'off' | 'warn'>> = {};
  if (autonomyLevel === 'off') marks.autonomia = 'off';
  if (autonomyLevel === 'autopilot') marks.autonomia = 'warn';
  if (settingsOk && !str(pitch.product, '')) marks.voz = 'warn';

  return (
    <Page title="Estúdio" sub="a bancada do agente — o que ele decide, fala, lembra e agenda">
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      <div className="set-wrap">
        <nav className="set-idx" aria-label="áreas do estúdio">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`idx${section === s.key ? ' sel' : ''}`}
              aria-current={section === s.key ? 'page' : undefined}
              onClick={() => go(s.key)}
            >
              <span className="idx-l">{s.label}</span>
              <span className="idx-s">{s.sub}</span>
              {marks[s.key] && <i className={`mk ${marks[s.key]}`} />}
            </button>
          ))}
          <Link className="idx out" to="/config">
            <span className="idx-l">config</span>
            <span className="idx-s">a sala de máquinas ›</span>
          </Link>
        </nav>
        <div className="set-panel">
          <div hidden={section !== 'autonomia'}>
            <section className="set-sec">
              <h2>acelerador</h2>
              <p className="sub">
                até onde o agente decide sozinho — a mesma régua vale pra todo run automático
              </p>
              {!settingsOk ? (
                settingsGate('autonomia')
              ) : (
                <AutonomyCard
                  server={autonomy.data}
                  saved={(map.agent_autonomy ?? {}) as Record<string, unknown>}
                  onSave={(v) => void saveSetting('agent_autonomy', v)}
                />
              )}
            </section>
          </div>
          <div hidden={section !== 'voz'}>
            <section className="set-sec">
              <h2>voz do agente</h2>
              <p className="sub">o pitch inteiro que o modelo recebe no system prompt</p>
              {!settingsOk ? (
                settingsGate('voz')
              ) : (
                <PitchCard value={pitch} onSave={(v) => void saveSetting('pitch', v)} />
              )}
            </section>
          </div>
          <div hidden={section !== 'playbooks'}>
            <section className="set-sec">
              <h2>playbooks</h2>
              <p className="sub">
                os modos de trabalho — gatilhos, ferramentas e orçamento de cada um
              </p>
              {!settingsOk ? (
                settingsGate('playbooks')
              ) : playbooks.st !== 'ok' ? (
                <>
                  <EndpointCard
                    st={playbooks.st}
                    title="catálogo de playbooks"
                    missing="GET /agent/playbooks ainda não chegou neste servidor — enquanto isso dá pra escrever os ajustes pelo json bruto abaixo."
                    onRetry={playbooks.reload}
                  />
                  <div className="drv">
                    <div className="drv-head">
                      <span className="dot" />
                      <h3>ajustes brutos</h3>
                    </div>
                    <RawJson
                      value={pbSetting}
                      onSave={(v) => void saveSetting('agent_playbooks', v)}
                    />
                  </div>
                </>
              ) : (
                playbooks.data!.map((pb) => (
                  <PlaybookCard key={pb.kind} pb={pb} onSave={savePlaybook} />
                ))
              )}
            </section>
          </div>
          <div hidden={section !== 'memoria'}>
            <section className="set-sec">
              <h2>memória</h2>
              <p className="sub">
                o que o agente carrega no contexto — workspace vale pra tudo, segmento por nicho,
                debrief sai de cada run
              </p>
              <MemoryPanel
                st={memory.st}
                data={memory.data}
                onRetry={memory.reload}
                onChanged={memory.reload}
                onError={(text) => setNotice({ kind: 'err', text })}
              />
            </section>
            <section className="set-sec">
              <h2>memória clássica (v1)</h2>
              <p className="sub">fatos guardados via tool `remember` — a v2 absorve</p>
              {!settingsOk ? (
                settingsGate('memória clássica')
              ) : (
                <MemoryCard
                  facts={memoryV1.facts}
                  onSave={(facts) => void saveSetting('agent_memory', { facts })}
                />
              )}
            </section>
          </div>
          <div hidden={section !== 'agenda'}>
            <section className="set-sec">
              <h2>agenda</h2>
              <p className="sub">retornos que o agente marcou — cancelar aqui desmarca o run</p>
              <WakeupsPanel onError={(text) => setNotice({ kind: 'err', text })} />
            </section>
          </div>
          <div hidden={section !== 'regras'}>
            <section className="set-sec">
              <h2>guardrails</h2>
              <p className="sub">regras duras — o código impõe, não o prompt</p>
              {!settingsOk ? (
                settingsGate('guardrails')
              ) : (
                <GuardrailsCard
                  value={guardrails}
                  onSave={(v) => void saveSetting('guardrails', v)}
                />
              )}
            </section>
          </div>
        </div>
      </div>
      {/* timezone picker inside guardrails reads this datalist */}
      <TzList />
    </Page>
  );
}

// ---------- autonomia ----------

const LEVELS: {
  key: AutonomyLevel;
  label: string;
  tag: string;
  runs: string;
  sends: string;
  queue: string;
}[] = [
  {
    key: 'off',
    label: 'desligado',
    tag: 'só no manual',
    runs: 'nenhum run automático — só quando alguém dispara na mão',
    sends: 'nada sai sozinho; se um run manual escrever, vira rascunho',
    queue: 'a fila de aprovação não anda',
  },
  {
    key: 'copilot',
    label: 'copiloto',
    tag: 'tudo vira rascunho',
    runs: 'pesquisa, escreve e agenda retornos sozinho',
    sends: 'toda mensagem espera aprovação antes de sair',
    queue: 'aprovações acumulam na fila',
  },
  {
    key: 'supervised',
    label: 'supervisionado',
    tag: 'o padrão de hoje',
    runs: 'roda sozinho em cima de cada gatilho',
    sends: 'respostas e follow-ups saem direto; primeiro contato espera aprovação',
    queue: 'só o primeiro contato para na fila',
  },
  {
    key: 'autopilot',
    label: 'piloto automático',
    tag: 'mão solta',
    runs: 'roda e envia sozinho, sem tocar na fila',
    sends: 'tudo sai direto — silêncio, teto/dia e ignorados continuam valendo',
    queue: 'fila vazia — nada espera você',
  },
];

function AutonomyCard({
  server,
  saved,
  onSave,
}: {
  /** GET /agent/autonomy — the effective preset, defaults applied */
  server: { level: AutonomyLevel; strategistAutoApproveUsd: number } | null;
  /** raw settings.agent_autonomy — the fallback read while the GET is absent */
  saved: Record<string, unknown>;
  onSave: (v: AgentAutonomySetting) => void;
}) {
  const base: Required<AgentAutonomySetting> = server ?? {
    level: ['off', 'copilot', 'supervised', 'autopilot'].includes(saved.level as string)
      ? (saved.level as AutonomyLevel)
      : 'supervised',
    strategistAutoApproveUsd: num(saved.strategistAutoApproveUsd, 0),
  };
  const [edit, setEdit] = useState(base);
  useEffect(() => setEdit(base), [JSON.stringify(base)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(base);
  const sel = LEVELS.find((l) => l.key === edit.level)!;
  const pos = LEVELS.findIndex((l) => l.key === edit.level);
  const capBad =
    !Number.isFinite(edit.strategistAutoApproveUsd) ||
    edit.strategistAutoApproveUsd < 0 ||
    edit.strategistAutoApproveUsd > 50;

  return (
    <div className="drv">
      <div className="drv-head">
        <span className="dot" />
        <h3>nível de autonomia</h3>
        <span className="sp" />
        {server && (
          <span className={`chip st-${server.level === 'off' ? 'off' : 'live'}`}>
            no ar: {LEVELS.find((l) => l.key === server.level)?.label}
          </span>
        )}
      </div>
      <div
        className="thr"
        role="radiogroup"
        aria-label="nível de autonomia"
        style={{ '--pos': pos } as CSSProperties}
      >
        {LEVELS.map((l) => (
          <button
            key={l.key}
            type="button"
            role="radio"
            aria-checked={edit.level === l.key}
            className={`thr-stop${edit.level === l.key ? ' sel' : ''}`}
            onClick={() => setEdit({ ...edit, level: l.key })}
          >
            <span className="thr-dot" aria-hidden />
            <span className="thr-l">{l.label}</span>
            <span className="thr-s">{l.tag}</span>
          </button>
        ))}
      </div>
      <div className="thr-read">
        <div>
          <span className="k">runs</span>
          {sel.runs}
        </div>
        <div>
          <span className="k">envios</span>
          {sel.sends}
        </div>
        <div>
          <span className="k">fila</span>
          {sel.queue}
        </div>
      </div>
      <div className="field" style={{ maxWidth: 260 }}>
        <label>auto-aprovação do estrategista (US$/sem)</label>
        <input
          type="number"
          min={0}
          max={50}
          step={0.5}
          value={edit.strategistAutoApproveUsd}
          onChange={(e) => setEdit({ ...edit, strategistAutoApproveUsd: Number(e.target.value) })}
        />
        <div className="hint">
          o estrategista liga sozinho o brief que propõe enquanto o gasto de descoberta dos últimos
          7 dias ficar abaixo desse teto — 0 = toda proposta chega desligada
        </div>
        {capBad && (
          <div className="hint" style={{ color: 'var(--red-400)' }}>
            número entre 0 e 50
          </div>
        )}
      </div>
      <div className="actions">
        <button
          className="btn primary"
          disabled={!dirty || capBad}
          onClick={() => onSave({ ...edit })}
        >
          salvar autonomia
        </button>
        {dirty && (
          <button className="btn ghost" onClick={() => setEdit(base)}>
            desfazer
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- playbooks ----------

const TRIGGER_LABEL: Record<string, string> = {
  staff: 'equipe',
  inbound: 'resposta',
  'next-action': 'sequência',
  wakeup: 'retorno',
  discovery: 'descoberta',
  'first-contact': '1º contato',
  brief: 'brief',
  weekly: 'semanal',
};

function PlaybookCard({
  pb,
  onSave,
}: {
  pb: AgentPlaybookInfo;
  onSave: (kind: PlaybookKind, ov: PlaybookOverride | null) => void;
}) {
  // Form = effective values (override over defaults) — a save writes the
  // whole override explicitly; "voltar ao padrão" removes the kind's key.
  const eff = {
    enabled: pb.override.enabled ?? true,
    stepBudget: pb.override.stepBudget ?? pb.defaults.stepBudget,
    model: pb.override.model ?? '',
    instructions: pb.override.instructions ?? '',
    monidCapUsd: pb.override.monidCapUsd ?? pb.defaults.monidCapUsd,
  };
  const [edit, setEdit] = useState(eff);
  useEffect(() => setEdit(eff), [JSON.stringify(eff)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(eff);
  const hasOverride = Object.keys(pb.override).length > 0;
  const invalid =
    !Number.isInteger(edit.stepBudget) ||
    edit.stepBudget < 1 ||
    edit.stepBudget > 60 ||
    !Number.isFinite(edit.monidCapUsd) ||
    edit.monidCapUsd < 0 ||
    edit.monidCapUsd > 5 ||
    edit.model.trim().length > 100 ||
    edit.instructions.length > 4000;

  const save = () =>
    onSave(pb.kind, {
      enabled: edit.enabled,
      stepBudget: edit.stepBudget,
      model: edit.model.trim() || null,
      instructions: edit.instructions,
      monidCapUsd: edit.monidCapUsd,
    });

  const over = (on: boolean) => (on ? ' ovr' : '');

  return (
    <div className={`drv${eff.enabled ? ' live' : ''}`}>
      <div className="drv-head">
        <span className="dot" />
        <h3>{pb.label}</h3>
        <span className="drv-cur">{pb.kind}</span>
        <span className="sp" />
        <span className={`chip ${eff.enabled ? 'st-live' : 'st-off'}`}>
          {eff.enabled ? 'ativo' : 'desligado'}
        </span>
      </div>
      <p className="pb-desc">{pb.description}</p>
      <div className="cfg-chips">
        {pb.triggers.map((t) => (
          <span className="chip" key={t}>
            {TRIGGER_LABEL[t] ?? t}
          </span>
        ))}
        {pb.tools.map((t) => (
          <span className="chip" key={t} style={{ fontFamily: 'var(--font-mono)' }}>
            {t}
          </span>
        ))}
      </div>
      <div className="pb-eff">
        <span className={`chip${over(pb.override.stepBudget !== undefined)}`}>
          {eff.stepBudget} passos
        </span>
        <span className={`chip${over(pb.override.monidCapUsd !== undefined)}`}>
          teto ${eff.monidCapUsd.toFixed(2)}
        </span>
        <span
          className={`chip${over(pb.override.model !== undefined && pb.override.model !== null)}`}
        >
          {eff.model || 'modelo do workspace'}
        </span>
        {eff.instructions && (
          <span className="chip ovr">+instruções ({eff.instructions.length}ch)</span>
        )}
        {hasOverride && <span className="chip st-warn">ajustado</span>}
      </div>
      <details className="pb-ed">
        <summary>ajustar este playbook</summary>
        <div className="pb-ed-body">
          <div className="grid3" style={{ alignItems: 'end' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>ativo</label>
              <label className="tgl">
                <input
                  type="checkbox"
                  checked={edit.enabled}
                  onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
                />
                <span className="tk" />
                <span className="lbl">{edit.enabled ? 'roda nos gatilhos' : 'não roda'}</span>
              </label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>orçamento (passos)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={edit.stepBudget}
                onChange={(e) => setEdit({ ...edit, stepBudget: Number(e.target.value) })}
              />
              <div className="hint">padrão {pb.defaults.stepBudget} · 1–60</div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>teto monid (US$)</label>
              <input
                type="number"
                min={0}
                max={5}
                step={0.05}
                value={edit.monidCapUsd}
                onChange={(e) => setEdit({ ...edit, monidCapUsd: Number(e.target.value) })}
              />
              <div className="hint">padrão ${pb.defaults.monidCapUsd.toFixed(2)} · 0–5</div>
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label>modelo</label>
            <input
              value={edit.model}
              maxLength={100}
              placeholder="padrão do workspace"
              onChange={(e) => setEdit({ ...edit, model: e.target.value })}
            />
            <div className="hint">vazio = o modelo que o workspace escolheu nas conexões</div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>instruções extras ({edit.instructions.length}/4000)</label>
            <textarea
              rows={3}
              value={edit.instructions}
              maxLength={4000}
              placeholder="vai junto do system prompt desse playbook — ex.: 'sempre mencione o frete grátis'"
              onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
            />
          </div>
          <div className="actions">
            <button className="btn primary" disabled={!dirty || invalid} onClick={save}>
              salvar ajuste
            </button>
            {dirty && (
              <button className="btn ghost" onClick={() => setEdit(eff)}>
                desfazer
              </button>
            )}
            {hasOverride && (
              <ConfirmBtn confirm="volta tudo ao padrão?" onConfirm={() => onSave(pb.kind, null)}>
                voltar ao padrão
              </ConfirmBtn>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------- memória v2 ----------

function MemoryPanel({
  st,
  data,
  onRetry,
  onChanged,
  onError,
}: {
  st: Load;
  data: Record<MemoryScope, MemoryItem[]> | null;
  onRetry: () => void;
  onChanged: () => void;
  onError: (text: string) => void;
}) {
  const [scope, setScope] = useState<MemoryScope>('workspace');
  const [segment, setSegment] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError(`memória: ${e instanceof Error ? e.message : e}`);
    }
  };

  const add = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await api.createMemory({
        scope,
        ...(scope === 'segment' ? { segment: segment.trim() } : {}),
        content,
      });
      setDraft('');
      onChanged();
    } catch (e) {
      onError(`memória: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  if (st !== 'ok' || !data) {
    return (
      <EndpointCard
        st={st}
        title="memória v2"
        missing="GET/POST /agent/memory ainda não chegou neste servidor — quando chegar, os itens ficam agrupados por escopo e dá pra fixar o que importa sempre. Por ora a memória clássica abaixo segue valendo."
        onRetry={onRetry}
      />
    );
  }

  const groups: { key: MemoryScope; label: string; items: MemoryItem[] }[] = [
    { key: 'workspace', label: 'workspace — vale pra todo run', items: data.workspace },
    { key: 'segment', label: 'por segmento — nicho do lead', items: data.segment },
    { key: 'debrief', label: 'debriefs — saem dos runs', items: data.debrief },
  ];
  const byPin = (a: MemoryItem, b: MemoryItem) => Number(b.pinned) - Number(a.pinned);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  const renderItem = (m: MemoryItem) => (
    <div className="mrow" key={m.id}>
      <button
        className={`mpin${m.pinned ? ' on' : ''}`}
        title={m.pinned ? 'soltar' : 'fixar — sempre entra no contexto'}
        aria-pressed={m.pinned}
        onClick={() => void run(() => api.patchMemory(m.id, { pinned: !m.pinned }))}
      >
        {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
      <div className="mtx">
        {editId === m.id ? (
          <div className="med">
            <textarea
              rows={2}
              maxLength={500}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="actions" style={{ marginTop: 6 }}>
              <button
                className="btn primary"
                disabled={!editText.trim()}
                onClick={() => {
                  const content = editText.trim();
                  setEditId(null);
                  void run(() => api.patchMemory(m.id, { content }));
                }}
              >
                salvar
              </button>
              <button className="btn ghost" onClick={() => setEditId(null)}>
                deixar
              </button>
            </div>
          </div>
        ) : (
          <button
            className="mtxt"
            title="editar"
            onClick={() => {
              setEditId(m.id);
              setEditText(m.content);
            }}
          >
            {m.content}
          </button>
        )}
        <div className="mmeta">
          {m.segment && <span className="chip">{m.segment}</span>}
          <span className="chip">{m.source === 'staff' ? 'equipe' : m.source}</span>
          {m.uses > 0 && <span>{m.uses} usos</span>}
          <span>{rel(m.updatedAt)}</span>
        </div>
      </div>
      <ConfirmBtn
        className="mpin"
        confirm="apagar?"
        onConfirm={() => void run(() => api.deleteMemory(m.id))}
      >
        ×
      </ConfirmBtn>
    </div>
  );

  // segment items regroup by their segment name
  const segGroups = new Map<string, MemoryItem[]>();
  for (const m of data.segment) {
    const k = m.segment ?? '(sem nome)';
    segGroups.set(k, [...(segGroups.get(k) ?? []), m]);
  }

  return (
    <>
      <div className="drv">
        <div className="mem-add">
          <select value={scope} onChange={(e) => setScope(e.target.value as MemoryScope)}>
            <option value="workspace">workspace</option>
            <option value="segment">segmento</option>
            <option value="debrief">debrief</option>
          </select>
          {scope === 'segment' && (
            <input
              value={segment}
              placeholder="nome do segmento — ex.: pizzarias"
              maxLength={80}
              onChange={(e) => setSegment(e.target.value)}
              style={{ maxWidth: 220 }}
            />
          )}
          <input
            value={draft}
            placeholder="grave algo que vale pra todo run — ex.: 'a Lia sempre indica leads quentes'"
            maxLength={500}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <button
            className="btn"
            disabled={!draft.trim() || (scope === 'segment' && !segment.trim()) || saving}
            onClick={() => void add()}
          >
            guardar
          </button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {total} ite{total === 1 ? 'm' : 'ns'} — fixados entram sempre no contexto do agente
        </div>
      </div>
      {groups.map((g) => (
        <div className="ovl" key={g.key} style={{ marginBottom: 14 }}>
          <div className="ovl-g">
            {g.label} · {g.items.length}
          </div>
          {g.key === 'segment'
            ? [...segGroups.entries()].map(([seg, items]) => (
                <div key={seg}>
                  <div className="ovl-g" style={{ paddingLeft: 14 }}>
                    {seg}
                  </div>
                  {[...items].sort(byPin).map(renderItem)}
                </div>
              ))
            : [...g.items].sort(byPin).map(renderItem)}
          {g.items.length === 0 && <div className="none">nada aqui ainda</div>}
        </div>
      ))}
    </>
  );
}

// ---------- agenda (wakeups) ----------

const WAKEUP_FILTERS: { key: string; label: string }[] = [
  { key: 'pending', label: 'pendentes' },
  { key: 'fired', label: 'disparados' },
  { key: 'canceled', label: 'cancelados' },
  { key: 'all', label: 'todos' },
];

function WakeupsPanel({ onError }: { onError: (text: string) => void }) {
  const [status, setStatus] = useState('pending');
  return (
    <>
      <div className="seg" style={{ marginBottom: 12 }} role="tablist" aria-label="filtro">
        {WAKEUP_FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={status === f.key}
            className={status === f.key ? 'sel' : ''}
            onClick={() => setStatus(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {/* key remounts on filter change — rows never flash the wrong set */}
      <WakeupList key={status} status={status} onError={onError} />
    </>
  );
}

function WakeupList({ status, onError }: { status: string; onError: (t: string) => void }) {
  const res = useAgent(() => api.wakeups({ status }), [status]);
  useEffect(() => {
    const off = onControlEvent('run.update', res.reload);
    const t = setInterval(res.reload, 60_000);
    return () => {
      off();
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const cancel = async (id: string) => {
    try {
      await api.cancelWakeup(id);
      res.reload();
    } catch (e) {
      onError(`agenda: ${e instanceof Error ? e.message : e}`);
    }
  };

  if (res.st !== 'ok' || !res.data) {
    return (
      <EndpointCard
        st={res.st}
        title="agenda do agente"
        missing="GET /agent/wakeups ainda não chegou neste servidor — os retornos que o agente marca com a tool `schedule` vão aparecer aqui, com cancelamento."
        onRetry={res.reload}
      />
    );
  }
  const items = res.data.wakeups;
  if (!items.length) {
    return (
      <div className="empty">
        <span className="serif">{status === 'pending' ? 'nada agendado' : `nada ${status}`}</span>
        <div>o agente marca retornos sozinho com a tool `schedule`</div>
      </div>
    );
  }
  return (
    <div className="card tbl-scroll" style={{ padding: 0 }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>quando</th>
            <th>lead</th>
            <th>tipo</th>
            <th>foco</th>
            <th>origem</th>
            <th className="end" />
          </tr>
        </thead>
        <tbody>
          {items.map((w) => (
            <tr key={w.id}>
              <td>
                <span className={`due${w.status === 'pending' && isLate(w.at) ? ' bad' : ''}`}>
                  {relDue(w.at)}
                </span>
                <div className="hint">{fmtDateTime(w.at)}</div>
              </td>
              <td>
                {w.leadId ? (
                  <Link to={`/leads/${w.leadId}`}>{w.leadName ?? w.leadId.slice(0, 8)}</Link>
                ) : (
                  (w.leadName ?? '—')
                )}
              </td>
              <td>
                <span className="chip">{RUN_KIND_LABEL[w.kind] ?? w.kind}</span>
              </td>
              <td className="k" style={{ maxWidth: 280 }}>
                {w.focus}
                {w.status === 'canceled' && w.cancelReason && (
                  <div className="hint">motivo: {w.cancelReason}</div>
                )}
              </td>
              <td>
                {w.createdBy === 'staff' ? 'equipe' : 'agente'}
                {w.requested && <span className="chip st-live"> pedido</span>}
              </td>
              <td className="end">
                {w.status === 'pending' && (
                  <ConfirmBtn confirm="desmarcar?" onConfirm={() => void cancel(w.id)}>
                    cancelar
                  </ConfirmBtn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- movidos do Config ----------

function PitchCard({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const cur = {
    product: str(value.product, ''),
    audience: str(value.audience, ''),
    tone: str(value.tone, ''),
    offerRange: str(value.offerRange, ''),
    offer: str(value.offer, ''),
    goal: str(value.goal, ''),
    hardRules: Array.isArray(value.hardRules) ? (value.hardRules as string[]) : [],
  };
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  const set = (k: keyof typeof cur) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setEdit({ ...edit, [k]: e.target.value });

  return (
    <div className="drv">
      <div className="field">
        <label>produto</label>
        <textarea rows={3} value={edit.product} maxLength={4000} onChange={set('product')} />
      </div>
      <div className="grid2">
        <div className="field">
          <label>público</label>
          <input value={edit.audience} maxLength={4000} onChange={set('audience')} />
        </div>
        <div className="field">
          <label>tom</label>
          <input value={edit.tone} maxLength={4000} onChange={set('tone')} />
        </div>
      </div>
      <div className="field">
        <label>o que pode oferecer</label>
        <textarea rows={2} value={edit.offerRange} maxLength={4000} onChange={set('offerRange')} />
      </div>
      <div className="field">
        <label>oferta concreta — fatos citáveis (preço, link de cadastro, loja exemplo)</label>
        <textarea
          rows={3}
          value={edit.offer}
          maxLength={4000}
          onChange={set('offer')}
          placeholder="ex.: plano R$149/mês, sem comissão; 7 dias grátis; cadastro: https://...; exemplo: https://..."
        />
      </div>
      <div className="field">
        <label>objetivo da conversa</label>
        <input value={edit.goal} maxLength={4000} onChange={set('goal')} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>regras duras ({edit.hardRules.length}/50)</label>
        <ListEditor
          items={edit.hardRules}
          placeholder="ex.: nunca prometa data de entrega"
          max={50}
          maxLen={500}
          onChange={(hardRules) => setEdit({ ...edit, hardRules })}
        />
      </div>
      <div className="actions">
        <button
          className="btn primary"
          disabled={!dirty}
          onClick={() => onSave({ ...value, ...edit })}
        >
          salvar voz
        </button>
        {dirty && (
          <button className="btn ghost" onClick={() => setEdit(cur)}>
            desfazer
          </button>
        )}
      </div>
      <RawJson value={value} onSave={onSave} />
    </div>
  );
}

function GuardrailsCard({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const cur = {
    maxOutboundPerLeadPerDay: num(value.maxOutboundPerLeadPerDay, 3),
    quietStart: str(value.quietStart, '21:00'),
    quietEnd: str(value.quietEnd, '08:00'),
    timezone: str(value.timezone, 'America/Sao_Paulo'),
    firstContactDraftOnly: value.firstContactDraftOnly !== false,
    discoveryAutoContact: value.discoveryAutoContact !== false,
    discoveryContactMinScore: num(value.discoveryContactMinScore, 8),
    inboundReplyDelayMin: num(value.inboundReplyDelayMin, 0),
    firstContactDelayMin: num(value.firstContactDelayMin, 0),
    followupCadenceDays: num(value.followupCadenceDays, 2),
    staleDraftDays: num(value.staleDraftDays, 7),
    briefAutoPauseRuns: num(value.briefAutoPauseRuns, 5),
    ignoredPhones: Array.isArray(value.ignoredPhones) ? (value.ignoredPhones as string[]) : [],
  };
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  const quietWrap = edit.quietStart > edit.quietEnd;
  const invalid =
    !tzValid(edit.timezone) ||
    edit.ignoredPhones.some((p) => {
      const d = p.replace(/\D/g, '');
      return d.length < 6 || d.length > 15;
    });

  return (
    <div className="drv">
      <div className="grid3">
        <div className="field">
          <label>msgs/dia por lead</label>
          <input
            type="number"
            min={1}
            max={100}
            value={edit.maxOutboundPerLeadPerDay}
            onChange={(e) =>
              setEdit({ ...edit, maxOutboundPerLeadPerDay: Number(e.target.value) || 1 })
            }
          />
        </div>
        <div className="field">
          <label>nota p/ autocontato</label>
          <input
            type="number"
            min={1}
            max={10}
            value={edit.discoveryContactMinScore}
            onChange={(e) =>
              setEdit({ ...edit, discoveryContactMinScore: Number(e.target.value) || 1 })
            }
          />
          <div className="hint">fitScore mínimo p/ o agente chamar no whatsapp sozinho</div>
        </div>
        <div className="field">
          <label>fuso</label>
          <input
            list="tz-list"
            value={edit.timezone}
            onChange={(e) => setEdit({ ...edit, timezone: e.target.value })}
          />
          {!tzValid(edit.timezone) && (
            <div className="hint" style={{ color: 'var(--red-400)' }}>
              fuso IANA inválido
            </div>
          )}
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            horário de silêncio{' '}
            {quietWrap && <em style={{ textTransform: 'none' }}>(vira o dia)</em>}
          </label>
          <div className="cfg-times">
            <input
              type="time"
              value={edit.quietStart}
              onChange={(e) => setEdit({ ...edit, quietStart: e.target.value })}
            />
            <span className="hint">até</span>
            <input
              type="time"
              value={edit.quietEnd}
              onChange={(e) => setEdit({ ...edit, quietEnd: e.target.value })}
            />
          </div>
          <div className="hint">o agente não envia nada dentro dessa janela</div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>primeiro contato</label>
          <label className="tgl">
            <input
              type="checkbox"
              checked={edit.firstContactDraftOnly}
              onChange={(e) => setEdit({ ...edit, firstContactDraftOnly: e.target.checked })}
            />
            <span className="tk" />
            <span className="lbl">
              {edit.firstContactDraftOnly ? 'sempre vira rascunho' : 'agente pode enviar direto'}
            </span>
          </label>
          <div className="hint">
            quem nunca recebeu mensagem nossa passa pela fila de aprovação — a autonomia 'autopilot'
            sobe isso pra todo mundo
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>autocontato no discovery</label>
          <label className="tgl">
            <input
              type="checkbox"
              checked={edit.discoveryAutoContact}
              onChange={(e) => setEdit({ ...edit, discoveryAutoContact: e.target.checked })}
            />
            <span className="tk" />
            <span className="lbl">
              {edit.discoveryAutoContact ? 'nota alta chama no whatsapp' : 'só cria o card'}
            </span>
          </label>
          <div className="hint">
            lead descoberto com fitScore ≥ o mínimo ganha um run de outreach na hora
          </div>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>resposta do agente (min)</label>
          <input
            type="number"
            min={0}
            max={1440}
            value={edit.inboundReplyDelayMin}
            onChange={(e) =>
              setEdit({ ...edit, inboundReplyDelayMin: Number(e.target.value) || 0 })
            }
          />
          <div className="hint">
            0 = responde na hora; &gt;0 o agente espera esse tempo depois da mensagem chegar
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>1º contato automático (min)</label>
          <input
            type="number"
            min={0}
            max={10080}
            value={edit.firstContactDelayMin}
            onChange={(e) =>
              setEdit({ ...edit, firstContactDelayMin: Number(e.target.value) || 0 })
            }
          />
          <div className="hint">
            0 = roda na hora, só rascunho (pesquisa + 1º contato pra aprovar); &gt;0 agenda o run
            esse tempo depois do lead ser criado (modo do lead decide rascunho vs. envio)
          </div>
        </div>
      </div>
      <div className="grid3" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>cadência p/ retorno (dias)</label>
          <input
            type="number"
            min={0}
            max={90}
            value={edit.followupCadenceDays}
            onChange={(e) => setEdit({ ...edit, followupCadenceDays: Number(e.target.value) || 0 })}
          />
          <div className="hint">
            envio do agente sem resposta agenda o próximo contato; 0 = desligado (nunca sobrescreve
            uma data que o agente já marcou)
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>rascunho expira (dias)</label>
          <input
            type="number"
            min={0}
            max={90}
            value={edit.staleDraftDays}
            onChange={(e) => setEdit({ ...edit, staleDraftDays: Number(e.target.value) || 0 })}
          />
          <div className="hint">
            aprovar rascunho do agente mais velho que isso não envia — regenera contra o estado
            atual do lead; 0 = desligado
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>auto-pausa de brief (runs)</label>
          <input
            type="number"
            min={0}
            max={100}
            value={edit.briefAutoPauseRuns}
            onChange={(e) => setEdit({ ...edit, briefAutoPauseRuns: Number(e.target.value) || 0 })}
          />
          <div className="hint">
            runs seguidas do mesmo brief sem lead novo pausam ele sozinho; 0 = nunca pausa
          </div>
        </div>
      </div>
      <div className="field">
        <label>números ignorados (equipe / founders)</label>
        <ListEditor
          items={edit.ignoredPhones}
          placeholder="+55 11 99999-0000"
          max={100}
          maxLen={40}
          onChange={(ignoredPhones) => setEdit({ ...edit, ignoredPhones })}
        />
        <div className="hint">
          mensagem desses números não vira lead e nada sai para eles — whatsapp ou phone do lead
        </div>
      </div>
      <div className="actions">
        {/* merge over `value` — PUT replaces the whole setting and unknown
            keys managed via raw JSON would otherwise be silently dropped */}
        <button
          className="btn primary"
          disabled={!dirty || invalid}
          onClick={() => onSave({ ...value, ...edit })}
        >
          salvar guardrails
        </button>
        {dirty && (
          <button className="btn ghost" onClick={() => setEdit(cur)}>
            desfazer
          </button>
        )}
      </div>
      <RawJson value={value} onSave={onSave} />
    </div>
  );
}

function MemoryCard({ facts, onSave }: { facts: string[]; onSave: (facts: string[]) => void }) {
  return (
    <div className="drv">
      <ListEditor
        items={facts}
        placeholder="grave um fato — ex.: a Lia sempre indica leads quentes"
        addLabel="lembrar"
        max={100}
        maxLen={500}
        onChange={onSave}
      />
      <div className="hint" style={{ marginTop: 8 }}>
        {facts.length} fato{facts.length === 1 ? '' : 's'} — o agente edita esta lista com a tool
        `remember` (guarda até 100); remover aqui apaga da memória dele.
      </div>
    </div>
  );
}

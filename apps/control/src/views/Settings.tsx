import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { api, type Integration } from '../api.ts';
import { Page } from '../components.tsx';

/** Config — "sala de máquinas". Left column: provider cards, one active
 *  driver per kind, status rail lime when live. Right column: guardrails,
 *  pitch and agent memory as structured editors (raw JSON under a toggle
 *  for the long tail of keys). */

type Driver = {
  d: string;
  label: string;
  hint: string;
  /** driver needs a secretRef env name */
  secret?: boolean;
  fields?: { key: string; label: string; placeholder: string }[];
};

const KINDS: { key: string; label: string; sub: string; drivers: Driver[] }[] = [
  {
    key: 'llm',
    label: 'modelo',
    sub: 'o cérebro do agente',
    drivers: [
      {
        d: 'openrouter',
        label: 'openrouter',
        hint: 'um endpoint, qualquer modelo — config.model escolhe qual',
        secret: true,
        fields: [{ key: 'model', label: 'modelo', placeholder: 'anthropic/claude-sonnet-4.5' }],
      },
      {
        d: 'anthropic',
        label: 'anthropic',
        hint: 'direto na API da Anthropic',
        secret: true,
        fields: [{ key: 'model', label: 'modelo', placeholder: 'claude-sonnet-4-5' }],
      },
      {
        d: 'openai',
        label: 'openai',
        hint: 'direto na API da OpenAI',
        secret: true,
        fields: [{ key: 'model', label: 'modelo', placeholder: 'gpt-5' }],
      },
      { d: 'mock', label: 'mock', hint: 'respostas roteirizadas — dev e testes' },
    ],
  },
  {
    key: 'email',
    label: 'email',
    sub: 'saída e entrada de mensagens',
    drivers: [
      {
        d: 'resend',
        label: 'resend',
        hint: 'envia de verdade + inbound por webhook',
        secret: true,
        fields: [{ key: 'from', label: 'remetente', placeholder: 'Venduá <oi@vendua.shop>' }],
      },
      { d: 'log', label: 'log', hint: 'imprime no console — dev' },
    ],
  },
  {
    key: 'whatsapp',
    label: 'whatsapp',
    sub: 'número próprio do agente',
    drivers: [
      {
        d: 'baileys',
        label: 'baileys',
        hint: 'socket em processo — pareie por QR abaixo',
        fields: [{ key: 'accountId', label: 'accountId', placeholder: 'default' }],
      },
      { d: 'log', label: 'log', hint: 'imprime no console — dev' },
    ],
  },
  {
    key: 'discovery',
    label: 'descoberta',
    sub: 'busca e extração de novos leads',
    drivers: [
      {
        d: 'tinyfish',
        label: 'tinyfish',
        hint: 'Search + Agent APIs (api.tinyfish.ai)',
        secret: true,
      },
      { d: 'mock', label: 'mock', hint: 'prospects enlatados — dev' },
    ],
  },
];

const TZ_SUGGESTIONS = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Manaus',
  'America/Belem',
  'America/Rio_Branco',
];

type Notice = { kind: 'ok' | 'err'; text: string } | null;

export default function Settings() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [qr, setQr] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    void Promise.all([api.integrations(), api.settings()])
      .then(([i, s]) => {
        setIntegrations(i.integrations);
        const map: Record<string, unknown> = {};
        for (const row of s.settings) map[row.key] = row.value;
        setSettings(map);
      })
      .catch((e: unknown) =>
        setNotice({
          kind: 'err',
          text: `falha ao carregar: ${e instanceof Error ? e.message : e}`,
        }),
      )
      .finally(() => setLoading(false));
    api
      .waQr()
      .then((r) => setQr(r.qr))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(
      () =>
        api
          .waQr()
          .then((r) => setQr(r.qr))
          .catch(() => undefined),
      4000,
    );
    return () => clearInterval(t);
  }, []);

  const active = (kind: string) => integrations.find((i) => i.kind === kind && i.enabled);

  const saveIntegration = async (
    kind: string,
    d: { driver: string; secretRef: string; config: Record<string, string> },
    enable = true,
  ) => {
    try {
      const config = Object.fromEntries(Object.entries(d.config).filter(([, v]) => v));
      await api.putIntegration(kind, {
        driver: d.driver,
        enabled: enable,
        ...(d.secretRef ? { secretRef: d.secretRef } : {}),
        ...(Object.keys(config).length ? { config } : {}),
      });
      setNotice({
        kind: 'ok',
        text: enable ? `${kind}: ${d.driver} ativo` : `${kind}: ${d.driver} desativado`,
      });
      load();
    } catch (e) {
      setNotice({ kind: 'err', text: `${kind}: ${e instanceof Error ? e.message : e}` });
    }
  };

  const saveSetting = async (key: string, value: unknown) => {
    try {
      await api.putSetting(key, value);
      setNotice({ kind: 'ok', text: `${key} salvo` });
      load();
    } catch (e) {
      setNotice({ kind: 'err', text: `${key}: ${e instanceof Error ? e.message : e}` });
    }
  };

  const guardrails = (settings.guardrails ?? {}) as Record<string, unknown>;
  const pitch = (settings.pitch ?? {}) as Record<string, unknown>;
  const memory = (settings.agent_memory ?? { facts: [] }) as { facts: string[] };

  return (
    <Page title="Config" sub="sala de máquinas — provedores, guardrails e a voz do agente">
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      <div className="set-grid">
        <div>
          <section className="set-sec">
            <h2>provedores</h2>
            <p className="sub">um driver ativo por tipo — trocar não reinicia nada</p>
            {loading && !integrations.length && (
              <div className="empty">
                <div className="serif" style={{ fontSize: 'var(--t-lg)' }}>
                  carregando…
                </div>
              </div>
            )}
            {KINDS.map((k) => (
              <ProviderCard
                key={k.key}
                kind={k}
                current={active(k.key)}
                qr={k.key === 'whatsapp' ? qr : null}
                onSave={(d, enable) => void saveIntegration(k.key, d, enable)}
              />
            ))}
          </section>
        </div>
        <div>
          <section className="set-sec">
            <h2>guardrails</h2>
            <p className="sub">regras duras — o código impõe, não o prompt</p>
            <GuardrailsCard value={guardrails} onSave={(v) => void saveSetting('guardrails', v)} />
          </section>
          <section className="set-sec">
            <h2>voz do agente</h2>
            <p className="sub">o pitch inteiro que o modelo recebe no system prompt</p>
            <PitchCard value={pitch} onSave={(v) => void saveSetting('pitch', v)} />
          </section>
          <section className="set-sec">
            <h2>memória do agente</h2>
            <p className="sub">fatos que ele guardou via `remember` — ou que você escreve</p>
            <MemoryCard
              facts={memory.facts}
              onSave={(facts) => void saveSetting('agent_memory', { facts })}
            />
          </section>
        </div>
      </div>
    </Page>
  );
}

// ---------- provider card ----------

function ProviderCard({
  kind,
  current,
  qr,
  onSave,
}: {
  kind: { key: string; label: string; sub: string; drivers: Driver[] };
  current: Integration | undefined;
  qr: string | null;
  onSave: (
    d: { driver: string; secretRef: string; config: Record<string, string> },
    enable: boolean,
  ) => void;
}) {
  const baseline = {
    driver: current?.driver ?? kind.drivers[0]?.d ?? '',
    secretRef: current?.secretRef ?? '',
    config: (current?.config ?? {}) as Record<string, string>,
  };
  const [driver, setDriver] = useState(baseline.driver);
  const [secretRef, setSecretRef] = useState(baseline.secretRef);
  const [config, setConfig] = useState<Record<string, string>>(baseline.config);
  useEffect(() => {
    setDriver(baseline.driver);
    setSecretRef(baseline.secretRef);
    setConfig(baseline.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync when the saved row changes
  }, [current?.driver, current?.secretRef, current?.updatedAt]);

  const drv = kind.drivers.find((x) => x.d === driver) ?? kind.drivers[0];
  const dirty =
    driver !== baseline.driver ||
    secretRef !== baseline.secretRef ||
    JSON.stringify(config) !== JSON.stringify(baseline.config);

  const state = !current
    ? 'att'
    : current.enabled && current.secretRef && !current.secretPresent
      ? 'att'
      : 'on';

  return (
    <div className={`drv ${state}`}>
      <div className="drv-head">
        <span className="dot" />
        <h3>{kind.label}</h3>
        <span className="hint">{kind.sub}</span>
        <span className="sp" />
        {current ? (
          <span className={`chip ${current.enabled ? 'agent' : ''}`}>
            {current.driver}
            {current.enabled ? '' : ' · off'}
          </span>
        ) : (
          <span className="chip warn">não configurado</span>
        )}
        {current?.secretRef ? (
          current.secretPresent ? (
            <span className="chip">secret ✓</span>
          ) : (
            <span className="chip bad">secret ausente</span>
          )
        ) : null}
      </div>
      <div className="drv-body">
        <span className="seg">
          {kind.drivers.map((dd) => (
            <button
              key={dd.d}
              className={dd.d === driver ? 'sel' : ''}
              onClick={() => setDriver(dd.d)}
            >
              {dd.label}
            </button>
          ))}
        </span>
        {drv?.hint && <div className="hint">{drv.hint}</div>}
        {(drv?.secret || drv?.fields?.length) && (
          <div className="grid2" style={{ marginTop: 10 }}>
            {drv.secret && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>secretRef</label>
                <input
                  value={secretRef}
                  placeholder={
                    kind.key === 'llm' ? 'OPENROUTER_API_KEY' : `${kind.key.toUpperCase()}_API_KEY`
                  }
                  onChange={(e) => setSecretRef(e.target.value)}
                />
              </div>
            )}
            {drv.fields?.map((f) => (
              <div className="field" style={{ marginBottom: 0 }} key={f.key}>
                <label>{f.label}</label>
                <input
                  value={config[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
        {kind.key === 'whatsapp' && driver === 'baileys' && qr && (
          <div className="wa-pair">
            <div className="t">parear — escaneie no whatsapp → aparelhos conectados</div>
            <pre>{qr}</pre>
            <div className="foot">o QR expira rápido; esta tela atualiza sozinha a cada 4s</div>
          </div>
        )}
        {kind.key === 'whatsapp' && driver === 'baileys' && !qr && current?.enabled && (
          <div className="wa-pair">
            <div className="t">whatsapp conectado</div>
            <div className="foot">nenhum QR pendente — o socket do agente está pareado</div>
          </div>
        )}
        <div className="actions">
          <button
            className="btn primary"
            disabled={!dirty}
            onClick={() => onSave({ driver, secretRef, config }, true)}
          >
            {current?.enabled && dirty ? 'trocar driver' : 'salvar + ativar'}
          </button>
          {dirty && (
            <button
              className="btn ghost"
              onClick={() => {
                setDriver(baseline.driver);
                setSecretRef(baseline.secretRef);
                setConfig(baseline.config);
              }}
            >
              desfazer
            </button>
          )}
          {current?.enabled && (
            <button
              className="btn danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => onSave({ driver: current.driver, secretRef, config }, false)}
            >
              desativar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- guardrails ----------

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
    discoveryMaxLeads: num(value.discoveryMaxLeads, 20),
  };
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  const quietWrap = edit.quietStart > edit.quietEnd;

  return (
    <div className="drv on">
      <div className="grid3">
        <div className="field">
          <label>msgs/dia por lead</label>
          <input
            type="number"
            min={1}
            max={50}
            value={edit.maxOutboundPerLeadPerDay}
            onChange={(e) =>
              setEdit({ ...edit, maxOutboundPerLeadPerDay: Number(e.target.value) || 1 })
            }
          />
        </div>
        <div className="field">
          <label>leads por discovery</label>
          <input
            type="number"
            min={1}
            max={200}
            value={edit.discoveryMaxLeads}
            onChange={(e) => setEdit({ ...edit, discoveryMaxLeads: Number(e.target.value) || 1 })}
          />
        </div>
        <div className="field">
          <label>fuso</label>
          <input
            list="tz-list"
            value={edit.timezone}
            onChange={(e) => setEdit({ ...edit, timezone: e.target.value })}
          />
          <datalist id="tz-list">
            {TZ_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="grid2" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            horário de silêncio{' '}
            {quietWrap && <em style={{ textTransform: 'none' }}>(vira o dia)</em>}
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <div className="hint">quem nunca recebeu mensagem nossa passa pela fila de aprovação</div>
        </div>
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!dirty} onClick={() => onSave(edit)}>
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

// ---------- pitch ----------

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
    goal: str(value.goal, ''),
    hardRules: Array.isArray(value.hardRules) ? (value.hardRules as string[]) : [],
  };
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  const set = (k: keyof typeof cur) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setEdit({ ...edit, [k]: e.target.value });

  return (
    <div className="drv on">
      <div className="field">
        <label>produto</label>
        <textarea
          rows={3}
          value={edit.product}
          onChange={set('product')}
          style={{ width: '100%' }}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label>público</label>
          <input value={edit.audience} onChange={set('audience')} />
        </div>
        <div className="field">
          <label>tom</label>
          <input value={edit.tone} onChange={set('tone')} />
        </div>
      </div>
      <div className="field">
        <label>o que pode oferecer</label>
        <textarea
          rows={2}
          value={edit.offerRange}
          onChange={set('offerRange')}
          style={{ width: '100%' }}
        />
      </div>
      <div className="field">
        <label>objetivo da conversa</label>
        <input value={edit.goal} onChange={set('goal')} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>regras duras ({edit.hardRules.length})</label>
        <ListEditor
          items={edit.hardRules}
          placeholder="ex.: nunca prometa data de entrega"
          onChange={(hardRules) => setEdit({ ...edit, hardRules })}
        />
      </div>
      <div className="actions">
        <button className="btn primary" disabled={!dirty} onClick={() => onSave(edit)}>
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

// ---------- agent memory ----------

function MemoryCard({ facts, onSave }: { facts: string[]; onSave: (facts: string[]) => void }) {
  return (
    <div className="drv on">
      <ListEditor
        items={facts}
        placeholder="grave um fato — ex.: a Lia sempre indica leads quentes"
        addLabel="lembrar"
        onChange={onSave}
      />
      <div className="hint" style={{ marginTop: 8 }}>
        {facts.length} fato{facts.length === 1 ? '' : 's'} — o agente edita esta lista com a tool
        `remember`; remover aqui apaga da memória dele.
      </div>
    </div>
  );
}

// ---------- bits ----------

function ListEditor({
  items,
  placeholder,
  addLabel = 'adicionar',
  onChange,
}: {
  items: string[];
  placeholder: string;
  addLabel?: string;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="lst">
        {items.length === 0 && <div className="none">nada por aqui ainda</div>}
        {items.map((it, i) => (
          <div className="row" key={`${i}-${it.slice(0, 12)}`}>
            <span className="ix">{String(i + 1).padStart(2, '0')}</span>
            <span className="tx">{it}</span>
            <button
              className="x"
              title="remover"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="lst-add">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" onClick={add} disabled={!draft.trim()}>
          {addLabel}
        </button>
      </div>
    </div>
  );
}

/** Raw JSON escape hatch — the structured fields cover the known keys;
 *  this stays for anything else a future knob adds. */
function RawJson({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setErr('precisa ser um objeto JSON');
        return;
      }
      setErr('');
      onSave(parsed as Record<string, unknown>);
    } catch {
      setErr('JSON inválido');
    }
  };
  return (
    <details
      className="raw"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setRaw(JSON.stringify(value, null, 2));
      }}
    >
      <summary>json bruto</summary>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
      {err && (
        <div className="hint" style={{ color: 'var(--red-400)' }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="btn" onClick={save}>
          salvar json
        </button>
      </div>
    </details>
  );
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

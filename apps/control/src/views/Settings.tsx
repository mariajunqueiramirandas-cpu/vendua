import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import QRCode from 'qrcode';
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
  /** default env-var name the backend falls back to */
  secretName?: string;
  fields?: { key: string; label: string; placeholder: string }[];
};

const KINDS: { key: string; label: string; sub: string; drivers: Driver[] }[] = [
  {
    key: 'llm',
    label: 'modelo',
    sub: 'o cérebro do agente',
    drivers: [
      {
        d: 'gemini',
        label: 'gemini',
        hint: 'google ai studio — gemini 3.5 flash lite',
        secret: true,
        secretName: 'GEMINI_API_KEY',
        fields: [{ key: 'model', label: 'modelo', placeholder: 'gemini-3.5-flash-lite' }],
      },
      {
        d: 'openrouter',
        label: 'openrouter',
        hint: 'um endpoint, qualquer modelo — config.model escolhe qual',
        secret: true,
        secretName: 'OPENROUTER_API_KEY',
        fields: [{ key: 'model', label: 'modelo', placeholder: 'liquid/lfm-2.5-2.6b:free' }],
      },
      {
        d: 'anthropic',
        label: 'anthropic',
        hint: 'direto na API da Anthropic',
        secret: true,
        secretName: 'ANTHROPIC_API_KEY',
        fields: [{ key: 'model', label: 'modelo', placeholder: 'claude-sonnet-4-5' }],
      },
      {
        d: 'openai',
        label: 'openai',
        hint: 'direto na API da OpenAI',
        secret: true,
        secretName: 'OPENAI_API_KEY',
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
        secretName: 'RESEND_API_KEY',
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
        secretName: 'TINYFISH_API_KEY',
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
  const [wa, setWa] = useState<{ qr: string | null; status: string }>({
    qr: null,
    status: 'off',
  });
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  // Only a SUCCESSFUL integrations fetch may prove whatsapp unconfigured —
  // a failed load also leaves rows empty, and auto-activating off a failed
  // read could flip a deliberately-disabled baileys row back on.
  const [integrationsOk, setIntegrationsOk] = useState(false);

  const load = useCallback(() => {
    // Independent fetches — a failed settings read must not discard a
    // successful integrations response (it alone proves whatsapp state).
    void api
      .integrations()
      .then((i) => {
        setIntegrations(i.integrations);
        setIntegrationsOk(true);
      })
      .catch((e: unknown) =>
        setNotice({
          kind: 'err',
          text: `falha ao carregar: ${e instanceof Error ? e.message : e}`,
        }),
      );
    void api
      .settings()
      .then((s) => {
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
      .then((r) => setWa({ qr: r.qr, status: r.status }))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const t = setInterval(
      () =>
        api
          .waQr()
          .then((r) => setWa({ qr: r.qr, status: r.status }))
          .catch(() => undefined),
      4000,
    );
    return () => clearInterval(t);
  }, []);

  const waLogout = async () => {
    try {
      await api.waLogout();
      setNotice({ kind: 'ok', text: 'whatsapp desconectado — QR novo a caminho' });
      load();
    } catch (e) {
      setNotice({ kind: 'err', text: `whatsapp: ${e instanceof Error ? e.message : e}` });
    }
  };

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
                rows={integrations.filter((i) => i.kind === k.key)}
                wa={k.key === 'whatsapp' ? wa : { qr: null, status: 'off' }}
                ready={integrationsOk}
                onWaLogout={k.key === 'whatsapp' ? () => void waLogout() : undefined}
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
  rows,
  wa,
  ready,
  onWaLogout,
  onSave,
}: {
  kind: { key: string; label: string; sub: string; drivers: Driver[] };
  rows: Integration[];
  wa: { qr: string | null; status: string };
  /** integrations fetch SUCCEEDED — rows=[] then means "never configured" */
  ready: boolean;
  onWaLogout: (() => void) | undefined;
  onSave: (
    d: { driver: string; secretRef: string; config: Record<string, string> },
    enable: boolean,
  ) => void;
}) {
  const current = rows.find((r) => r.enabled);
  const baseline = {
    driver: current?.driver ?? kind.drivers[0]?.d ?? '',
    secretRef: current?.secretRef ?? '',
    config: (current?.config ?? {}) as Record<string, string>,
  };
  const [driver, setDriver] = useState(baseline.driver);
  const [secretRef, setSecretRef] = useState(baseline.secretRef);
  const [config, setConfig] = useState<Record<string, string>>(baseline.config);
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [pairPhone, setPairPhone] = useState('');
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [qrImg, setQrImg] = useState<string | null>(null);
  useEffect(() => {
    setDriver(baseline.driver);
    setSecretRef(baseline.secretRef);
    setConfig(baseline.config);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync when the saved row changes
  }, [current?.driver, current?.secretRef, current?.updatedAt]);
  useEffect(() => {
    if (!wa.qr) {
      setQrImg(null);
      return;
    }
    let dead = false;
    void QRCode.toDataURL(wa.qr, { margin: 1, width: 220 })
      .then((url) => {
        if (!dead) setQrImg(url);
      })
      .catch(() => {
        if (!dead) setQrImg(null);
      });
    return () => {
      dead = true;
    };
  }, [wa.qr]);
  useEffect(() => {
    // A stale code survives logout otherwise — re-pairing must start clean.
    if (wa.status === 'open') setPairCode(null);
  }, [wa.status]);

  const activateBaileys = () => {
    const saved = rows.find((r) => r.driver === 'baileys');
    onSave(
      {
        driver: 'baileys',
        secretRef: saved?.secretRef ?? '',
        config: Object.fromEntries(
          Object.entries(saved?.config ?? {}).map(([k, v]) => [k, String(v)]),
        ),
      },
      true,
    );
  };
  // WhatsApp pairing needs a live socket, which only exists once an enabled
  // baileys row does — and baileys is the card's default selection, so on a
  // fresh setup it's already highlighted without any click. Auto-activate
  // only when the load proves whatsapp was NEVER configured (no rows at
  // all): a disabled row is explicit state that a page visit must not undo.
  const waAuto = useRef(false);
  useEffect(() => {
    if (
      waAuto.current ||
      kind.key !== 'whatsapp' ||
      driver !== 'baileys' ||
      !ready ||
      rows.length > 0
    )
      return;
    waAuto.current = true;
    activateBaileys();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot once rows arrive
  }, [kind.key, driver, rows, ready]);

  const drv = kind.drivers.find((x) => x.d === driver) ?? kind.drivers[0];
  // The saved row for the SELECTED driver — its secretName/secretPresent
  // reflect what's actually on the server, independent of `enabled`.
  const selRow = rows.find((r) => r.driver === driver);
  const dirty =
    driver !== baseline.driver ||
    secretRef !== baseline.secretRef ||
    JSON.stringify(config) !== JSON.stringify(baseline.config);

  const secretMissing = !!current?.enabled && !!current?.secretName && !current.secretPresent;
  const state = !current || secretMissing ? 'att' : 'on';

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.testIntegration(kind.key));
    } catch (e) {
      setTest({ ok: false, detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const runPair = async () => {
    setPairBusy(true);
    setPairErr(null);
    try {
      setPairCode((await api.waPairCode(pairPhone)).code);
    } catch (e) {
      setPairErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPairBusy(false);
    }
  };

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
        {current?.secretName ? (
          current.secretPresent ? (
            <span className="chip" title="env presente no servidor">
              {current.secretName} ✓
            </span>
          ) : (
            <span className="chip bad">{current.secretName} ausente</span>
          )
        ) : null}
      </div>
      <div className="drv-body">
        <span className="seg">
          {kind.drivers.map((dd) => (
            <button
              key={dd.d}
              className={dd.d === driver ? 'sel' : ''}
              onClick={() => {
                setDriver(dd.d);
                setTest(null);
                // Drivers read different env vars and config keys — switching
                // must not drag the previous driver's secretRef/model along.
                if (dd.d === baseline.driver) {
                  setSecretRef(baseline.secretRef);
                  setConfig(baseline.config);
                } else {
                  setSecretRef(dd.secretName ?? '');
                  setConfig({});
                }
                // Clicking baileys is also explicit activation intent —
                // covers re-selects after the one-shot mount effect fired.
                if (
                  kind.key === 'whatsapp' &&
                  dd.d === 'baileys' &&
                  !rows.some((r) => r.driver === 'baileys' && r.enabled)
                )
                  activateBaileys();
              }}
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
                  placeholder={drv.secretName ?? `${kind.key.toUpperCase()}_API_KEY`}
                  onChange={(e) => setSecretRef(e.target.value)}
                />
                <div className="hint">
                  env que o driver lê: <code>{selRow?.secretName ?? drv.secretName}</code>
                  {selRow?.secretName && selRow.secretPresent != null
                    ? selRow.secretPresent
                      ? ' — presente no servidor ✓'
                      : ' — ausente no servidor'
                    : ''}
                </div>
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
        {kind.key === 'whatsapp' && current?.driver === 'baileys' && current.enabled && (
          <div className="wa-pair">
            {wa.status === 'open' ? (
              <>
                <div className="t">whatsapp conectado</div>
                <div className="foot">
                  socket pareado — o agente já envia e recebe. desconectar libera o número e emite
                  um QR novo.
                </div>
                <button className="btn danger" onClick={onWaLogout}>
                  desconectar número
                </button>
              </>
            ) : (
              <>
                <div className="t">
                  {wa.status === 'qr'
                    ? 'parear — whatsapp → aparelhos conectados → conectar aparelho'
                    : wa.status === 'connecting'
                      ? 'conectando ao whatsapp…'
                      : 'whatsapp desligado — socket não está rodando'}
                </div>
                {wa.qr && qrImg && <img className="wa-qr" src={qrImg} alt="QR do whatsapp" />}
                <div className="wa-paircode">
                  <span className="hint">ou conectar com código:</span>
                  {pairCode && <code className="wa-code">{pairCode}</code>}
                  <span className="wa-pairrow">
                    <input
                      placeholder="DDI+DDD+número — 5511…"
                      value={pairPhone}
                      onChange={(e) => {
                        setPairPhone(e.target.value);
                        setPairCode(null);
                      }}
                    />
                    <button
                      className="btn ghost"
                      disabled={pairBusy}
                      onClick={() => void runPair()}
                    >
                      {pairBusy ? 'gerando…' : pairCode ? 'novo código' : 'gerar código'}
                    </button>
                  </span>
                  {pairErr && <div className="hint">{pairErr}</div>}
                </div>
                <div className="foot">
                  o QR expira rápido — esta tela atualiza sozinha a cada 4s
                </div>
              </>
            )}
          </div>
        )}
        <div className="actions">
          <button
            className="btn primary"
            disabled={!dirty && !!current?.enabled}
            onClick={() => onSave({ driver, secretRef, config }, true)}
          >
            {current && !current.enabled && !dirty
              ? 'ativar'
              : current?.enabled && dirty
                ? 'trocar driver'
                : 'salvar + ativar'}
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
          <button
            className="btn ghost"
            disabled={testing || !current?.enabled}
            title="chama o driver ativo de verdade (1 chamada barata)"
            onClick={() => void runTest()}
          >
            {testing ? 'testando…' : 'testar'}
          </button>
          {test && (
            <span className={`chip ${test.ok ? 'agent' : 'bad'}`} title={test.detail}>
              {test.ok ? '✓ ' : '✗ '}
              {test.detail}
            </span>
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
        {/* merge over `value` — PUT replaces the whole setting and unknown
            keys managed via raw JSON would otherwise be silently dropped */}
        <button
          className="btn primary"
          disabled={!dirty}
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

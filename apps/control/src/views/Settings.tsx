import { useCallback, useEffect, useState } from 'react';
import { api, type Integration } from '../api.ts';
import { Page } from '../components.tsx';

const KINDS: {
  key: string;
  label: string;
  drivers: { d: string; label: string; hint: string }[];
}[] = [
  {
    key: 'llm',
    label: 'modelo (llm)',
    drivers: [
      {
        d: 'openrouter',
        label: 'openrouter',
        hint: 'secretRef OPENROUTER_API_KEY · config.model = anthropic/claude-sonnet-4.5',
      },
      { d: 'anthropic', label: 'anthropic', hint: 'secretRef ANTHROPIC_API_KEY' },
      { d: 'openai', label: 'openai', hint: 'secretRef OPENAI_API_KEY' },
      { d: 'mock', label: 'mock', hint: 'roteirizado — dev/testes' },
    ],
  },
  {
    key: 'email',
    label: 'email',
    drivers: [
      { d: 'resend', label: 'resend', hint: 'secretRef RESEND_API_KEY · config.from' },
      { d: 'log', label: 'log', hint: 'imprime no console — dev' },
    ],
  },
  {
    key: 'whatsapp',
    label: 'whatsapp',
    drivers: [
      { d: 'baileys', label: 'baileys', hint: 'socket em processo · pareamento por QR abaixo' },
      { d: 'log', label: 'log', hint: 'imprime no console — dev' },
    ],
  },
  {
    key: 'discovery',
    label: 'descoberta',
    drivers: [
      { d: 'tinyfish', label: 'tinyfish', hint: 'secretRef TINYFISH_API_KEY' },
      { d: 'mock', label: 'mock', hint: 'prospects enlatados — dev' },
    ],
  },
];

export default function Settings() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState<
    Record<string, { driver: string; secretRef: string; model: string }>
  >({});

  const load = useCallback(() => {
    api.integrations().then((r) => setIntegrations(r.integrations));
    api.settings().then((r) => {
      const map: Record<string, unknown> = {};
      for (const s of r.settings) map[s.key] = s.value;
      setSettings(map);
    });
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

  const saveIntegration = async (kind: string) => {
    const d = dirty[kind];
    if (!d) return;
    await api.putIntegration(kind, {
      driver: d.driver,
      enabled: true,
      ...(d.secretRef ? { secretRef: d.secretRef } : {}),
      ...(d.model ? { config: { model: d.model } } : {}),
    });
    setMsg(`${kind}: ${d.driver} ativo`);
    load();
  };

  const guardrails = (settings.guardrails ?? {}) as Record<string, unknown>;
  const pitch = (settings.pitch ?? {}) as Record<string, unknown>;

  const saveJson = (key: string, raw: string) => {
    try {
      void api.putSetting(key, JSON.parse(raw)).then(() => {
        setMsg(`${key} salvo`);
        load();
      });
    } catch {
      setMsg(`${key}: JSON inválido`);
    }
  };

  return (
    <Page title="Config" sub="provedores modulares — um driver ativo por tipo">
      {msg && <div style={{ marginBottom: 12, color: 'var(--forest-800)' }}>{msg}</div>}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          {KINDS.map((k) => {
            const cur = active(k.key);
            const d = dirty[k.key] ?? {
              driver: cur?.driver ?? k.drivers[0]?.d ?? '',
              secretRef: cur?.secretRef ?? '',
              model: (cur?.config.model as string) ?? '',
            };
            return (
              <div key={k.key} className="card" style={{ padding: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 10 }}>
                  <b>{k.label}</b>
                  {cur ? (
                    <span className="chip agent">{cur.driver}</span>
                  ) : (
                    <span className="chip warn">não configurado</span>
                  )}
                  {cur?.secretPresent ? (
                    <span className="chip">secret ✓</span>
                  ) : cur?.secretRef ? (
                    <span className="chip bad">secret ausente</span>
                  ) : null}
                </div>
                <div className="field">
                  <label>driver</label>
                  <select
                    value={d.driver}
                    onChange={(e) =>
                      setDirty({ ...dirty, [k.key]: { ...d, driver: e.target.value } })
                    }
                  >
                    {k.drivers.map((dd) => (
                      <option key={dd.d} value={dd.d}>
                        {dd.label}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)' }}>
                    {k.drivers.find((x) => x.d === d.driver)?.hint}
                  </span>
                </div>
                <div className="grid2">
                  <div className="field">
                    <label>secretRef (nome da env)</label>
                    <input
                      value={d.secretRef}
                      placeholder="OPENROUTER_API_KEY"
                      onChange={(e) =>
                        setDirty({ ...dirty, [k.key]: { ...d, secretRef: e.target.value } })
                      }
                    />
                  </div>
                  {k.key === 'llm' && (
                    <div className="field">
                      <label>modelo</label>
                      <input
                        value={d.model}
                        placeholder="anthropic/claude-sonnet-4.5"
                        onChange={(e) =>
                          setDirty({ ...dirty, [k.key]: { ...d, model: e.target.value } })
                        }
                      />
                    </div>
                  )}
                </div>
                <button className="btn primary" onClick={() => void saveIntegration(k.key)}>
                  salvar + ativar
                </button>
              </div>
            );
          })}

          {qr && (
            <div className="card" style={{ padding: 16, marginBottom: 12 }}>
              <b>whatsapp — parear número</b>
              <div style={{ marginTop: 8, fontSize: 'var(--t-xs)', color: 'var(--muted)' }}>
                escaneie no WhatsApp → aparelhos conectados:
              </div>
              <pre
                className="mono"
                style={{
                  marginTop: 8,
                  padding: 10,
                  background: 'var(--night-950)',
                  color: 'var(--lime-300)',
                  borderRadius: 8,
                  overflow: 'auto',
                  fontSize: '0.72em',
                  lineHeight: 1.1,
                }}
              >
                {qr}
              </pre>
            </div>
          )}
        </div>

        <div>
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <b>guardrails</b>
            <JsonEditor value={guardrails} onSave={(raw) => saveJson('guardrails', raw)} />
            <div style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)', marginTop: 6 }}>
              maxOutboundPerLeadPerDay · quietStart/quietEnd (fuso) · firstContactDraftOnly ·
              timezone
            </div>
          </div>
          <div className="card" style={{ padding: 16, marginBottom: 12 }}>
            <b>pitch — a voz do agente</b>
            <JsonEditor value={pitch} onSave={(raw) => saveJson('pitch', raw)} />
            <div style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)', marginTop: 6 }}>
              product · audience · tone · offerRange · goal · hardRules[]
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <b>memória do agente</b>
            <JsonEditor
              value={(settings.agent_memory ?? { facts: [] }) as Record<string, unknown>}
              onSave={(raw) => saveJson('agent_memory', raw)}
            />
            <div style={{ fontSize: 'var(--t-2xs)', color: 'var(--muted)', marginTop: 6 }}>
              facts[] — aprendizados que o agente persiste via `remember`
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}

function JsonEditor({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (raw: string) => void;
}) {
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);
  const pretty = JSON.stringify(value, null, 2);
  if (!editing) {
    return (
      <div>
        <pre
          className="mono"
          style={{
            fontSize: 'var(--t-xs)',
            background: 'var(--surface-2)',
            padding: 10,
            borderRadius: 6,
            overflow: 'auto',
            maxHeight: 220,
          }}
        >
          {pretty}
        </pre>
        <button
          className="btn"
          style={{ marginTop: 6 }}
          onClick={() => {
            setRaw(pretty);
            setEditing(true);
          }}
        >
          editar
        </button>
      </div>
    );
  }
  return (
    <div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{
          width: '100%',
          minHeight: 180,
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--t-xs)',
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button
          className="btn primary"
          onClick={() => {
            onSave(raw);
            setEditing(false);
          }}
        >
          salvar
        </button>
        <button className="btn ghost" onClick={() => setEditing(false)}>
          cancelar
        </button>
      </div>
    </div>
  );
}

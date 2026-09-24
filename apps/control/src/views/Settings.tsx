import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, type ChannelHealth, type Integration, type MeetingStatus } from '../api.ts';
import { onControlEvent } from '../events.ts';
import { ConfirmBtn, LEAD_STATES, Page } from '../components.tsx';
import { RawJson, TzList, num, str, tzValid } from './settings-bits.tsx';

/** Config — "sala de máquinas". An index rail splits the wall into named
 *  areas ('conexões' = provider cards, 'regras' = guardrails, etc.) shown
 *  one at a time and deep-linked via ?s=. The landing area, 'visão geral',
 *  is a readiness checklist: one line per piece the agent needs, each line
 *  a jump into the area that fixes it. Card state is the REAL runtime
 *  state, not the saved config: 'enabled' is a fact about the row, 'live'
 *  means the driver can actually work right now (secret present; for
 *  baileys, socket open). Raw JSON stays under a toggle for the long tail
 *  of setting keys. */

type Driver = {
  d: string;
  label: string;
  hint: string;
  /** driver needs a secretRef env name */
  secret?: boolean;
  /** default env-var name the backend falls back to */
  secretName?: string;
  // placeholder doubles as the driver's runtime default — the head chip shows
  // it as the effective value when the field is unset, so keep it in sync with
  // the `?? 'default'` in packages/core (llm.ts, channels/*).
  fields?: {
    key: string;
    label: string;
    placeholder: string;
    hint?: string;
    /** stored as a JSON number — the driver reads `typeof config.x === 'number'` */
    number?: boolean;
  }[];
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
        hint: 'google ai studio — acesso direto',
        secret: true,
        secretName: 'GEMINI_API_KEY',
        fields: [
          { key: 'model', label: 'modelo', placeholder: 'gemini-3.5-flash-lite' },
          {
            key: 'rpm',
            label: 'req/min',
            placeholder: '14',
            number: true,
            hint: 'teto de chamadas por minuto — tier gratuito ≤15',
          },
        ],
      },
      {
        d: 'openrouter',
        label: 'openrouter',
        hint: 'um endpoint, qualquer modelo — o campo modelo escolhe qual',
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
        fields: [{ key: 'model', label: 'modelo', placeholder: 'gpt-4o-mini' }],
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
        hint: 'envio real + respostas chegam por webhook',
        secret: true,
        secretName: 'RESEND_API_KEY',
        fields: [
          { key: 'from', label: 'remetente', placeholder: 'Venduá <agente@auto.vendua.com.br>' },
        ],
      },
      { d: 'log', label: 'log', hint: 'só imprime no console — nada sai de verdade' },
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
        hint: 'conecta o número de verdade — pareia por QR ou código',
        fields: [
          {
            key: 'accountId',
            label: 'id da sessão',
            placeholder: 'default',
            hint: 'só mude se rodar mais de um número no mesmo core',
          },
        ],
      },
      { d: 'log', label: 'log', hint: 'só imprime no console — nada sai de verdade' },
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
        hint: 'busca e extrai negócios reais na web',
        secret: true,
        secretName: 'TINYFISH_API_KEY',
        fields: [
          {
            key: 'searchUrl',
            label: 'url de busca',
            placeholder: 'https://api.search.tinyfish.ai',
          },
          {
            key: 'fetchUrl',
            label: 'url de leitura',
            placeholder: 'https://api.fetch.tinyfish.ai',
            hint: 'o driver só aceita https://*.tinyfish.ai — outro host derruba o run',
          },
        ],
      },
      { d: 'mock', label: 'mock', hint: 'prospects enlatados — dev e testes' },
    ],
  },
];

type Notice = { kind: 'ok' | 'err'; text: string } | null;
type WaState = {
  qr: string | null;
  status: string;
  me: { phone: string | null; name: string | null } | null;
};
const WA_IDLE: WaState = { qr: null, status: 'off', me: null };

/** 'ativo' means the driver can work NOW — not just that a row is enabled.
 *  baileys enabled with an unscanned QR is 'warn', not live. */
type ProvTone = 'off' | 'warn' | 'live';
function providerStatus(
  kindKey: string,
  rows: Integration[],
  wa: WaState,
): {
  tone: ProvTone;
  text: string;
} {
  const cur = rows.find((r) => r.enabled);
  if (!cur) return { tone: 'off', text: rows.length ? 'desativado' : 'não configurado' };
  if (kindKey === 'whatsapp' && cur.driver === 'baileys') {
    if (wa.status === 'open') return { tone: 'live', text: 'conectado' };
    if (wa.status === 'qr') return { tone: 'warn', text: 'escanear QR' };
    if (wa.status === 'connecting') return { tone: 'warn', text: 'conectando…' };
    return { tone: 'warn', text: 'socket offline' };
  }
  if (cur.secretName && !cur.secretPresent) return { tone: 'warn', text: 'falta chave' };
  return { tone: 'live', text: 'ativo' };
}

const fmtPhone = (digits: string) => {
  // '5511988887777' → '+55 11 98888-7777'; anything else → '+<digits>'
  if (digits.startsWith('55') && digits.length === 13)
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.startsWith('55') && digits.length === 12)
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return `+${digits}`;
};

/** The index rail. Order follows how you'd bring the machine up:
 *  check it → wire it → book it → report it. The agent itself (voz,
 *  playbooks, memória, autonomia, guardrails) lives in the Estúdio. */
const SECTIONS = [
  { key: 'visao', label: 'visão geral', sub: 'o que falta' },
  { key: 'conexoes', label: 'conexões', sub: 'canais' },
  { key: 'agenda', label: 'agenda', sub: 'reuniões' },
  { key: 'relatorios', label: 'relatórios', sub: 'previsão e resumo' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

/** One checklist row on visão geral — a piece, its live state, where to fix it. */
type Check = {
  key: string;
  label: string;
  state: string;
  tone: ProvTone;
  to?: SectionKey;
  /** anchor inside the target area (provider card id) */
  p?: string;
  /** cross-view jump — agent rows open the Estúdio, not an area here */
  route?: string;
};

export default function Settings() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [wa, setWa] = useState<WaState>(WA_IDLE);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  // 'err' = the status probe itself failed — the checklist says so instead
  // of guessing at the wiring from the settings map.
  const [mStatus, setMStatus] = useState<MeetingStatus | 'err' | null>(null);

  // Independent fetches — a failed settings read must not discard a
  // successful integrations response (it alone proves whatsapp state).
  // Per-resource success watermarks: event-driven + floor loads overlap.
  const loadSeq = useRef(0);
  const loadOk = useRef<Record<string, number>>({});
  // The checklist reads integrations + settings + meetingsStatus — until
  // they answer once, empty defaults would read as real "não configurado"
  // states. A failed first read still ungates, but the rows then show
  // 'falha ao ler' instead of fake states (loadErr bitmask).
  const settled = useRef(0);
  const [loadErr, setLoadErr] = useState(0);
  const settle = (bit: number) => {
    settled.current |= bit;
    if (settled.current === 0b111) setLoading(false);
  };
  const load = useCallback(() => {
    const my = ++loadSeq.current;
    const fresh = (key: string) => my > (loadOk.current[key] ?? 0);
    void api
      .integrations()
      .then((i) => {
        if (fresh('integrations')) {
          loadOk.current['integrations'] = my;
          setIntegrations(i.integrations);
          setLoadErr((m) => m & ~0b001);
        }
      })
      .catch((e: unknown) => {
        // Failure is the newer outcome — record it so an older in-flight
        // success can't overwrite it with stale data afterwards.
        if (fresh('integrations')) {
          loadOk.current['integrations'] = my;
          setLoadErr((m) => m | 0b001);
        }
        setNotice({
          kind: 'err',
          text: `falha ao carregar: ${e instanceof Error ? e.message : e}`,
        });
      })
      .finally(() => settle(0b001));
    void api
      .settings()
      .then((s) => {
        if (fresh('settings')) {
          loadOk.current['settings'] = my;
          const map: Record<string, unknown> = {};
          for (const row of s.settings) map[row.key] = row.value;
          setSettings(map);
          setLoadErr((m) => m & ~0b010);
        }
      })
      .catch((e: unknown) => {
        if (fresh('settings')) {
          loadOk.current['settings'] = my;
          setLoadErr((m) => m | 0b010);
        }
        setNotice({
          kind: 'err',
          text: `falha ao carregar: ${e instanceof Error ? e.message : e}`,
        });
      })
      .finally(() => settle(0b010));
    api
      .waQr()
      .then((r) => {
        if (fresh('wa')) {
          loadOk.current['wa'] = my;
          setWa({ qr: r.qr, status: r.status, me: r.me });
        }
      })
      .catch(() => {
        if (fresh('wa')) loadOk.current['wa'] = my;
      });
    api
      .meetingsStatus()
      .then((s) => {
        if (fresh('mstatus')) {
          loadOk.current['mstatus'] = my;
          setMStatus(s);
        }
      })
      .catch(() => {
        if (fresh('mstatus')) {
          loadOk.current['mstatus'] = my;
          setMStatus('err');
        }
      })
      .finally(() => settle(0b100));
  }, []);
  useEffect(load, [load]);
  // channel.health accelerates everything the card renders — integration
  // rows flip on the same events as pairing state. The slow poll is the floor.
  useEffect(() => {
    const off = onControlEvent('channel.health', load);
    const t = setInterval(load, 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load]);

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
    d: { driver: string; secretRef: string; config: Record<string, string | number> },
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
  const meeting = (settings.meeting ?? {}) as Record<string, unknown>;
  const forecast = (settings.forecast ?? {}) as Record<string, unknown>;
  const digest = (settings.digest ?? {}) as Record<string, unknown>;
  const autonomy = (settings.agent_autonomy ?? {}) as Record<string, unknown>;

  // ---------- section selection (?s=) + provider anchor scroll (?p=) ----------
  const section: SectionKey = SECTIONS.find((s) => s.key === searchParams.get('s'))?.key ?? 'visao';
  const anchor = searchParams.get('p');
  const go = (s: SectionKey, p?: string) => {
    const next = new URLSearchParams(searchParams);
    if (s === 'visao') next.delete('s');
    else next.set('s', s);
    if (p) next.set('p', p);
    else next.delete('p');
    setSearchParams(next);
  };
  useEffect(() => {
    if (!anchor) return;
    // after the area renders — the card may not exist in the DOM yet on the
    // same tick the search param flips
    const t = setTimeout(
      () => document.getElementById(`prov-${anchor}`)?.scrollIntoView({ block: 'start' }),
      30,
    );
    return () => clearTimeout(t);
  }, [section, anchor]);

  // ---------- checklist: one line per piece, read off live state ----------
  const integErr = (loadErr & 0b001) !== 0;
  const setErr = (loadErr & 0b010) !== 0;
  const provCheck = (k: (typeof KINDS)[number]): Check => {
    if (integErr)
      return {
        key: k.key,
        label: k.label,
        state: 'falha ao ler',
        tone: 'warn',
        to: 'conexoes',
        p: k.key,
      };
    const rows = integrations.filter((i) => i.kind === k.key);
    const st = providerStatus(k.key, rows, k.key === 'whatsapp' ? wa : WA_IDLE);
    const cur = rows.find((r) => r.enabled);
    return {
      key: k.key,
      label: k.label,
      state: cur ? `${st.text} · ${cur.driver}` : st.text,
      tone: st.tone,
      to: 'conexoes',
      p: k.key,
    };
  };
  const provTones = KINDS.map(
    (k) =>
      providerStatus(
        k.key,
        integrations.filter((i) => i.kind === k.key),
        k.key === 'whatsapp' ? wa : WA_IDLE,
      ).tone,
  );
  const provLive = provTones.filter((t) => t === 'live').length;

  const weekDays =
    mStatus && mStatus !== 'err'
      ? Object.values(mStatus.cfg.weekly).filter((w) => w.length > 0).length
      : 0;
  const agendaCheck: Check =
    mStatus === null
      ? { key: 'agenda', label: 'agenda', state: 'lendo status…', tone: 'off', to: 'agenda' }
      : mStatus === 'err'
        ? {
            key: 'agenda',
            label: 'agenda',
            state: 'falha ao ler status do serviço',
            tone: 'warn',
            to: 'agenda',
          }
        : weekDays === 0
          ? {
              key: 'agenda',
              label: 'agenda',
              state: 'sem horários abertos',
              tone: 'off',
              to: 'agenda',
            }
          : // booking needs somewhere to meet — Daily room or the static
            // link; google is an optional sync layer, not the readiness gate
            mStatus.room.provider === 'daily' && mStatus.room.lastError
            ? {
                key: 'agenda',
                label: 'agenda',
                state: mStatus.cfg.roomUrl
                  ? 'daily falhou — salvando na sala fixa'
                  : 'daily falhou — a call sai sem link',
                tone: 'warn',
                to: 'agenda',
              }
            : !(mStatus.room.provider === 'daily' || mStatus.cfg.roomUrl)
              ? {
                  key: 'agenda',
                  label: 'agenda',
                  state: 'sem sala — a call sai sem link',
                  tone: 'warn',
                  to: 'agenda',
                }
              : mStatus.gcal.configured && mStatus.gcal.lastError
                ? {
                    key: 'agenda',
                    label: 'agenda',
                    state: `${weekDays}d/semana · google falhou`,
                    tone: 'warn',
                    to: 'agenda',
                  }
                : {
                    key: 'agenda',
                    label: 'agenda',
                    state:
                      `${weekDays}d/semana · ${
                        mStatus.room.provider === 'daily' ? 'sala daily.co' : 'sala fixa'
                      }` + (mStatus.gcal.configured ? ' · google conectada' : ''),
                    tone: 'live',
                    to: 'agenda',
                  };

  const essential: Check[] = [...KINDS.map(provCheck), agendaCheck];
  const g = guardrails;
  // autonomy level reads like readiness: 'off' parks the agent, 'copilot'
  // drafts everything (the queue backs up silently) — both worth a look.
  const autoLevel = str(autonomy.level, 'supervised');
  const routine: Check[] = setErr
    ? (
        [
          { key: 'autonomia', label: 'autonomia', route: '/estudio' },
          { key: 'voz', label: 'voz do agente', route: '/estudio?s=voz' },
          { key: 'regras', label: 'regras', route: '/estudio?s=regras' },
          { key: 'resumo', label: 'resumo diário', to: 'relatorios' },
        ] as const
      ).map((c): Check => ({ ...c, state: 'falha ao ler', tone: 'warn' }))
    : [
        {
          key: 'autonomia',
          label: 'autonomia',
          state:
            autoLevel === 'off'
              ? 'desligado — nada roda sozinho'
              : autoLevel === 'copilot'
                ? 'copiloto — tudo vira rascunho'
                : autoLevel === 'autopilot'
                  ? 'piloto automático — envia direto'
                  : 'supervisionado',
          tone: autoLevel === 'off' ? 'off' : autoLevel === 'copilot' ? 'warn' : 'live',
          route: '/estudio',
        },
        {
          key: 'voz',
          label: 'voz do agente',
          state: str(pitch.product, '') ? 'definida' : 'vazia — o agente improvisa',
          tone: str(pitch.product, '') ? 'live' : 'off',
          route: '/estudio?s=voz',
        },
        {
          key: 'regras',
          label: 'regras',
          state: `silêncio ${str(g.quietStart, '21:00')}–${str(g.quietEnd, '08:00')} · ${str(
            g.timezone,
            'America/Sao_Paulo',
          )}`,
          tone: 'live',
          route: '/estudio?s=regras',
        },
        {
          key: 'resumo',
          label: 'resumo diário',
          state: digest.enabled === true ? `todo dia às ${num(digest.hour, 8)}h` : 'desligado',
          tone: digest.enabled === true ? 'live' : 'off',
          to: 'relatorios',
        },
      ];
  const ready = essential.filter((c) => c.tone === 'live').length;
  const attn = [...essential, ...routine].filter((c) => c.tone === 'warn').length;

  // index-rail trailing marks — only where live state exists to report
  const connMark: ProvTone = integErr
    ? 'warn'
    : provTones.includes('warn')
      ? 'warn'
      : provLive === KINDS.length
        ? 'live'
        : 'off';
  const marks: Partial<Record<SectionKey, ProvTone>> = {};
  if (mStatus && agendaCheck.tone !== 'live') marks.agenda = agendaCheck.tone;

  return (
    <Page title="Config" sub="sala de máquinas — uma área por vez">
      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
      <div className="set-wrap">
        <nav className="set-idx" aria-label="áreas da config">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`idx${section === s.key ? ' sel' : ''}`}
              aria-current={section === s.key ? 'page' : undefined}
              onClick={() => go(s.key)}
            >
              <span className="idx-l">{s.label}</span>
              <span className="idx-s">{s.sub}</span>
              {s.key === 'conexoes' ? (
                <span className={`idx-n st-${connMark}`}>
                  {integErr ? '—' : `${provLive}/${KINDS.length}`}
                </span>
              ) : (
                marks[s.key] && <i className={`mk ${marks[s.key]}`} />
              )}
            </button>
          ))}
          <Link className="idx out" to="/estudio">
            <span className="idx-l">estúdio</span>
            <span className="idx-s">o agente todo ›</span>
          </Link>
        </nav>
        {/* Areas stay mounted — switching sections hides, not unmounts, so
            unsaved edits inside a card survive a round trip on the rail. */}
        <div className="set-panel">
          <div hidden={section !== 'visao'}>
            <section className="set-sec">
              <h2>
                {loading
                  ? 'lendo a máquina…'
                  : ready === essential.length && attn === 0
                    ? 'máquina inteira no ar'
                    : `${ready} de ${essential.length} essenciais no ar`}
              </h2>
              <p className="sub">
                uma linha por peça — clique para abrir a área que resolve
                {attn > 0 && <span className="attn"> · {attn} pedindo atenção</span>}
              </p>
              {loading ? (
                <div className="empty">
                  <div className="serif" style={{ fontSize: 'var(--t-lg)' }}>
                    carregando…
                  </div>
                </div>
              ) : (
                <div className="ovl">
                  <div className="ovl-g">essencial — o agente não roda sem isso</div>
                  {essential.map((c) => (
                    <CheckRow key={c.key} c={c} onGo={go} />
                  ))}
                  <div className="ovl-g">rotina — ajusta o dia a dia</div>
                  {routine.map((c) => (
                    <CheckRow key={c.key} c={c} onGo={go} />
                  ))}
                </div>
              )}
            </section>
            <section className="set-sec">
              <h2>saúde dos canais</h2>
              <p className="sub">envios, falhas e bloqueios de guarda · últimos 30 dias</p>
              <ChannelHealthCard />
            </section>
          </div>
          <div hidden={section !== 'conexoes'}>
            <section className="set-sec">
              <h2>provedores</h2>
              <p className="sub">
                um driver ativo por tipo — {provLive}/{KINDS.length} prontos
              </p>
              {loading && !integrations.length && (
                <div className="empty">
                  <div className="serif" style={{ fontSize: 'var(--t-lg)' }}>
                    carregando…
                  </div>
                </div>
              )}
              {KINDS.map((k) => (
                <div className="prov-anchor" id={`prov-${k.key}`} key={k.key}>
                  <ProviderCard
                    kind={k}
                    rows={integrations.filter((i) => i.kind === k.key)}
                    wa={k.key === 'whatsapp' ? wa : WA_IDLE}
                    onWaLogout={k.key === 'whatsapp' ? () => void waLogout() : undefined}
                    onSave={(d, enable) => void saveIntegration(k.key, d, enable)}
                  />
                </div>
              ))}
            </section>
          </div>
          <div hidden={section !== 'agenda'}>
            <section className="set-sec">
              <h2>reunião</h2>
              <p className="sub">
                objetivo 'reunião' — o link que o agente envia quando o lead topa
              </p>
              <MeetingCard
                value={meeting}
                status={mStatus === 'err' ? null : mStatus}
                onSave={(v) => void saveSetting('meeting', v)}
              />
            </section>
          </div>
          <div hidden={section !== 'relatorios'}>
            <section className="set-sec">
              <h2>previsão do pipeline</h2>
              <p className="sub">
                probabilidade de fechar por estágio — multiplica o valor do lead na previsão de
                relatórios
              </p>
              <ForecastCard value={forecast} onSave={(v) => void saveSetting('forecast', v)} />
            </section>
            <section className="set-sec">
              <h2>resumo diário</h2>
              <p className="sub">um email por dia com leads novos, respostas, calls e custo</p>
              <DigestCard value={digest} onSave={(v) => void saveSetting('digest', v)} />
            </section>
          </div>
        </div>
      </div>
      {/* shared by the guardrails + meeting tz pickers */}
      <TzList />
    </Page>
  );
}

/** Checklist row on visão geral — the whole line jumps to where it's fixed
 *  (an area here, or the Estúdio for agent pieces). */
function CheckRow({ c, onGo }: { c: Check; onGo: (s: SectionKey, p?: string) => void }) {
  const nav = useNavigate();
  return (
    <button
      className={`ck ${c.tone}`}
      onClick={() => (c.route ? nav(c.route) : c.to && onGo(c.to, c.p))}
    >
      <i className="dot" aria-hidden />
      <span className="ck-l">{c.label}</span>
      <span className="ck-s">{c.state}</span>
      <span className="ck-go" aria-hidden>
        ›
      </span>
    </button>
  );
}

// ---------- provider card ----------

function ProviderCard({
  kind,
  rows,
  wa,
  onWaLogout,
  onSave,
}: {
  kind: { key: string; label: string; sub: string; drivers: Driver[] };
  rows: Integration[];
  wa: WaState;
  onWaLogout: (() => void) | undefined;
  onSave: (
    d: { driver: string; secretRef: string; config: Record<string, string | number> },
    enable: boolean,
  ) => void;
}) {
  const current = rows.find((r) => r.enabled);
  // Nothing enabled → seed the form from the first driver's saved row, so
  // 'usar X' re-enables WITH its config instead of wiping it to {}.
  const baseRow = current ?? rows.find((r) => r.driver === kind.drivers[0]?.d);
  const baseline = {
    driver: baseRow?.driver ?? kind.drivers[0]?.d ?? '',
    secretRef: baseRow?.secretRef ?? '',
    config: (baseRow?.config ?? {}) as Record<string, string | number>,
  };
  const [driver, setDriver] = useState(baseline.driver);
  const [secretRef, setSecretRef] = useState(baseline.secretRef);
  const [config, setConfig] = useState<Record<string, string | number>>(baseline.config);
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
    // A saved-row change restarts the socket / swaps the driver — any probe
    // result or pair code on screen belongs to the old config.
    setTest(null);
    setPairCode(null);
    setPairErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync when the saved row changes
  }, [baseRow?.driver, baseRow?.secretRef, baseRow?.updatedAt]);
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
    // 'open': paired — the code is spent. 'off': the socket died and its
    // pending registration died with it — a shown code can never complete,
    // so clear it instead of leaving a dead one on screen.
    if (wa.status === 'open' || wa.status === 'off') setPairCode(null);
  }, [wa.status]);

  const drv = kind.drivers.find((x) => x.d === driver) ?? kind.drivers[0];
  // The saved row for the SELECTED driver — its secretName/secretPresent
  // reflect what's actually on the server, independent of `enabled`.
  const selRow = rows.find((r) => r.driver === driver);
  const selIsActive = !!current && driver === current.driver;
  const dirty =
    driver !== baseline.driver ||
    secretRef !== baseline.secretRef ||
    JSON.stringify(config) !== JSON.stringify(baseline.config);
  const st = providerStatus(kind.key, rows, wa);
  // What's live, at a glance: `gemini · gemini-3.5-flash-lite`.
  const liveDetail = current
    ? [
        current.driver,
        ...(kind.drivers.find((x) => x.d === current.driver)?.fields ?? []).map(
          (f) => String(current.config[f.key] ?? '') || f.placeholder,
        ),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const pickDriver = (dd: Driver) => {
    setDriver(dd.d);
    setTest(null);
    setPairCode(null);
    setPairErr(null);
    if (dd.d === baseline.driver) {
      setSecretRef(baseline.secretRef);
      setConfig(baseline.config);
    } else {
      // Preload that driver's own saved row — not the live one's leftovers.
      const row = rows.find((r) => r.driver === dd.d);
      setSecretRef(row?.secretRef ?? dd.secretName ?? '');
      setConfig({ ...(row?.config ?? {}) } as Record<string, string | number>);
    }
  };
  const reset = () => {
    setDriver(baseline.driver);
    setSecretRef(baseline.secretRef);
    setConfig(baseline.config);
  };

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
    <div className={`drv ${st.tone}`}>
      <div className="drv-head">
        <span className="dot" />
        <h3>{kind.label}</h3>
        <span className="hint">{kind.sub}</span>
        <span className="sp" />
        {liveDetail && (
          <code className="drv-cur" title="driver ativo + config efetiva">
            {liveDetail}
          </code>
        )}
        <span className={`chip st-${st.tone}`}>{st.text}</span>
      </div>
      <div className="drv-body">
        <span className="seg">
          {kind.drivers.map((dd) => {
            const row = rows.find((r) => r.driver === dd.d);
            const mark = row?.enabled
              ? st.tone
              : row?.secretName && !row.secretPresent
                ? 'warn'
                : row
                  ? 'cfg'
                  : '';
            return (
              <button
                key={dd.d}
                className={dd.d === driver ? 'sel' : ''}
                title={
                  row?.enabled
                    ? 'driver ativo'
                    : row
                      ? 'configurado, desligado'
                      : 'nunca configurado'
                }
                onClick={() => pickDriver(dd)}
              >
                {mark && <i className={`mk ${mark}`} />}
                {dd.label}
              </button>
            );
          })}
        </span>
        {drv?.hint && <div className="hint">{drv.hint}</div>}
        {kind.key === 'whatsapp' &&
          driver === 'baileys' &&
          (current?.driver === 'baileys' && current.enabled ? (
            <div className="wa-pair">
              {wa.status === 'open' ? (
                <>
                  <div className="t">conectado</div>
                  <div className="wa-me">
                    <span className="wa-phone">
                      {wa.me?.phone ? fmtPhone(wa.me.phone) : 'número pareado'}
                    </span>
                    {wa.me?.name && <span className="wa-name">{wa.me.name}</span>}
                  </div>
                  <div className="foot">
                    o agente já envia e recebe por esse número — desconectar libera o aparelho e
                    emite um QR novo.
                  </div>
                  <ConfirmBtn
                    className="danger"
                    confirm="desconectar mesmo?"
                    onConfirm={() => onWaLogout?.()}
                  >
                    desconectar número
                  </ConfirmBtn>
                </>
              ) : wa.status === 'off' ? (
                <>
                  <div className="t">socket parado</div>
                  <div className="foot">
                    o driver está ativo mas o socket não está rodando — ele religa sozinho depois de
                    uma queda; se o número foi desvinculado, pareie de novo.
                  </div>
                  <button
                    className="btn ghost wa-mini"
                    disabled={testing}
                    onClick={() => void runTest()}
                  >
                    {testing ? 'religando…' : 'reconectar agora'}
                  </button>
                </>
              ) : (
                <>
                  <div className="t">
                    {wa.qr
                      ? 'parear — whatsapp → aparelhos conectados → conectar aparelho'
                      : 'conectando ao whatsapp…'}
                  </div>
                  {wa.qr && qrImg && <img className="wa-qr" src={qrImg} alt="QR do whatsapp" />}
                  <div className="wa-paircode">
                    <span className="hint">
                      ou conectar com código — o número precisa ser o da conta whatsapp no aparelho
                      que vai parear:
                    </span>
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
                    QR e código expiram rápido — esta tela atualiza sozinha
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="hint wa-pending">
              ative pra gerar o QR — o número pareia por aqui mesmo
            </div>
          ))}
        {(drv?.secret || drv?.fields?.length) && (
          <div className="grid2" style={{ marginTop: 10 }}>
            {drv.secret && (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>chave — nome da env var</label>
                <input
                  value={secretRef}
                  placeholder={drv.secretName ?? `${kind.key.toUpperCase()}_API_KEY`}
                  onChange={(e) => setSecretRef(e.target.value)}
                />
                <div className="hint">
                  {(() => {
                    const envName = selRow?.secretName ?? drv.secretName;
                    if (!envName) return 'a chave mora numa env var do servidor — nunca no banco';
                    return selRow ? (
                      selRow.secretPresent ? (
                        <>
                          <code>{envName}</code> presente no servidor ✓
                        </>
                      ) : (
                        <>
                          <code>{envName}</code> ausente — cadastre nas envs do serviço e reinicie
                        </>
                      )
                    ) : (
                      <>
                        o driver lê <code>{envName}</code> quando o campo fica vazio
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
            {drv.fields?.map((f) => (
              <div className="field" style={{ marginBottom: 0 }} key={f.key}>
                <label>{f.label}</label>
                <input
                  type={f.number ? 'number' : undefined}
                  value={config[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      [f.key]:
                        f.number && e.target.value !== '' ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
                {f.hint && <div className="hint">{f.hint}</div>}
              </div>
            ))}
          </div>
        )}
        {!selIsActive && current && (
          <div className="hint" style={{ marginTop: 8 }}>
            rodando agora: <code>{current.driver}</code>
          </div>
        )}
        <div className="actions">
          {!selIsActive ? (
            <button
              className="btn primary"
              onClick={() => onSave({ driver, secretRef, config }, true)}
            >
              usar {drv?.label ?? driver}
            </button>
          ) : dirty ? (
            <button
              className="btn primary"
              onClick={() => onSave({ driver, secretRef, config }, true)}
            >
              salvar
            </button>
          ) : null}
          {dirty && (
            <button className="btn ghost" onClick={reset}>
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
          {current?.enabled && selIsActive && (
            <ConfirmBtn
              className="danger drv-off"
              confirm="desativar mesmo?"
              onConfirm={() =>
                onSave(
                  {
                    driver: current.driver,
                    secretRef: baseline.secretRef,
                    config: baseline.config,
                  },
                  false,
                )
              }
            >
              desativar
            </ConfirmBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- channel health ----------

/** 30d outbound rollup per channel. Alert = failureRate ≥ 20% on ≥5 resolved
 *  sends — flags the problem on the board, never pauses sends on its own
 *  (a global per-channel pause flag doesn't exist; staff stays in the loop). */
function ChannelHealthCard() {
  const [rows, setRows] = useState<ChannelHealth[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const tick = () =>
      api
        .channelHealth()
        .then((r) => {
          setRows(r.channels);
          setErr('');
        })
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    tick();
    const off = onControlEvent('channel.health', tick);
    const t = setInterval(tick, 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  if (err) return <div className="hint">{err}</div>;
  if (!rows) return <div className="hint">carregando…</div>;
  return (
    <div className="tbl-scroll">
      <table className="tbl">
        <thead>
          <tr>
            <th>canal</th>
            <th style={{ textAlign: 'right' }}>enviadas</th>
            <th style={{ textAlign: 'right' }}>falhas</th>
            <th style={{ textAlign: 'right' }}>bloqueios</th>
            <th style={{ textAlign: 'right' }}>bounces</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.channel}>
              <td>{r.channel}</td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {r.sent}
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {r.failed}
              </td>
              <td
                className="mono"
                style={{ textAlign: 'right' }}
                title={Object.entries(r.blockedByReason)
                  .map(([reason, n]) => `${reason}: ${n}`)
                  .join('\n')}
              >
                {r.blocked}
              </td>
              <td className="mono" style={{ textAlign: 'right' }}>
                {r.bounced || '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {r.alert ? (
                  <span className="chip bad">falha {Math.round((r.failureRate ?? 0) * 100)}%</span>
                ) : (
                  <span className="chip">ok</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- meeting ----------

const DAY_NAMES: [string, string][] = [
  ['seg', 'mon'],
  ['ter', 'tue'],
  ['qua', 'wed'],
  ['qui', 'thu'],
  ['sex', 'fri'],
  ['sáb', 'sat'],
  ['dom', 'sun'],
];

/** Availability used by /agendar + the agent's booking link. Weekly windows
 *  per weekday (lists of HH:MM–HH:MM pairs), slot grid, buffer, horizon; the
 *  roomUrl is the static video room unless DAILY_API_KEY mints per-meeting
 *  rooms; status chips report the gcal + room wiring — the page owns that
 *  fetch so the checklist and the card read the same snapshot. */
function MeetingCard({
  value,
  status,
  onSave,
}: {
  value: Record<string, unknown>;
  status: MeetingStatus | null;
  onSave: (v: Record<string, unknown>) => void;
}) {
  type Weekly = Record<string, [string, string][]>;
  const normWeekly = (w: unknown): Weekly => {
    const out: Weekly = {};
    if (w && typeof w === 'object' && !Array.isArray(w)) {
      for (const [day, list] of Object.entries(w as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          out[day] = list.filter((p): p is [string, string] => Array.isArray(p) && p.length === 2);
        }
      }
    }
    for (const [, k] of DAY_NAMES) if (!out[k]) out[k] = [];
    return out;
  };

  const cur = {
    bookingUrl: str(value.bookingUrl, ''),
    roomUrl: str(value.roomUrl, ''),
    publicBaseUrl: str(value.publicBaseUrl, 'https://crm.vendua.com.br'),
    tz: str(value.tz, 'America/Sao_Paulo'),
    slotMinutes: num(value.slotMinutes, 30),
    bufferMinutes: num(value.bufferMinutes, 15),
    horizonDays: num(value.horizonDays, 14),
    weekly: normWeekly(value.weekly ?? status?.cfg.weekly),
  };
  const [edit, setEdit] = useState(cur);
  // `touched` gates hydration, not `dirty`: a late `value`/`status` response
  // changes `cur` and would otherwise mark an untouched form dirty and block
  // the sync (and a save would persist the stale, all-closed weekly).
  const [touched, setTouched] = useState(false);
  const update = (next: typeof cur) => {
    setTouched(true);
    setEdit(next);
  };
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  // mirrors validateSetting('meeting'): IANA tz, ≤6 windows/day, open < close
  const badWin = Object.values(edit.weekly).some(
    (ws) => ws.length > 6 || ws.some(([a, b]) => !a || !b || a >= b),
  );
  const invalid = !tzValid(edit.tz) || badWin;
  useEffect(() => {
    if (status && !touched) {
      setEdit({ ...cur, weekly: normWeekly(value.weekly ?? status.cfg.weekly) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, JSON.stringify(cur)]);
  // Saving converges edit === cur — clear the flag so a later refresh can
  // hydrate again; without this the first edit would lock out all future syncs.
  useEffect(() => {
    if (touched && JSON.stringify(edit) === JSON.stringify(cur)) setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cur)]);

  const setDay = (day: string, wins: [string, string][]) =>
    update({ ...edit, weekly: { ...edit.weekly, [day]: wins } });

  return (
    <div className="drv">
      <div className="cfg-chips">
        <span className={`chip ${status?.room.provider === 'daily' ? 'agent' : ''}`}>
          sala:{' '}
          {status ? (status.room.provider === 'daily' ? 'daily.co (por call)' : 'estática') : '…'}
        </span>
        <span className={`chip ${status?.gcal.configured ? 'agent' : 'warn'}`}>
          {status
            ? status.gcal.configured
              ? 'google agenda conectada'
              : 'google agenda: não configurada'
            : '…'}
        </span>
        {status?.gcal.lastError && (
          <span className="chip bad" title={status.gcal.lastError}>
            erro: {status.gcal.lastError.slice(0, 40)}
          </span>
        )}
      </div>

      <div className="field">
        <label>link da sala (estático)</label>
        <input
          value={edit.roomUrl}
          placeholder="https://meet.google.com/…"
          maxLength={500}
          onChange={(e) => update({ ...edit, roomUrl: e.target.value })}
        />
        <div className="hint">
          usado quando o provider é estático — o lead recebe na confirmação
        </div>
      </div>
      <div className="field">
        <label>base pública do link</label>
        <input
          value={edit.publicBaseUrl}
          placeholder="https://crm.vendua.com.br"
          maxLength={500}
          onChange={(e) => update({ ...edit, publicBaseUrl: e.target.value })}
        />
        <div className="hint">prefixo do link de agendamento — /agendar?t=…</div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>fallback manual (objetivo reunião sem link interno)</label>
        <input
          value={edit.bookingUrl}
          placeholder="https://calendar.google.com/calendar/appointments/…"
          maxLength={500}
          onChange={(e) => update({ ...edit, bookingUrl: e.target.value })}
        />
      </div>

      <div className="grid4" style={{ margin: '12px 0' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>duração (min)</label>
          <input
            type="number"
            min={5}
            max={120}
            value={edit.slotMinutes}
            onChange={(e) => update({ ...edit, slotMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>intervalo (min)</label>
          <input
            type="number"
            min={0}
            max={180}
            value={edit.bufferMinutes}
            onChange={(e) => update({ ...edit, bufferMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>horizonte (dias)</label>
          <input
            type="number"
            min={1}
            max={60}
            value={edit.horizonDays}
            onChange={(e) => update({ ...edit, horizonDays: Number(e.target.value) })}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>fuso</label>
          <input
            list="tz-list"
            value={edit.tz}
            onChange={(e) => update({ ...edit, tz: e.target.value })}
          />
        </div>
      </div>
      {!tzValid(edit.tz) && (
        <div className="hint" style={{ color: 'var(--red-400)', marginBottom: 8 }}>
          fuso IANA inválido
        </div>
      )}

      <div className="field">
        <label>disponibilidade semanal</label>
        {DAY_NAMES.map(([label, day]) => (
          <div key={day} className="cfg-day">
            <span className="mono cfg-day-lbl">{label}</span>
            {(edit.weekly[day] ?? []).map((w, i) => (
              <span key={i} className="cfg-win">
                <input
                  type="time"
                  value={w[0]}
                  onChange={(e) =>
                    setDay(
                      day,
                      (edit.weekly[day] ?? []).map((x, j) =>
                        j === i ? ([e.target.value, x[1]] as [string, string]) : x,
                      ),
                    )
                  }
                />
                <span className="cfg-sep">–</span>
                <input
                  type="time"
                  value={w[1]}
                  onChange={(e) =>
                    setDay(
                      day,
                      (edit.weekly[day] ?? []).map((x, j) =>
                        j === i ? ([x[0], e.target.value] as [string, string]) : x,
                      ),
                    )
                  }
                />
                <button
                  className="icon-btn"
                  title="remover janela"
                  onClick={() =>
                    setDay(
                      day,
                      (edit.weekly[day] ?? []).filter((_, j) => j !== i),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {(edit.weekly[day] ?? []).length === 0 && (
              <span className="hint" style={{ margin: 0 }}>
                fechado
              </span>
            )}
            <button
              className="icon-btn"
              title={
                (edit.weekly[day] ?? []).length >= 6 ? 'máx 6 janelas/dia' : 'adicionar janela'
              }
              disabled={(edit.weekly[day] ?? []).length >= 6}
              onClick={() => setDay(day, [...(edit.weekly[day] ?? []), ['09:00', '12:00']])}
            >
              +
            </button>
          </div>
        ))}
        <div className="hint">
          janelas no fuso {edit.tz || '…'} — fora delas nenhum slot aparece
        </div>
        {badWin && (
          <div className="hint" style={{ color: 'var(--red-400)' }}>
            janela com abertura depois do fechamento não salva
          </div>
        )}
      </div>

      <div className="actions">
        <button
          className="btn primary"
          disabled={!dirty || invalid}
          onClick={() => onSave({ ...value, ...edit })}
        >
          salvar agenda
        </button>
        {dirty && (
          <button
            className="btn ghost"
            onClick={() => {
              setTouched(false);
              setEdit(cur);
            }}
          >
            desfazer
          </button>
        )}
      </div>
      <RawJson value={value} onSave={onSave} />
    </div>
  );
}

// ---------- forecast ----------

/** Percent defaults mirrored from DEFAULT_FORECAST_PROBABILITIES (core). */
const FORECAST_DEFAULT_PCT: Record<(typeof LEAD_STATES)[number][0], number> = {
  lead: 5,
  contacted: 20,
  invited: 60,
  live: 100,
};

function ForecastCard({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const stored = (value.probabilities ?? {}) as Record<string, unknown>;
  // Stored as 0..1 fractions; the card edits percent — staff reads %.
  // ×10000/100 keeps two decimal places so a hand-set 55.5% isn't silently
  // rounded to 56 on the next save of an untouched field.
  const cur = Object.fromEntries(
    LEAD_STATES.map(([k]) => [
      k,
      Math.round(num(stored[k], FORECAST_DEFAULT_PCT[k] / 100) * 10000) / 100,
    ]),
  ) as Record<(typeof LEAD_STATES)[number][0], number>;
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  const invalid = LEAD_STATES.some(
    ([k]) => !Number.isFinite(edit[k]) || edit[k] < 0 || edit[k] > 100,
  );

  return (
    <div className="drv">
      <div className="grid4">
        {LEAD_STATES.map(([k, label]) => (
          <div className="field" key={k}>
            <label>{label}</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                max={100}
                step="any"
                value={edit[k]}
                onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })}
              />
              <span className="hint">%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="hint">
        valor ponderado = valor em aberto no estágio × probabilidade — relatórios
      </div>
      {invalid && (
        <div className="hint" style={{ color: 'var(--red-400)' }}>
          probabilidades precisam ficar entre 0 e 100%
        </div>
      )}
      <div className="actions">
        <button
          className="btn primary"
          disabled={!dirty || invalid}
          onClick={() =>
            onSave({
              ...value,
              probabilities: Object.fromEntries(LEAD_STATES.map(([k]) => [k, edit[k] / 100])),
            })
          }
        >
          salvar previsão
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

// ---------- digest ----------

function DigestCard({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const cur = {
    enabled: value.enabled === true,
    to: str(value.to, ''),
    hour: num(value.hour, 8),
  };
  const [edit, setEdit] = useState(cur);
  useEffect(() => setEdit(cur), [JSON.stringify(cur)]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(edit) !== JSON.stringify(cur);
  // backend rejects enabled-without-to — block the same way client-side
  const invalid = edit.enabled && !edit.to.trim();

  return (
    <div className="drv">
      <div className="grid2" style={{ alignItems: 'end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>enviar para</label>
          <input
            type="email"
            placeholder="voce@empresa.com"
            value={edit.to}
            maxLength={320}
            onChange={(e) => setEdit({ ...edit, to: e.target.value })}
          />
          {invalid ? (
            <div className="hint" style={{ color: 'var(--red-400)' }}>
              ligado precisa de um email de destino
            </div>
          ) : (
            <div className="hint">sai pelo driver de email ativo (resend em produção)</div>
          )}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>a partir das</label>
          <input
            type="number"
            min={0}
            max={23}
            value={edit.hour}
            onChange={(e) => setEdit({ ...edit, hour: Number(e.target.value) || 0 })}
          />
          <div className="hint">hora local no fuso dos guardrails — dispara uma vez ao dia</div>
        </div>
      </div>
      <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
        <label className="tgl">
          <input
            type="checkbox"
            checked={edit.enabled}
            onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
          />
          <span className="tk" />
          <span className="lbl">{edit.enabled ? 'enviando todo dia' : 'desligado'}</span>
        </label>
      </div>
      <div className="actions">
        <button
          className="btn primary"
          disabled={!dirty || invalid}
          onClick={() => onSave({ ...value, ...edit, to: edit.to.trim() })}
        >
          salvar resumo
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

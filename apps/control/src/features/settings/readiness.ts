import type { Integration, MeetingStatus } from '@/lib/api.ts';
import { KINDS, providerStatus, WA_IDLE, type ProvTone, type WaState } from './providers.ts';
import { num, obj, str, type SettingsMap } from './queries.ts';

export const AREAS = [
  { key: 'visao', label: 'visão geral' },
  { key: 'conexoes', label: 'conexões' },
  { key: 'agenda', label: 'agenda' },
  { key: 'relatorios', label: 'relatórios' },
] as const;
export type AreaKey = (typeof AREAS)[number]['key'];

/** The agent itself (autonomia, voz, regras) lives in the Estúdio. */
export const STUDIO = '/agente/estudio';

export type Check = {
  key: string;
  label: string;
  state: string;
  tone: ProvTone;
  to?: AreaKey;
  /** anchor inside the target area (provider card id) */
  p?: string;
  /** cross-view jump — agent rows open the Estúdio, not an area here */
  route?: string;
};

export type Readiness = {
  essential: Check[];
  routine: Check[];
  ready: number;
  attn: number;
  provLive: number;
  connMark: ProvTone;
  agendaCheck: Check;
};

/**
 * The overview checklist. `mStatus` is null while the first probe is in
 * flight and 'err' when the probe itself failed — reported, never guessed.
 */
export function computeReadiness({
  integrations,
  integErr,
  settings,
  setErr,
  wa,
  mStatus,
}: {
  integrations: Integration[];
  integErr: boolean;
  settings: SettingsMap;
  setErr: boolean;
  wa: WaState;
  mStatus: MeetingStatus | 'err' | null;
}): Readiness {
  const provTones = KINDS.map(
    (k) =>
      providerStatus(
        k.key,
        integrations.filter((i) => i.kind === k.key),
        k.key === 'whatsapp' ? wa : WA_IDLE,
      ).tone,
  );
  const provLive = provTones.filter((t) => t === 'live').length;

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

  const agenda = (state: string, tone: ProvTone): Check => ({
    key: 'agenda',
    label: 'agenda',
    state,
    tone,
    to: 'agenda',
  });
  const weekDays =
    mStatus && mStatus !== 'err'
      ? Object.values(mStatus.cfg.weekly).filter((w) => w.length > 0).length
      : 0;
  const agendaCheck: Check =
    mStatus === null
      ? agenda('lendo status…', 'off')
      : mStatus === 'err'
        ? agenda('falha ao ler status do serviço', 'warn')
        : weekDays === 0
          ? agenda('sem horários abertos', 'off')
          : // booking needs a room (daily or static link); google is optional sync
            mStatus.room.provider === 'daily' && mStatus.room.lastError
            ? agenda(
                mStatus.cfg.roomUrl
                  ? 'daily falhou — salvando na sala fixa'
                  : 'daily falhou — a call sai sem link',
                'warn',
              )
            : !(mStatus.room.provider === 'daily' || mStatus.cfg.roomUrl)
              ? agenda('sem sala — a call sai sem link', 'warn')
              : mStatus.gcal.configured && mStatus.gcal.lastError
                ? agenda(`${weekDays}d/semana · google falhou`, 'warn')
                : agenda(
                    `${weekDays}d/semana · ${
                      mStatus.room.provider === 'daily' ? 'sala daily.co' : 'sala fixa'
                    }` + (mStatus.gcal.configured ? ' · google conectada' : ''),
                    'live',
                  );

  const essential: Check[] = [...KINDS.map(provCheck), agendaCheck];

  const g = obj(settings.guardrails);
  const pitch = obj(settings.pitch);
  const digest = obj(settings.digest);
  const autonomy = obj(settings.agent_autonomy);
  // 'off' parks the agent; 'copilot' silently backs up the draft queue — both worth flagging
  const autoLevel = str(autonomy.level, 'supervised');
  const routine: Check[] = setErr
    ? (
        [
          { key: 'autonomia', label: 'autonomia', route: `${STUDIO}?s=autonomia` },
          { key: 'voz', label: 'voz do agente', route: `${STUDIO}?s=voz` },
          { key: 'regras', label: 'regras', route: `${STUDIO}?s=regras` },
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
          route: `${STUDIO}?s=autonomia`,
        },
        {
          key: 'voz',
          label: 'voz do agente',
          state: str(pitch.product, '') ? 'definida' : 'vazia — o agente improvisa',
          tone: str(pitch.product, '') ? 'live' : 'off',
          route: `${STUDIO}?s=voz`,
        },
        {
          key: 'regras',
          label: 'regras',
          state: `silêncio ${str(g.quietStart, '21:00')}–${str(g.quietEnd, '08:00')} · ${str(
            g.timezone,
            'America/Sao_Paulo',
          )}`,
          tone: 'live',
          route: `${STUDIO}?s=regras`,
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
  const connMark: ProvTone = integErr
    ? 'warn'
    : provTones.includes('warn')
      ? 'warn'
      : provLive === KINDS.length
        ? 'live'
        : 'off';

  return { essential, routine, ready, attn, provLive, connMark, agendaCheck };
}

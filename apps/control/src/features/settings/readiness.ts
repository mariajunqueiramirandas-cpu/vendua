import type { IgStatus, Integration, MeetingStatus, TelegramOverview } from '@/lib/api.ts';
import { KINDS, providerStatus, WA_IDLE, type ProvTone, type WaState } from './providers.ts';
import { obj, str, type SettingsMap } from './queries.ts';

export const AREAS = [
  { key: 'visao', label: 'visão geral' },
  { key: 'conexoes', label: 'conexões' },
  { key: 'reunioes', label: 'reuniões' },
  { key: 'equipe', label: 'equipe' },
  { key: 'telegram', label: 'telegram' },
  { key: 'relatorios', label: 'relatórios' },
] as const;
export type AreaKey = (typeof AREAS)[number]['key'];

/** The agent itself (autonomia, voz, limites, memória) lives in Agente → Configurar. */
export const STUDIO = '/agente/configurar';

export type Check = {
  key: string;
  label: string;
  state: string;
  tone: ProvTone;
  to?: AreaKey;
  /** anchor inside the target area (provider card id) */
  p?: string;
  /** cross-view jump — agent rows open Configurar, not an area here */
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
  ig,
  mStatus,
  telegram,
}: {
  integrations: Integration[];
  integErr: boolean;
  settings: SettingsMap;
  setErr: boolean;
  wa: WaState;
  ig: IgStatus | null;
  mStatus: MeetingStatus | 'err' | null;
  /** null while the first read is in flight, 'err' when it failed */
  telegram: TelegramOverview | 'err' | null;
}): Readiness {
  const provTones = KINDS.map(
    (k) =>
      providerStatus(
        k.key,
        integrations.filter((i) => i.kind === k.key),
        k.key === 'whatsapp' ? wa : WA_IDLE,
        ig,
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
    const st = providerStatus(k.key, rows, k.key === 'whatsapp' ? wa : WA_IDLE, ig);
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
    key: 'reunioes',
    label: 'reuniões',
    state,
    tone,
    to: 'reunioes',
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
  const autonomy = obj(settings.agent);
  const staff = obj(settings.staff);
  const staffCount = Array.isArray(staff.members) ? staff.members.length : 0;
  const autoLevel = str(autonomy.level, 'autopilot');
  const routine: Check[] = setErr
    ? (
        [
          { key: 'autonomia', label: 'autonomia', route: STUDIO },
          { key: 'voz', label: 'voz do agente', route: `${STUDIO}?s=voz` },
          { key: 'regras', label: 'limites', route: `${STUDIO}?s=limites` },
          { key: 'equipe', label: 'equipe', to: 'equipe' },
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
                  ? 'piloto automático — envia tudo direto sem aprovação'
                  : 'supervisionado — respostas saem, 1º contato espera aprovação',
          tone: autoLevel === 'off' ? 'off' : autoLevel === 'supervised' ? 'live' : 'warn',
          route: STUDIO,
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
          label: 'limites',
          state: `${
            g.quietHoursEnabled === false
              ? 'sem horário de silêncio'
              : `silêncio ${str(g.quietStart, '21:00')}–${str(g.quietEnd, '08:00')}`
          } · ${str(g.timezone, 'America/Sao_Paulo')}`,
          tone: 'live',
          route: `${STUDIO}?s=limites`,
        },
        {
          key: 'equipe',
          label: 'equipe',
          state: staffCount
            ? `${staffCount} ${staffCount === 1 ? 'pessoa' : 'pessoas'}`
            : 'ninguém cadastrado — ninguém usa os botões do bot',
          tone: staffCount ? 'live' : 'warn',
          to: 'equipe',
        },
      ];

  routine.push(telegramCheck(telegram));

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

function telegramCheck(d: TelegramOverview | 'err' | null): Check {
  const c = (state: string, tone: ProvTone): Check => ({
    key: 'telegram',
    label: 'avisos no telegram',
    state,
    tone,
    to: 'telegram',
  });
  if (d === null) return c('lendo status…', 'off');
  if (d === 'err') return c('falha ao ler', 'warn');
  if (!d.app.enabled) return c('desligado — a equipe não fica sabendo de nada', 'warn');
  if (!d.app.ok) return c(d.app.reason ?? 'incompleto', 'warn');
  const recentError =
    d.state.lastError && Date.now() - new Date(d.state.lastError.at).getTime() < 86_400_000;
  if (recentError) return c(`erro: ${d.state.lastError!.message}`, 'warn');
  if (d.team.linked === 0) return c('ninguém conectou a DM ainda', 'warn');
  return c(`@${d.app.username} · ${d.team.linked}/${d.team.members} da equipe`, 'live');
}

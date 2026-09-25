import type { Integration } from '@/lib/api.ts';

export type Driver = {
  d: string;
  label: string;
  hint: string;
  /** driver needs a secretRef env name */
  secret?: boolean;
  /** default env-var name the backend falls back to */
  secretName?: string;
  // placeholder doubles as the runtime default — keep it in sync with the
  // `?? 'default'` in packages/core (llm.ts, channels/*)
  fields?: {
    key: string;
    label: string;
    placeholder: string;
    hint?: string;
    /** stored as a JSON number — the driver reads `typeof config.x === 'number'` */
    number?: boolean;
  }[];
};

export type Kind = { key: string; label: string; sub: string; drivers: Driver[] };

export const KINDS: Kind[] = [
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

export type WaState = {
  qr: string | null;
  status: string;
  me: { phone: string | null; name: string | null } | null;
};
export const WA_IDLE: WaState = { qr: null, status: 'off', me: null };

/** 'live' = driver can work NOW, not just an enabled row (baileys + unscanned QR = 'warn'). */
export type ProvTone = 'off' | 'warn' | 'live';

export function providerStatus(
  kindKey: string,
  rows: Integration[],
  wa: WaState,
): { tone: ProvTone; text: string } {
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

export const TONE_BADGE = { live: 'agent', warn: 'warn', off: 'default' } as const;

export const fmtPhone = (digits: string) => {
  if (digits.startsWith('55') && digits.length === 13)
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
  if (digits.startsWith('55') && digits.length === 12)
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
  return `+${digits}`;
};

export type IntegrationDraft = {
  driver: string;
  secretRef: string;
  config: Record<string, string | number>;
};

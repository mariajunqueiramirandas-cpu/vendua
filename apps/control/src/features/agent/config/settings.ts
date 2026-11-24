import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type AgentConfig, type AgentPitch, type ResetInstructionsScope } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

type SettingsRes = { settings: { key: string; value: unknown }[] };
export type SettingsMap = Record<string, unknown>;

const SETTING_LABEL: Record<string, string> = {
  agent: 'agente',
  pitch: 'voz',
  guardrails: 'limites',
};

// the cache keeps the raw GET shape — qk.settings() is shared with the config screen
const toMap = (r: SettingsRes): SettingsMap =>
  Object.fromEntries(r.settings.map((s) => [s.key, s.value]));

export const useSettingsMap = () =>
  useQuery({ queryKey: qk.settings(), queryFn: api.settings, select: toMap });

/** A whole value, or an updater run against the freshest cached value right before the PUT. */
export type SettingWrite = unknown;

/**
 * PUT sends the whole setting, so writes serialize (mutation scope) and
 * updaters merge off the cache as it stands after every earlier write —
 * rapid saves accumulate instead of clobbering each other.
 */
export function useSaveSetting() {
  const qc = useQueryClient();
  const m = useMutation({
    scope: { id: 'settings-put' },
    mutationFn: async ({ key, value }: { key: string; value: SettingWrite }) => {
      const res = qc.getQueryData<SettingsRes>(qk.settings());
      const cur = res?.settings.find((s) => s.key === key)?.value;
      const v = typeof value === 'function' ? (value as (c: unknown) => unknown)(cur) : value;
      await api.putSetting(key, v);
      return { key, v };
    },
    onSuccess: async ({ key, v }) => {
      // any GET issued before this write is stale — drop it before writing the cache
      await qc.cancelQueries({ queryKey: qk.settings() });
      qc.setQueryData<SettingsRes>(qk.settings(), (old) => {
        const rows = old?.settings ?? [];
        const has = rows.some((s) => s.key === key);
        return {
          settings: has
            ? rows.map((s) => (s.key === key ? { key, value: v } : s))
            : [...rows, { key, value: v }],
        };
      });
      const label = SETTING_LABEL[key] ?? key;
      toast.success(`${label} salvo`);
      for (const queryKey of [qk.settings(), qk.agentConfig(), qk.memory()])
        void qc.invalidateQueries({ queryKey });
    },
    onError: (e, { key }) => {
      const label = SETTING_LABEL[key] ?? key;
      toast.error(`${label}: ${errorMessage(e)}`);
      // resync — the local picture may be stale
      void qc.invalidateQueries({ queryKey: qk.settings() });
    },
  });
  const { mutateAsync } = m;
  const save = useCallback(
    (key: string, value: SettingWrite) =>
      mutateAsync({ key, value }).then(
        () => true,
        () => false,
      ),
    [mutateAsync],
  );
  return { save, pending: m.isPending };
}

export function useResetAgentInstructions() {
  const qc = useQueryClient();
  const m = useMutation({
    scope: { id: 'settings-put' },
    mutationFn: (scope: ResetInstructionsScope = 'all') => api.resetAgentInstructions(scope),
    onSuccess: async (res) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: qk.settings() }),
        qc.cancelQueries({ queryKey: qk.agentConfig() }),
      ]);
      qc.setQueryData<AgentConfig>(qk.agentConfig(), res.config);
      qc.setQueryData<SettingsRes>(qk.settings(), (old) => {
        const rows = old?.settings ?? [];
        const upsert = (list: { key: string; value: unknown }[], key: string, value: unknown) =>
          list.some((s) => s.key === key)
            ? list.map((s) => (s.key === key ? { key, value } : s))
            : [...list, { key, value }];
        return { settings: upsert(upsert(rows, 'agent', res.config), 'pitch', res.pitch) };
      });
      toast.success('voz e instruções restauradas para o padrão — memória e leads mantidos');
      for (const queryKey of [qk.settings(), qk.agentConfig()])
        void qc.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      toast.error(`restaurar instruções: ${errorMessage(e)}`);
      void qc.invalidateQueries({ queryKey: qk.settings() });
      void qc.invalidateQueries({ queryKey: qk.agentConfig() });
    },
  });
  const { mutateAsync } = m;
  const resetInstructions = useCallback(
    (
      scope: ResetInstructionsScope = 'all',
    ): Promise<{ scope: ResetInstructionsScope; config: AgentConfig; pitch: AgentPitch } | null> =>
      mutateAsync(scope).catch(() => null),
    [mutateAsync],
  );
  return { resetInstructions, resetting: m.isPending };
}

export const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
export const obj = (v: unknown) =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Record<string, unknown>;

// same check validateSetting applies server-side — saves a 422 round-trip
export const tzValid = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

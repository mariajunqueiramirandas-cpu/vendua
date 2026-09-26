import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import type { IntegrationDraft } from './providers.ts';

export type SettingsMap = Record<string, unknown>;

const toMap = (s: { settings: { key: string; value: unknown }[] }): SettingsMap => {
  const map: SettingsMap = {};
  for (const row of s.settings) map[row.key] = row.value;
  return map;
};

export const useSettingsMap = () =>
  useQuery({ queryKey: qk.settings(), queryFn: api.settings, select: toMap });

export const useMeetingsStatus = () =>
  useQuery({ queryKey: qk.meetingsStatus(), queryFn: api.meetingsStatus });

export const useChannelHealth = () =>
  useQuery({ queryKey: qk.channelHealth(), queryFn: api.channelHealth });

/**
 * Socket state lives under the 'integrations' root so `channel.health` (which
 * invalidates 'integrations') and every provider save refresh it too — the old
 * screen reloaded QR/status in the same sweep.
 */
export const waQrKey = qk.waQr;
export const useWaQr = () => useQuery({ queryKey: waQrKey(), queryFn: api.waQr, retry: false });
/** Same 'integrations' root — a sidecar state event (channel.health) refreshes it. */
export const useIgStatus = () =>
  useQuery({ queryKey: qk.igStatus(), queryFn: api.igStatus, retry: false });

/** Everything this screen reads — the old page reloaded all of it after any write. */
function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [qk.integrations(), qk.settings(), qk.meetingsStatus(), qk.channelHealth()].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

export function useSaveIntegration() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ kind, d, enable }: { kind: string; d: IntegrationDraft; enable: boolean }) => {
      // empty fields fall back to the driver's defaults — never persist blanks
      const config = Object.fromEntries(Object.entries(d.config).filter(([, v]) => v));
      return api.putIntegration(kind, {
        driver: d.driver,
        enabled: enable,
        ...(d.secretRef ? { secretRef: d.secretRef } : {}),
        ...(Object.keys(config).length ? { config } : {}),
      });
    },
    onSuccess: (_r, { kind, d, enable }) =>
      toast.success(enable ? `${kind}: ${d.driver} ativo` : `${kind}: ${d.driver} desativado`),
    onError: (e, { kind }) => toast.error(`${kind}: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useSaveSetting() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api.putSetting(key, value),
    onSuccess: (_r, { key }) => toast.success(`${key} salvo`),
    onError: (e, { key }) => toast.error(`${key}: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useWaLogout() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: api.waLogout,
    onSuccess: () => toast.success('whatsapp desconectado — QR novo a caminho'),
    onError: (e) => toast.error(`whatsapp: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useIgLogout() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: api.igLogout,
    onSuccess: () => toast.success('instagram desconectado — sessão apagada'),
    onError: (e) => toast.error(`instagram: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

/** Settings arrive as untyped jsonb — read with a fallback instead of trusting the shape. */
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

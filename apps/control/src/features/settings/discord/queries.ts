import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type DiscordSetting } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useDiscord = () => useQuery({ queryKey: qk.discord(), queryFn: api.discord });

/** Live from Discord's API — no polling, and only once the bot can authenticate. */
export const useDiscordGuild = (enabled: boolean) =>
  useQuery({
    queryKey: qk.discordGuild(),
    queryFn: api.discordGuild,
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: false,
    retry: false,
  });

function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [qk.discord(), qk.settings(), qk.integrations()].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

export function useSaveDiscordConnection() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (v: {
      config: { applicationId: string; publicKey: string; guildId: string };
      secretRef: string;
      enabled: boolean;
    }) =>
      api.putIntegration('discord', {
        driver: 'bot',
        enabled: v.enabled,
        config: Object.fromEntries(Object.entries(v.config).filter(([, x]) => x.trim())),
        ...(v.secretRef.trim() ? { secretRef: v.secretRef.trim() } : {}),
      }),
    onSuccess: (_r, v) => toast.success(v.enabled ? 'discord ativo' : 'discord desligado'),
    onError: (e) => toast.error(`discord: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useSaveDiscordSetting() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (value: DiscordSetting) => api.putSetting('discord', value),
    onSuccess: () => toast.success('discord salvo'),
    onError: (e) => toast.error(`discord: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useDiscordSetup() {
  const refresh = useRefresh();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.discordSetup,
    onSuccess: (r) =>
      toast.success(
        r.created.length
          ? `${r.created.length} ${r.created.length === 1 ? 'canal criado' : 'canais criados'} e ligados`
          : 'os canais já existiam — ligados de novo',
      ),
    onError: (e) => toast.error(`criar canais: ${errorMessage(e)}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.discordGuild() });
      return refresh();
    },
  });
}

export function useDiscordTest() {
  return useMutation({
    mutationFn: api.discordTest,
    onSuccess: ({ results }) => {
      const bad = results.filter((r) => !r.ok).length;
      if (!results.length) toast.error('nenhum canal escolhido ainda');
      else if (bad) toast.error(`${bad} de ${results.length} canais falharam`);
      else
        toast.success(
          `teste enviado para ${results.length} ${results.length === 1 ? 'canal' : 'canais'}`,
        );
    },
    onError: (e) => toast.error(`teste: ${errorMessage(e)}`),
  });
}

export function useDiscordCommands() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: api.discordCommands,
    onSuccess: (r) =>
      r.ok
        ? toast.success(`${r.commands} comandos registrados`)
        : toast.error(`comandos: ${r.error}`),
    onError: (e) => toast.error(`comandos: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useDiscordMute() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ category, minutes }: { category: string; minutes: number }) =>
      api.discordMute(category, minutes),
    onSuccess: (_r, v) => toast.success(v.minutes ? 'silenciado' : 'reativado'),
    onError: (e) => toast.error(`silenciar: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

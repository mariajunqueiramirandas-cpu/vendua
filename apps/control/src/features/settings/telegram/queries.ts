import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type TelegramSetting } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const useTelegram = () => useQuery({ queryKey: qk.telegram(), queryFn: api.telegram });

function useRefresh() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [qk.telegram(), qk.settings(), qk.integrations()].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
    );
}

/** Reads the bot from the token, sets the webhook and registers private-chat commands. */
export function useTelegramConnect() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (secretRef?: string) => api.telegramConnect(secretRef),
    onSuccess: (r) => {
      if (!r.webhook.ok) toast.error('conectado, mas o Telegram recusou a URL do webhook');
      else toast.success(`@${r.username} conectado`);
    },
    onError: (e) => toast.error(`telegram: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useTelegramDisconnect() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: api.telegramDisconnect,
    onSuccess: () => toast.success('telegram desligado'),
    onError: (e) => toast.error(`telegram: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

/** Generates a single-use one-tap `t.me/<bot>?start=link_<token>` link. */
export function useTelegramLink() {
  return useMutation({
    mutationFn: (memberIndex?: number) => api.telegramLink(memberIndex),
    onError: (e) => toast.error(`link do telegram: ${errorMessage(e)}`),
  });
}

export function useSaveTelegramSetting() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (value: TelegramSetting) => api.putSetting('telegram', value),
    onSuccess: () => toast.success('telegram salvo'),
    onError: (e) => toast.error(`telegram: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useTelegramTest() {
  return useMutation({
    mutationFn: api.telegramTest,
    onSuccess: ({ results }) => {
      const bad = results.filter((r) => !r.ok).length;
      if (!results.length) toast.error('ninguém conectou o Telegram ainda');
      else if (bad) toast.error(`${bad} de ${results.length} DMs falharam`);
      else
        toast.success(
          `teste enviado para ${results.length} ${results.length === 1 ? 'DM' : 'DMs'}`,
        );
    },
    onError: (e) => toast.error(`teste: ${errorMessage(e)}`),
  });
}

export function useTelegramCommands() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: api.telegramCommands,
    onSuccess: (r) =>
      r.ok
        ? toast.success(`${r.commands} comandos registrados`)
        : toast.error(`comandos: ${r.error}`),
    onError: (e) => toast.error(`comandos: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

export function useTelegramMute() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ category, minutes }: { category: string; minutes: number }) =>
      api.telegramMute(category, minutes),
    onSuccess: (_r, v) => toast.success(v.minutes ? 'silenciado' : 'reativado'),
    onError: (e) => toast.error(`silenciar: ${errorMessage(e)}`),
    onSettled: () => refresh(),
  });
}

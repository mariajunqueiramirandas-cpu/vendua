import type { Sql } from '../../platform/db.ts';
import { log } from '../../platform/log.ts';
import { controlTx } from '../control.ts';
import { staffConfigTx } from '../staff.ts';
import { runAction, isEphemeral, type ActionDeps } from './actions.ts';
import {
  autocomplete,
  ephemeral,
  runCommand,
  say,
  type CommandCtx,
  type InteractionResponse,
} from './commands.ts';
import type { DiscordContext } from './config.ts';
import { esc } from './format.ts';

// Discord's HTTP interactions (ADR 0023): every request is signed with the application's
// Ed25519 key over `timestamp + body`; anything unsigned, stale or from another guild is
// refused, and only Discord users listed on a team member (Config → Equipe) can act.

const ilog = log.child({ mod: 'discord' });
const MAX_SKEW_S = 300;

const keys = new Map<string, Promise<CryptoKey>>();

function importKey(hex: string): Promise<CryptoKey> {
  let k = keys.get(hex);
  if (!k) {
    k = crypto.subtle.importKey('raw', Buffer.from(hex, 'hex'), { name: 'Ed25519' }, false, [
      'verify',
    ]);
    keys.set(hex, k);
    k.catch(() => keys.delete(hex));
  }
  return k;
}

export async function verifyDiscordSignature(
  publicKeyHex: string,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  body: string,
  nowS = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!signatureHex || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  // a captured request can't be replayed later
  if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return false;
  try {
    return await crypto.subtle.verify(
      'Ed25519',
      await importKey(publicKeyHex),
      Buffer.from(signatureHex, 'hex'),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string | null;
}

export interface Interaction {
  id: string;
  type: number;
  guild_id?: string;
  member?: { user?: DiscordUser };
  user?: DiscordUser;
  data?: {
    name?: string;
    custom_id?: string;
    options?: {
      name: string;
      type: number;
      value?: string | number | boolean;
      focused?: boolean;
    }[];
  };
  message?: { flags?: number };
}

export async function staffNameForDiscordUser(sql: Sql, userId: string): Promise<string | null> {
  const cfg = await controlTx(sql, staffConfigTx);
  const m = cfg.members.find((x) => (x as { discord?: unknown }).discord === userId);
  if (!m) return null;
  return m.name?.trim() || m.email || 'equipe';
}

export async function handleInteraction(
  sql: Sql,
  ctx: DiscordContext,
  i: Interaction,
  deps: ActionDeps,
): Promise<InteractionResponse> {
  if (i.type === 1) return { type: 1 };
  if (!ctx.app.ok) return say('o bot está desligado no CRM (Config → Conexões → Discord)');
  if (i.guild_id !== ctx.app.app.guildId)
    return say('este bot só atende dentro do servidor da equipe Venduá');
  const user = i.member?.user ?? i.user;
  if (!user?.id) return say('não consegui identificar quem clicou');
  const staffName = await staffNameForDiscordUser(sql, user.id);
  if (!staffName) {
    if (i.type === 4) return { type: 8, data: { choices: [] } };
    return ephemeral({
      content: [
        '🔒 este bot é só para a equipe da Venduá.',
        `o seu ID do Discord é \`${esc(user.id)}\` — peça para alguém da equipe colar em **Config → Equipe** no CRM e tente de novo.`,
      ].join('\n'),
    });
  }
  const c: CommandCtx = { sql, ctx, staffName, userId: user.id, interactionId: i.id };
  try {
    if (i.type === 2) return await runCommand(c, i.data?.name ?? '', i.data?.options);
    if (i.type === 4) return await autocomplete(sql, i.data?.name ?? '', i.data?.options);
    if (i.type === 3)
      return await runAction(
        c,
        {
          interactionId: i.id,
          customId: i.data?.custom_id ?? '',
          fromList: isEphemeral(i.message?.flags),
        },
        deps,
      );
    return say('ok');
  } catch (e) {
    ilog.error(
      { err: e, type: i.type, name: i.data?.name ?? i.data?.custom_id },
      'discord interaction failed',
    );
    if (i.type === 4) return { type: 8, data: { choices: [] } };
    return say('algo deu errado do nosso lado — tente de novo ou use o CRM');
  }
}

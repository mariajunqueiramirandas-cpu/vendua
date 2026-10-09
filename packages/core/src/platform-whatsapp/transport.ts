// Which process holds Venduá's own WhatsApp number (docs/features/dua-no-whatsapp.md §4.4):
// 'socket' is the CRM's Baileys socket inside Core (agent/channels/whatsapp.ts), 'gateway' is a
// platform session on the wa-gateway process. The flip is the cutover; going back is a re-pair.
export type PlatformTransport = 'socket' | 'gateway';

export function platformTransport(
  env: Record<string, string | undefined> = process.env,
): PlatformTransport {
  return env.WA_PLATFORM_TRANSPORT === 'gateway' ? 'gateway' : 'socket';
}

/** The one platform session today; a second number would be a second row (§4.5). */
export const VENDUA_SESSION = 'vendua';

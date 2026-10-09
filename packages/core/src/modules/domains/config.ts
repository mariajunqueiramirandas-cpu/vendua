import { isIP } from 'node:net';
import { log } from '../../platform/log.ts';
import { brasilApiCnpj } from './cnpj.ts';
import { cloudflare } from './cloudflare.ts';
import { openprovider } from './openprovider.ts';
import { httpsProbe } from './probe.ts';
import type { DomainProviders } from './providers.ts';
import { registroBrRdap } from './rdap.ts';

// Every variable is a literal property access on process.env: test/hermetic.ts clears the ones it
// finds written that way.

const env = (v: string | undefined) => v?.trim() || null;

export function domainProvidersFromEnv(): DomainProviders {
  const opUser = env(process.env.OPENPROVIDER_USERNAME);
  const opPassword = env(process.env.OPENPROVIDER_PASSWORD);
  const opHandle = env(process.env.OPENPROVIDER_CONTACT_HANDLE);
  const opUrl = env(process.env.OPENPROVIDER_URL);
  const cfToken = env(process.env.CLOUDFLARE_API_TOKEN);
  const cfAccount = env(process.env.CLOUDFLARE_ACCOUNT_ID);
  let ipv4 = env(process.env.VENDUA_EDGE_IPV4);
  let ipv6 = env(process.env.VENDUA_EDGE_IPV6);

  if (ipv4 && isIP(ipv4) !== 4) {
    log.warn({ mod: 'domains' }, 'VENDUA_EDGE_IPV4 is not an IPv4 address; ignored');
    ipv4 = null;
  }
  if (ipv6 && isIP(ipv6) !== 6) {
    log.warn({ mod: 'domains' }, 'VENDUA_EDGE_IPV6 is not an IPv6 address; ignored');
    ipv6 = null;
  }

  return {
    registrar:
      opUser && opPassword && opHandle
        ? openprovider({
            username: opUser,
            password: opPassword,
            contactHandle: opHandle,
            ...(opUrl ? { url: opUrl } : {}),
          })
        : null,
    dnsHost: cfToken && cfAccount ? cloudflare({ token: cfToken, accountId: cfAccount }) : null,
    rdap: registroBrRdap(),
    cnpj: brasilApiCnpj(),
    edge: ipv4 ? { ipv4, ipv6 } : null,
    providerName: env(process.env.OPENPROVIDER_PROVIDER_NAME),
    probeTls: httpsProbe(),
  };
}

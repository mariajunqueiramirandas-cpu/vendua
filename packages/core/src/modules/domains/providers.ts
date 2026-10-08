// The outside services ADR 0038 drives: the registrar (Openprovider), the DNS host (Cloudflare),
// registro.br's RDAP and the CNPJ public record. Jobs and routes depend on these interfaces only;
// tests swap in fakes.

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';

/** A record in a zone Venduá hosts. `name` is '@' for the root or relative ('mail', '_dmarc'). */
export interface DnsRecord {
  type: DnsRecordType;
  name: string;
  value: string;
  priority?: number;
}

export interface HolderAddress {
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  /** UF, two letters */
  state: string;
  /** eight digits */
  postalCode: string;
}

export interface HolderInput {
  kind: 'cnpj' | 'cpf';
  /** normalized: 11 digits (CPF) or 14 characters (CNPJ, alphanumeric since July 2026) */
  document: string;
  /** legal name (razão social) or the person's full name */
  name: string;
  email: string;
  /** Brazilian number with area code, digits only (10 or 11) */
  phone: string;
  address: HolderAddress;
}

export interface RegistrarDomain {
  /** the registrar's id for the domain */
  ref: string;
  status: 'pending' | 'active' | 'failed';
  expiresAt: Date | null;
}

export interface Availability {
  available: boolean | null;
  /** the registrar's price for one year, in the currency's minor unit */
  price?: { cents: number; currency: string };
}

/**
 * Why a registrar call failed. `conflict`: the CPF/CNPJ belongs to another provider at
 * registro.br; `taken`: the name isn't free; `invalid`: the registry refused the data;
 * `unavailable`: the registrar can't be reached or is in maintenance (retry later).
 */
export class RegistrarError extends Error {
  constructor(
    message: string,
    readonly kind: 'conflict' | 'taken' | 'invalid' | 'unavailable' | 'other',
  ) {
    super(message);
  }
}

export interface Registrar {
  /** availability of each host (lower-case `label.com.br`) */
  check(hosts: string[]): Promise<Map<string, Availability>>;
  /** the domain in Venduá's account, if a previous attempt already registered it */
  find(host: string): Promise<RegistrarDomain | null>;
  /** a contact for the holder; returns its handle */
  createHolder(holder: HolderInput): Promise<string>;
  /** a zone on the registrar's own DNS with the root and `www` A (and AAAA) records; idempotent */
  parkZone(host: string, ipv4: string, ipv6: string | null): Promise<void>;
  /** registers for one year on the registrar's nameservers; Venduá's handle is admin/tech/billing */
  register(o: { host: string; holderHandle: string }): Promise<RegistrarDomain>;
  get(ref: string): Promise<RegistrarDomain>;
  renew(ref: string, host: string): Promise<RegistrarDomain>;
  setNameservers(ref: string, host: string, nameServers: string[]): Promise<void>;
}

export interface Zone {
  id: string;
  nameServers: string[];
  /** Cloudflare's: 'pending' until the nameservers point at it, then 'active' */
  status: string;
}

export interface DnsHost {
  /** the zone for `host` in Venduá's account, created when missing */
  ensureZone(host: string): Promise<Zone>;
  zone(id: string): Promise<Zone | null>;
  /**
   * Makes the zone hold exactly: A (and AAAA) at '@' and 'www' pointing at the edge, plus
   * `records`. Every other record is removed. DNS-only (never proxied).
   */
  syncRecords(
    zoneId: string,
    host: string,
    edge: { ipv4: string; ipv6: string | null },
    records: DnsRecord[],
  ): Promise<void>;
  deleteZone(id: string): Promise<void>;
}

export interface RdapInfo {
  registered: boolean;
  expiresAt: Date | null;
  nameServers: string[];
  /** DNSSEC: a DS record is published (delegation would fail until it's removed) */
  signed: boolean;
}

/** registro.br's RDAP; null when it couldn't answer (or the host isn't under .br) */
export type Rdap = (host: string) => Promise<RdapInfo | null>;

export interface CnpjRecord {
  name: string;
  address: HolderAddress | null;
}

/** The CNPJ's public record (legal name and address), null when unknown or unreachable. */
export type CnpjLookup = (cnpj: string) => Promise<CnpjRecord | null>;

export interface DomainProviders {
  registrar: Registrar | null;
  dnsHost: DnsHost | null;
  rdap: Rdap;
  cnpj: CnpjLookup;
  /** the VPS's public addresses (A/AAAA in hosted zones) */
  edge: { ipv4: string; ipv6: string | null } | null;
  /** the provider name owners select at registro.br (conflict steps) */
  providerName: string | null;
  /** the TLS probe: true when `https://<host>` answers with a valid certificate */
  probeTls: (host: string) => Promise<boolean>;
}

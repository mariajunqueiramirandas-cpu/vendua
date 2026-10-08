// In-memory stand-ins for ADR 0038's outside services, for the domain lifecycle tests.
import {
  RegistrarError,
  type Availability,
  type CnpjRecord,
  type DnsHost,
  type DnsRecord,
  type DomainProviders,
  type HolderInput,
  type Rdap,
  type RdapInfo,
  type Registrar,
  type RegistrarDomain,
  type Zone,
} from '../src/modules/domains/providers.ts';

export interface Call {
  op: string;
  args: unknown[];
}

type FailKind = RegistrarError['kind'];
const YEAR_MS = 365 * 86_400_000;

export interface FakeDomain extends RegistrarDomain {
  host: string;
  holderHandle: string;
  nameServers: string[];
}

export interface FakeRegistrar extends Registrar {
  domains: Map<string, FakeDomain>;
  holders: Map<string, HolderInput>;
  parked: Map<string, { ipv4: string; ipv6: string | null }>;
  /** per-host answers for `check` (and `register`: available false → 'taken') */
  availability: Map<string, Availability>;
  /** register answers 'pending' until `complete(host)` */
  registerAsync: boolean;
  /** the next mutating call (or the next call to `op`) throws RegistrarError */
  failNext(kind: FailKind, message?: string, op?: MutatingOp): void;
  complete(host: string, o?: { status?: 'active' | 'failed'; expiresAt?: Date }): void;
  calls: Call[];
}

type MutatingOp = 'createHolder' | 'parkZone' | 'register' | 'renew' | 'setNameservers';

export function fakeRegistrar(): FakeRegistrar {
  const domains = new Map<string, FakeDomain>();
  const holders = new Map<string, HolderInput>();
  const parked = new Map<string, { ipv4: string; ipv6: string | null }>();
  const availability = new Map<string, Availability>();
  const failures: { kind: FailKind; message: string; op?: MutatingOp }[] = [];
  const calls: Call[] = [];
  let seq = 0;

  const view = (d: FakeDomain): RegistrarDomain => ({
    ref: d.ref,
    status: d.status,
    expiresAt: d.expiresAt,
  });
  const byRef = (ref: string) => {
    for (const d of domains.values()) if (d.ref === ref) return d;
    throw new RegistrarError(`domain ${ref} not found`, 'other');
  };
  const mutate = (op: MutatingOp, args: unknown[]) => {
    calls.push({ op, args });
    const i = failures.findIndex((f) => !f.op || f.op === op);
    if (i >= 0) {
      const [f] = failures.splice(i, 1);
      throw new RegistrarError(f!.message, f!.kind);
    }
  };

  const r: FakeRegistrar = {
    domains,
    holders,
    parked,
    availability,
    registerAsync: false,
    calls,
    failNext(kind, message = `fake ${kind}`, op) {
      failures.push({ kind, message, ...(op ? { op } : {}) });
    },
    complete(host, o = {}) {
      const d = domains.get(host);
      if (!d) throw new Error(`fakeRegistrar: no domain ${host}`);
      d.status = o.status ?? 'active';
      if (d.status === 'active') d.expiresAt = o.expiresAt ?? new Date(Date.now() + YEAR_MS);
    },

    async check(hosts) {
      calls.push({ op: 'check', args: [hosts] });
      const out = new Map<string, Availability>();
      for (const h of hosts) {
        const host = h.toLowerCase();
        out.set(
          host,
          availability.get(host) ??
            (domains.has(host)
              ? { available: false }
              : { available: true, price: { cents: 899, currency: 'EUR' } }),
        );
      }
      return out;
    },
    async find(host) {
      calls.push({ op: 'find', args: [host] });
      const d = domains.get(host);
      return d ? view(d) : null;
    },
    async createHolder(holder) {
      mutate('createHolder', [holder]);
      const handle = `VH${String(++seq).padStart(6, '0')}-BR`;
      holders.set(handle, holder);
      return handle;
    },
    async parkZone(host, ipv4, ipv6) {
      mutate('parkZone', [host, ipv4, ipv6]);
      parked.set(host, { ipv4, ipv6 });
    },
    async register({ host, holderHandle }) {
      mutate('register', [{ host, holderHandle }]);
      if (domains.has(host) || availability.get(host)?.available === false)
        throw new RegistrarError(`openprovider: domain ${host} already exists`, 'taken');
      const d: FakeDomain = {
        ref: String(100_000 + ++seq),
        host,
        holderHandle,
        status: r.registerAsync ? 'pending' : 'active',
        expiresAt: r.registerAsync ? null : new Date(Date.now() + YEAR_MS),
        nameServers: ['ns1.openprovider.nl', 'ns2.openprovider.be', 'ns3.openprovider.eu'],
      };
      domains.set(host, d);
      return view(d);
    },
    async get(ref) {
      calls.push({ op: 'get', args: [ref] });
      return view(byRef(ref));
    },
    async renew(ref, host) {
      mutate('renew', [ref, host]);
      const d = byRef(ref);
      d.expiresAt = new Date((d.expiresAt ?? new Date()).getTime() + YEAR_MS);
      return view(d);
    },
    async setNameservers(ref, host, nameServers) {
      mutate('setNameservers', [ref, host, nameServers]);
      byRef(ref).nameServers = [...nameServers];
    },
  };
  return r;
}

export interface FakeZone extends Zone {
  host: string;
  edge: { ipv4: string; ipv6: string | null } | null;
  /** the owner records of the last sync */
  records: DnsRecord[];
  syncedAt: Date | null;
}

export interface FakeDnsHost extends DnsHost {
  /** keyed by host */
  zones: Map<string, FakeZone>;
  /** Cloudflare's 'active': the nameservers point at the zone */
  activate(host: string): void;
  /** the next call (or the next call to `op`) throws */
  failNext(message?: string, op?: keyof DnsHost): void;
  calls: Call[];
}

export function fakeDnsHost(): FakeDnsHost {
  const zones = new Map<string, FakeZone>();
  const failures: { message: string; op?: keyof DnsHost }[] = [];
  const calls: Call[] = [];
  let seq = 0;

  const record = (op: keyof DnsHost, args: unknown[]) => {
    calls.push({ op, args });
    const i = failures.findIndex((f) => !f.op || f.op === op);
    if (i >= 0) throw new Error(failures.splice(i, 1)[0]!.message);
  };
  const byId = (id: string) => [...zones.values()].find((z) => z.id === id) ?? null;
  const view = (z: FakeZone): Zone => ({
    id: z.id,
    nameServers: [...z.nameServers],
    status: z.status,
  });

  return {
    zones,
    calls,
    activate(host) {
      const z = zones.get(host);
      if (!z) throw new Error(`fakeDnsHost: no zone ${host}`);
      z.status = 'active';
    },
    failNext(message = 'cloudflare: fake failure', op) {
      failures.push({ message, ...(op ? { op } : {}) });
    },
    async ensureZone(host) {
      record('ensureZone', [host]);
      let z = zones.get(host);
      if (!z) {
        z = {
          id: `zone${String(++seq).padStart(4, '0')}`,
          host,
          nameServers: ['ana.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
          status: 'pending',
          edge: null,
          records: [],
          syncedAt: null,
        };
        zones.set(host, z);
      }
      return view(z);
    },
    async findZone(host) {
      record('findZone', [host]);
      const z = zones.get(host);
      return z ? view(z) : null;
    },
    async zone(id) {
      record('zone', [id]);
      const z = byId(id);
      return z ? view(z) : null;
    },
    async syncRecords(zoneId, host, edge, records) {
      record('syncRecords', [zoneId, host, edge, records]);
      const z = byId(zoneId);
      if (!z) throw new Error('cloudflare: not found');
      z.edge = { ...edge };
      z.records = records.map((r) => ({ ...r }));
      z.syncedAt = new Date();
    },
    async deleteZone(id) {
      record('deleteZone', [id]);
      const z = byId(id);
      if (z) zones.delete(z.host);
    },
  };
}

export type FakeRdap = Rdap & { map: Map<string, RdapInfo | null>; calls: string[] };

/** Answers from `map`; a host not in it gets null (RDAP couldn't answer). */
export function fakeRdap(
  map: Map<string, RdapInfo | null> | Record<string, RdapInfo | null> = {},
): FakeRdap {
  const m = map instanceof Map ? map : new Map(Object.entries(map));
  const calls: string[] = [];
  const fn = (async (host: string) => {
    calls.push(host);
    return m.get(host) ?? null;
  }) as FakeRdap;
  fn.map = m;
  fn.calls = calls;
  return fn;
}

export function fakeProviders(overrides: Partial<DomainProviders> = {}): DomainProviders {
  return {
    registrar: fakeRegistrar(),
    dnsHost: fakeDnsHost(),
    rdap: fakeRdap(),
    cnpj: (): Promise<CnpjRecord | null> => Promise.resolve(null),
    edge: { ipv4: '203.0.113.10', ipv6: null },
    providerName: 'Openprovider',
    probeTls: () => Promise.resolve(true),
    ...overrides,
  };
}

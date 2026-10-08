import { HttpError } from '../../platform/http.ts';
import { dnsResolver, settle } from '../billing/domains.ts';
import type { DnsRecord, DnsRecordType } from './providers.ts';

// The owner's own records in a zone Venduá hosts (mail, verifications, subdomains). '@' and
// 'www' address records are Venduá's: the zone always points them at the edge.

export const MAX_RECORDS = 50;
const TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'];
const LABEL = /^(\*|_?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)$/;
// targets may have underscore labels (Microsoft 365 DKIM: selector1-x._domainkey.x.onmicrosoft.com)
const HOSTNAME = /^_?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\._?[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\.?$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]{2,39}$/;

const bad = (i: number, why: string) =>
  new HttpError(422, 'INVALID_RECORD', why, { field: `records.${i}` });

function validName(name: string) {
  return name === '@' || (name.length <= 200 && name.split('.').every((l) => LABEL.test(l)));
}

/** The records an owner sent, checked and normalized; 422 names the first bad one. */
export function parseRecords(raw: unknown): DnsRecord[] {
  if (!Array.isArray(raw)) throw new HttpError(422, 'INVALID_RECORD', 'records must be a list');
  if (raw.length > MAX_RECORDS)
    throw new HttpError(422, 'TOO_MANY_RECORDS', `at most ${MAX_RECORDS} records`);
  const out: DnsRecord[] = [];
  raw.forEach((r: unknown, i) => {
    const x = (r ?? {}) as Record<string, unknown>;
    const type = typeof x.type === 'string' ? (x.type.toUpperCase() as DnsRecordType) : null;
    if (!type || !TYPES.includes(type)) throw bad(i, 'type must be A, AAAA, CNAME, MX or TXT');
    const name =
      typeof x.name === 'string' ? x.name.trim().toLowerCase().replace(/\.$/, '') || '@' : '@';
    if (!validName(name)) throw bad(i, 'name must be @ or a name like mail or _dmarc');
    if ((name === '@' || name === 'www') && type !== 'MX' && type !== 'TXT')
      throw bad(i, '@ and www point at the store; they are set by Venduá');
    if (name === '@' && type === 'CNAME') throw bad(i, 'the root cannot be a CNAME');
    const value = typeof x.value === 'string' ? x.value.trim() : '';
    if (!value || value.length > 2048) throw bad(i, 'value is required (up to 2048 characters)');
    const lower = value.toLowerCase();
    if (type === 'A' && !IPV4.test(value)) throw bad(i, 'an A record takes an IPv4 address');
    if (type === 'AAAA' && (!IPV6.test(lower) || !lower.includes(':')))
      throw bad(i, 'an AAAA record takes an IPv6 address');
    if ((type === 'CNAME' || type === 'MX') && !HOSTNAME.test(lower))
      throw bad(i, 'this record points at a host name');
    const rec: DnsRecord = {
      type,
      name,
      value: type === 'TXT' ? value : lower.replace(/\.$/, ''),
    };
    if (type === 'MX') {
      const p = Number(x.priority ?? 10);
      if (!Number.isInteger(p) || p < 0 || p > 65535) throw bad(i, 'MX priority is 0 to 65535');
      rec.priority = p;
    }
    if (
      !out.some(
        (o) =>
          o.type === rec.type &&
          o.name === rec.name &&
          o.value === rec.value &&
          o.priority === rec.priority,
      )
    )
      out.push(rec);
  });
  // the column holds 64 KB of jsonb text, which spaces out what JSON.stringify packs
  if (JSON.stringify(out).length > 56 * 1024)
    throw new HttpError(422, 'TOO_MANY_RECORDS', 'the records are too long altogether');
  return out;
}

// DKIM selectors of the mail providers Brazilian stores use (Google, Microsoft 365, Zoho,
// Hostinger, Locaweb, KingHost, Mailchimp…); a lookup can't list a zone, so these are guesses.
const DKIM = [
  'google',
  'selector1',
  'selector2',
  'zmail',
  'zoho',
  'default',
  'dkim',
  'mail',
  'k1',
  'k2',
  's1',
  's2',
  'hostingermail1',
  'hostingermail2',
  'hostingermail3',
  'locaweb',
  'kinghost',
];
const NAMES = [
  'mail',
  'webmail',
  'smtp',
  'imap',
  'pop',
  'autodiscover',
  'autoconfig',
  'ftp',
  'cpanel',
  'blog',
  'loja',
  'app',
  'api',
  'm',
  'em',
];

/** What Core can find on the domain's current DNS, to copy into the zone it will host. */
export async function discoverRecords(host: string): Promise<DnsRecord[]> {
  const r = dnsResolver();
  const out: DnsRecord[] = [];
  const add = (rec: DnsRecord) => {
    if (out.length < MAX_RECORDS) out.push(rec);
  };
  const txt = async (name: string, rel: string) => {
    for (const chunks of await settle(r.resolveTxt(name), [] as string[][]))
      add({ type: 'TXT', name: rel, value: chunks.join('') });
  };
  const address = async (name: string, rel: string) => {
    const cname = await settle(r.resolveCname(name), [] as string[]);
    if (cname[0]) return add({ type: 'CNAME', name: rel, value: cname[0].toLowerCase() });
    for (const a of await settle(r.resolve4(name), [] as string[]))
      add({ type: 'A', name: rel, value: a });
    if (r.resolve6)
      for (const a of await settle(r.resolve6(name), [] as string[]))
        add({ type: 'AAAA', name: rel, value: a.toLowerCase() });
  };
  if (r.resolveMx)
    for (const mx of await settle(r.resolveMx(host), []))
      add({ type: 'MX', name: '@', value: mx.exchange.toLowerCase(), priority: mx.priority });
  // root TXT, except the old verification token: Venduá's zone doesn't need it
  for (const chunks of await settle(r.resolveTxt(host), [] as string[][])) {
    const value = chunks.join('');
    if (!value.startsWith('vendua-verify=')) add({ type: 'TXT', name: '@', value });
  }
  await txt(`_dmarc.${host}`, '_dmarc');
  await Promise.all(
    DKIM.map(async (sel) => {
      const name = `${sel}._domainkey`;
      const cname = await settle(r.resolveCname(`${name}.${host}`), [] as string[]);
      if (cname[0]) add({ type: 'CNAME', name, value: cname[0].toLowerCase() });
      else await txt(`${name}.${host}`, name);
    }),
  );
  await Promise.all(NAMES.map((n) => address(`${n}.${host}`, n)));
  return parseRecords(out.slice(0, MAX_RECORDS));
}

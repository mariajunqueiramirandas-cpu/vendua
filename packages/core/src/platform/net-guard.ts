// Addresses a request we make must never reach: the agent's map pointers and the menu import's
// one GET to a merchant's own host both check every resolved address here before connecting.

/** inet_aton semantics — 1–4 parts, decimal/octal/hex; catches every notation
 *  smuggled past string-prefix checks (0177.0.0.1, 0x7f…1, 2130706433) */
export function ipv4ToU32(host: string): number | null {
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums = parts.map((p) =>
    /^0x[0-9a-f]+$/i.test(p)
      ? parseInt(p, 16)
      : /^0[0-7]+$/.test(p)
        ? parseInt(p, 8)
        : /^[0-9]+$/.test(p)
          ? parseInt(p, 10)
          : NaN,
  );
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const last = nums[nums.length - 1]!;
  const lastBytes = 5 - nums.length; // bytes the last part must hold
  if (nums.slice(0, -1).some((n) => n > 255) || last >= 256 ** lastBytes) return null;
  let ip = 0;
  for (const n of nums.slice(0, -1)) ip = ip * 256 + n;
  return ip * 256 ** lastBytes + last;
}

/** Private/reserved IPv4 ranges — the targets a fetched URL must never
 *  name. */
export function isPrivateV4(ip: number): boolean {
  const top = (bits: number) => ip >>> (32 - bits);
  return (
    top(8) === 0 || // 0.0.0.0/8 "this host"
    top(24) === 0xc00000 || // 192.0.0/24 protocol assignments
    top(8) === 10 ||
    top(8) === 127 ||
    top(12) === 0xac1 || // 172.16/12
    top(16) === 0xa9fe || // 169.254/16 link-local (incl. 169.254.169.254)
    top(16) === 0xc0a8 || // 192.168/16
    top(10) === 0x191 || // 100.64/10 CGNAT
    top(15) === 0x6309 || // 198.18/15 benchmarking
    top(4) >= 0xe // 224/4 multicast + 240/4 reserved
  );
}

function isPrivateV6(host: string): boolean {
  // ::/::1 (unspecified/loopback), fc00::/7 unique-local, fe80::/10 link-local, ff00::/8
  // multicast, and any ::ffff:-mapped or dotted-quad tail whose v4 part is private
  const [first, second] = host.split(':');
  const head = parseInt(first || '0', 16);
  const v4Tail = /([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$/.exec(host)?.[1];
  return (
    host === '::' ||
    host === '::1' ||
    host.startsWith('::ffff:') ||
    // translation prefixes carry a v4 address the network may route inside: NAT64
    // (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16), Teredo (2001:0::/32)
    (head === 0x64 && parseInt(second || '0', 16) === 0xff9b) ||
    head === 0x2002 ||
    (head === 0x2001 && parseInt(second || '0', 16) === 0) ||
    (head & 0xfe00) === 0xfc00 ||
    (head & 0xffc0) === 0xfe80 ||
    (head & 0xff00) === 0xff00 ||
    (v4Tail !== undefined && isPrivateV4(ipv4ToU32(v4Tail) ?? 0))
  );
}

/** "0:0:0:0:0:ffff:a00:1" → "::ffff:a00:1": the shapes above, whatever the spelling */
function canonicalV6(host: string): string | null {
  try {
    return new URL(`http://[${host}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
}

/** a hostname or IP literal (v4 in any inet_aton notation, v6 bracket-free) that names
 *  a loopback/private/link-local/CGNAT/ULA/mapped/reserved target */
export function isPrivateHost(rawHost: string): boolean {
  const host = rawHost
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  if (host.includes(':')) {
    const canonical = canonicalV6(host);
    return isPrivateV6(host) || canonical === null || isPrivateV6(canonical);
  }
  const ip = ipv4ToU32(host);
  return ip !== null && isPrivateV4(ip);
}

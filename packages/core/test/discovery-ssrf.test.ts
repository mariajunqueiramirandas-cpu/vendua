import { afterEach, describe, expect, test } from 'bun:test';
import {
  assertFetchableResolved,
  isMapPointer,
  mapPointerName,
  resolveMapPointer,
  setDnsLookupForTest,
} from '../src/agent/channels/discovery.ts';

// M6: map pointers are fetched in-process — host checks are exact, and every hop's
// resolved addresses are checked, not just the hostname string.
const realFetch = globalThis.fetch;
afterEach(() => {
  setDnsLookupForTest(null);
  globalThis.fetch = realFetch;
});

describe('map url host allow-list', () => {
  test('real google map hosts only', () => {
    for (const u of [
      'https://maps.google.com/?cid=1',
      'https://maps.google.com.br/maps?q=x',
      'https://www.google.com/maps/place/Acme',
      'https://google.com.br/maps/place/Acme',
      'https://maps.app.goo.gl/abc',
      'https://g.co/kgs/abc',
    ]) {
      expect(isMapPointer(u)).toBe(true);
    }
    for (const u of [
      'https://maps.google.evil.com/x',
      'https://maps.google.com.evil.io/x',
      'https://google.evil.co/maps/x',
      'https://www.google.attacker.com/maps',
      'https://g.co/other',
      'https://maps.app.goo.gl.evil.com/abc',
    ]) {
      expect(isMapPointer(u)).toBe(false);
    }
  });

  test('a continue= carrier on a look-alike google host is not a name source', () => {
    expect(mapPointerName('https://www.google.com/search?q=Acme')).toBe('Acme');
    expect(mapPointerName('https://google.evil.co/search?q=Acme')).toBeNull();
    expect(
      mapPointerName(
        `https://www.google.com/sorry/?continue=${encodeURIComponent('https://google.evil.co/search?q=Acme')}`,
      ),
    ).toBeNull();
  });
});

describe('assertFetchableResolved', () => {
  test('rejects names that resolve to private, loopback, link-local, CGNAT, ULA or mapped', async () => {
    for (const addr of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '100.64.0.1',
      '100.127.255.1',
      '198.19.0.1',
      '192.168.0.10',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      // translation prefixes that can route to an inside v4 address, and 192.0.0/24
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1::a00:1',
      '2002:a00:1::1',
      '2001:0:4136:e378::1',
      '192.0.0.170',
    ]) {
      setDnsLookupForTest(async () => ['93.184.216.34', addr]);
      await expect(assertFetchableResolved('https://innocent.example/x')).rejects.toThrow(
        /private\/internal/,
      );
    }
  });

  test('passes public answers; a failed lookup is refused', async () => {
    setDnsLookupForTest(async () => ['93.184.216.34', '2606:2800:220:1::1']);
    expect((await assertFetchableResolved('https://ok.example/x')).hostname).toBe('ok.example');
    setDnsLookupForTest(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(assertFetchableResolved('https://nx.example/x')).rejects.toThrow(/dns/);
    // literals are still judged without a lookup
    await expect(assertFetchableResolved('http://2130706433/')).rejects.toThrow(/private/);
  });

  test('resolveMapPointer never fetches a hop whose name resolves inside', async () => {
    setDnsLookupForTest(async () => ['127.0.0.1']);
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'https://x.test' } });
    }) as unknown as typeof fetch;
    expect(await resolveMapPointer('https://maps.app.goo.gl/abc')).toBeNull();
    expect(calls).toBe(0);
  });
});

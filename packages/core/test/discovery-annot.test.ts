import { describe, expect, test } from 'bun:test';
import {
  annotateResult,
  annotateResults,
  contactFromUrl,
  contactsFromLinks,
  navLinks,
  pageKey,
} from '../src/agent/channels/discovery.ts';
import type { DiscoveryResult } from '../src/agent/channels/discovery.ts';

const r = (url: string, title = 'x', snippet = ''): DiscoveryResult['results'][number] => ({
  title,
  url,
  snippet,
});
const cfu = (url: string) => contactFromUrl(new URL(url));

describe('pageKey', () => {
  test('identity ignores www, scheme and trailing slash', () => {
    expect(pageKey('https://www.doceria.com.br/contato/')).toBe('doceria.com.br/contato');
    expect(pageKey('http://doceria.com.br/contato')).toBe('doceria.com.br/contato');
    expect(pageKey('https://doceria.com.br/contato')).toBe('doceria.com.br/contato');
  });
  test('null on unparseable url', () => {
    expect(pageKey('not a url')).toBeNull();
  });
  test('content params stay in the key — different phones are different pages', () => {
    expect(pageKey('https://api.whatsapp.com/send?phone=5511111111111')).not.toBe(
      pageKey('https://api.whatsapp.com/send?phone=5522222222222'),
    );
  });
  test('tracking params are stripped, order is canonical', () => {
    expect(pageKey('https://site.com.br/x?b=2&utm_source=gp&a=1')).toBe('site.com.br/x?a=1&b=2');
    expect(pageKey('https://site.com.br/x?a=1&b=2&fbclid=zzz')).toBe(
      pageKey('https://site.com.br/x?b=2&a=1'),
    );
  });
});

describe('contactFromUrl', () => {
  test('wa.me digits → +phone', () => {
    expect(cfu('https://wa.me/5585999887766')).toEqual({ phone: '+5585999887766' });
  });
  test('api.whatsapp.com ?phone= param', () => {
    expect(cfu('https://api.whatsapp.com/send?phone=558512345678')).toEqual({
      phone: '+558512345678',
    });
  });
  test('too-short digits are not a phone', () => {
    expect(cfu('https://wa.me/1234')).toEqual({});
  });
  test('instagram single-segment → @handle', () => {
    expect(cfu('https://instagram.com/brigaderia85')).toEqual({
      instagram: '@brigaderia85',
    });
    expect(cfu('https://www.instagram.com/doceria.mar/')).toEqual({
      instagram: '@doceria.mar',
    });
  });
  test('instagram utility paths are not handles', () => {
    for (const u of ['p', 'reel', 'reels', 'explore', 'accounts', 'stories']) {
      expect(cfu(`https://instagram.com/${u}/xyz`)).toEqual({});
    }
  });
  test('unrelated urls return nothing', () => {
    expect(cfu('https://doceria.com.br')).toEqual({});
  });
});

describe('annotateResult', () => {
  test('wa.me result → kind contact with phone', () => {
    const a = annotateResult(r('https://wa.me/5585999887766', 'Brigaderia'));
    expect(a.kind).toBe('contact');
    expect(a.phone).toBe('+5585999887766');
  });
  test('instagram profile → kind profile with handle', () => {
    const a = annotateResult(r('https://instagram.com/doceria85'));
    expect(a.kind).toBe('profile');
    expect(a.instagram).toBe('@doceria85');
  });
  test('listing host → kind listing', () => {
    expect(annotateResult(r('https://www.ifood.com.br/x')).kind).toBe('listing');
    expect(annotateResult(r('https://tripadvisor.com.br/resto')).kind).toBe('listing');
  });
  test('own site → kind site', () => {
    expect(annotateResult(r('https://doceria85.com.br/contato')).kind).toBe('site');
  });
  test('snippet truncated to 160', () => {
    const a = annotateResult(r('https://x.com.br', 'x', 'y'.repeat(400)));
    expect(a.snippet!.length).toBe(160);
  });
});

describe('contactsFromLinks', () => {
  test('whatsapp deep links → phone + whatsappLinks', () => {
    const c = contactsFromLinks([
      'https://wa.me/5585999887766',
      'https://api.whatsapp.com/send?phone=5521999966823&text=oi',
    ]);
    expect(c.phones).toEqual(['+5585999887766', '+5521999966823']);
    expect(c.whatsappLinks.length).toBe(2);
  });
  test('mailto: + tel: decode to emails/phones', () => {
    const c = contactsFromLinks(['mailto:contato@doceria.com.br', 'tel:+558532223344']);
    expect(c.emails).toEqual(['contato@doceria.com.br']);
    expect(c.phones).toEqual(['+558532223344']);
  });
  test('tel: without + is a BR-local number — normalized to +55, not +<digits>', () => {
    const c = contactsFromLinks(['tel:(85) 3222-3344', 'tel:85999887766', 'tel:0800']);
    // DDD+number → +55…; a fragment (<8 digits) is dropped entirely.
    expect(c.phones).toEqual(['+558532223344', '+5585999887766']);
  });
  test('social roots → handles; utility paths ignored', () => {
    const c = contactsFromLinks([
      'https://instagram.com/doceria.aurora',
      'https://www.instagram.com/p/abc123/',
      'https://facebook.com/atelledocelar',
      'https://facebook.com/sharer/sharer.php?u=x',
      'https://tiktok.com/@doceria.aurora',
      'https://tiktok.com/discover',
    ]);
    expect(c.instagram).toEqual(['@doceria.aurora']);
    expect(c.facebook).toEqual(['facebook.com/atelledocelar']);
    expect(c.tiktok).toEqual(['@doceria.aurora']);
  });
  test('dedupes repeated channels, skips junk', () => {
    const c = contactsFromLinks([
      'https://wa.me/5585999887766?text=a',
      'https://wa.me/5585999887766',
      'not a url',
      'https://doceria.com.br/menu',
    ]);
    expect(c.phones).toEqual(['+5585999887766']);
    expect(c.whatsappLinks.length).toBe(2);
  });
});

describe('navLinks', () => {
  test('same-host contact-ish paths surface, capped and deduped', () => {
    const nav = navLinks(
      [
        'https://doceria.com.br/contato',
        'https://doceria.com.br/contato/',
        'https://doceria.com.br/cardapio',
        'https://doceria.com.br/blog/bolo-de-pote',
        'https://instagram.com/doceria',
        'https://doceria.com.br/sobre-nos',
      ],
      'https://doceria.com.br/',
    );
    expect(nav).toContain('https://doceria.com.br/contato');
    expect(nav).toContain('https://doceria.com.br/cardapio');
    expect(nav).toContain('https://doceria.com.br/sobre-nos');
    expect(nav.length).toBe(3);
  });
  test('other hosts and unparseable urls are skipped', () => {
    expect(navLinks(['https://outro.com.br/contato', 'junk'], 'https://a.com.br/')).toEqual([]);
    expect(navLinks([], 'not a url')).toEqual([]);
  });
});

describe('annotateResults', () => {
  test('dedupes by pageKey and counts dropped', () => {
    const { results, droppedDupes } = annotateResults([
      r('https://doceria.com.br/contato'),
      r('https://www.doceria.com.br/contato/'),
      r('https://outro.com.br'),
    ]);
    expect(results.length).toBe(2);
    expect(droppedDupes).toBe(1);
  });
  test('orders contact > site > profile > listing without filtering anything', () => {
    const { results, droppedDupes } = annotateResults([
      r('https://ifood.com.br/list', 'listing'),
      r('https://instagram.com/doce', 'profile'),
      r('https://site.com.br', 'site'),
      r('https://wa.me/5585999887766', 'contact'),
    ]);
    expect(droppedDupes).toBe(0);
    expect(results.map((x) => x.kind)).toEqual(['contact', 'site', 'profile', 'listing']);
  });
  test('nothing is ever hidden — junk stays in, only ordered last', () => {
    const { results } = annotateResults([r('https://www.youtube.com/watch?v=x')]);
    expect(results.length).toBe(1);
    expect(results[0]!.kind).toBe('listing');
  });
});

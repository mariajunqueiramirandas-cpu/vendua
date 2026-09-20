import { describe, expect, test } from 'bun:test';
import {
  annotateResult,
  annotateResults,
  contactFromUrl,
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

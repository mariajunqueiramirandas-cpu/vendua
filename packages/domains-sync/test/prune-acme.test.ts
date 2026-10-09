import { describe, expect, test } from 'bun:test';
import { pruneAcme } from '../src/prune-acme.ts';

const cert = (main: string, sans: string[] = []) => ({
  domain: { main, sans },
  certificate: 'CERT',
  key: 'KEY',
  Store: 'default',
});

const OPTS = {
  storeDomain: 'vendua.com.br',
  deny: ['painel.vendua.com.br', ' crm.vendua.com.br '],
  keepResolvers: ['cloudflare'],
};

describe('pruneAcme', () => {
  test('drops per-store certificates and keeps everything else untouched', () => {
    const acme = {
      letsencrypt: {
        Account: { Email: 'x' },
        Certificates: [
          cert('pudim.vendua.com.br'),
          cert('bolo.vendua.com.br', ['doce.vendua.com.br']),
          cert('painel.vendua.com.br'),
          cert('crm.vendua.com.br'),
          cert('vendua.com.br'),
          cert('a.b.vendua.com.br'),
          cert('loja.com.br', ['www.loja.com.br']),
          cert('pudim.vendua.com.br', ['loja.com.br']),
        ],
      },
      cloudflare: {
        Account: null,
        Certificates: [cert('vendua.com.br', ['*.vendua.com.br']), cert('x.vendua.com.br')],
      },
    };
    const { next, removed } = pruneAcme(acme, OPTS);
    expect(removed).toEqual([
      'letsencrypt: pudim.vendua.com.br',
      'letsencrypt: bolo.vendua.com.br, doce.vendua.com.br',
    ]);
    expect(next.letsencrypt!.Account).toEqual({ Email: 'x' });
    expect(next.letsencrypt!.Certificates!.map((c) => c.domain!.main)).toEqual([
      'painel.vendua.com.br',
      'crm.vendua.com.br',
      'vendua.com.br',
      'a.b.vendua.com.br',
      'loja.com.br',
      'pudim.vendua.com.br',
    ]);
    expect(next.cloudflare).toBe(acme.cloudflare);
    expect(acme.letsencrypt.Certificates.length).toBe(8);
  });

  test('empty and null resolvers pass through', () => {
    const acme = { letsencrypt: { Account: null, Certificates: null }, other: null };
    expect(pruneAcme(acme, OPTS)).toEqual({ next: acme, removed: [] });
  });
});

import { describe, expect, test } from 'bun:test';
import { renderReplyEmail } from '../src/agent/channels/email-template.ts';

describe('renderReplyEmail', () => {
  test('escapes html in the body', () => {
    const html = renderReplyEmail({ body: 'a <script>alert(1)</script> b' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('blank lines become paragraphs, single newlines become <br>', () => {
    const html = renderReplyEmail({ body: 'p1a\np1b\n\np2' });
    expect(html).toContain('p1a<br>p1b');
    expect(html).toContain('>p2</p>');
  });

  test('subject shows as a Re: eyebrow and is escaped', () => {
    const html = renderReplyEmail({ body: 'oi', subject: 'Pedido <x>' });
    expect(html).toContain('Re: Pedido &lt;x&gt;');
    expect(html).not.toContain('Pedido <x>');
  });

  test('carries the brand markers', () => {
    const html = renderReplyEmail({ body: 'oi' });
    for (const marker of ['vendu&aacute;', '#123c32', '#d9f875', '#f7f4ea'])
      expect(html).toContain(marker);
  });

  test('footer mailbox follows the effective from', () => {
    const html = renderReplyEmail({ body: 'oi', from: 'Venduá <oi@vendua.shop>' });
    expect(html).toContain('mailto:oi@vendua.shop');
    expect(html).toContain('>oi@vendua.shop</a>');
    expect(html).not.toContain('agente@auto.vendua.com.br');
  });

  test('no from → generic reply line, no mailbox link', () => {
    const html = renderReplyEmail({ body: 'oi' });
    expect(html).toContain('Responda a este e-mail');
    expect(html).not.toContain('mailto:');
  });

  test('empty-ish body renders without stray paragraphs', () => {
    const html = renderReplyEmail({ body: ' \n\n ' });
    expect(html).not.toContain('margin:0 0 18px');
  });
});

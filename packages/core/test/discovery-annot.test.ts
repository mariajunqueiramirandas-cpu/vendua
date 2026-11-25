import { describe, expect, test } from 'bun:test';
import {
  annotateResult,
  annotateResults,
  chaseLinks,
  contactFromUrl,
  isBrMobilePhone,
  isProfileHubUrl,
  isShortenerUrl,
  contactsFromLinks,
  contactsFromText,
  navLinks,
  outboundLinks,
  pageKey,
  phoneFromText,
} from '../src/crm/channels/discovery.ts';
import type { DiscoveryResult } from '../src/crm/channels/discovery.ts';

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
  test('hl/igsh locale+share params dedupe the same profile read', () => {
    expect(pageKey('https://www.instagram.com/ondadotrigo/?hl=pt')).toBe(
      pageKey('https://instagram.com/ondadotrigo'),
    );
  });
});

describe('contactFromUrl', () => {
  test('wa.me digits → +phone + whatsappLink', () => {
    expect(cfu('https://wa.me/5585999887766')).toEqual({
      phone: '+5585999887766',
      whatsappLink: 'https://wa.me/5585999887766',
    });
  });
  test('api.whatsapp.com ?phone= param', () => {
    expect(cfu('https://api.whatsapp.com/send?phone=558512345678')).toEqual({
      phone: '+558512345678',
      whatsappLink: 'https://api.whatsapp.com/send?phone=558512345678',
    });
  });
  test('wa.me/message + wa.me/c are whatsapp channels without digits', () => {
    const msg = cfu('https://wa.me/message/2HDCP7FOAFBXB1');
    expect(msg.phone).toBeUndefined();
    expect(msg.whatsappLink).toBe('https://wa.me/message/2HDCP7FOAFBXB1');
    const cat = cfu('https://wa.me/c/5522992086005');
    expect(cat.whatsappLink).toBe('https://wa.me/c/5522992086005');
    expect(cat.phone).toBe('+5522992086005');
  });
  test('opaque wa.me codes never become phones', () => {
    // a /message/ code with an all-digit body is still not a number
    const m = cfu('https://wa.me/message/1234567890AB');
    expect(m.phone).toBeUndefined();
    expect(m.whatsappLink).toBe('https://wa.me/message/1234567890AB');
    const m2 = cfu('https://wa.me/message/12345678901');
    expect(m2.phone).toBeUndefined();
  });
  test('wa.me/p/<item>/<phone> — number is the last segment', () => {
    const p = cfu('https://wa.me/p/1149164198755526/5516999999999');
    expect(p.phone).toBe('+5516999999999');
    expect(p.whatsappLink).toBe('https://wa.me/p/1149164198755526/5516999999999');
  });
  test('query digits never leak into the phone', () => {
    const c = cfu('https://wa.me/5511999999999?text=pedido%202026%20por%20favor');
    expect(c.phone).toBe('+5511999999999');
    const s = cfu('https://api.whatsapp.com/send?phone=558512345678&text=pedido%202026');
    expect(s.phone).toBe('+558512345678');
    // a non-numeric phone param is a share link, not a destination
    const bare = cfu('https://api.whatsapp.com/send?text=oi');
    expect(bare.phone).toBeUndefined();
    expect(bare.whatsappLink).toBeUndefined();
    // E.164's leading + on the phone param is the same number
    const plus = cfu('https://api.whatsapp.com/send?phone=%2B558512345678');
    expect(plus.phone).toBe('+558512345678');
    expect(plus.whatsappLink).toBeDefined();
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
    // mobile subdomain — same profile parser
    expect(cfu('https://m.instagram.com/doceria85')).toEqual({
      instagram: '@doceria85',
    });
  });
  test('non-profile instagram subdomains are not handles', () => {
    expect(cfu('https://about.instagram.com/about-us')).toEqual({});
    expect(cfu('https://l.instagram.com/x')).toEqual({});
  });
  test('instagram utility paths are not handles', () => {
    for (const u of ['p', 'reel', 'reels', 'explore', 'accounts', 'stories']) {
      expect(cfu(`https://instagram.com/${u}/xyz`)).toEqual({});
    }
  });
  test('unrelated urls return nothing', () => {
    expect(cfu('https://doceria.com.br')).toEqual({});
  });
  test('web.whatsapp.com/send?phone parses like api.whatsapp.com', () => {
    expect(cfu('https://web.whatsapp.com/send?phone=5521999887766')).toEqual({
      phone: '+5521999887766',
      whatsappLink: 'https://web.whatsapp.com/send?phone=5521999887766',
    });
  });
  test('chat.whatsapp.com invite is a whatsapp channel without a number', () => {
    expect(cfu('https://chat.whatsapp.com/EqxAmP12H4dLqVbCdEfGhI')).toEqual({
      whatsappLink: 'https://chat.whatsapp.com/EqxAmP12H4dLqVbCdEfGhI',
    });
    expect(cfu('https://chat.whatsapp.com/xx')).toEqual({});
  });
  test('wa.me/qr/<code> is a channel, never a phone', () => {
    expect(cfu('https://wa.me/qr/7AVRCDFJIO2KL1')).toEqual({
      whatsappLink: 'https://wa.me/qr/7AVRCDFJIO2KL1',
    });
    const digits = cfu('https://wa.me/qr/5522999998888');
    expect(digits.phone).toBeUndefined();
    expect(digits.whatsappLink).toBeDefined();
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
  test('ordering-platform subdomains → listing (js-shell pages)', () => {
    expect(annotateResult(r('https://pedido.anota.ai/loja/doce')).kind).toBe('listing');
    expect(annotateResult(r('https://instadelivery.com.br/x')).kind).toBe('listing');
    expect(annotateResult(r('https://delicias.goomer.app/')).kind).toBe('listing');
  });
  test('snippet carrying a phone/email is parsed for free', () => {
    const a = annotateResult(
      r(
        'https://doceria.com.br',
        'Doceria',
        'Encomendas: (22) 99712-3470 ou contato@doceria.com.br',
      ),
    );
    expect(a.phone).toBe('+5522997123470');
    expect(a.email).toBe('contato@doceria.com.br');
    expect(a.kind).toBe('contact');
  });
  test('snippet email fills even when the URL already carried a phone', () => {
    const a = annotateResult(
      r('https://wa.me/5585999887766', 'x', 'ou escreva para vendas@doceria.com.br'),
    );
    expect(a.phone).toBe('+5585999887766');
    expect(a.email).toBe('vendas@doceria.com.br');
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
  test('social redirect wrappers unwrap to the real destination', () => {
    const c = contactsFromLinks([
      'https://l.instagram.com/?u=' + encodeURIComponent('https://wa.me/5522992086005') + '&e=ABC',
      'https://l.facebook.com/l.php?u=' + encodeURIComponent('https://linktr.ee/doceria'),
    ]);
    expect(c.phones).toEqual(['+5522992086005']);
    expect(c.whatsappLinks).toEqual(['https://wa.me/5522992086005']);
  });
});

describe('contactsFromText', () => {
  test('wa.me urls written as prose text carry the phone', () => {
    const c = contactsFromText(
      'Peça pelo nosso whats wa.me/c/5522992086005 ou wa.me/5521998877665',
    );
    expect(c.phones).toEqual(['+5522992086005', '+5521998877665']);
    expect(c.whatsappLinks.length).toBe(2);
  });
  test('formatted BR phones in text → +55 numbers; cnpj/dates stay out', () => {
    const c = contactsFromText(
      'Loja na Rua Pereira nº 615 — WhatsApp (22) 9 9712-3470. CNPJ 50.182.263/0001-37. Aberto 13:30 às 19:30.',
    );
    expect(c.phones).toEqual(['+5522997123470']);
  });
  test('explicit + numbers keep their country code — no glued +55', () => {
    expect(phoneFromText('+1 (415) 555-2671')).toBe('+14155552671');
    expect(phoneFromText('+55 22 99712-3470')).toBe('+5522997123470');
    expect(phoneFromText('+0800')).toBeNull();
    expect(phoneFromText('+01234567')).toBeNull();
  });
  test('emails parsed, image-asset lookalikes excluded', () => {
    const c = contactsFromText('fale conosco: vendas@doceria.com.br — logo@2x.png hero@3x.webp');
    expect(c.emails).toEqual(['vendas@doceria.com.br']);
  });
  test('link-in-bio hubs in text surface for the follow-up read', () => {
    const c = contactsFromText('Encomendas e cardápio: linktr.ee/deliciasdamahh');
    expect(c.hubs).toEqual(['https://linktr.ee/deliciasdamahh']);
  });
  test('shorteners in text are hubs too — the fetch follows the redirect', () => {
    const c = contactsFromText('peça pelo bit.ly/jodoces ou w.app/jodoces');
    expect(c.hubs).toEqual(['https://bit.ly/jodoces', 'https://w.app/jodoces']);
  });
  test('bare 9xxxx-xxxx mobile is a phoneHint, not a phone', () => {
    const c = contactsFromText('📲 pedidos no zap 99912-3456 ou 9 8812-0011');
    expect(c.phones).toEqual([]);
    expect(c.phoneHints).toEqual(['99912-3456', '9 8812-0011']);
  });
  test('hint never duplicates a full number already captured', () => {
    const c = contactsFromText('WhatsApp (22) 99968-8525 e fixo 3344-1122');
    expect(c.phones).toEqual(['+5522999688525']);
    expect(c.phoneHints).toEqual([]);
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
  test('link-in-bio hubs surface cross-host, wrapped or bare', () => {
    const nav = navLinks(
      [
        'https://l.instagram.com/?u=' + encodeURIComponent('https://linktr.ee/doceria85'),
        'https://instagram.com/doceria85',
      ],
      'https://instagram.com/doceria85',
    );
    expect(nav).toContain('https://linktr.ee/doceria85');
  });
  test('hub subdomains count — carrd.co sites are <name>.carrd.co', () => {
    const nav = navLinks(['https://doceria85.carrd.co/'], 'https://instagram.com/doceria85');
    expect(nav).toContain('https://doceria85.carrd.co');
  });
  test('on a hub page, nav points OUT — same-host platform chrome is dropped', () => {
    const nav = navLinks(
      [
        'https://linktr.ee/s/about',
        'https://linktr.ee/features/contact-forms',
        'https://wa.me/message/ABC123',
        'https://ifood.com.br/doceria85',
        'https://doceria85.com.br/contato',
      ],
      'https://linktr.ee/doceria85',
    );
    expect(nav).toEqual(['https://doceria85.com.br/contato']);
  });
  test('on a hub page a shortener link is the OUTBOUND contact, not chrome', () => {
    const nav = navLinks(
      ['https://w.app/doceria85', 'https://linktr.ee/features/x'],
      'https://linktr.ee/doceria85',
    );
    expect(nav).toContain('https://w.app/doceria85');
  });
  test('google-business/maps pointers surface cross-host from any page', () => {
    const nav = navLinks(
      [
        'https://g.co/kgs/xm7tgsx',
        'https://maps.app.goo.gl/AbC123',
        'https://www.google.com/maps/place/Doceria',
        'https://instagram.com/doceria85',
      ],
      'https://doceria85.com.br/',
    );
    expect(nav).toContain('https://g.co/kgs/xm7tgsx');
    expect(nav).toContain('https://maps.app.goo.gl/AbC123');
    expect(nav).toContain('https://www.google.com/maps/place/Doceria');
  });
});

describe('chaseLinks', () => {
  test('collects hubs + business-map links from nav, skips the rest', () => {
    const chased = chaseLinks({
      url: 'https://instagram.com/doceria85',
      title: null,
      description: null,
      text: '',
      nav: [
        'https://linktr.ee/doceria85',
        'https://g.co/kgs/xm7tgsx',
        'https://doceria85.com.br/contato',
        'https://instagram.com/outra',
      ],
      foundContacts: {
        phones: [],
        whatsappLinks: [],
        emails: [],
        instagram: [],
        facebook: [],
        tiktok: [],
        phoneHints: [],
      },
    });
    expect(chased).toEqual(['https://linktr.ee/doceria85', 'https://g.co/kgs/xm7tgsx']);
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

describe('isBrMobilePhone', () => {
  test('BR mobile (+55 DD 9xxxx-xxxx) is the whatsapp line', () => {
    expect(isBrMobilePhone('+55 22 99987-3674')).toBe(true);
    expect(isBrMobilePhone('+5522999873674')).toBe(true);
    expect(isBrMobilePhone('22999873674')).toBe(true);
  });
  test('landline is not whatsapp', () => {
    expect(isBrMobilePhone('+55 22 3343-4882')).toBe(false);
    expect(isBrMobilePhone('+552233434882')).toBe(false);
  });
  test('short/international non-BR not whatsapp', () => {
    expect(isBrMobilePhone('+1 415 555 0132')).toBe(false);
    expect(isBrMobilePhone('99999')).toBe(false);
  });
});

describe('outboundLinks & bio-hub link following', () => {
  test('torbolariadapreta.pages.dev surfaces Brendi menus in outboundLinks, WhatsApp in contacts, and Maps in nav', () => {
    const pageUrl = 'https://torbolariadapreta.pages.dev/';
    const links = [
      'https://chat.whatsapp.com/FcdgrprZwnVKKa7nPrKhKh',
      'https://menu.brendi.com.br/torbolaria-da-preta/?utm_source=Instagram',
      'https://menu.brendi.com.br/torbolaria-da-preta-sao-pedro-da-aldeia/?utm_source=Instagram',
      'https://wa.me/5522988459183?text=Gostaria%20do%20card%C3%A1pio%20de%20Natal',
      'https://www.google.com/maps/place/data=!3m1!4b1!4m2!3m1!1s0x976971a000000001:0x1',
      'https://instagram.com/torbolariadapreta',
    ];
    const out = outboundLinks(links, pageUrl);
    expect(out).toEqual([
      'https://menu.brendi.com.br/torbolaria-da-preta',
      'https://menu.brendi.com.br/torbolaria-da-preta-sao-pedro-da-aldeia',
    ]);
    const contacts = contactsFromLinks(links);
    expect(contacts.phones).toEqual(['+5522988459183']);
    expect(contacts.instagram).toEqual(['@torbolariadapreta']);
    expect(contacts.whatsappLinks).toContain('https://chat.whatsapp.com/FcdgrprZwnVKKa7nPrKhKh');
    expect(contacts.whatsappLinks.some((u) => u.startsWith('https://wa.me/5522988459183'))).toBe(
      true,
    );
    const nav = navLinks(links, pageUrl);
    expect(nav.some((u) => u.startsWith('https://www.google.com/maps/place/'))).toBe(true);
  });

  test('outboundLinks keeps ordering platforms, marketplaces, PDFs, Forms, and unwraps l.instagram.com while dropping noise', () => {
    const out = outboundLinks(
      [
        'https://linktr.ee/s/about',
        'https://linktr.ee/features/pricing',
        'https://pedido.anota.ai/loja/doce?utm_medium=bio',
        'https://www.ifood.com.br/delivery/cabo-frio/doceria',
        'https://drive.google.com/file/d/123/view',
        'https://forms.gle/abc123',
        'https://cdn.example.com/cardapio-natal.pdf',
        'https://cdn.example.com/logo.png',
        'https://fonts.googleapis.com/css2?family=Inter',
        'https://www.googletagmanager.com/gtag/js?id=G-123',
        'https://wa.me/5522999990000',
        'mailto:oi@doceria.com.br',
        'tel:+5522999990000',
        'https://l.instagram.com/?u=' +
          encodeURIComponent('https://menu.brendi.com.br/doce/?fbclid=xyz'),
      ],
      'https://linktr.ee/doceria85',
      'Veja também https://doceria85.goomer.app/menu',
    );
    expect(out).toEqual([
      'https://pedido.anota.ai/loja/doce',
      'https://www.ifood.com.br/delivery/cabo-frio/doceria',
      'https://drive.google.com/file/d/123/view',
      'https://forms.gle/abc123',
      'https://cdn.example.com/cardapio-natal.pdf',
      'https://menu.brendi.com.br/doce',
      'https://doceria85.goomer.app/menu',
    ]);
  });

  test('modern bio-hub hosts and bare subdomain hubs are recognized', () => {
    for (const u of [
      'https://torbolariadapreta.pages.dev',
      'https://torbolariadapreta.pages.dev/',
      'https://doceria.my.canva.site/',
      'https://doceria.vercel.app',
      'https://doceria.netlify.app',
      'https://taplink.cc/doceria',
      'https://bio.site/doceria',
      'https://bento.me/doceria',
      'https://heylink.me/doceria',
      'https://sites.google.com/view/doceria-artesanal',
    ]) {
      expect(isProfileHubUrl(new URL(u))).toBe(true);
    }
    expect(isProfileHubUrl(new URL('https://sites.google.com/'))).toBe(false);
    expect(isProfileHubUrl(new URL('https://doceria85.com.br/contato'))).toBe(false);
    expect(isProfileHubUrl(new URL('https://menu.brendi.com.br/torbolaria-da-preta'))).toBe(false);

    const fromBio = contactsFromText(
      'Cardápio e encomendas em torbolariadapreta.pages.dev ou doceria.my.canva.site e taplink.cc/doce',
    );
    expect(fromBio.hubs).toContain('https://torbolariadapreta.pages.dev');
    expect(fromBio.hubs).toContain('https://doceria.my.canva.site');
    expect(fromBio.hubs).toContain('https://taplink.cc/doce');
  });

  test('isShortenerUrl and chaseLinks follow hubs, shorteners, and maps pointers from nav and outboundLinks', () => {
    expect(isShortenerUrl('https://bit.ly/cardapio-doce')).toBe(true);
    expect(isShortenerUrl('https://w.app/doce')).toBe(true);
    expect(isShortenerUrl('https://contate.me/doce')).toBe(true);
    expect(isShortenerUrl('https://encurtador.com.br/abc')).toBe(true);
    expect(isShortenerUrl('https://bit.ly/')).toBe(false);
    expect(isShortenerUrl('https://menu.brendi.com.br/doce')).toBe(false);

    const chased = chaseLinks({
      url: 'https://instagram.com/torbolariadapreta',
      title: null,
      description: null,
      text: '',
      nav: [
        'https://torbolariadapreta.pages.dev',
        'https://g.co/kgs/xm7tgsx',
        'https://doceria85.com.br/contato',
      ],
      outboundLinks: [
        'https://bit.ly/cardapio-doce',
        'https://contate.me/torbolaria',
        'https://menu.brendi.com.br/torbolaria-da-preta',
      ],
      foundContacts: {
        phones: [],
        whatsappLinks: [],
        emails: [],
        instagram: [],
        facebook: [],
        tiktok: [],
        phoneHints: [],
      },
    });
    expect(chased).toEqual([
      'https://torbolariadapreta.pages.dev',
      'https://g.co/kgs/xm7tgsx',
      'https://bit.ly/cardapio-doce',
      'https://contate.me/torbolaria',
    ]);
  });

  test('annotateResult classifies Brendi and BR ordering platforms as listing', () => {
    for (const u of [
      'https://menu.brendi.com.br/torbolaria-da-preta',
      'https://brendi.app/loja',
      'https://app.cardapioweb.com.br/doce',
      'https://doceria.olaclick.app/',
      'https://menudino.com.br/doceria',
      'https://delivery.yooga.app/doceria',
      'https://www.rappi.com.br/restaurantes/123',
      'https://aiqfome.com/SP/cidade/doceria',
    ]) {
      expect(annotateResult(r(u)).kind).toBe('listing');
    }
  });
});

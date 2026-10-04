// End-to-end gate for the built site (`bun run build` first; the webServer serves build/).
//   CHROMIUM=/opt/pw-browsers/chromium bun run test:e2e
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';

const HOME = '/';
const PRIVACY = '/privacidade/';
const MISSING = '/nao-existe/';
// the pages written to be found on search (src/lib/pages.ts): one per kind of shop, the guides, about
const NICHES = ['/para/doceiras/', '/para/marmitarias/', '/para/hamburguerias/', '/para/padarias/'];
const GUIDES = [
  '/guias/vender-comida-pelo-whatsapp/',
  '/guias/cardapio-digital/',
  '/guias/encomendas-de-bolos-e-doces/',
  '/guias/delivery-proprio/',
];
const CONTENT = [...NICHES, '/guias/', ...GUIDES, '/sobre/'];
const PAGES = [HOME, ...CONTENT, PRIVACY, MISSING];
const DOMAIN = 'https://vendua.com.br';
const INSTAGRAM = 'https://www.instagram.com/vendua.digital/';
// sign-up lives in the merchant admin (src/lib/content.ts); the build bakes PUBLIC_ADMIN_URL in
const ADMIN = new URL(process.env.PUBLIC_ADMIN_URL || 'https://painel.vendua.com.br');
const SIGNUP = new URL('/admin/comecar', ADMIN).href;
// the site's own call to action preselects the recommended plan
const START = `${SIGNUP}?plano=bandeira`;
const THEMES = ['light', 'dark'] as const;

// Lazy images load only near the viewport: walk the page one screen at a time, waiting a frame
// for layout at each stop, then wait for every rendered image to settle.
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.75) {
      scrollTo(0, y);
      await frame();
    }
    scrollTo(0, document.documentElement.scrollHeight);
    await frame();
  });
  await expect
    .poll(
      () =>
        // an image skipped on the fast walk gets its own stop, like a reader lingering on it
        page.evaluate(() =>
          [...document.images]
            .filter((i) => i.getClientRects().length > 0 && !i.complete)
            .map((i) => (i.scrollIntoView({ block: 'center' }), i.currentSrc || i.src)),
        ),
      { message: `imagens que não terminaram de carregar em ${page.url()}`, timeout: 20_000 },
    )
    .toEqual([]);
  await page.evaluate(() => scrollTo(0, 0));
}

test.describe('rotas', () => {
  test('as páginas do site respondem 200; o resto, 404 com a página de não encontrada', async ({
    page,
  }) => {
    for (const path of [HOME, ...CONTENT, PRIVACY]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
    }
    for (const path of [MISSING, '/privacidade/nada/', '/pedidos', '/para/', '/guias/nada/']) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.locator('h1')).toHaveText('Essa página saiu para entrega.');
    }
  });

  for (const path of PAGES)
    test(`${path}: título, descrição, canonical, og:image e um só h1`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(/\S.*Venduá|Venduá.*\S/);
      const meta = (sel: string, attr = 'content') =>
        page.locator(sel).evaluateAll((els, a) => els.map((e) => e.getAttribute(a) ?? ''), attr);
      const [description] = await meta('meta[name="description"]');
      expect(description?.length ?? 0, 'meta description').toBeGreaterThan(50);
      expect(await meta('link[rel="canonical"]', 'href')).toEqual([
        new URL(path === MISSING ? '/404/' : path, DOMAIN).href,
      ]);
      expect(await meta('meta[property="og:image"]')).toEqual([`${DOMAIN}/og.png`]);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
    });

  test('a imagem social existe e tem 1200×630', async ({ request }) => {
    const res = await request.get('/og.png');
    expect(res.status()).toBe(200);
    const png = await res.body();
    // IHDR: width and height are big-endian u32 at bytes 16 and 20
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});

test.describe('busca', () => {
  const ld = (page: Page) =>
    page
      .locator('script[type="application/ld+json"]')
      .evaluateAll((els) => els.map((e) => JSON.parse(e.textContent ?? '')));

  test('o Google aprende que vendua, sem acento, é a Venduá', async ({ page }) => {
    await page.goto(HOME);
    const [data] = await ld(page);
    const nodes: Record<string, unknown>[] = data['@graph'];
    const of = (type: string) => nodes.find((n) => n['@type'] === type)!;
    expect(of('Organization')).toMatchObject({ name: 'Venduá', alternateName: 'Vendua' });
    expect(of('Organization').sameAs).toContain(INSTAGRAM);
    expect(of('WebSite')).toMatchObject({ name: 'Venduá', url: `${DOMAIN}/` });
    expect(of('WebSite').alternateName).toContain('Vendua');
    // the product with the plans open for sign-up, never the closed Pangolim
    const offers = (of('SoftwareApplication').offers as { name: string; url: string }[]).map(
      (o) => o.name,
    );
    expect(offers).toEqual(['Venduá Mirim', 'Venduá Bandeira']);
    // the about page says it in words too
    await page.goto('/sobre/');
    await expect(page.locator('main')).toContainText('vendua, sem acento');
  });

  test('cada página tem os seus dados estruturados, e só as indexáveis', async ({ page }) => {
    for (const path of CONTENT) {
      await page.goto(path);
      const types = (await ld(page)).flatMap((d) =>
        (d['@graph'] as { '@type': string }[]).map((n) => n['@type']),
      );
      expect(types, path).toContain('BreadcrumbList');
      if (GUIDES.includes(path)) expect(types, path).toContain('Article');
      if (NICHES.includes(path)) expect(types, path).toContain('FAQPage');
    }
    for (const path of [PRIVACY, MISSING]) {
      await page.goto(path);
      expect(await ld(page), path).toEqual([]);
    }
  });

  test('o sitemap lista as páginas indexáveis, e o robots aponta para ele', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual([HOME, ...CONTENT].map((p) => new URL(p, DOMAIN).href).sort());
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain(`Sitemap: ${DOMAIN}/sitemap.xml`);
  });

  test('toda página nova tem link de outras: a home, o rodapé e as leituras do fim', async ({
    page,
  }) => {
    await page.goto(HOME);
    for (const path of NICHES)
      await expect(page.locator(`#para-quem a[href="${path}"]`), path).toHaveCount(1);
    const footer = await page
      .locator('footer a[href^="/"]')
      .evaluateAll((els) => els.map((a) => a.getAttribute('href')));
    for (const path of [...NICHES, '/guias/', '/sobre/', PRIVACY]) expect(footer).toContain(path);
    await page.goto('/guias/');
    for (const path of GUIDES)
      await expect(page.locator(`main a[href="${path}"]`).first(), path).toBeVisible();
  });
});

test.describe('layout', () => {
  for (const colorScheme of THEMES)
    for (const width of [320, 375, 768, 1280, 1440])
      test(`sem rolagem horizontal em ${width}px (${colorScheme})`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        for (const path of PAGES) {
          await page.goto(path);
          await scrollThrough(page);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${path} transborda ${overflow}px`).toBeLessThanOrEqual(0);
        }
        await ctx.close();
      });
});

test.describe('acessibilidade', () => {
  for (const colorScheme of THEMES)
    for (const width of [375, 1280])
      for (const path of PAGES)
        test(`axe sem violações sérias em ${path} a ${width}px (${colorScheme})`, async ({
          browser,
        }) => {
          const ctx = await browser.newContext({
            viewport: { width, height: 900 },
            colorScheme,
            reducedMotion: 'reduce',
          });
          const page = await ctx.newPage();
          await page.goto(path);
          await scrollThrough(page);
          const { violations } = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();
          const bad = violations
            .filter((v) => v.impact === 'serious' || v.impact === 'critical')
            .map(
              (v) =>
                `${v.id} (${v.impact}): ${v.nodes
                  .slice(0, 4)
                  .map((n) => n.target.join(' '))
                  .join(' | ')}`,
            );
          expect(bad).toEqual([]);
          await ctx.close();
        });

  test('toda <img> tem alt', async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.locator('img:not([alt])'), path).toHaveCount(0);
      // the screenshots carry meaning; only Duá and ornaments may be decorative
      // (a screen inside an aria-hidden decoration may be alt="")
      for (const alt of await page
        .locator('picture img')
        .evaluateAll((els) =>
          els
            .filter((e) => !e.closest('[aria-hidden="true"]'))
            .map((e) => e.getAttribute('alt') ?? ''),
        ))
        expect(alt.trim().length, 'alt de uma tela').toBeGreaterThan(10);
    }
  });
});

test.describe('conteúdo', () => {
  test('a home funciona sem JavaScript', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(HOME);
    await expect(page.locator('h1')).toBeVisible();
    const sections = page.locator('main section[aria-labelledby]');
    expect(await sections.count(), 'seções da home').toBeGreaterThanOrEqual(5);
    for (const id of await sections.evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-labelledby')!),
    )) {
      const heading = page.locator(`[id="${id}"]`);
      await expect(heading, `título de #${id}`).toBeVisible();
      await expect(heading).not.toBeEmpty();
    }
    const tags = await sections.evaluateAll((els) =>
      els.map((e) => document.getElementById(e.getAttribute('aria-labelledby')!)?.tagName),
    );
    expect(tags, 'cada seção nomeada pelo seu h2 (o h1 abre a primeira)').toEqual([
      'H1',
      ...Array(tags.length - 1).fill('H2'),
    ]);
    await expect(page.locator(`header a[href="${START}"]`)).toBeVisible();
    for (const id of ['veja', 'preco', 'perguntas'])
      await expect(page.locator(`#${id}`)).toBeAttached();
    // the demos can't play without a script: all four show, finished and still, with no tabs
    await expect(page.locator('#veja [role="tab"]')).toHaveCount(0);
    for (const id of ['vendedor', 'pedido', 'cozinha', 'loja']) {
      const demo = page.locator(`#demo-${id}`);
      await expect(demo, `demo ${id}`).toBeVisible();
      expect((await demo.innerText()).trim().length, `demo ${id} sem conteúdo`).toBeGreaterThan(80);
    }
    // the AI seller is Duá, and says it's the store's virtual assistant
    await expect(page.locator('#demo-vendedor')).toContainText(
      'Oi! Sou o Duá, assistente virtual da Bolos da Nena.',
    );
    // the calculator shows its R$ 8.000 example as text
    await expect(page.locator('#preco')).toContainText('R$ 960');

    // FAQ: native <details>, so every answer ships in the HTML and opens without a script
    const faq = page.locator('#perguntas details');
    expect(await faq.count(), 'perguntas').toBeGreaterThanOrEqual(3);
    for (const item of await faq.all()) {
      await expect(item.locator('summary')).not.toBeEmpty();
      const answer = await item.evaluate((d) =>
        [...d.children]
          .filter((c) => c.tagName !== 'SUMMARY')
          .map((c) => c.textContent ?? '')
          .join(' ')
          .trim(),
      );
      expect(answer.length, 'resposta da pergunta').toBeGreaterThan(20);
    }
    await faq.first().locator('summary').click();
    await expect(faq.first()).toHaveAttribute('open', '');
    // the theme switch needs a script, so it isn't offered
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
    await ctx.close();
  });

  test('o tema escolhido no topo vence o do sistema, vale para as telas e fica salvo', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(HOME);
    const state = () =>
      page.evaluate(() => ({
        theme: document.documentElement.dataset.theme ?? null,
        bg: getComputedStyle(document.body).backgroundColor,
        screen: (document.querySelector('main picture img') as HTMLImageElement).currentSrc,
      }));
    const light = await state();
    expect(light.theme).toBeNull();
    expect(light.screen).toContain('-creme-');

    await page.getByRole('button', { name: 'Usar tema escuro' }).click();
    await expect.poll(async () => (await state()).screen).toContain('-noite-');
    const dark = await state();
    expect(dark.theme).toBe('dark');
    expect(dark.bg).not.toBe(light.bg);

    await page.reload();
    expect((await state()).theme, 'a escolha sobrevive ao recarregar').toBe('dark');

    // back to what the system says: the choice is dropped and the system decides again
    await page.getByRole('button', { name: 'Usar tema claro' }).click();
    expect((await state()).theme).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('vendua-theme'))).toBeNull();
    await ctx.close();
  });

  test('a chamada leva ao cadastro no painel: sem formulário nem contato no site', async ({
    page,
  }) => {
    const CTA =
      /cadastr|inscrev|assin[ae]|criar|come[cç]ar agora|comece|teste|experimente|fale|contato|whats|agend|quero/i;
    for (const path of PAGES) {
      await page.goto(path);
      // the only control is the plans' calculator (a number, no submit): nothing collects data
      await expect(page.locator('form, textarea, select'), path).toHaveCount(0);
      expect(
        await page
          .locator('input')
          .evaluateAll((els) => els.filter((e) => !e.closest('#preco')).length),
        path,
      ).toBe(0);
      await expect(page.locator('button[type="submit"], [role="button"]'), path).toHaveCount(0);
      // the header's call to action, on every page
      await expect(page.locator(`header a[href="${START}"]`), path).toHaveCount(1);

      const links = await page.locator('a[href]').evaluateAll((els) =>
        els.map((a) => ({
          href: (a as HTMLAnchorElement).href,
          raw: a.getAttribute('href')!,
          text: (a.textContent ?? '').trim(),
          footer: !!a.closest('footer'),
        })),
      );
      for (const l of links) {
        // the one exception: the privacy page's address for requests about personal data (LGPD)
        const legal = path === PRIVACY && /^mailto:[^@]+@vendua\.com\.br$/.test(l.raw);
        if (legal) continue;
        expect(l.raw, `${path}: ${l.text}`).not.toMatch(/^(mailto|tel|sms|whatsapp):/i);
        expect(l.href, `${path}: ${l.text}`).not.toMatch(
          /wa\.me|whatsapp|ig\.me|forms?\.|typeform/i,
        );
        const url = new URL(l.href);
        if (url.origin === ADMIN.origin) {
          // the admin only at its sign-up, with no plan or an open one (Pangolim is closed)
          expect(url.pathname, `${path}: ${l.text}`).toBe('/admin/comecar');
          expect([...url.searchParams.keys()].filter((k) => k !== 'plano')).toEqual([]);
          expect([null, 'mirim', 'bandeira']).toContain(url.searchParams.get('plano'));
        } else if (url.origin !== new URL(page.url()).origin)
          // besides sign-up, Instagram is the only site linked (the profile, and its privacy policy on /privacidade/)
          expect(url.hostname, `${path}: link externo "${l.text}"`).toMatch(
            /(^|\.)instagram\.com$/,
          );
        // a guide's title names a topic ("vender pelo WhatsApp"), not a call to action
        else if (!/^\/guias\/./.test(url.pathname))
          expect(l.text, `${path}: ${l.href}`).not.toMatch(CTA);
      }
      const instagram = links.filter((l) => l.href === INSTAGRAM);
      expect(
        instagram.filter((l) => l.footer),
        `${path}: Instagram no rodapé`,
      ).toHaveLength(1);
      // at most one "acompanhe no Instagram" line near the closing call to action
      expect(instagram.filter((l) => !l.footer).length, path).toBeLessThanOrEqual(1);
      // the demos' buttons are the visitor's lines in a simulation ("Quero a fatia também"), not calls to action
      for (const b of await page
        .locator('button')
        .evaluateAll((els) =>
          els.filter((e) => !e.closest('.demo')).map((e) => e.textContent ?? ''),
        ))
        expect(b, `${path}: botão`).not.toMatch(CTA);
    }
  });

  test('#preco mostra os três planos como decididos, o Bandeira recomendado, cada um com o seu cadastro', async ({
    page,
  }) => {
    await page.goto(HOME);
    const preco = page.locator('#preco');
    const text = (await preco.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Venduá Mirim R$ 69,90/mês');
    expect(text).toContain('Venduá Pangolim R$ 449/mês');
    // Bandeira is the recommended plan: the trial leads the section and sits by its price; the others have none
    expect(text).toContain('Comece pelo Venduá Bandeira: 14 dias grátis, sem cartão.');
    expect(text).toMatch(
      /Recomendado Venduá Bandeira .*R\$ 169\/mês começa com 14 dias grátis, sem cartão/,
    );
    expect(text.match(/Recomendado/g)).toHaveLength(1);
    expect(text.match(/grátis, sem cartão/g)).toHaveLength(2);
    expect(text).toContain('seunome.vendua.com.br');
    expect(text).toContain('250 conversas por mês');
    expect(text).toMatch(
      /Pangolim.*Domínio próprio.*site feito pelo nosso agente de IA.*1\.000 conversas por mês/,
    );
    // the comparison opens without a script, and every plan has no per-order fee
    await preco.locator('details summary').first().click();
    expect((await preco.innerText()).replace(/\s+/g, ' ')).toMatch(/Taxa da Venduá por pedido/);
    // the calculator cites iFood's own published rates
    expect(text).toContain('blog-parceiros.ifood.com.br/taxas-ifood');
    await expect(preco.locator(`a[href="${SIGNUP}?plano=mirim"]`)).toHaveCount(1);
    await expect(preco.locator(`a[href="${SIGNUP}?plano=bandeira"]`)).toHaveCount(2);
    // Pangolim is shown but closed: price and perks, a plain line instead of its button
    const pangolim = preco.locator('li.plan', { hasText: 'Venduá Pangolim' });
    await expect(pangolim).toContainText('R$ 449/mês');
    await expect(pangolim).toContainText('Ainda não está aberto para assinatura.');
    await expect(pangolim.locator('a[href*="/admin/comecar"]')).toHaveCount(0);
    await expect(page.locator('a[href*="plano=pangolim"]')).toHaveCount(0);
    // perks open their demo
    for (const id of ['vendedor', 'pedido', 'cozinha', 'loja'])
      expect(await preco.locator(`a[href="#demo-${id}"]`).count(), id).toBeGreaterThan(0);
    // the trial strip's Bandeira first, then the plans cheapest first, with Bandeira in the middle
    expect(
      await preco
        .locator('a[href*="?plano="]')
        .evaluateAll((els) =>
          els.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get('plano')),
        ),
    ).toEqual(['bandeira', 'mirim', 'bandeira']);
    // no other price anywhere on the page
    const prices = (await page.locator('main').innerText()).match(/R\$\s?\d+(,\d{2})?\/mês/g) ?? [];
    expect([...new Set(prices)].sort()).toEqual(['R$ 169/mês', 'R$ 449/mês', 'R$ 69,90/mês']);
  });

  for (const width of [375, 1280])
    test(`âncoras #veja #preco #perguntas e os links do topo a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const anchors = ['#veja', '#preco', '#perguntas'];
      // the bar shows its links inline on wide screens and behind a <details> menu on phones
      const links = page.locator('header nav a:visible');
      const open = async () => {
        if ((await links.count()) === 0) await page.locator('header summary').click();
        await expect(links).toHaveCount(anchors.length);
      };
      const hrefs = () => links.evaluateAll((els) => els.map((e) => e.getAttribute('href')));

      await page.goto(HOME);
      for (const a of anchors) await expect(page.locator(a)).toHaveCount(1);
      await open();
      expect(await hrefs()).toEqual(anchors);
      for (const a of anchors) {
        await open();
        await links.and(page.locator(`[href="${a}"]`)).click();
        await expect(page).toHaveURL(new RegExp(`${a}$`));
        await expect(page.locator(a)).toBeInViewport();
      }

      // on the other pages the same links lead back to the home's sections
      await page.goto(PRIVACY);
      await open();
      expect(await hrefs()).toEqual(anchors.map((a) => `/${a}`));
      await links.first().click();
      await expect(page).toHaveURL(/\/#veja$/);
      await expect(page.locator('#veja')).toBeInViewport();
    });
});

test.describe('preços ao vivo', () => {
  const catalog = (over: Record<string, object>) => ({
    plans: [
      {
        id: 'mirim',
        name: 'Venduá Mirim',
        priceCents: 6990,
        trialDays: 0,
        available: true,
        aiConversations: 0,
        aiTrialConversations: 0,
        features: { vendedor: false },
      },
      {
        id: 'bandeira',
        name: 'Venduá Bandeira',
        priceCents: 16900,
        trialDays: 14,
        available: true,
        aiConversations: 250,
        aiTrialConversations: 50,
        features: { vendedor: true },
      },
      {
        id: 'pangolim',
        name: 'Venduá Pangolim',
        priceCents: 44900,
        trialDays: 0,
        available: false,
        aiConversations: 1000,
        aiTrialConversations: 50,
        features: { vendedor: true },
      },
    ].map((p) => ({ ...p, ...(over[p.id] ?? {}) })),
  });

  test('o que o CRM muda aparece na página, sem build novo', async ({ page }) => {
    await page.route('**/precos.json', (r) =>
      r.fulfill({
        json: catalog({
          bandeira: { priceCents: 19900, trialDays: 7, aiConversations: 300 },
          pangolim: { available: true },
        }),
      }),
    );
    await page.goto(HOME);
    const preco = page.locator('#preco');
    const bandeira = preco.locator('li.plan', { hasText: 'Venduá Bandeira' });
    await expect(bandeira).toContainText('R$ 199/mês');
    await expect(bandeira).toContainText('começa com 7 dias grátis, sem cartão');
    await expect(bandeira).toContainText('300 conversas por mês');
    await expect(preco).toContainText('Comece pelo Venduá Bandeira: 7 dias grátis, sem cartão.');
    // Pangolim opened in the CRM: its button comes back
    const pangolim = preco.locator('li.plan', { hasText: 'Venduá Pangolim' });
    await expect(pangolim.locator(`a[href="${SIGNUP}?plano=pangolim"]`)).toHaveCount(1);
    await expect(pangolim).not.toContainText('Ainda não está aberto');
    // the calculator and the night's closing line follow too
    await expect(preco.locator('.calc, [class*="calc"]').first()).toContainText('R$ 199');
    await expect(page.locator('#perguntas, #comecar').first()).toContainText('R$ 199');
  });

  test('recursos ligados e desligados no CRM mudam os cartões e a tabela', async ({ page }) => {
    const F = {
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
      customDomain: false,
      customSite: false,
    };
    await page.route('**/precos.json', (r) =>
      r.fulfill({
        json: catalog({
          bandeira: { features: { ...F, loyalty: false } },
          pangolim: {
            priceCents: 1_500_000,
            features: { ...F, customDomain: true, customSite: true },
          },
        }),
      }),
    );
    await page.goto(HOME);
    const preco = page.locator('#preco');
    const bandeira = preco.locator('li.plan', { hasText: 'Venduá Bandeira' });
    await expect(bandeira).not.toContainText('Cartão fidelidade');
    // what Mirim lacks follows what Bandeira has
    await expect(preco.locator('li.plan', { hasText: 'Venduá Mirim' })).toContainText(
      'Sem a tela da cozinha, a impressão e o Duá.',
    );
    // Pangolim still has everything Bandeira has, and now the loyalty card on top
    const pangolim = preco.locator('li.plan', { hasText: 'Venduá Pangolim' });
    await expect(pangolim).toContainText('Tudo do Bandeira, e mais:');
    await expect(pangolim).toContainText('Cartão fidelidade');
    // any price the CRM takes shows
    await expect(pangolim).toContainText('R$ 15.000/mês');
    await preco.locator('details summary').first().click();
    const row = preco.locator('tr', { hasText: 'Cartão fidelidade' });
    await expect(row.locator('td').nth(1)).toContainText('não');
  });

  test('um plano oculto no CRM fica sem botão', async ({ page }) => {
    const all = catalog({});
    await page.route('**/precos.json', (r) =>
      r.fulfill({ json: { plans: all.plans.filter((p) => p.id !== 'mirim') } }),
    );
    await page.goto(HOME);
    const mirim = page.locator('#preco li.plan', { hasText: 'Venduá Mirim' });
    await expect(mirim).toContainText('Ainda não está aberto para assinatura.');
    await expect(page.locator('a[href*="plano=mirim"]')).toHaveCount(0);
  });

  test('sem o catálogo, a página fica com os preços do build', async ({ page }) => {
    await page.route('**/precos.json', (r) => r.abort());
    await page.goto(HOME);
    const bandeira = page.locator('#preco li.plan', { hasText: 'Venduá Bandeira' });
    await expect(bandeira).toContainText('R$ 169/mês');
    await expect(bandeira).toContainText('começa com 14 dias grátis, sem cartão');
  });
});

test.describe('imagens', () => {
  for (const colorScheme of THEMES)
    for (const width of [375, 1440])
      test(`as imagens carregam em ${width}px (${colorScheme})`, async ({ browser }) => {
        const ctx = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme,
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        const failed: string[] = [];
        page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
        page.on('requestfailed', (r) => failed.push(`falhou ${r.url()}`));
        for (const path of [HOME, PRIVACY, NICHES[0]!, GUIDES[0]!]) {
          await page.goto(path);
          await scrollThrough(page);
          const imgs = await page.locator('img').evaluateAll((els) =>
            (els as HTMLImageElement[])
              .filter((i) => i.getClientRects().length > 0)
              .map((i) => ({
                src: i.currentSrc,
                w: i.naturalWidth,
                screen: !!i.closest('picture'),
              })),
          );
          expect(imgs.length, path).toBeGreaterThan(0);
          for (const i of imgs) expect(i.w, `${path}: ${i.src} não carregou`).toBeGreaterThan(0);
          const screens = imgs.filter((i) => i.screen);
          // the hero's two phones; the product further down is the four drawn demos (#veja)
          if (path === HOME) expect(screens.length, 'telas na home').toBeGreaterThanOrEqual(2);
          const want = colorScheme === 'dark' ? '-noite-' : '-creme-';
          for (const s of screens) expect(s.src, `tela ${colorScheme}`).toContain(want);
        }
        expect(failed).toEqual([]);
        await ctx.close();
      });
});

test.describe('rede', () => {
  test('nenhuma requisição sai da origem e nada quebra no console', async ({ page }) => {
    const origin = new URL(test.info().project.use.baseURL!).origin;
    const foreign: string[] = [];
    const errors: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
        foreign.push(r.url());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      // the 404 page's own document status is expected
      if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
    });
    for (const colorScheme of THEMES) {
      await page.emulateMedia({ colorScheme });
      for (const path of PAGES) {
        await page.goto(path, { waitUntil: 'networkidle' });
        await scrollThrough(page);
      }
    }
    expect(foreign).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('orçamento de JavaScript e fontes da home', async ({ page }) => {
    const js: Promise<number>[] = [];
    const fonts: Promise<number>[] = [];
    page.on('response', (r) => {
      const type = r.request().resourceType();
      // the preview serves raw files; gzip here is what nginx (gzip_static) sends
      if (type === 'script') js.push(r.body().then((b) => gzipSync(b, { level: 9 }).length));
      if (type === 'font') fonts.push(r.body().then((b) => b.length));
    });
    await page.goto(HOME, { waitUntil: 'networkidle' });
    await scrollThrough(page);
    await page.waitForLoadState('networkidle');
    const sum = async (list: Promise<number>[]) =>
      (await Promise.all(list)).reduce((a, b) => a + b, 0);
    const jsBytes = await sum(js);
    const fontBytes = await sum(fonts);
    const report = `JS ${jsBytes} B gzip em ${js.length} arquivos; fontes ${fontBytes} B em ${fonts.length}`;
    test.info().annotations.push({ type: 'orçamento', description: report });
    // Measured 2026-09-29: JS 45.2 KB gzip (9 files), fonts 64.6 KB (3 woff2: Figtree, Space Grotesk,
    // Instrument Serif italic, latin subsets). 2026-10-03: the four interactive demos and the plans
    // calculator (the owner's decision) bring JS to 67.0 KB gzip (10 files). Budgets are ~20% above;
    // raise them only on purpose.
    expect(jsBytes, report).toBeLessThanOrEqual(80_000);
    expect(fontBytes, report).toBeLessThanOrEqual(78_000);
  });
});

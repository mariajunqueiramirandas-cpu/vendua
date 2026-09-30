// End-to-end gate for the built site (`bun run build` first; the webServer serves build/).
//   CHROMIUM=/opt/pw-browsers/chromium bun run test:e2e
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { gzipSync } from 'node:zlib';

const HOME = '/';
const PRIVACY = '/privacidade/';
const MISSING = '/nao-existe/';
const PAGES = [HOME, PRIVACY, MISSING];
const DOMAIN = 'https://vendua.com.br';
const INSTAGRAM = 'https://www.instagram.com/vendua.digital/';
// sign-up lives in the merchant admin (src/lib/content.ts); the build bakes PUBLIC_ADMIN_URL in
const ADMIN = new URL(process.env.PUBLIC_ADMIN_URL || 'https://painel.vendua.com.br');
const SIGNUP = new URL('/admin/comecar', ADMIN).href;
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
  test('/ e /privacidade/ respondem 200; o resto, 404 com a página de não encontrada', async ({
    page,
  }) => {
    for (const path of [HOME, PRIVACY]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
    }
    for (const path of [MISSING, '/privacidade/nada/', '/pedidos']) {
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
    expect(await sections.count(), 'seções da home').toBeGreaterThanOrEqual(6);
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
    await expect(page.locator(`header a[href="${SIGNUP}"]`)).toBeVisible();
    for (const id of ['pedidos', 'preco', 'perguntas'])
      await expect(page.locator(`#${id}`)).toBeAttached();

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
      await expect(page.locator('form, input, textarea, select'), path).toHaveCount(0);
      await expect(page.locator('button[type="submit"], [role="button"]'), path).toHaveCount(0);
      // the header's call to action, on every page
      await expect(page.locator(`header a[href="${SIGNUP}"]`), path).toHaveCount(1);

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
          // the admin only at its sign-up, with no plan or one of the two
          expect(url.pathname, `${path}: ${l.text}`).toBe('/admin/comecar');
          expect([...url.searchParams.keys()].filter((k) => k !== 'plano')).toEqual([]);
          expect([null, 'basic', 'pro_plus']).toContain(url.searchParams.get('plano'));
        } else if (url.origin !== new URL(page.url()).origin)
          // besides sign-up, Instagram is the only site linked (the profile, and its privacy policy on /privacidade/)
          expect(url.hostname, `${path}: link externo "${l.text}"`).toMatch(
            /(^|\.)instagram\.com$/,
          );
        else expect(l.text, `${path}: ${l.href}`).not.toMatch(CTA);
      }
      const instagram = links.filter((l) => l.href === INSTAGRAM);
      expect(
        instagram.filter((l) => l.footer),
        `${path}: Instagram no rodapé`,
      ).toHaveLength(1);
      // at most one "acompanhe no Instagram" line near the closing call to action
      expect(instagram.filter((l) => !l.footer).length, path).toBeLessThanOrEqual(1);
      for (const b of await page.locator('button').allTextContents())
        expect(b, `${path}: botão`).not.toMatch(CTA);
    }
  });

  test('#preco mostra os dois planos como decididos, cada um com o seu cadastro', async ({
    page,
  }) => {
    await page.goto(HOME);
    const preco = page.locator('#preco');
    const text = (await preco.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('Venduá Basic R$ 39,90/mês');
    expect(text).toContain('Venduá PRO+ R$ 99/mês');
    expect(text).toContain('seunome.vendua.com.br');
    expect(text).toContain('Domínio próprio e um site feito pelo nosso agente de IA.');
    expect(text).toContain('Taxa da Venduá por pedido nenhuma');
    for (const plano of ['basic', 'pro_plus'])
      await expect(preco.locator(`a[href="${SIGNUP}?plano=${plano}"]`)).toHaveCount(1);
    // no other price anywhere on the page
    const prices = (await page.locator('main').innerText()).match(/R\$\s?\d+(,\d{2})?\/mês/g) ?? [];
    expect([...new Set(prices)].sort()).toEqual(['R$ 39,90/mês', 'R$ 99/mês']);
  });

  for (const width of [375, 1280])
    test(`âncoras #pedidos #preco #perguntas e os links do topo a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const anchors = ['#pedidos', '#preco', '#perguntas'];
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
      await expect(page).toHaveURL(/\/#pedidos$/);
      await expect(page.locator('#pedidos')).toBeInViewport();
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
        for (const path of [HOME, PRIVACY]) {
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
          if (path === HOME) expect(screens.length, 'telas na home').toBeGreaterThanOrEqual(4);
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
    // Instrument Serif italic, latin subsets). Budgets are ~20% above; raise them only on purpose.
    expect(jsBytes, report).toBeLessThanOrEqual(55_000);
    expect(fontBytes, report).toBeLessThanOrEqual(78_000);
  });
});

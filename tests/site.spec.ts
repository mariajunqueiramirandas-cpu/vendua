import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const routes = ['/', '/contato/', '/privacidade/', '/nao-existe/'];
const axeTags = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

// sessionStorage 'vnd-intro' skips the intro veil so tests reach the content directly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('vnd-intro', '1'));
});

async function ready(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
}

async function axeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.length} nó(s)`),
    `violações axe em ${page.url()}`,
  ).toEqual([]);
}

for (const width of [320, 360, 390, 768, 1280, 1440]) {
  test(`rotas, imagens e layout em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const route of routes) {
      const response = await page.goto(route);
      await ready(page);
      expect(response?.status()).toBe(route === '/nao-existe/' ? 404 : 200);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `overflow horizontal em ${route} @ ${width}px`,
      ).toBe(true);
      for (const img of await page.locator('img:visible').all()) {
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
          .toBeGreaterThan(0);
      }
      await page.evaluate(() => scrollTo(0, 0));
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: `artifacts/${route === '/' ? 'home' : route.split('/')[1]}-${width}.png`,
          fullPage: true,
        });
    }
    expect(errors).toEqual([]);
  });
}

test('a porta de entrada é a conversa pelo direct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Contato' }).click();
  await expect(page).toHaveURL(/\/contato\/$/);
  await expect(page.locator('h1')).toContainText('Só uma');
  const cta = page.getByRole('link', { name: /Abrir @vendua.digital/ });
  await expect(cta).toHaveAttribute('href', 'https://ig.me/m/vendua.digital');
  await expect(cta).toHaveAttribute('target', '_blank');
  await page.goto('/');
  const primaryCta = page.getByRole('link', { name: 'Iniciar um projeto' }).first();
  await expect(primaryCta).toHaveAttribute('href', 'https://ig.me/m/vendua.digital');
  await expect(primaryCta).toHaveAttribute('target', '_blank');
});

test('tema claro por padrão, alternável e persistente', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const html = page.locator('html');
  const body = page.locator('body');
  const meta = page.locator('meta[name="theme-color"]');
  await expect(html).not.toHaveAttribute('data-theme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(247, 244, 234)');
  const toggle = page.getByRole('button', { name: /tema/i });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(body).toHaveCSS('background-color', 'rgb(10, 16, 13)');
  await expect(meta).toHaveAttribute('content', '#0a100d');
  await page.reload();
  await ready(page);
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await axeClean(page);
  await toggle.click();
  await expect(html).not.toHaveAttribute('data-theme', 'dark');
  await expect(body).toHaveCSS('background-color', 'rgb(247, 244, 234)');
  await expect(meta).toHaveAttribute('content', '#f7f4ea');
});

test('modal de transmissão: abre, fecha por todas as vias e devolve o foco', async ({ page }) => {
  // Movimento reduzido torna abertura/fechamento síncronos — o que se testa é o
  // comportamento do <dialog> (Esc, backdrop, foco), não a animação.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await ready(page);

  const dialog = page.getByRole('dialog', { name: 'Ingestão do negócio' });
  const trigger = page.getByRole('button', { name: /Abrir estágio S-01/ });
  const closeButton = dialog.getByRole('button', { name: 'Fechar' });
  const overflow = () => page.evaluate(() => document.body.style.overflow);

  await expect(page.locator('.tx-panel')).toHaveCount(4); // painel introdutório + 3 estágios
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

  // Clique abre o modal com título, detalhe e especificações da transmissão.
  await trigger.click();
  await expect(dialog).toBeVisible();
  // O foco entra no modal — o fundo fica inerte para quem navega por teclado.
  await expect(closeButton).toBeFocused();
  await expect(dialog.locator('.tx-modal-title')).toHaveText('Ingestão do negócio');
  await expect(dialog.locator('.tx-modal-detail')).not.toBeEmpty();
  await expect(dialog.locator('.tx-specs div')).toHaveCount(4);
  await expect.poll(overflow).toBe('hidden');
  await page.screenshot({ path: 'artifacts/modal-390.png' });
  await axeClean(page);

  // Esc fecha (handler usa 'cancel'), libera o scroll e devolve o foco ao cartão.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(overflow).toBe('');
  await expect(trigger).toBeFocused();

  // O cartão é um <button>: Enter também abre — não há interação só de mouse.
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();

  // Botão "Fechar" fecha e devolve o foco.
  await closeButton.click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Clique no backdrop (fora da caixa do dialog) fecha.
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
  await expect.poll(overflow).toBe('');
});

test('perguntas abrem e fecham pelo acordeão', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const item = page.locator('.teaser-faq details').first();
  const summary = item.locator('summary');
  await expect(item).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(item).toHaveAttribute('open', '');
  await expect(item.locator('.faq-body p')).toBeVisible();
  await summary.click();
  await expect(item).not.toHaveAttribute('open', '');
});

test('skip link é o primeiro foco e leva ao conteúdo', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.keyboard.press('Tab');
  const skip = page.locator('.skip');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#conteudo$/);
  await expect(page.locator('#conteudo')).toBeFocused();
});

test('véu de introdução aparece uma vez e some', async ({ browser, baseURL }) => {
  // Contexto próprio, sem a semente de sessionStorage do beforeEach.
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  const veil = page.locator('.intro-veil');
  await expect(veil).toBeVisible();
  await expect(veil).toBeHidden({ timeout: 15_000 });
  await expect(page.locator('h1')).toBeVisible();
  await page.reload();
  await expect(veil).toBeHidden();
  await expect(page.locator('h1')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('conteúdo do teaser sem JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('sob medida');
  await expect(page.locator('.intro-veil')).toBeHidden();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('.signal-item')).toHaveCount(3);
  await expect(page.locator('.manifesto-text')).toContainText('não resolve ninguém');
  await expect(page.locator('.tx-panel')).toHaveCount(4);
  await expect(page.locator('.ritual-row')).toHaveCount(3);
  await expect(page.locator('.teaser-faq details')).toHaveCount(5);
  await page.locator('summary').first().click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await page.goto('/contato/');
  await expect(page.getByRole('link', { name: /Abrir @vendua.digital/ })).toHaveAttribute(
    'href',
    'https://ig.me/m/vendua.digital',
  );
  const response = await page.goto('/nao-existe/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Esta porta');
  await context.close();
});

test('acessibilidade nas páginas', async ({ page }) => {
  // Reduced motion renders the settled state of every section — the axe pass then
  // audits final contrast values instead of mid-animation blends.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of routes) {
    await page.goto(route);
    await ready(page);
    await axeClean(page);
  }
});

test('zoom 200%, redução de movimento, links e SEO', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of routes) {
    await page.goto(route);
    await ready(page);
    await page.evaluate(() => (document.documentElement.style.zoom = '2'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior),
    ).toBe('auto');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
    // Canonical/OG absolutos só são emitidos quando site.publicDomain é definido (F05).
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  }
  await page.goto('/');
  const links = await page
    .locator('a[href^="/"]')
    .evaluateAll((els) => [
      ...new Set(els.map((el) => el.getAttribute('href')!.split('#')[0]).filter(Boolean)),
    ]);
  for (const link of links) expect((await request.get(link)).status()).toBe(200);
  await expect(page.locator('a[href*="/projetos/"]')).toHaveCount(0);
});

test('orçamento inicial mobile e captura', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const measurements: Promise<{ url: string; bytes: number; script: boolean }>[] = [];
  page.on('response', (response) => {
    measurements.push(
      (async () => {
        const type = response.headers()['content-type'] || '';
        try {
          const body = await response.body();
          return {
            url: response.url(),
            bytes: /text|javascript|json|svg/.test(type) ? gzipSync(body).length : body.length,
            script: type.includes('javascript'),
          };
        } catch {
          // Respostas sem corpo (redirecionamentos, falhas) não entram no orçamento.
          return { url: response.url(), bytes: 0, script: false };
        }
      })(),
    );
  });
  await page.goto('/');
  await ready(page);
  await page.waitForLoadState('networkidle');
  const initial = await Promise.all(measurements);
  const payload = initial.reduce((sum, file) => sum + file.bytes, 0);
  const javascript = initial
    .filter((file) => file.script)
    .reduce((sum, file) => sum + file.bytes, 0);
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/performance.json',
    JSON.stringify(
      { viewport: 390, payloadGzipBytes: payload, javascriptGzipBytes: javascript, files: initial },
      null,
      2,
    ),
  );
  expect(payload).toBeLessThan(1_000_000);
  expect(javascript).toBeLessThan(120_000);
});

import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const routes = ['/', '/contato/', '/privacidade/', '/nao-existe/'];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('vnd-intro', '1'));
});
async function ready(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
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
test('a porta de entrada é o acesso pelo direct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('link', { name: 'Acesso' }).click();
  await expect(page).toHaveURL(/\/contato\/$/);
  await expect(page.locator('h1')).toContainText('Só uma porta');
  const cta = page.getByRole('link', { name: /Abrir @vendua.digital/ });
  await expect(cta).toHaveAttribute('href', 'https://www.instagram.com/vendua.digital/');
  await expect(cta).toHaveAttribute('target', '_blank');
  await page.goto('/');
  await page.getByRole('link', { name: 'Pedir acesso' }).first().click();
  await expect(page).toHaveURL(/\/contato\/$/);
});
test('conteúdo do teaser sem JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('h1')).toContainText('Será gerada');
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.locator('.signal-item')).toHaveCount(3);
  await expect(page.locator('.manifesto-text')).toContainText('não pede licença');
  await expect(page.locator('.tx-panel')).toHaveCount(4);
  await expect(page.locator('.ritual-row')).toHaveCount(3);
  await expect(page.locator('.teaser-faq details')).toHaveCount(4);
  await page.locator('summary').first().click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await page.goto('http://127.0.0.1:4173/contato/');
  await expect(page.getByRole('link', { name: /Abrir @vendua.digital/ })).toHaveAttribute(
    'href',
    'https://www.instagram.com/vendua.digital/',
  );
  await page.goto('http://127.0.0.1:4173/nao-existe/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Esse caminho');
  await context.close();
});
test('acessibilidade nas páginas', async ({ page }) => {
  // Reduced motion renders the settled state of every section — the axe pass then
  // audits final contrast values instead of mid-animation blends.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of routes) {
    await page.goto(route);
    await ready(page);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
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
        const body = await response.body();
        const type = response.headers()['content-type'] || '';
        return {
          url: response.url(),
          bytes: /text|javascript|json|svg/.test(type) ? gzipSync(body).length : body.length,
          script: type.includes('javascript'),
        };
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

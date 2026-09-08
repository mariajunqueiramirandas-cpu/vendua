import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const routes = [
  '/',
  '/contato/',
  '/projetos/quero-pudim-gourmet/',
  '/privacidade/',
  '/nao-existe/',
];
async function ready(page: Page) {
  await expect(page.locator('nav.enhanced')).toBeAttached();
}
async function brief(page: Page) {
  await page.goto('/contato/');
  await page.getByLabel('Confeitaria', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('WhatsApp', { exact: true }).check();
  await page.getByLabel('Instagram', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Organizar a operação', { exact: true }).check();
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
      await expect(page.locator('h1')).toHaveCount(1);
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
test('abas, ampliação, foco, zoom e FAQ por teclado', async ({ page }) => {
  await page.goto('/');
  const buyer = page.getByRole('tab', { name: 'Para quem compra' });
  await buyer.focus();
  await page.keyboard.press('ArrowRight');
  const seller = page.getByRole('tab', { name: 'Para quem vende' });
  await expect(seller).toBeFocused();
  await expect(seller).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel').locator('.capture img')).toHaveAttribute(
    'src',
    /admin-web/,
  );
  const enlarge = page.getByRole('button', { name: 'Ampliar imagem' });
  await enlarge.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Ver tamanho original' }).press('Enter');
  await expect(page.getByRole('dialog').locator('img')).toHaveClass('zoom');
  await page.getByRole('region', { name: /Imagem ampliada/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() =>
      page
        .locator('.viewer-scroll')
        .filter({ visible: true })
        .evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(enlarge).toBeFocused();
  await buyer.focus();
  await page.keyboard.press('Home');
  await expect(buyer).toHaveAttribute('aria-selected', 'true');
  const faq = page.locator('summary').first();
  await faq.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await expect(page.locator('details').first()).not.toHaveAttribute('open');
});
test('menu mobile fecha com Escape e ao navegar', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.press('Enter');
  await expect(page.locator('#navigation')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.getByRole('navigation').getByRole('link', { name: 'Soluções' }).click();
  await expect(page).toHaveURL(/#solucoes/);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(() =>
      page.locator('#solucoes').evaluate((el) => Math.abs(el.getBoundingClientRect().top - 32)),
    )
    .toBeLessThan(3);
});
test('validações, voltar, resumo editável, cópia e nenhuma transmissão', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/contato/');
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#brief-error')).toContainText('Selecione');
  await expect(page.getByLabel('Confeitaria', { exact: true })).toBeFocused();
  await page.getByLabel('Confeitaria', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#brief-error')).toContainText('pelo menos um canal');
  await page.getByLabel('WhatsApp', { exact: true }).check();
  await page.getByLabel('Instagram', { exact: true }).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  await expect(page.locator('#brief-error')).toContainText('Selecione o que quer facilitar');
  await page.getByLabel('Organizar a operação', { exact: true }).check();
  await page.locator('#detail').fill('X'.repeat(550));
  await expect(page.locator('#detail')).toHaveValue('X'.repeat(500));
  const marker = 'DETALHE_LOCAL_987';
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url() + (r.postData() || '')));
  await page.locator('#detail').fill(marker);
  await page.getByRole('button', { name: 'Voltar', exact: true }).click();
  await expect(page.getByLabel('WhatsApp', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Instagram', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('#detail')).toHaveValue(marker);
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  await expect(page.locator('#message')).toHaveValue(new RegExp(marker));
  await page.locator('#message').fill('Mensagem editada ' + marker);
  await page.getByRole('button', { name: 'Copiar mensagem' }).click();
  await expect(page.getByRole('status')).toContainText('Mensagem copiada');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Mensagem editada ' + marker,
  );
  await expect(page.getByRole('link', { name: /Abrir Instagram/ })).toHaveAttribute(
    'href',
    'https://www.instagram.com/vendua.digital/',
  );
  await page.getByRole('button', { name: 'Voltar' }).click();
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  await expect(page.locator('#message')).toHaveValue('Mensagem editada ' + marker);
  expect(requests.filter((r) => r.includes(marker))).toEqual([]);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  expect(await context.cookies()).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Confeitaria', { exact: true })).not.toBeChecked();
});
test('clipboard indisponível mantém texto selecionado para recuperação', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', { value: undefined }),
  );
  await brief(page);
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  await page.getByRole('button', { name: 'Copiar mensagem' }).click();
  await expect(page.getByRole('status')).toContainText('Não foi possível copiar automaticamente');
  await expect(page.locator('#message')).toBeFocused();
  expect(
    await page.locator('#message').evaluate((el) => (el as HTMLTextAreaElement).selectionEnd),
  ).toBeGreaterThan(0);
});
test('conteúdo, duas visões, FAQ e contato sem JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 360, height: 800 },
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173/');
  await expect(page.locator('.project-panel:visible')).toHaveCount(2);
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.locator('summary').first().click();
  await expect(page.locator('details').first()).toHaveAttribute('open', '');
  await page.goto('http://127.0.0.1:4173/contato/');
  await expect(
    page.getByText('O assistente de mensagem precisa de JavaScript.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Prefiro falar direto/ })).toBeVisible();
  await page.goto('http://127.0.0.1:4173/nao-existe/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Esse caminho');
  await context.close();
});
test('acessibilidade nas páginas e estados de interação', async ({ page }) => {
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
  await brief(page);
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Para quem vende' }).click();
  await page.getByRole('button', { name: 'Ampliar imagem' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
  await expect(page.locator('a[href*="opensaga"], a[href="/admin"], video')).toHaveCount(0);
});

test('orçamento inicial mobile e capturas dos estados', async ({ page }) => {
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
  expect(initial.filter((file) => file.url.includes('original.png'))).toEqual([]);
  page.removeAllListeners('response');
  await page.getByRole('tab', { name: 'Para quem vende' }).click();
  await page.getByRole('button', { name: 'Ampliar imagem' }).click();
  await page.screenshot({ path: 'artifacts/modal-390.png' });
  await page.keyboard.press('Escape');
  await brief(page);
  await page.getByRole('button', { name: 'Revisar mensagem' }).click();
  await page.screenshot({ path: 'artifacts/resumo-390.png', fullPage: true });
});

test('falha de imagem preserva descrição, legenda e contato', async ({ page }) => {
  await page.route('**/assets/projetos/*.webp', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('tab', { name: 'Para quem compra' }).click();
  await expect(page.getByRole('tabpanel').locator('img').first()).toHaveAttribute(
    'alt',
    /Página inicial do Quero Pudim Gourmet/,
  );
  await expect(
    page
      .getByRole('figure')
      .getByText(
        'Página inicial do Quero Pudim Gourmet. Captura fornecida pelo responsável pelo projeto.',
      ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Conversar sobre meu negócio' })).toBeVisible();
});

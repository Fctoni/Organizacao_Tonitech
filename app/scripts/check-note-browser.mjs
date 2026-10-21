// Production frontend with browser-only fixtures; no real login or database writes.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const origin = 'https://tonitech-inventario.vercel.app';
const fixture = {
  id: '00000000-0000-4000-8000-000000000001', name: 'Cabo USB', aliases: ['fixture'],
  category: 'Cables', shelf: 1, place: 'B01', qty: 2, minimum_safe_stock: 0,
  status: 'in_stock', low_stock: false,
  body: '\r\n # Cabo USB\r\n\r\n- **Blindado**\n- [Manual](https://example.com/manual)\n\n## Especificações\n\n```text\n# Cabo USB\n```\n\n<script>window.noteXss=true</script>\n\n[Inseguro](javascript:alert%281%29)\n\n' + 'TextoLongo'.repeat(80),
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('https://*.supabase.co/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const responses = {
        '/rest/v1/rpc/access_state': 'ready', '/rest/v1/items': [fixture],
        '/rest/v1/categories': [{ name: 'Cables' }], '/rest/v1/movements': [],
      };
      if (!(path in responses)) { errors.push(`Unexpected backend request: ${path}`); return route.abort(); }
      await route.fulfill({ json: responses[path] });
    });
    await context.addInitScript(() => {
      localStorage.setItem('sb-pfhfhrypxncgzmnmlztm-auth-token', JSON.stringify({
        access_token: 'browser-fixture-only', refresh_token: 'browser-fixture-only', token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '00000000-0000-4000-8000-000000000002', email: 'fixture@example.com', aud: 'authenticated', role: 'authenticated' },
      }));
    });
    assert.equal((await page.goto(origin)).status(), 200);
    await page.getByRole('button').filter({ hasText: 'Cabo USB' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('heading', { name: 'Cabo USB', exact: true }).count(), 1);
    assert.equal(await dialog.locator('.note li').count(), 2);
    assert.equal(await dialog.locator('.note strong').textContent(), 'Blindado');
    assert.equal(await dialog.getByRole('link', { name: 'Manual', exact: true }).getAttribute('href'), 'https://example.com/manual');
    assert.equal(await dialog.getByRole('link', { name: 'Inseguro', exact: true }).getAttribute('href'), '');
    assert.equal(await dialog.locator('.note pre code').textContent(), '# Cabo USB\n');
    assert.equal(await dialog.getByRole('heading', { name: 'Especificações' }).count(), 1);
    assert.equal(await page.evaluate(() => window.noteXss), undefined);
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'Dialog has no horizontal overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS production UI ${width}px: initial title, Markdown, XSS, code, responsive dialog; backend fully intercepted`);
    await context.close();
  }
} finally {
  await browser.close();
}

// Authorized transport exception: Playwright Node instead of MCP. No traces, videos or credential logs.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { remoteClients } from './remote.mjs';
import { check } from './local.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
const { admin } = remoteClients();
const origin = 'https://tonitech-inventario.vercel.app';
const email = `browser-${randomUUID()}@example.com`;
const password = randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const fixture = `UI verificação ${randomUUID()}`;
const directory = `../test-evidence/1/${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`;
await mkdir(directory, { recursive: true });
let browser, user, page;
let step = 'setup';
const pageErrors = [];
const failedRequests = [];
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR' });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.name));
  page.on('requestfailed', request => failedRequests.push(new URL(request.url()).pathname));
  const response = await page.goto(origin);
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
  await page.screenshot({ path: `${directory}/01-login-desktop.png` });
  user = check(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user;
  check(await admin.from('access_members').insert({ user_id: user.id }));

  async function login(secret) {
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(secret);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  step = 'pending-login';
  await login(password);
  await page.getByRole('heading', { name: 'Troque sua senha' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Cadastrar Item', exact: true }).count(), 0);
  step = 'password-change';
  await page.getByLabel('Senha atual', { exact: true }).fill(password);
  await page.getByLabel('Nova senha', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirme a nova senha', { exact: true }).fill('invalid-confirmation');
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'A confirmação deve ser igual' }).waitFor();
  await page.getByLabel('Confirme a nova senha', { exact: true }).fill(newPassword);
  const changedResponse = page.waitForResponse(response => response.url().endsWith('/api/change-password'));
  await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
  assert.equal((await changedResponse).status(), 200, 'Production password endpoint');
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
  await login(newPassword);
  await page.getByRole('heading', { name: 'Seus Itens', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: '143 Itens encontrados' }).waitFor();
  console.log('PASS browser: anonymous login, mandatory change, confirmation validation, deployed endpoint, new login');

  step = 'create-item';
  const createButton = page.getByRole('button', { name: 'Cadastrar Item', exact: true });
  await createButton.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  // Tab and Shift+Tab must stay inside the native modal.
  for (let index = 0; index < 16; index++) {
    step = `dialog-tab-${index}`;
    await page.keyboard.press('Tab');
    // Chromium may move through browser chrome (activeElement=BODY) at the end
    // of a native modal's tab sequence; the next tab must return to the dialog.
    if (await page.evaluate(() => document.activeElement === document.body)) await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
  }
  await page.keyboard.press('Shift+Tab');
  step = 'dialog-shift-tab';
  assert.ok(await page.evaluate(() => document.activeElement?.closest('dialog') !== null));
  await dialog.getByLabel('Nome', { exact: true }).fill(fixture);
  step = 'create-submit';
  await dialog.getByLabel('Prateleira', { exact: true }).fill('99');
  await dialog.getByLabel('Place (ex.: B03 ou W12)', { exact: true }).fill('B03');
  await dialog.getByLabel('Quantidade inicial', { exact: true }).fill('5');
  await dialog.getByLabel('Estoque mínimo', { exact: true }).fill('2');
  step = 'create-category';
  await dialog.getByLabel('Categoria').selectOption('Tools');
  step = 'create-aliases';
  await dialog.getByLabel('Aliases separados por vírgula', { exact: true }).fill('teste álias navegador');
  step = 'create-body';
  await dialog.getByLabel('Observações e unidade de medida', { exact: true }).fill('Fixture de validação. Quantidade em peças.');
  step = 'create-save';
  await dialog.getByRole('button', { name: 'Salvar Item', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Item cadastrado.' }).waitFor();
  await dialog.getByRole('heading', { name: fixture, exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  step = 'dialog-focus-return';
  assert.ok(await createButton.evaluate(element => element === document.activeElement));

  step = 'search-and-filters';
  await page.getByLabel('Buscar por nome ou alias', { exact: true }).fill('TESTE ALIAS NAVEGADOR');
  await page.getByRole('status').filter({ hasText: '1 Itens encontrados' }).waitFor();
  await page.getByLabel('Categoria').selectOption('Tools');
  await page.getByLabel('Prateleira').selectOption('99');
  await page.getByLabel('Superfície').selectOption('B');
  await page.getByLabel('Place').selectOption('B03');
  await page.getByLabel('Status').selectOption('in_stock');
  await page.getByRole('status').filter({ hasText: '1 Itens encontrados' }).waitFor();
  await page.screenshot({ path: `${directory}/02-desktop-filters.png` });
  const fixtureButton = page.getByRole('button').filter({ hasText: fixture });
  await fixtureButton.click();

  step = 'take-add';
  await dialog.getByLabel('Quantidade a movimentar', { exact: true }).fill('7');
  await dialog.getByRole('button', { name: 'Retirar', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Quantidade ajustada para zero.' }).waitFor();
  await dialog.getByLabel('Quantidade a movimentar', { exact: true }).fill('3');
  await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await dialog.getByRole('status').filter({ hasText: 'Alteração registrada.' }).waitFor();
  step = 'relocate-recategorize';
  await dialog.getByLabel('Prateleira', { exact: true }).fill('98');
  await dialog.getByLabel('Place (ex.: B03 ou W12)', { exact: true }).fill('W05');
  await dialog.getByRole('button', { name: 'Mover Item', exact: true }).click();
  await dialog.locator('.location').filter({ hasText: 'Prateleira 98 · W05' }).waitFor();
  await dialog.getByLabel('Categoria').selectOption('Hardware');
  await dialog.getByRole('button', { name: 'Salvar categoria', exact: true }).click();
  await dialog.getByText('Tools → Hardware', { exact: false }).waitFor();
  await dialog.getByRole('heading', { name: fixture, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/03-desktop-dialog.png` });
  await dialog.getByText('Tools → Hardware', { exact: false }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/04-desktop-history.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await page.getByLabel('Buscar por nome ou alias', { exact: true }).fill(fixture);

  step = 'mobile';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('status').filter({ hasText: '1 Itens encontrados' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${directory}/05-mobile-top.png` });
  await page.getByRole('button').filter({ hasText: fixture }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/06-mobile-item.png` });
  await page.getByRole('button').filter({ hasText: fixture }).click();
  await dialog.getByRole('heading', { name: fixture, exact: true }).waitFor();
  assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth));
  await page.screenshot({ path: `${directory}/07-mobile-dialog.png` });
  await dialog.getByRole('button', { name: 'Salvar categoria', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/08-mobile-actions-history.png` });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
  assert.equal(pageErrors.length, 0);
  assert.equal(failedRequests.length, 0);
  console.log(`PASS browser: create, accented alias search, filters, take/add, relocate, recategorize/history, keyboard/modal, desktop/mobile, logout; Chromium ${browser.version()}`);
  console.log(`Screenshots: ${directory}`);
} catch (error) {
  // Playwright errors can include fill values; never print their message or stack.
  console.error(`Browser check failed at ${step}; ${error.name}; credential-bearing diagnostics suppressed.`);
  if (page) console.error(`HTTP failures=${failedRequests.length}; JS errors=${pageErrors.length}`);
  if (page && !['setup','pending-login','password-change'].includes(step)) console.error(await page.evaluate(() => ({ focusTag: document.activeElement?.tagName, focusName: document.activeElement?.getAttribute('name'), dialogOpen: !!document.querySelector('dialog[open]') })));
  if (page && step.startsWith('create-')) console.error(await page.locator('dialog select').evaluateAll(elements => elements.map(element => ({name:element.name,options:[...element.options].map(option => option.text)}))));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  check(await admin.from('items').delete().eq('name', fixture));
  if (user) check(await admin.auth.admin.deleteUser(user.id));
  console.log('Browser fixture/user cleanup complete.');
}

// Isolated browser check: real UI, fixture SDK, no database or provider access.
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = '/tmp/opencode/inventory-compact';
await mkdir(evidence, { recursive: true });
const base = { id: 'one', name: 'Cabo de teste', qty: 2, minimum_safe_stock: 5, shelf: 1, place: 'B01', category: 'Cables', status: 'in_stock', low_stock: true, body: 'Unidade: metros.\n\n' + 'Observação preservada.\n\n'.repeat(20), aliases: ['fio'] };
const items = [base, { ...base, id: 'two', name: 'Item esgotado', qty: 0, minimum_safe_stock: 0, low_stock: false, status: 'out', place: 'B02', body: '' }, { ...base, id: 'three', name: 'Item disponível', qty: 8, low_stock: false, place: 'W03', category: 'Tools', body: '- **Unidade:** peças.' }];
const fixture = `export function createClient() {
 const state = window.fixture = { items: ${JSON.stringify(items)}, calls: [], history: [], reads: [], fail: new URLSearchParams(location.search).has('fail'), empty: new URLSearchParams(location.search).has('empty'), delay: 0, mutationFail: false };
 const session = {access_token:'fixture',user:{id:'owner'}};
  return {auth:{onAuthStateChange(cb){
    const changed=()=>cb('TOKEN_REFRESHED',session);
    window.addEventListener('fixture-access',changed);
    queueMicrotask(()=>cb('INITIAL_SESSION',session));
    return {data:{subscription:{unsubscribe(){window.removeEventListener('fixture-access',changed);}}}};
  },signOut:async()=>({})},
 async rpc(name, args) {
    if(name==='access_state') return {data:state.access ?? 'ready'};
   state.calls.push({name,...args}); await new Promise(r=>setTimeout(r,state.delay));
   if(state.mutationFail) return {error:{code:'test'}};
   const item=state.items.find(i=>i.id===args.item_id), before={...item};
   if(args.action==='add') item.qty+=args.input.n;
   if(args.action==='take') item.qty=Math.max(0,item.qty-args.input.n);
   if(args.action==='relocate' || args.action==='recategorize') Object.assign(item,args.input);
   item.status=item.qty===0?'out':'in_stock'; item.low_stock=item.qty<item.minimum_safe_stock;
   state.history.unshift({id:state.calls.length,action:args.action,requested:args.input.n??null,created_at:'2026-10-22T12:00:00Z',before_value:before,after_value:{...item}});
   return {data:{item:{...item},warning:false}};
 },from(table){ const query={select:()=>query,order:()=>query,range:()=>query,eq:()=>query,limit:()=>query,
   async then(resolve){
     state.reads.push(table);
     const result=state.fail && table!=='movements'?{error:{code:'network'}}:{data:structuredClone(table==='items'?(state.empty?[]:state.items):table==='categories'?[{name:'Cables'},{name:'Tools'}]:state.history)};
     if(state.holdNext===table){state.holdNext=null;await new Promise(r=>{state.release=r;});state.release=null;}
     else await new Promise(r=>setTimeout(r,state.delay));
     return resolve(result);
   }};return query;}};
}`;
const server = await createServer({ envFile: false, define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://fixture.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"fixture"' }, plugins: [{ name: 'inventory-fixture', enforce: 'pre', resolveId(id) { if (id === '@supabase/supabase-js') return '\0fixture'; }, load(id) { if (id === '\0fixture') return fixture; } }], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
 const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
 const errors = []; page.on('pageerror', e => errors.push(e.message));
 await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 await page.goto(server.resolvedUrls.local[0]);
 await page.locator('.item').first().waitFor();
 const firstTop = (await page.locator('.item').first().boundingBox()).y;
 console.log('First Item top:', firstTop);
 await page.screenshot({ path: `${evidence}/after-mobile.png` });
  assert.ok(firstTop <= 440, `First Item starts at ${firstTop}px`);
  assert.equal(await page.getByRole('table').count(), 0, 'Mobile exposes only the list');
  const mobileRows = page.getByRole('list', { name: 'Itens do inventário' }).getByRole('button');
  assert.deepEqual(await mobileRows.locator('.item-name').allTextContents(), items.map(item => item.name));
  for (const row of await mobileRows.all()) {
    const bounds = await row.boundingBox();
    assert.ok(bounds.height >= 44 && bounds.height <= 100, `Compact row height: ${bounds.height}`);
    assert.equal(await row.locator('button, a').count(), 0);
  }
  assert.equal(await mobileRows.nth(1).locator('.quantity').innerText(), '0');
  assert.equal(await mobileRows.first().locator('.quantity').innerText(), '2 mt');
  assert.equal(await mobileRows.nth(2).locator('.quantity').innerText(), '8 un');
  assert.match(await mobileRows.first().ariaSnapshot(), /Quantidade: 2.*Prateleira 1/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 const search = page.getByRole('searchbox');
 const toggle = page.getByRole('button', { name: 'Filtros (0)', exact: true });
 assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
 assert.equal(await page.getByRole('combobox', { name: /^Categoria/ }).isVisible(), false);
 await toggle.focus(); await page.keyboard.press('Enter');
 await page.getByRole('combobox', { name: /^Categoria/ }).selectOption('Tools');
 await page.getByRole('button', { name: 'Filtros (1)' }).click();
 await page.getByRole('button', { name: 'Assistente', exact: true }).click();
 await page.getByRole('button', { name: 'Inventário', exact: true }).click();
 assert.equal(await page.getByRole('button', { name: 'Filtros (1)' }).getAttribute('aria-expanded'), 'false');
 await search.fill('ausente');
 await page.getByText('Nenhum resultado para estes filtros.', { exact: true }).waitFor();
 await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
 assert.equal(await search.inputValue(), '');
 assert.equal(await page.locator('.item').count(), 3);
 await page.getByLabel('Abaixo do mínimo', { exact: true }).check();
 assert.equal(await toggle.isVisible(), true);
 assert.equal(await page.locator('.item').count(), 1);
 await page.getByRole('button', { name: 'Limpar filtros' }).click();
 assert.match(await page.locator('.item').nth(0).innerText(), /Mínimo: 5/);
 assert.match(await page.locator('.item').nth(1).innerText(), /Esgotado/);
 assert.doesNotMatch(await page.locator('.item').nth(1).innerText(), /Abaixo do mínimo/);
 assert.doesNotMatch(await page.locator('.item').nth(2).innerText(), /Abaixo do mínimo|Esgotado/);
 await page.evaluate(() => { window.fixture.fail = true; });
 await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
 await page.getByText(/Exibindo os dados da última consulta/).waitFor();
 assert.equal(await page.locator('.item').count(), 3);
 assert.doesNotMatch(await page.locator('main').innerText(), /Confira os campos/);
 await page.evaluate(() => { window.fixture.fail = false; });
 await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
 await page.getByText(/Exibindo os dados da última consulta/).waitFor({ state: 'hidden' });
 const card = page.getByRole('button', { name: /Cabo de teste/ });
  // The location/second line is part of the native button's target.
  await card.locator('.location').click();
 const dialog = page.getByRole('dialog');
 const close = dialog.getByRole('button', { name: 'Fechar', exact: true });
 const movement = dialog.getByRole('spinbutton', { name: 'Quantidade a movimentar' });
 assert.equal(await movement.getAttribute('step'), '1');
 assert.equal(await dialog.getByRole('spinbutton', { name: 'Quantidade a movimentar mt', exact: true }).count(), 1);
 assert.doesNotMatch(await dialog.innerText(), /Use a unidade descrita|Cabos por comprimento/);
 assert.ok((await movement.boundingBox()).y < 600, 'Movement accessible before long notes');
 assert.equal(await dialog.getByRole('button', { name: 'Mover Item' }).isVisible(), false);
 await dialog.getByText('Histórico recente', { exact: true }).scrollIntoViewIfNeeded();
 const closeBounds = await close.boundingBox();
 assert.ok(closeBounds.y >= 0 && closeBounds.y + closeBounds.height < 844);
 await page.screenshot({ path: `${evidence}/mobile-dialog-scrolled.png` });
 await page.keyboard.press('Escape');
 assert.equal(await card.evaluate(e => e === document.activeElement), true);
  await card.focus(); await page.keyboard.press('Enter');
 await movement.fill('1');
 await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await dialog.getByText('Quantidade: 3 mt', { exact: true }).waitFor();
  await dialog.locator('.history').getByText(/Entrada \(1 mt\)/).waitFor();
 await dialog.getByRole('button', { name: 'Retirar', exact: true }).click();
  await dialog.getByText('Quantidade: 2 mt', { exact: true }).waitFor();
  await dialog.locator('.history').getByText(/Retirada \(1 mt\)/).waitFor();
 await dialog.getByText('Localização e categoria', { exact: true }).click();
 await dialog.getByRole('spinbutton', { name: 'Prateleira', exact: true }).fill('4');
 await dialog.getByRole('textbox', { name: /^Place/ }).fill('W12');
 await dialog.getByRole('button', { name: 'Mover Item', exact: true }).click();
 await dialog.locator('.location').getByText(/Prateleira 4 · W12/).waitFor();
 await dialog.getByRole('combobox', { name: /^Categoria/ }).selectOption('Tools');
 await dialog.getByRole('button', { name: 'Salvar categoria', exact: true }).click();
 await dialog.locator('.location').getByText(/Tools/).waitFor();
 const calls = await page.evaluate(() => window.fixture.calls);
 assert.deepEqual(calls.map(({action,input}) => ({action,input})), [{action:'add',input:{n:1}},{action:'take',input:{n:1}},{action:'relocate',input:{shelf:4,place:'W12'}},{action:'recategorize',input:{category:'Tools'}}]);
 assert.ok(calls.every(c => c.name === 'mutate_item' && c.item_id === 'one'));
 await close.click();
 assert.equal(await card.evaluate(e => e === document.activeElement), true);
 // Busy operations cannot double-submit; a failed refresh must not invite repeating a saved Take.
 await card.click();
 await movement.fill('1');
 await page.evaluate(() => { window.fixture.delay = 250; window.fixture.fail = true; });
 await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
 assert.equal(await close.isDisabled(), true);
 assert.equal(await dialog.getByRole('button', { name: 'Retirar', exact: true }).isDisabled(), true);
 await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
 await dialog.getByText(/A alteração já foi salva/).waitFor();
  await dialog.getByText('Quantidade: 3 mt', { exact: true }).waitFor();
 assert.equal(await page.evaluate(() => window.fixture.calls.length), 5);
 await page.evaluate(() => { window.fixture.fail = false; window.fixture.mutationFail = true; });
 await dialog.getByRole('button', { name: 'Retirar', exact: true }).click();
 await dialog.getByText(/Não foi possível concluir/).waitFor();
  assert.equal(await dialog.getByText('Quantidade: 3 mt', { exact: true }).isVisible(), true);
 assert.equal(await dialog.getByText(/Alteração registrada/).count(), 0);
 await close.click();
 await page.goto(server.resolvedUrls.local[0] + '?empty');
 await page.getByText('Nenhum Item cadastrado.', { exact: true }).waitFor();
 assert.equal(await page.getByRole('button', { name: 'Limpar filtros' }).count(), 0);
 await page.goto(server.resolvedUrls.local[0] + '?fail');
 await page.getByText('Não foi possível carregar o inventário.', { exact: true }).waitFor();
 assert.doesNotMatch(await page.locator('main').innerText(), /última consulta|Nenhum Item cadastrado|Confira os campos/);
 await page.evaluate(() => { window.fixture.fail = false; window.fixture.delay = 300; });
 await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
 await page.getByText('Carregando Itens…', { exact: true }).waitFor();
 assert.equal(await page.getByRole('button', { name: 'Atualizar', exact: true }).isDisabled(), true);
 await page.locator('.item').first().waitFor();
 await page.evaluate(() => { window.fixture.delay = 0; });
 await page.screenshot({ path: `${evidence}/after-mobile.png` });
 await card.click();
 await page.screenshot({ path: `${evidence}/mobile-dialog-top.png` });
 await dialog.getByText('Localização e categoria', { exact: true }).click();
 const place = dialog.getByRole('textbox', { name: /^Place/ });
 await place.fill('');
 await dialog.getByText('Localização e categoria', { exact: true }).click();
 await movement.fill('1');
 await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await dialog.getByText('Quantidade: 3 mt', { exact: true }).waitFor();
 await close.click();
 // A long Item name wraps without covering the close button or focused fields.
 await page.evaluate(() => { window.fixture.items[0].name = 'Cabo com nome muito longo para identificar na garagem '.repeat(3); });
 await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
 await page.getByRole('button', { name: /Cabo com nome muito longo/ }).click();
 await movement.focus();
 const titleBounds = await dialog.getByRole('heading', { level: 2 }).boundingBox();
 const longClose = await close.boundingBox();
 const fieldBounds = await movement.boundingBox();
 assert.ok(titleBounds.x + titleBounds.width <= longClose.x);
 assert.ok(fieldBounds.y >= titleBounds.y + titleBounds.height);
 assert.ok(fieldBounds.y + fieldBounds.height < 844);
 await page.screenshot({ path: `${evidence}/mobile-dialog-long-name.png` });
 await close.click();
 await page.getByRole('button', { name: 'Cadastrar Item', exact: true }).click();
 await dialog.getByRole('textbox', { name: 'Observações e unidade de medida' }).focus();
 assert.ok((await close.boundingBox()).y >= 0);
 await page.keyboard.press('Escape');
 assert.equal(await page.getByRole('button', { name: 'Cadastrar Item', exact: true }).evaluate(e => e === document.activeElement), true);
 await page.goto(server.resolvedUrls.local[0]);
 await page.locator('.item').first().waitFor();
 await page.getByRole('button', { name: 'Filtros (0)' }).click();
 await page.getByRole('combobox', { name: /^Categoria/ }).selectOption('Cables');
 await page.getByRole('combobox', { name: /^Prateleira/ }).selectOption('1');
 await page.getByRole('combobox', { name: /^Superfície/ }).selectOption('B');
 await page.getByRole('combobox', { name: /^Place/ }).selectOption('B01');
 await page.getByRole('combobox', { name: /^Status/ }).selectOption('in_stock');
 assert.equal(await page.getByRole('button', { name: 'Filtros (5)' }).getAttribute('aria-controls'), 'extra-filters');
 assert.equal(await page.locator('.item').count(), 1);
 await page.getByRole('button', { name: 'Filtros (5)' }).click();
 assert.equal(await page.getByRole('combobox', { name: /^Status/ }).isVisible(), false);
 await page.getByRole('button', { name: 'Filtros (5)' }).click();
 assert.equal(await page.getByRole('combobox', { name: /^Place/ }).inputValue(), 'B01');
 await page.screenshot({ path: `${evidence}/mobile-filters-expanded.png` });
 await page.setViewportSize({ width: 1440, height: 900 });
 assert.equal(await page.getByRole('combobox', { name: /^Categoria/ }).isVisible(), true);
 assert.equal(await page.getByRole('button', { name: 'Filtros (5)' }).isVisible(), false);
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  const table = page.getByRole('table', { name: 'Itens do inventário' });
  assert.equal(await table.isVisible(), true);
  assert.equal(await page.getByRole('list', { name: 'Itens do inventário' }).count(), 0);
  assert.deepEqual(await table.getByRole('columnheader').allTextContents(), ['Item', 'Localização', 'Categoria', 'Quantidade', 'Mínimo']);
  assert.equal(await table.locator('thead th[scope="col"]').count(), 5);
  assert.equal(await table.locator('[aria-sort], th button, tr[tabindex], tr[role="button"]').count(), 0);
  assert.deepEqual(await table.locator('tbody button').allTextContents(), items.map(item => item.name));
   assert.deepEqual(await table.locator('tbody .quantity').allTextContents(), ['2 mt', '0', '8 un']);
   assert.deepEqual(await table.locator('tbody td:last-child').allTextContents(), ['5 mt', '0', '5 un']);
  const tableQuantity = table.getByRole('row').filter({ has: card }).locator('.quantity');
  await page.screenshot({ path: `${evidence}/after-desktop.png` });
  await search.focus(); await page.keyboard.press('Shift+Tab');
  await card.focus(); await page.keyboard.press('Space');
  await page.screenshot({ path: `${evidence}/desktop-dialog.png` });
  await page.keyboard.press('Escape');
  assert.equal(await card.evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await table.locator('tbody button').nth(1).evaluate(e => e === document.activeElement), true);
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 // WCAG text contrast of both rendered status badges, independent of color perception.
  for (const badge of await page.locator('.stock-badge:visible').all()) {
   const colors = await badge.evaluate(e => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
   const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
   const [a, b] = colors.map(luminance);
   const contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
   assert.ok(contrast >= 4.5); console.log(await badge.innerText(), 'contrast:', contrast.toFixed(2));
 }
 // Freeze the old read before Add; finish the mutation reload before releasing it.
 await page.evaluate(() => { window.fixture.holdNext = 'categories'; });
 await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
 await page.waitForFunction(() => typeof window.fixture.release === 'function');
 await card.click();
 await movement.fill('1');
 await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
 await dialog.getByText('Alteração registrada.', { exact: true }).waitFor();
 await close.click();
  const quantities = [await tableQuantity.innerText()];
 await page.evaluate(async () => { window.fixture.release(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
  quantities.push(await tableQuantity.innerText());
  assert.deepEqual(quantities, ['3 mt', '3 mt'], 'Old refresh must not overwrite the completed mutation reload');
 assert.equal(await page.evaluate(() => window.fixture.calls.length), 1);
 console.log('PASS: ordered DOM quantities after mutation reload / after old refresh:', quantities);
 // An obsolete error must neither clear the latest loading state nor show a stale error.
 await page.evaluate(() => { window.fixture.fail = true; window.fixture.holdNext = 'items'; });
 await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
 await page.waitForFunction(() => typeof window.fixture.release === 'function');
 await page.evaluate(() => { window.fixture.oldRelease = window.fixture.release; window.fixture.release = null; window.fixture.fail = false; window.fixture.holdNext = 'categories'; });
 await card.click(); await movement.fill('1');
 await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click();
 await page.waitForFunction(() => typeof window.fixture.release === 'function');
 // Save the newer release before the older response finishes.
 await page.evaluate(async () => { window.fixture.newRelease = window.fixture.release; window.fixture.oldRelease(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
 assert.equal(await page.getByRole('button', { name: 'Atualizar', exact: true }).isDisabled(), true);
 assert.equal(await page.getByText('Carregando Itens…', { exact: true }).count(), 1);
 assert.equal(await page.getByText(/Exibindo os dados da última consulta/).count(), 0);
 await page.evaluate(() => window.fixture.newRelease());
 await dialog.getByText('Alteração registrada.', { exact: true }).waitFor();
 await close.click();
   assert.equal(await tableQuantity.innerText(), '4 mt');
 assert.equal(await page.getByText(/Exibindo os dados da última consulta/).count(), 0);
 // Access loss invalidates even the latest pending read, before access is granted again.
 await page.evaluate(() => { window.fixture.holdNext = 'categories'; });
 await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
 await page.waitForFunction(() => typeof window.fixture.release === 'function');
 await page.evaluate(() => { window.fixture.access = 'denied'; window.dispatchEvent(new Event('fixture-access')); });
 await page.getByText(/Este acesso não está liberado/).waitFor();
 await page.evaluate(async () => { window.fixture.release(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
 assert.equal(await page.locator('.item').count(), 0);
 await page.evaluate(() => { window.fixture.access = 'ready'; window.fixture.holdNext = 'items'; window.dispatchEvent(new Event('fixture-access')); });
 await page.waitForFunction(() => typeof window.fixture.release === 'function');
 assert.equal(await page.locator('.item').count(), 0, 'A late read cannot repopulate a reset access scope');
 assert.equal(await page.getByText(/Itens encontrados/).count(), 0);
 await page.evaluate(() => window.fixture.release());
 await card.waitFor();
   assert.equal(await tableQuantity.innerText(), '4 mt');
 assert.equal(await page.evaluate(() => window.fixture.calls.length), 2, 'Refresh and access retries must remain read-only');
  console.log('PASS: obsolete error/loading isolation, access-loss invalidation, read-only retries.');
  // Edge cases use the same React UI, including a token without natural wrap points.
  await page.evaluate(() => {
    window.fixture.items[0].name = 'Cabo com nome muito longo para identificar na garagem ' + 'X'.repeat(90);
    window.fixture.items[1].minimum_safe_stock = 5;
    window.fixture.items[1].low_stock = true;
    window.fixture.items[2].qty = 2147483647;
  });
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await table.getByRole('button', { name: /Cabo com nome muito longo/ }).waitFor();
  for (const width of [320, 390, 768, 899, 900, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No horizontal scroll at ${width}`);
    assert.equal(await table.isVisible(), width >= 900);
    if (width < 900) {
      for (const row of await mobileRows.all()) {
        const name = await row.locator('.item-name').boundingBox();
        const qty = await row.locator('.item-quantity').boundingBox();
        const location = await row.locator('.location').boundingBox();
        assert.ok(name.x + name.width <= qty.x, `Name and quantity cannot overlap at ${width}`);
        assert.ok(location.y >= name.y + name.height, 'Location follows the wrapped name');
      }
      assert.match(await mobileRows.nth(1).innerText(), /Esgotado · Mínimo: 5/);
      assert.equal(await mobileRows.nth(1).locator('.quantity').innerText(), '0');
       assert.equal(await mobileRows.nth(2).locator('.quantity').innerText(), '2147483647 un');
      assert.doesNotMatch(await mobileRows.nth(2).innerText(), /unidades|Abaixo do mínimo|Esgotado/);
    } else {
      assert.equal(await table.locator('tbody .quantity').last().evaluate(e => getComputedStyle(e.parentElement).textAlign), 'right');
      assert.equal(await table.locator('tbody .quantity').last().evaluate(e => getComputedStyle(e).fontVariantNumeric), 'tabular-nums');
    }
    if ([320, 900].includes(width)) await page.screenshot({ path: `${evidence}/long-names-${width}.png`, fullPage: true });
  }
  console.log('PASS: semantic table, native row buttons, keyboard/focus, density, zero/threshold, long names and responsive widths 320–1440.');
 console.log('PASS: filters/state/empty/error/retry, quantity/status, dialog/focus/scroll, Add/Take/location/category RPC, busy and saved-operation feedback.');
 assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }

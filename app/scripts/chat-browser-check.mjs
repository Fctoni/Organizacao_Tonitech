// Real React + SDK over local HTTP; auth, inventory and provider are isolated fixtures.
// Run with PLAYWRIGHT_MODULE pointing to an existing Playwright installation.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const evidence = '/tmp/opencode/chat-redesign';
await mkdir(evidence, { recursive: true });
const item = { id: '11111111-1111-4111-8111-111111111111', name: 'Cabo de teste', qty: 8, minimum_safe_stock: 2, shelf: 3, place: 'B02', category: 'Cabos', status: 'in_stock', low_stock: false, body: 'Unidade: metros.', aliases: [] };
const requests = [];
let confirms = 0;
const fixture = `export function createClient() {
 const session = { access_token: 'local-fixture', user: { id: 'fixture-owner' } };
 return { auth: { getSession: async () => ({data:{session}}), onAuthStateChange: cb => {
   const revoke = () => cb('SIGNED_OUT', null); window.addEventListener('fixture-revoke', revoke);
   queueMicrotask(() => cb('INITIAL_SESSION', session));
   return { data: { subscription: { unsubscribe() { window.removeEventListener('fixture-revoke', revoke); } } } };
 }, signOut: async () => ({}) }, rpc: async () => ({data:'ready'}), from: table => {
 const query = { select: () => query, order: () => query, range: () => query, eq: () => query, limit: () => query,
 then: resolve => Promise.resolve({data: table === 'items' ? [${JSON.stringify(item)}] : table === 'categories' ? [{name:'Cabos'}] : []}).then(resolve) }; return query;
 } };
}`;
const server = await createServer({ envFile: false, define: { 'import.meta.env.VITE_SUPABASE_URL': '"http://fixture.invalid"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"fixture"' },
  plugins: [{ name: 'chat-fixtures', enforce: 'pre', resolveId(id) { if (id === '@supabase/supabase-js') return '\0fixture-db'; }, load(id) { if (id === '\0fixture-db') return fixture; }, configureServer(server) {
    server.middlewares.use('/api/chat', async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body);
      const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (body.action === 'settings') return json({ active: { version: 1, body: 'Ajude a localizar Itens.', canEdit: true, created_at: '2026-10-21T12:00:00Z', author: null }, history: [] });
      if (body.action === 'confirm') { confirms++; return confirms === 1 ? json({ message: 'Conexão de teste interrompida.' }, 503) : json({ item: { ...item, qty: 7 } }); }
      if (body.action) return json({ message: 'Ação fora deste roteiro de interface.' }, 400);
      const text = body.messages.at(-1)?.parts[0]?.text || '';
      if (text === 'erro') return json({ message: 'Falha de teste. Tente novamente.' }, 503);
      const runId = `run-${requests.length}`;
      const usage = { runId, sequence: 1, model: 'fixture-model', promptVersion: 1, steps: 1, status: 'complete', inputTokens: 20, outputTokens: 30, totalTokens: 50 };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1', 'X-Chat-Run-Id': runId });
      const emit = value => { if (!res.destroyed) res.write(`data: ${JSON.stringify(value)}\n\n`); };
      emit({ type: 'start', messageId: runId });
      emit({ type: 'text-start', id: 'text' });
      const paragraphs = text.includes('longo') ? 35 : 1;
      for (let i = 0; i < paragraphs; i++) {
        emit({ type: 'text-delta', id: 'text', delta: paragraphs === 1 ? '**Posso ajudar com o inventário.** Consulte a localização ou peça uma movimentação.\n\n' : `### Orientação ${i + 1}\n\nConfira o nome do Item, a localização e a unidade antes de confirmar uma movimentação.\n\n` });
        await new Promise(resolve => setTimeout(resolve, paragraphs === 1 ? 100 : 80));
      }
      emit({ type: 'text-end', id: 'text' });
      if (text.includes('cartão')) {
        emit({ type: 'tool-input-available', toolCallId: 'proposal', toolName: 'proposeChange', input: {} });
        emit({ type: 'tool-output-available', toolCallId: 'proposal', output: { proposal: { id: 'proposal', expiresAt: 2000000000000, requestText: 'Retirar um metro', operation: { action: 'take', item_id: item.id, input: { n: 1 } }, item }, ticket: 'same-fixture-ticket' } });
      }
      emit({ type: 'data-usage', data: usage });
      emit({ type: 'finish', messageMetadata: { responseComplete: true, context: 'signed-fixture-context', usage } });
      res.end('data: [DONE]\n\n');
    });
  } }], server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(server.resolvedUrls.local[0]);
  {
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${evidence}/desktop-empty.png` });
    const field = page.getByRole('textbox', { name: 'Pergunta ou lançamento' });
    const sent = () => requests.filter(body => !body.action);
    const finished = () => page.getByRole('button', { name: 'Parar resposta' }).waitFor({ state: 'hidden' });
    const ask = async text => { await field.fill(text); await field.press('Enter'); await page.getByRole('button', { name: 'Parar resposta' }).waitFor(); await finished(); };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
    const checkItemHeader = async () => {
      assert.match(await page.locator('.chat-item-card').first().innerText(), /Quantidade: 8 mt · Mínimo: 2 mt/);
      assert.equal(await page.getByText('Quantidade a retirar: 1 mt', { exact: true }).count(), 1);
      const header = page.locator('.chat-item-header').first();
      const title = header.locator('strong');
      const open = header.getByRole('button', { name: `Abrir item ${item.name}`, exact: true });
      for (const name of [item.name, 'Nome muito longo de um cabo para testar quebra de linha '.repeat(4), 'X'.repeat(180)]) {
        await title.evaluate((element, text) => { element.textContent = text; }, name);
        const { bounds, label, action, body, textTops } = await header.evaluate(element => {
          const [title, button] = element.children;
          return { bounds: element.getBoundingClientRect().toJSON(), label: title.getBoundingClientRect().toJSON(),
            action: button.getBoundingClientRect().toJSON(), body: element.nextElementSibling.getBoundingClientRect().toJSON(),
            textTops: [...element.children].map(child => {
              const range = document.createRange(); range.selectNodeContents(child);
              return range.getClientRects()[0].top;
            }) };
        });
        assert.ok(Math.abs(label.y - action.y) < 1 && label.x + label.width <= action.x + 1, JSON.stringify({ name, label, action }));
        assert.ok(action.x + action.width <= bounds.x + bounds.width + 1);
        assert.ok(action.width >= 24 && action.height >= 24);
        if (name === item.name) assert.ok(bounds.height >= 24 && bounds.height <= 25);
        assert.ok(Math.abs(textTops[0] - textTops[1]) <= 1);
        assert.ok(body.y - (bounds.y + bounds.height) >= 3 && body.y - (bounds.y + bounds.height) <= 5);
        assert.equal(await header.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      }
      await title.evaluate((element, text) => { element.textContent = text; }, item.name);
      assert.equal(await open.innerText(), 'abrir');
      await header.screenshot({ path: `${evidence}/item-header-${page.viewportSize().width}.png` });
      await open.focus();
      assert.equal(await open.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), true);
      await open.click();
      await page.getByRole('heading', { name: item.name, exact: true }).waitFor();
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    };
    await page.getByRole('button', { name: 'Quais Itens estão abaixo do mínimo?' }).click();
    assert.equal(await field.inputValue(), 'Quais Itens estão abaixo do mínimo?'); assert.equal(sent().length, 0);
    await field.fill('Onde está'); await field.press('Shift+Enter'); await field.press('End'); await field.type('meu Item?');
    assert.equal(await field.inputValue(), 'Onde está\nmeu Item?');
    await field.dispatchEvent('compositionstart');
    await field.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
    assert.equal(sent().length, 0);
    await field.dispatchEvent('compositionend');
    await field.press('Enter'); await field.press('Enter');
    await page.getByRole('button', { name: 'Parar resposta' }).waitFor(); await finished();
    assert.equal(sent().length, 1); assert.equal(sent()[0].messages[0].parts[0].text, 'Onde está\nmeu Item?');
    assert.equal(await field.evaluate(element => element === document.activeElement), true);
    await page.getByText('Tokens da conversa: 50', { exact: true }).waitFor();
    await page.screenshot({ path: `${evidence}/desktop-messages.png` });
    await field.fill('Rascunho preservado');
    await page.getByRole('button', { name: 'Inventário', exact: true }).click();
    await page.getByRole('heading', { name: 'Seus Itens' }).waitFor();
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    assert.equal(await field.inputValue(), 'Rascunho preservado');
    await page.getByText('Tokens da conversa: 50', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('textbox', { name: 'Comportamento', exact: true }).fill('Rascunho do comportamento');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Configurações', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Comportamento', exact: true }).inputValue(), 'Rascunho do comportamento');
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await ask('Mostre o cartão');
    assert.equal(sent().at(-1).context, 'signed-fixture-context');
    await checkItemHeader();
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).click();
    await page.getByText('Conexão de teste interrompida.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).click();
    await page.getByText('Alteração registrada.', { exact: true }).waitFor();
    assert.deepEqual(requests.filter(body => body.action === 'confirm').map(body => body.ticket), ['same-fixture-ticket', 'same-fixture-ticket']);
    await page.screenshot({ path: `${evidence}/desktop-conversation.png` });
    await page.getByText('Tokens da conversa: 100', { exact: true }).click();
    await page.getByText('2 execuções, incluindo tentativas anteriores.', { exact: false }).waitFor();
    await page.screenshot({ path: `${evidence}/desktop-usage.png` });
    await page.getByText('Tokens da conversa: 100', { exact: true }).click();
    // Card interactions may scroll to a button above the bottom. Start this scenario at the end.
    const scroll = page.getByLabel('Conversa', { exact: true });
    await scroll.hover(); await page.mouse.wheel(0, 10000);
    await page.waitForFunction(() => { const element = document.querySelector('.chat-messages'); return element.scrollHeight - element.clientHeight - element.scrollTop < 70; });
    await field.fill('longo'); await field.press('Enter');
    await page.getByRole('heading', { name: 'Orientação 10', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Inventário', exact: true }).click();
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    await page.getByRole('button', { name: 'Parar resposta' }).waitFor();
    await page.waitForFunction(() => { const element = document.querySelector('.chat-messages'); return element.scrollHeight - element.clientHeight - element.scrollTop < 70; });
    assert.equal(await scroll.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop < 70), true);
    await scroll.hover(); await page.mouse.wheel(0, -10000);
    await page.getByRole('button', { name: 'Ir para o fim', exact: false }).waitFor();
    await finished();
    assert.equal(await scroll.evaluate(element => element.scrollTop < 100), true);
    await page.getByRole('button', { name: 'Inventário', exact: true }).click();
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    assert.equal(await scroll.evaluate(element => element.scrollTop < 100), true);
    await page.getByRole('button', { name: 'Ir para o fim', exact: false }).click();
    assert.equal(await scroll.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop < 70), true);
    await field.fill('longo interrompido'); await field.press('Enter');
    await page.getByRole('button', { name: 'Parar resposta' }).click();
    await page.getByText('Resposta não concluída.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tentar resposta novamente' }).click(); await finished();
    await page.getByText('Resposta não concluída.', { exact: false }).waitFor({ state: 'hidden' });
    await field.fill('erro'); await field.press('Enter');
    await page.getByText('Falha de teste. Tente novamente.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tentar resposta novamente' }).click();
    await page.getByText('Falha de teste. Tente novamente.', { exact: false }).waitFor();
    assert.equal(sent().at(-1).messages.at(-1).parts[0].text, 'erro');
    await page.getByText('Tokens da conversa: 200 · incompleto', { exact: true }).waitFor();
    await page.screenshot({ path: `${evidence}/desktop-error.png` });
    await page.getByRole('button', { name: 'Nova conversa', exact: true }).click();
    await page.getByRole('heading', { name: 'O que vamos organizar?' }).waitFor();
    await page.getByText('Tokens da conversa: 0', { exact: true }).waitFor();
    assert.equal(await page.locator('.chat-message').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${evidence}/mobile-empty.png` }); await noOverflow();
    await field.fill('Mensagem com várias linhas\n'.repeat(12));
    assert.equal(await field.evaluate(element => element.clientHeight > 100 && element.clientHeight <= 180), true);
    await page.setViewportSize({ width: 390, height: 480 });
    await field.focus();
    await page.waitForFunction(() => document.querySelector('.chat-send').getBoundingClientRect().bottom <= innerHeight);
    const sendBounds = await page.getByRole('button', { name: 'Enviar mensagem' }).boundingBox();
    assert.ok(sendBounds.y + sendBounds.height <= 480); await noOverflow();
    await page.screenshot({ path: `${evidence}/mobile-keyboard-height.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await ask('Mostre o cartão');
    assert.equal(sent().at(-1).context, undefined);
    await checkItemHeader();
    await page.screenshot({ path: `${evidence}/mobile-card.png` }); await noOverflow();
    await page.getByRole('button', { name: 'Descartar', exact: true }).click();
    await page.getByText('Descartada', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.screenshot({ path: `${evidence}/mobile-settings.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Inventário', exact: true }).click();
    await page.getByRole('button', { name: 'Assistente', exact: true }).click();
    await page.getByText('Tokens da conversa: 50', { exact: true }).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('fixture-revoke')));
    await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
    assert.equal(await page.locator('.inventory-chat').count(), 0);
    assert.equal(await page.locator('.assistant-settings').count(), 0);
    console.log('PASS: Enter/IME, multiline, navigation/state/usage, settings focus, confirmation retry, scrolling, stop/retry/error, reset/revocation, desktop/mobile geometry.');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await server.close(); }

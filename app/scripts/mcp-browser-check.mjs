// Reusable browser slice of the disposable integration fixture; never production.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import chatHandler from '../api/chat.mjs';
import { changePassword } from '../server/change-password.mjs';
import { signChatEnvelope } from '../server/chat-tools.mjs';

export async function checkBrowser({ authOrigin, restOrigin, adminToken, anonToken, users, adminDb, itemId, secret, clientId }) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
  let browser; let vite;
  try {
    // A local gateway supplies the normal Supabase URL layout to the actual SPA.
    vite = await createServer({ logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'mcp-fixture', configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url;
        if (!path.startsWith('/auth/v1/') && !path.startsWith('/rest/v1/') && !path.startsWith('/api/')) return next();
        try {
          if (path === '/api/chat') return await chatHandler(req, res, { env: { CHAT_SIGNING_SECRET: secret, SUPABASE_URL: uiOrigin, SUPABASE_ANON_KEY: anonToken } });
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const body = chunks.length ? Buffer.concat(chunks) : undefined;
          let response;
          if (path === '/api/change-password') {
            const options = { auth: { persistSession: false, autoRefreshToken: false } };
            response = await changePassword(new Request(uiOrigin + path, { method: req.method, headers: req.headers, body }), createClient(uiOrigin, adminToken, options), () => createClient(uiOrigin, anonToken, options));
          } else {
            const upstream = path.startsWith('/auth/v1/') ? authOrigin + path.slice('/auth/v1'.length) : restOrigin + path.slice('/rest/v1'.length);
            response = await fetch(upstream, { method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': req.headers['content-type'] ?? 'application/json' }, body, redirect: 'manual' });
          }
          res.statusCode = response.status;
          res.setHeader('content-type', response.headers.get('content-type') ?? 'application/json');
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.statusCode = 503; res.end('{}'); }
      });
    } }] });
    await vite.listen();
    const uiOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    // Vite substitutes these public values at transform time.
    vite.config.env.VITE_SUPABASE_URL = uiOrigin;
    vite.config.env.VITE_SUPABASE_ANON_KEY = anonToken;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('https://claude.ai/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Fixture callback</p>' }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.name));
    const oauthErrors = [];
    page.on('response', async response => { if (response.url().includes('/oauth/authorizations/') && response.status() >= 400) { const data = await response.json().catch(() => ({})); oauthErrors.push({ status: response.status(), code: data.error_code ?? data.code }); } });
    const item = (await adminDb.query('select *,updated_at::text as updated_at from public.items where id=$1', [itemId])).rows[0];
    const proposal = { id: crypto.randomUUID(), userId: users[0].id, expiresAt: Date.now() + 900000, requestText: 'Fixture navegador', item,
      operation: { action: 'add', item_id: itemId, input: { n: 1 }, expected_updated_at: item.updated_at } };
    const ticket = signChatEnvelope(proposal, 'proposal', secret);
    await adminDb.query('update public.access_members set password_changed_at=null where user_id=$1', [users[0].id]);
    await page.goto(uiOrigin + '/#proposal=' + encodeURIComponent(ticket));
    await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    async function login(user, password = user.password) {
      await page.getByLabel('E-mail', { exact: true }).fill(user.email);
      await page.getByLabel('Senha', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    }
    await login(users[0]);
    await page.getByRole('heading', { name: 'Troque sua senha' }).waitFor();
    const newPassword = randomBytes(24).toString('hex');
    await page.getByLabel('Senha atual', { exact: true }).fill(users[0].password);
    await page.getByLabel('Nova senha', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirme a nova senha').fill(newPassword);
    await page.getByRole('button', { name: 'Alterar senha', exact: true }).click();
    await page.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
    await login(users[0], newPassword);
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).waitFor();
    assert.equal((await adminDb.query('select qty from public.items where id=$1', [itemId])).rows[0].qty, item.qty);
    let lostResponse = false;
    await page.route('**/api/chat', async route => {
      if (route.request().postDataJSON()?.action === 'confirm' && !lostResponse) {
        lostResponse = true; await route.fetch(); await route.abort('failed');
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).click();
    await page.getByText('Confirmada', { exact: true }).waitFor();
    assert.equal((await adminDb.query('select qty from public.items where id=$1', [itemId])).rows[0].qty, item.qty + 1);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    // The same ticket is unusable by another ready user.
    await adminDb.query("update public.access_members set password_changed_at='2020-01-01' where user_id=$1", [users[1].id]);
    await login(users[1]);
    await page.getByText('Não foi possível abrir a solicitação.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Confirmar alteração', exact: true }).count(), 0);
    async function consent(approve) {
      const verifier = randomBytes(48).toString('base64url');
      const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scope: 'email', state: 'fixture', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      const response = await fetch(authOrigin + '/oauth/authorize?' + params, { redirect: 'manual' });
      const authorizationId = new URL(response.headers.get('location')).searchParams.get('authorization_id');
      assert.ok(authorizationId, 'Fixture deve receber authorization_id novo');
      await page.goto(uiOrigin + '/oauth/consent?authorization_id=' + authorizationId);
      try { await page.getByRole('button', { name: approve ? 'Autorizar Claude' : 'Negar acesso', exact: true }).waitFor(); }
      catch { throw new Error(`Consent fixture: errors=${JSON.stringify(oauthErrors)}; headings=${await page.getByRole('heading').allTextContents()}; alerts=${await page.getByRole('alert').allTextContents()}`); }
      assert.equal(new URL(page.url()).search, '');
      await page.getByRole('button', { name: approve ? 'Autorizar Claude' : 'Negar acesso', exact: true }).click();
      await page.waitForURL('https://claude.ai/api/mcp/auth_callback?**');
      const returned = new URL(page.url());
      assert.equal(returned.searchParams.get('state'), 'fixture');
      assert.equal(approve ? !!returned.searchParams.get('code') : returned.searchParams.get('error'), approve ? true : 'access_denied');
    }
    await consent(false); await consent(true);
    assert.deepEqual(errors, []);
    console.log('PASS Chromium SPA: hash cleanup, login/password change/new login intent, explicit confirm, lost-response replay, wrong user, OAuth deny/approve and query cleanup');
  } finally { await browser?.close(); await vite?.close(); }
}

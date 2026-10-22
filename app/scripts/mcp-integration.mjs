// Local disposable DB + Auth/PostgREST containers. Never resets or copies operational data.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpServer } from 'node:http';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, generateKeyPair, exportJWK, createRemoteJWKSet } from 'jose';
import { withInventory } from '../server/mcp-database.mjs';
import { inventoryTools, verifyProposal, signChatEnvelope } from '../server/chat-tools.mjs';
import { verifyMcpToken } from '../server/mcp-auth.mjs';
import { mcpHandler } from '../server/mcp.mjs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const container = 'supabase_db_tonitech-inventory';
const suffix = randomUUID().replaceAll('-', '');
const database = `mcp_test_${suffix}`;
const login = `mcp_test_${suffix}`;
const authContainer = `mcp_auth_test_${suffix}`;
const restContainer = `mcp_rest_test_${suffix}`;
const secret = randomBytes(32).toString('hex');
const cleanupFault = process.argv.find(arg => arg.startsWith('--cleanup-fault='))?.split('=')[1];
assert.ok(cleanupFault === undefined || ['prepare', 'close'].includes(cleanupFault));
const createdContainers = new Set();
function command(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Comando de fixture Docker falhou; saída suprimida.');
  return result.stdout;
}
const info = name => JSON.parse(command(['inspect', name]))[0];
const envOf = info => Object.fromEntries(info.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
const sql = (input, role = 'postgres') => command(['exec', '-i', container, 'psql', '-U', role, '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input);
async function port() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function wait(url) { for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 250)); } throw new Error('Fixture não iniciou.'); }
async function dockerApi(path, body) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath: '/var/run/docker.sock', path, method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
      let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => res.statusCode < 300 ? resolve(data) : reject(new Error(`Docker fixture HTTP ${res.statusCode}`)));
    });
    req.on('error', () => reject(new Error('Docker fixture indisponível.'))); req.end(JSON.stringify(body));
  });
}
async function startContainer(name, image, env, hostPort, containerPort) {
  await dockerApi(`/containers/create?name=${name}`, { Image: image, Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    HostConfig: { NetworkMode: 'supabase_network_tonitech-inventory', PortBindings: { [`${containerPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }] } } });
  createdContainers.add(name);
  await dockerApi(`/containers/${name}/start`);
}
const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
const key = { ...await exportJWK(privateKey), kid: randomUUID(), alg: 'ES256', use: 'sig', key_ops: ['sign', 'verify'] };
const publicJwk = { ...await exportJWK(publicKey), kid: key.kid, alg: 'ES256', use: 'sig' };
let pool; let adminDb; let mcpServer; let mcpClient; let createdBridgeRole = false; let createdDatabase = false;
try {
  command(['exec', container, 'createdb', '-U', 'postgres', database]);
  createdDatabase = true;
  const authInfo = info('supabase_auth_tonitech-inventory');
  const authEnv = envOf(authInfo);
  sql(command(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--schema=auth']), 'supabase_admin');
  sql(command(['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--data-only', '--table=auth.schema_migrations']), 'supabase_admin');
  createdBridgeRole = sql("select count(*) from pg_roles where rolname='inventory_mcp'").trim() === '0';
  for (const name of readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort()) sql(readFileSync(`supabase/migrations/${name}`, 'utf8'));
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  assert.equal(status.status, 0);
  const dbUrl = new URL(JSON.parse(status.stdout).DB_URL);
  assert.equal(dbUrl.hostname, '127.0.0.1'); assert.equal(dbUrl.port, '55432');
  dbUrl.pathname = '/' + database;
  const connectingAdmin = new pg.Client({ connectionString: dbUrl.href });
  try {
    if (cleanupFault === 'prepare') { console.log('INJECT MCP cleanup prepare'); throw new Error('Injected preparation failure'); }
    await connectingAdmin.connect();
    adminDb = connectingAdmin; // Only a connected client belongs to the main lifecycle.
  } catch (error) { await connectingAdmin.end().catch(() => {}); throw error; }
  const password = randomBytes(32).toString('hex');
  await adminDb.query(`create role ${pg.escapeIdentifier(login)} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${pg.escapeLiteral(password)}`);
  await adminDb.query(`grant authenticated to ${pg.escapeIdentifier(login)}`);
  const loginUrl = new URL(dbUrl); loginUrl.username = login; loginUrl.password = password;
  pool = new pg.Pool({ connectionString: loginUrl.href, max: 2, connectionTimeoutMillis: 1000, query_timeout: 11000 });
  const authPort = await port(); const origin = `http://127.0.0.1:${authPort}`;
  const issuer = origin + '/auth/v1';
  const upstreamDb = new URL(authEnv.GOTRUE_DB_DATABASE_URL); upstreamDb.pathname = '/' + database;
  Object.assign(authEnv, { GOTRUE_DB_DATABASE_URL: upstreamDb.href, GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: origin, GOTRUE_SITE_URL: 'http://127.0.0.1:5173',
    GOTRUE_JWT_ISSUER: issuer, GOTRUE_JWT_KEYS: JSON.stringify([key]), GOTRUE_JWT_EXP: '3600', GOTRUE_OAUTH_SERVER_ENABLED: 'true',
    GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: '/oauth/consent', GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: 'false',
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true', GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: 'pg-functions://postgres/inventory_auth/custom_access_token' });
  await startContainer(authContainer, authInfo.Config.Image, authEnv, authPort, 9999);
  await wait(origin + '/health');
  const adminToken = await new SignJWT({ role: 'service_role', aud: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: key.kid }).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  async function auth(path, body, token = adminToken, method = 'POST') {
    const response = await fetch(origin + path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(`Fixture Auth ${path.split('?')[0]} HTTP ${response.status} (${data.error_code ?? data.code ?? 'unknown'})`);
    return data;
  }
  const client = await auth('/admin/oauth/clients', { client_name: 'Fixture Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_type: 'public', token_endpoint_auth_method: 'none' });
  const clientId = client.client_id;
  assert.ok(clientId);
  const resourcePort = await port();
  const resource = `http://127.0.0.1:${resourcePort}/api/mcp`;
  await adminDb.query('insert into inventory_auth.mcp_client(client_id,resource) values($1,$2)', [clientId, resource]);
  for (const client_id of [undefined, 'other-client']) {
    const claims = { sub: randomUUID(), aud: 'authenticated', role: 'authenticated', iat: 100, exp: 3700, client_id, user_metadata: { fixture: true } };
    const result = (await adminDb.query('select inventory_auth.custom_access_token($1::jsonb) as event', [JSON.stringify({ claims, authentication_method: 'token_refresh' })])).rows[0].event;
    assert.deepEqual(result.claims, JSON.parse(JSON.stringify(claims)));
  }
  const users = [];
  for (let i = 0; i < 2; i++) {
    const email = `mcp-${suffix}-${i}@example.com`; const password = randomBytes(24).toString('hex');
    const user = await auth('/admin/users', { email, password, email_confirm: true });
    const session = await auth('/token?grant_type=password', { email, password });
    users.push({ id: user.id, session, email, password });
    await adminDb.query("insert into public.access_members(user_id,password_changed_at) values($1,'2020-01-01')", [user.id]);
  }
  const discovery = await (await fetch(origin + '/.well-known/oauth-authorization-server')).json();
  assert.ok(discovery.code_challenge_methods_supported.includes('S256'));
  assert.equal((await fetch(origin + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).ok, false);
  async function authorize(user, approve) {
    const verifier = randomBytes(48).toString('base64url');
    const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', scope: 'openid email', state: randomUUID(), code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    const response = await fetch(origin + '/oauth/authorize?' + params, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const authorizationId = new URL(response.headers.get('location')).searchParams.get('authorization_id');
    if (!authorizationId) {
      const logs = spawnSync('docker', ['logs', authContainer], { encoding: 'utf8' });
      const errors = (logs.stdout + logs.stderr).split('\n').flatMap(line => { try { const row = JSON.parse(line); return row.error ? [String(row.error).replace(/https?:\/\/\S+|[A-Za-z0-9_.-]{30,}/g, '[redacted]')] : []; } catch { return []; } });
      const description = new URL(response.headers.get('location')).searchParams.get('error_description')?.replace(/https?:\/\/\S+|[A-Za-z0-9_.-]{30,}/g, '[redacted]');
      throw new Error(`OAuth fixture failed: ${errors.join('; ') || description || 'server_error'}`);
    }
    const details = await auth(`/oauth/authorizations/${authorizationId}`, undefined, user.session.access_token, 'GET');
    const decision = details.redirect_url ? details : await auth(`/oauth/authorizations/${authorizationId}/consent`, { action: approve ? 'approve' : 'deny' }, user.session.access_token);
    const redirect = new URL(decision.redirect_url);
    assert.equal(redirect.searchParams.get('state'), params.get('state'));
    return { code: redirect.searchParams.get('code'), error: redirect.searchParams.get('error'), verifier };
  }
  const denied = await authorize(users[1], false); assert.equal(denied.error, 'access_denied');
  const approved = await authorize(users[0], true);
  const exchange = (grant, fields) => fetch(origin + '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: grant, client_id: clientId, ...fields }) });
  assert.equal((await exchange('authorization_code', { code: approved.code, code_verifier: randomBytes(48).toString('base64url'), redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })).ok, false);
  const second = await authorize(users[0], true);
  const exchanged = await exchange('authorization_code', { code: second.code, code_verifier: second.verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  assert.equal(exchanged.status, 200); const tokens = await exchanged.json();
  const config = { issuer, resource, clientId }; const keys = createRemoteJWKSet(new URL(origin + '/.well-known/jwks.json'));
  const identity = await verifyMcpToken(tokens.access_token, config, keys);
  assert.equal(identity.exp - identity.iat, 300);
  assert.ok(tokens.id_token); await assert.rejects(verifyMcpToken(tokens.id_token, config, keys));
  assert.equal(identity.sub, users[0].id);
  assert.equal((await exchange('authorization_code', { code: second.code, code_verifier: second.verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' })).ok, false);
  const refreshed = await exchange('refresh_token', { refresh_token: tokens.refresh_token });
  assert.equal(refreshed.status, 200); const refresh = await refreshed.json();
  assert.ok(refresh.refresh_token !== tokens.refresh_token, 'Refresh token deve rotacionar.');
  assert.equal((await verifyMcpToken(refresh.access_token, config, keys)).sub, users[0].id);
  await assert.rejects(verifyMcpToken(users[0].session.access_token, config, keys));
  console.log('PASS native OAuth: DCR off, PKCE failure, deny/approve, code replay, rotated refresh, hook binding, browser JWT rejected');

  let loseResponse = false;
  mcpServer = createHttpServer(mcpHandler({ env: { MCP_RESOURCE_URL: resource, SUPABASE_URL: origin, MCP_CLIENT_ID: clientId, CHAT_SIGNING_SECRET: secret }, keys, run: async (identity, work, options) => {
    const result = await withInventory(pool, identity, work, options);
    if (options?.write && loseResponse) { loseResponse = false; throw new Error('Fixture lost commit acknowledgement'); }
    return result;
  } }));
  await new Promise(resolve => mcpServer.listen(resourcePort, '127.0.0.1', resolve));
  mcpClient = new Client({ name: 'fixture-real-oauth', version: '1' });
  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${refresh.access_token}` } } }));
  const listed = (await mcpClient.listTools()).tools;
  assert.equal(listed.length, 6);
  assert.ok(listed.filter(tool => tool.name !== 'executeChange').every(tool => tool.annotations.readOnlyHint));
  assert.equal(listed.find(tool => tool.name === 'executeChange').annotations.readOnlyHint, false);
  assert.ok((await mcpClient.callTool({ name: 'categories', arguments: {} })).structuredContent.categories.includes('Tools'));

  const item = (await adminDb.query("insert into public.items(name,shelf,place,qty,category,body,aliases,updated_at) values('Fixture válvula',1,'B01',8,'Hardware','unidades',array['valve'],'2026-01-01T00:00:00.123456Z') returning id")).rows[0];
  await adminDb.query("insert into public.items(name,shelf,place,qty,category,aliases) select 'Pagination fixture '||n,1,'B02',1,'Tools',array['pagination fixture'] from generate_series(1,520) n");
  const tools = repository => inventoryTools(null, { repository, userId: identity.sub, secret, requestText: 'Fixture', signal: AbortSignal.timeout(10000) });
  let proposal = await withInventory(pool, identity, async repository => {
    const t = tools(repository);
    assert.equal((await t.searchItems.execute({ query: 'VALVULA', offset: 0 })).total, 1);
    assert.equal((await t.searchItems.execute({ query: 'valve', offset: 0 })).total, 1);
    const page = await t.searchItems.execute({ query: 'pagination fixture', offset: 500 });
    assert.equal(page.total, 520); assert.equal(page.items.length, 20); assert.equal(page.nextOffset, null);
    const result = await t.proposeChange.execute({ action: 'add', item_id: item.id, input: { n: 2 } });
    assert.match(result.proposal.operation.expected_updated_at, /123456/);
    assert.match(result.proposal.operation.expected_updated_at, /T.*[+]00:00$/);
    return result;
  });
  assert.equal(verifyProposal(proposal.ticket, identity.sub, secret).id, proposal.proposal.id);
  assert.throws(() => verifyProposal(proposal.ticket, users[1].id, secret));
  const proposed = await mcpClient.callTool({ name: 'proposeChange', arguments: { action: 'add', item_id: item.id, input: { n: 2 } } });
  assert.equal(proposed.isError, undefined);
  const ticket = proposed.structuredContent.ticket;
  proposal = { ticket, proposal: verifyProposal(ticket, identity.sub, secret) };
  const execute = async ticket => (await mcpClient.callTool({ name: 'executeChange', arguments: { ticket } })).structuredContent;
  const propose = async operation => (await mcpClient.callTool({ name: 'proposeChange', arguments: operation })).structuredContent;
  const signed = (proposal, purpose = 'proposal') => signChatEnvelope(proposal, purpose, secret);
  assert.equal((await adminDb.query('select count(*)::int as n from public.movements')).rows[0].n, 0, 'propose never writes');
  const concurrent = await Promise.all([execute(ticket), execute(ticket)]);
  for (const result of concurrent) { assert.equal(result.status, 'committed'); assert.equal(result.item.qty, 10); }
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.equal((await execute(ticket)).item.qty, 10);
  assert.equal((await execute(signed({ ...proposal.proposal, expiresAt: 1 }))).status, 'committed');
  assert.equal((await execute(signed({ ...proposal.proposal, operation: { ...proposal.proposal.operation, input: { n: 3 } } }))).code, '22023');
  assert.equal((await execute(signed({ ...proposal.proposal, id: randomUUID(), expiresAt: 1 }))).code, 'PT410');
  assert.equal((await execute(signed({ ...proposal.proposal, id: randomUUID() }))).code, 'PT409');
  for (const invalid of [signed(proposal.proposal, 'conversation'), ticket.replace(/^./, 'x'), signed({ ...proposal.proposal, userId: users[1].id })]) {
    const result = await execute(invalid); assert.equal(result.code, 'INVALID_PROPOSAL'); assert.equal(result.retryable, false);
  }
  assert.equal((await adminDb.query('select count(*)::int as n from public.movements where item_id=$1', [item.id])).rows[0].n, 1);
  const created = await propose({ action: 'create', input: { name: 'MCP execution fixture', shelf: 2, place: 'W03', qty: 5, minimum_safe_stock: 2, category: 'Tools', aliases: [], body: 'unidades' } });
  created.ticket = signed({ ...created.proposal, expiresAt: Date.now() + 1500 });
  loseResponse = true;
  assert.equal((await execute(created.ticket)).status, 'uncertain');
  const recovered = await execute(created.ticket);
  assert.equal(recovered.status, 'committed'); assert.equal(recovered.item.qty, 5);
  assert.equal(recovered.item.extra_fields, undefined);
  for (const operation of [{ action: 'take', input: { n: 8 } }, { action: 'add', input: { n: 4 } }, { action: 'relocate', input: { shelf: 3, place: 'B003' } }, { action: 'recategorize', input: { category: 'Hardware' } }]) {
    const pending = await propose({ ...operation, item_id: recovered.item.id });
    const result = await execute(pending.ticket);
    assert.equal(result.status, 'committed');
    if (operation.action === 'take') { assert.equal(result.item.qty, 0); assert.equal(result.warning, true); }
    if (operation.action === 'add') assert.equal(result.item.qty, 4);
    if (operation.action === 'relocate') { assert.equal(result.item.shelf, 3); assert.equal(result.item.place, 'B03'); }
    if (operation.action === 'recategorize') assert.equal(result.item.category, 'Hardware');
  }
  assert.equal((await adminDb.query('select count(*)::int as n from public.movements where item_id=$1', [recovered.item.id])).rows[0].n, 5);
  // A committed ticket returns its earlier result, not today's Item snapshot.
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.equal((await execute(created.ticket)).item.qty, 5);
  assert.ok(!('executeChange' in tools({})), 'embedded chat model never receives execution');
  console.log('PASS official MCP execution: all five operations, concurrent exactly-once, lost response, expired replay, conflict, collision, invalid tickets, warning');
  const otherApproval = await authorize(users[1], true);
  const otherExchange = await exchange('authorization_code', { code: otherApproval.code, code_verifier: otherApproval.verifier, redirect_uri: 'https://claude.ai/api/mcp/auth_callback' });
  assert.equal(otherExchange.status, 200);
  const otherTokens = await otherExchange.json();
  const otherClient = new Client({ name: 'fixture-other-user', version: '1' });
  try {
    await otherClient.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${otherTokens.access_token}` } } }));
    const denied = await otherClient.callTool({ name: 'executeChange', arguments: { ticket } });
    assert.equal(denied.structuredContent.code, 'INVALID_PROPOSAL'); assert.equal(denied.isError, true);
  } finally { await otherClient.close(); }
  const other = { ...identity, sub: users[1].id };
  await adminDb.query('update public.access_members set password_changed_at=null where user_id=$1', [other.sub]);
  for (let i = 0; i < 8; i++) {
    const results = await Promise.allSettled([withInventory(pool, identity, repo => repo.item(item.id)), withInventory(pool, other, repo => repo.item(item.id))]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  }
  await assert.rejects(withInventory(pool, identity, () => { throw new Error('fixture abort'); }));
  await withInventory(pool, identity, repo => assert.equal(repo.execute, undefined));
  await assert.rejects(pool.query('select id from public.items'));
  const cancelled = await propose({ action: 'add', item_id: recovered.item.id, input: { n: 7 } });
  // Disconnect while the fixed RPC waits on a real row lock. The bridge must
  // roll back once the query finishes, before acknowledging/committing anything.
  await adminDb.query('BEGIN');
  await adminDb.query('select id from public.items where id=$1 for update', [recovered.item.id]);
  const controller = new AbortController();
  const disconnected = fetch(resource, { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${refresh.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'tools/call', params: { name: 'executeChange', arguments: { ticket: cancelled.ticket } } }) }).catch(error => error);
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = (await adminDb.query("select exists(select 1 from pg_stat_activity where usename=$1 and wait_event_type='Lock') as waiting", [login])).rows[0].waiting;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true);
    controller.abort(); await disconnected;
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { controller.abort(); await adminDb.query('ROLLBACK'); }
  for (let i = 0; i < 100 && pool.idleCount !== pool.totalCount; i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await adminDb.query('select count(*)::int as n from public.inventory_operations where operation_id=$1', [cancelled.proposal.id])).rows[0].n, 0);
  assert.equal((await execute(cancelled.ticket)).item.qty, 11);
  const timedOut = await propose({ action: 'add', item_id: recovered.item.id, input: { n: 1 } });
  await adminDb.query('BEGIN');
  await adminDb.query('LOCK TABLE public.items IN ACCESS EXCLUSIVE MODE');
  try {
    await assert.rejects(withInventory(pool, identity, repo => repo.item(item.id)), error => error.code === '57014');
    const result = await execute(timedOut.ticket);
    assert.equal(result.status, 'transient'); assert.equal(result.retryable, true);
  }
  finally { await adminDb.query('ROLLBACK'); }
  assert.equal((await execute(timedOut.ticket)).item.qty, 12);
  await assert.rejects(withInventory(pool, identity, async repo => { await new Promise(resolve => setTimeout(resolve, 10500)); return repo.item(item.id); }));
  assert.ok(pool.totalCount <= 2);
  const connection = await pool.connect();
  const clean = await connection.query("select current_user, nullif(current_setting('request.jwt.claims',true),'') as claims"); connection.release();
  assert.equal(clean.rows[0].current_user, login); assert.equal(clean.rows[0].claims, null);
  await adminDb.query('delete from public.access_members where user_id=$1', [identity.sub]);
  await assert.rejects(withInventory(pool, identity, repo => repo.item(item.id)));
  await assert.rejects(mcpClient.callTool({ name: 'executeChange', arguments: { ticket } }), 'revocation blocks even committed replay');
  await adminDb.query("insert into public.access_members(user_id,password_changed_at) values($1,'2020-01-01')", [identity.sub]);
  await adminDb.query('update public.access_members set password_changed_at=null where user_id=$1', [identity.sub]);
  await assert.rejects(mcpClient.callTool({ name: 'executeChange', arguments: { ticket } }));
  await adminDb.query("update public.access_members set password_changed_at='2020-01-01' where user_id=$1", [identity.sub]);
  assert.equal((await fetch(resource, { method: 'POST', headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' }, body: '{}' })).status, 401);
  await assert.rejects(withInventory(pool, { ...identity, iat: 0 }, repo => repo.item(item.id)));
  console.log('PASS PostgreSQL bridge: restricted login, wrong-user/pending/revoked replay denied, disconnect rollback, transient timeout/retry, claims isolation, microseconds');

  const restInfo = info('supabase_rest_tonitech-inventory'); const restEnv = envOf(restInfo);
  const restDb = new URL(restEnv.PGRST_DB_URI); restDb.pathname = '/' + database;
  Object.assign(restEnv, { PGRST_DB_URI: restDb.href, PGRST_JWT_SECRET: JSON.stringify({ keys: [publicJwk] }), PGRST_DB_ANON_ROLE: 'anon' });
  delete restEnv.PGRST_JWT_AUD; // Prove denial even if Data API accepts custom audience.
  const restPort = await port();
  await startContainer(restContainer, restInfo.Config.Image, restEnv, restPort, 3000);
  await wait(`http://127.0.0.1:${restPort}/`);
  for (const [path, body] of [['/items?select=id'], ['/categories?select=name'], ['/movements?select=id'],
    ['/rpc/create_item', { input: { name: 'Forbidden fixture', shelf: 1, place: 'B01', qty: 1, category: 'Tools' } }],
    ['/rpc/mutate_item', { item_id: item.id, action: 'add', input: { n: 1 } }],
    ['/rpc/execute_inventory_operation', { operation_id: randomUUID(), payload: proposal.proposal.operation, expires_at: new Date(Date.now() + 60000).toISOString() }]]) {
    const response = await fetch(`http://127.0.0.1:${restPort}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${refresh.access_token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok([401, 403].includes(response.status));
  }
  const privileges = (await adminDb.query("select has_schema_privilege('anon','inventory_auth','usage') as schema, has_function_privilege('anon','public.create_item(jsonb)','execute') as create_item, has_function_privilege('authenticated','inventory_auth.custom_access_token(jsonb)','execute') as hook")).rows[0];
  assert.deepEqual(privileges, { schema: false, create_item: false, hook: false });
  const browser = createClient('http://127.0.0.1:' + restPort, 'fixture', { global: { fetch: (url, options) => fetch(String(url).replace('/rest/v1/', '/'), options), headers: { Authorization: `Bearer ${users[0].session.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const args = { operation_id: proposal.proposal.id, payload: proposal.proposal.operation, expires_at: new Date(proposal.proposal.expiresAt).toISOString() };
  const results = await Promise.all([browser.rpc('execute_inventory_operation', args), browser.rpc('execute_inventory_operation', args)]);
  for (const result of results) { assert.equal(result.error, null); assert.equal(result.data.item.qty, 10); }
  assert.equal((await browser.rpc('execute_inventory_operation', { ...args, payload: { ...args.payload, input: { n: 3 } } })).error.code, '22023');
  assert.equal((await browser.rpc('execute_inventory_operation', { ...args, expires_at: '2020-01-01' })).data.item.qty, 10);
  assert.equal((await browser.rpc('execute_inventory_operation', { ...args, operation_id: randomUUID(), expires_at: '2020-01-01' })).error.code, 'PT410');
  assert.equal((await browser.rpc('execute_inventory_operation', { ...args, operation_id: randomUUID() })).error.code, 'PT409');
  assert.equal((await adminDb.query('select count(*)::int as n from public.movements where item_id=$1', [item.id])).rows[0].n, 1);
  await adminDb.query("insert into public.movements(item_id,action,before_value,after_value) select $1,'add','{\"qty\":10,\"extra_fields\":{\"private\":\"fixture-hidden\"}}','{\"qty\":10,\"body\":\"fixture-hidden\"}' from generate_series(1,21)", [item.id]);
  const history = await mcpClient.callTool({ name: 'history', arguments: { id: item.id } });
  assert.equal(history.structuredContent.movements.length, 20);
  assert.ok(Number.isSafeInteger(history.structuredContent.nextBefore));
  assert.ok(!JSON.stringify(history).includes('fixture-hidden'));
  console.log('PASS real Data API: OAuth anon cannot read/write; browser confirmation uses existing RPC; concurrent replay exactly once and collision rejected');
  const revoked = await fetch(origin + '/user/oauth/grants?client_id=' + clientId, { method: 'DELETE', headers: { Authorization: `Bearer ${users[0].session.access_token}` } });
  assert.ok(revoked.ok);
  assert.equal((await exchange('refresh_token', { refresh_token: refresh.refresh_token })).ok, false);
  await verifyMcpToken(refresh.access_token, config, keys);
  console.log('PASS grant revocation blocks refresh; already issued JWT remains valid until its maximum five-minute expiry (documented limit)');
  if (process.argv.includes('--browser')) {
    const anonToken = await new SignJWT({ role: 'anon', aud: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: key.kid }).setIssuedAt().setExpirationTime('10m').sign(privateKey);
    const { checkBrowser } = await import('./mcp-browser-check.mjs');
    await checkBrowser({ authOrigin: origin, restOrigin: `http://127.0.0.1:${restPort}`, adminToken, anonToken, users, adminDb, itemId: item.id, secret, clientId });
  }
} catch (error) {
  // Failure diagnostics also exclude tokens, passwords, tickets and provider payloads.
  console.error('FAIL MCP fixture', { kind: error.name, code: /^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : undefined,
    location: error.stack?.split('\n').find(line => line.trim().startsWith('at ') && /mcp-(integration|browser-check)\.mjs:\d+:\d+/.test(line))?.trim() });
  process.exitCode = 1;
} finally {
  const failures = [];
  const clean = async (step, work) => {
    try { await work(); } catch { failures.push(step); }
  };
  await clean('mcp-client', async () => {
    await mcpClient?.close();
    if (cleanupFault === 'close') { console.log('INJECT MCP cleanup close'); throw new Error('Injected close failure'); }
  });
  await clean('http-server', async () => {
    if (mcpServer) await new Promise((resolve, reject) => {
      mcpServer.closeAllConnections(); mcpServer.close(error => error ? reject(error) : resolve());
    });
  });
  for (const name of createdContainers) await clean(name === authContainer ? 'auth-container' : 'rest-container', () => command(['rm', '-f', name]));
  await clean('pool', () => pool?.end());
  await clean('admin-connection', () => adminDb?.end());
  // Use the independent local admin channel even if the Node connection never opened
  // or failed during teardown. FORCE targets only this run's randomly named database.
  const clusterSql = input => command(['exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input);
  if (createdDatabase) await clean('database', () => command(['exec', container, 'dropdb', '-U', 'supabase_admin', '--if-exists', '--force', database]));
  await clean('login-role', () => clusterSql(`drop role if exists ${pg.escapeIdentifier(login)}`));
  if (createdBridgeRole) await clean('bridge-role', () => clusterSql('drop role if exists inventory_mcp'));
  await clean('verify-leftovers', () => {
    const databases = Number(clusterSql(`select count(*) from pg_database where datname = ${pg.escapeLiteral(database)}`).trim());
    const roles = Number(clusterSql(`select count(*) from pg_roles where rolname in (${pg.escapeLiteral(login)}${createdBridgeRole ? ", 'inventory_mcp'" : ''})`).trim());
    const names = command(['ps', '-a', '--format', '{{.Names}}']).trim().split('\n');
    const containers = names.filter(name => name === authContainer || name === restContainer).length;
    console.log('MCP fixture leftovers', { databases, roles, containers });
    assert.equal(databases + roles + containers, 0);
  });
  if (failures.length) {
    console.error('FAIL MCP fixture cleanup', { steps: failures });
    process.exitCode = 1;
  }
}

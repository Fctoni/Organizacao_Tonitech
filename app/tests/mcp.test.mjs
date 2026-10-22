import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { verifyMcpToken } from '../server/mcp-auth.mjs';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpHandler } from '../server/mcp.mjs';
import { inventoryTools } from '../server/chat-tools.mjs';
import { withInventory } from '../server/mcp-database.mjs';
import { EventEmitter } from 'node:events';

const config = { issuer: 'https://fixture.supabase.co/auth/v1', resource: 'https://inventory.example/api/mcp', clientId: 'fixture-client' };
test('MCP aceita somente access token destinado ao recurso e cliente registrado', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'fixture' }] });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: config.issuer, aud: config.resource, client_id: config.clientId, role: 'anon', sub: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', iat: now, exp: now + 300 };
  const sign = value => new SignJWT(value).setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).sign(privateKey);
  assert.equal((await verifyMcpToken(await sign(claims), config, keys)).sub, claims.sub);
  for (const patch of [{ aud: 'authenticated' }, { aud: [config.resource, 'authenticated'] }, { client_id: 'other' }, { role: 'authenticated' }, { session_id: undefined }, { exp: now - 1 }, { iat: now + 60 }, { exp: now + 4000 }, { iss: 'https://attacker.example' }]) {
    await assert.rejects(verifyMcpToken(await sign({ ...claims, ...patch }), config, keys));
  }
});

test('ponte não anuncia sucesso quando o COMMIT perde resposta e descarta a conexão', async () => {
  const connection = new EventEmitter();
  const statements = []; let discarded;
  connection.query = async text => {
    statements.push(text);
    if (text === 'COMMIT') throw new Error('Connection lost');
    return { rows: [{ state: 'ready' }] };
  };
  connection.release = failed => { discarded = failed; };
  await assert.rejects(withInventory({ connect: async () => connection }, { sub: 'fixture' }, async () => 'result', { write: true }), error => error.outcome === 'uncertain');
  assert.equal(statements.at(-1), 'ROLLBACK');
  assert.equal(discarded, true);
  assert.equal(connection.listenerCount('error'), 0);
});

test('cliente oficial inicializa stateless, lista e chama ferramentas; HTTP protege discovery e negociação', async t => {
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'fixture' }] });
  const env = { SUPABASE_URL: 'http://127.0.0.1:55431', MCP_CLIENT_ID: 'fixture-client', CHAT_SIGNING_SECRET: 'fixture-signing-secret-123456789012345' };
  const item = { id: '00000000-0000-4000-8000-000000000004', name: 'TESTITEM', qty: 8, minimum_safe_stock: 0,
    shelf: 999, place: 'B99', category: 'Tools', aliases: [], body: 'Unidade: peças', updated_at: '2026-10-21T00:00:00Z' };
  const operation = { action: 'take', item_id: item.id, input: { n: 2 } };
  let committed = false;
  let executedProposal;
  let executionError;
  const handler = mcpHandler({ env, keys, run: async (_, work, options) => {
    const result = await work({ categories: async () => [{ name: 'Tools' }], item: async id => { assert.equal(id, item.id); return item; },
      execute: async proposal => { if (executionError) throw executionError; executedProposal = proposal; return { item: { ...item, qty: 6, extra_fields: { hidden: true } }, warning: false }; } });
    if (options?.write) committed = true;
    return result;
  } });
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  env.MCP_RESOURCE_URL = `http://127.0.0.1:${server.address().port}/api/mcp`;
  const url = new URL(env.MCP_RESOURCE_URL);
  const unauth = await fetch(url);
  assert.equal(unauth.status, 401);
  const metadataUrl = unauth.headers.get('www-authenticate').match(/resource_metadata="([^"]+)"/)[1];
  const metadata = await (await fetch(metadataUrl)).json();
  assert.equal(metadata.resource, url.href);
  assert.deepEqual(metadata.authorization_servers, [env.SUPABASE_URL + '/auth/v1']);
  assert.equal((await fetch(url, { headers: { origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(url + '?access_token=forbidden')).status, 400);
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sub: '00000000-0000-4000-8000-000000000001', session_id: '00000000-0000-4000-8000-000000000002', role: 'anon', client_id: env.MCP_CLIENT_ID })
    .setProtectedHeader({ alg: 'ES256', kid: 'fixture' }).setIssuer(env.SUPABASE_URL + '/auth/v1').setAudience(url.href).setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey);
  const client = new Client({ name: 'fixture', version: '1' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const listed = (await client.listTools()).tools;
  assert.deepEqual(listed.map(tool => tool.name).sort(), ['categories', 'executeChange', 'getItem', 'history', 'proposeChange', 'searchItems']);
  assert.equal(listed.find(tool => tool.name === 'executeChange').annotations.readOnlyHint, false);
  assert.equal(listed.find(tool => tool.name === 'executeChange').annotations.idempotentHint, true);
  const instructions = client.getInstructions();
  assert.match(instructions, /executeChange/);
  assert.match(instructions, /confirmação conversacional/);
  assert.match(instructions, /servidor não atesta confirmação humana/);
  assert.doesNotMatch(JSON.stringify({ instructions, listed }), /cartão|reviewUrl|mcp-request/i);
  const propose = listed.find(tool => tool.name === 'proposeChange');
  assert.match(propose.description, /sem gravar/);
  assert.match(propose.description, /executeChange/);
  assert.equal(propose.annotations.readOnlyHint, true);
  assert.deepEqual(listed.find(tool => tool.name === 'executeChange').inputSchema.required, ['ticket']);
  assert.ok(!('executeChange' in inventoryTools(null, { repository: {} })));
  const prepared = await client.callTool({ name: 'proposeChange', arguments: operation });
  assert.equal(prepared.isError, undefined);
  assert.equal(committed, false);
  assert.equal(executedProposal, undefined);
  assert.deepEqual(JSON.parse(prepared.content[0].text), prepared.structuredContent);
  assert.doesNotMatch(prepared.content[0].text, /cartão|reviewUrl|mcp-request/i);
  const { ticket, proposal } = prepared.structuredContent;
  assert.equal(typeof ticket, 'string');
  assert.ok(ticket.length > 0);
  assert.deepEqual(proposal.operation, { ...operation, expected_updated_at: item.updated_at });
  assert.equal(proposal.item.qty, 8);
  const executed = await client.callTool({ name: 'executeChange', arguments: { ticket } });
  assert.equal(executed.structuredContent.status, 'committed');
  assert.equal(executed.structuredContent.item.qty, 6);
  assert.deepEqual(executedProposal, proposal);
  assert.deepEqual(JSON.parse(executed.content[0].text), executed.structuredContent);
  assert.doesNotMatch(executed.content[0].text, /cartão|reviewUrl|mcp-request/i);
  assert.equal(committed, true);
  assert.equal(executed.structuredContent.item.extra_fields, undefined);
  executionError = Object.assign(new Error('Fixture version conflict'), { code: 'PT409' });
  const conflict = await client.callTool({ name: 'executeChange', arguments: { ticket } });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.status, 'definitive');
  assert.equal(conflict.structuredContent.code, 'PT409');
  assert.equal(conflict.structuredContent.retryable, false);
  assert.doesNotMatch(conflict.content[0].text, /cartão|reviewUrl|mcp-request/i);
  const result = await client.callTool({ name: 'categories', arguments: {} });
  assert.deepEqual(result.structuredContent, { categories: ['Tools'] });
  for (const method of ['GET', 'DELETE', 'PUT']) assert.equal((await fetch(url, { method, headers: { authorization: `Bearer ${token}` } })).status, 405);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/html' }, body: '{}' })).status, 406);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': 'bad' }, body: '{}' })).status, 400);
});

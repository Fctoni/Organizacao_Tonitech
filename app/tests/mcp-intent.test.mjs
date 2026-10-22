import test from 'node:test';
import assert from 'node:assert/strict';
import { captureMcpIntent, claudeRedirect } from '../src/mcp-intent.ts';
import { chat } from '../server/chat.mjs';
import { signChatEnvelope } from '../server/chat-tools.mjs';

test('intenção sai da URL e permanece em memória durante login; retorno aceita somente callback Claude', () => {
  const replaced = [];
  const history = { replaceState: (...args) => replaced.push(args[2]) };
  assert.deepEqual(captureMcpIntent({ href: 'https://inventory.example/#proposal=fixture.ticket' }, history), { kind: 'proposal', value: 'fixture.ticket' });
  assert.deepEqual(captureMcpIntent({ href: 'https://inventory.example/oauth/consent?authorization_id=fixture&redirect=https://attacker.example' }, history), { kind: 'consent', value: 'fixture' });
  assert.deepEqual(replaced, ['/', '/oauth/consent?redirect=https%3A%2F%2Fattacker.example']);
  assert.equal(claudeRedirect('https://claude.ai/api/mcp/auth_callback?code=fixture&state=fixture'), 'https://claude.ai/api/mcp/auth_callback?code=fixture&state=fixture');
  for (const url of ['javascript:alert(1)', 'https://claude.ai.attacker.example/api/mcp/auth_callback', 'https://claude.ai/other', 'https://a@claude.ai/api/mcp/auth_callback']) assert.throws(() => claudeRedirect(url));
});

test('review valida usuário e acesso sem escrever nem chamar modelo; mesmo ticket serve para confirm', async () => {
  const env = { CHAT_SIGNING_SECRET: 'fixture-signing-secret-123456789012345' };
  const proposal = { id: 'fixture', userId: 'owner', expiresAt: Date.now() + 1000, operation: { action: 'add' } };
  const ticket = signChatEnvelope(proposal, 'proposal', env.CHAT_SIGNING_SECRET);
  for (const [userId, state, status] of [['owner', 'ready', 200], ['other', 'ready', 403], ['owner', 'password_required', 403]]) {
    const response = await chat(new Request('http://localhost/api/chat', { method: 'POST', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ action: 'review', ticket }) }), {
      env, model: () => assert.fail('sem modelo'), client: () => ({ auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, rpc: async name => { assert.equal(name, 'access_state'); return { data: state }; } }),
    });
    assert.equal(response.status, status);
    if (status === 200) assert.deepEqual((await response.json()).proposal, proposal);
  }
});

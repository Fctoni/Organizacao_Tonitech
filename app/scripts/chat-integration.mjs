import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { localClients, check } from './local.mjs';
import { inventoryTools } from '../server/chat-tools.mjs';
import { chat } from '../server/chat.mjs';

// Fixed local client, never testClients (which can target remote). All reads/writes use fixture IDs.
const { admin, client, url, anonKey } = localClients();
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
const users = []; const items = [];
const secret = randomBytes(32).toString('hex');
const env = { CHAT_SIGNING_SECRET: secret };
try {
  const password = randomBytes(24).toString('base64url');
  const email = `chat-test-${randomUUID()}@example.com`;
  const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true })); users.push(user.id);
  const member = client();
  const { session } = check(await member.auth.signInWithPassword({ email, password }));
  check(await admin.from('access_members').insert({ user_id: user.id, password_changed_at: '2020-01-01' }));
  const api = body => chat(new Request('http://localhost/api/chat', { method: 'POST', headers: { authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) }), { client: () => member, env });
  const tools = () => inventoryTools(member, { userId: user.id, secret, requestText: 'Pedido fixture explícito', signal: new AbortController().signal });
  const propose = operation => tools().proposeChange.execute(operation);
  const confirm = ticket => api({ action: 'confirm', ticket });
  const operation = { action: 'create', input: { name: `Chat fixture ${user.id}`, shelf: 1, place: 'B003', qty: 5, minimum_safe_stock: 2, category: 'Tools', aliases: ['Medição fixture'], body: 'Unidade: peças.' } };
  const proposal = await propose(operation);
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => confirm(proposal.ticket)));
  for (const response of concurrent) assert.equal(response.status, 200, await response.clone().text());
  const created = await concurrent[0].json(); items.push(created.item.id);
  for (const response of concurrent.slice(1)) assert.deepEqual(await response.json(), created);
  assert.equal(created.item.qty, 5); assert.equal(created.item.place, 'B03');
  assert.equal(check(await member.from('movements').select('id').eq('item_id', created.item.id)).length, 1);
  assert.ok((await member.from('inventory_operations').select('*')).error);
  assert.equal((await confirm(`${proposal.ticket.slice(0, -5)}xxxxx`)).status, 403);
  assert.equal((await api({ action: 'confirm', ticket: 'unsigned' })).status, 403);
  const collision = await member.rpc('execute_inventory_operation', { operation_id: proposal.proposal.id, payload: { ...operation, input: { ...operation.input, qty: 9 } }, expires_at: '2000-01-01' });
  assert.equal(collision.error.code, '22023');
  const recovered = check(await member.rpc('execute_inventory_operation', { operation_id: proposal.proposal.id, payload: proposal.proposal.operation, expires_at: '2000-01-01' }));
  assert.deepEqual(recovered, { ...created, item: { ...created.item, extra_fields: {} } });
  assert.equal((await member.rpc('execute_inventory_operation', { operation_id: randomUUID(), payload: operation, expires_at: '2000-01-01' })).error.code, 'PT410');
  console.log('PASS concurrent create/replay → one item, one movement; collision and unsigned/tampered approval rejected');

  for (const [action, input, expected] of [
    ['take', { n: 9 }, { qty: 0, status: 'out', low_stock: true, warning: true }],
    ['add', { n: 3 }, { qty: 3, status: 'in_stock', low_stock: false, warning: false }],
    ['relocate', { shelf: 2, place: 'W005' }, { shelf: 2, place: 'W05' }],
    ['recategorize', { category: 'Hardware' }, { category: 'Hardware' }],
  ]) {
    const p = await propose({ action, item_id: created.item.id, input });
    const responses = await Promise.all(Array.from({ length: 10 }, () => confirm(p.ticket)));
    const first = await responses[0].json();
    assert.equal(responses[0].status, 200, JSON.stringify(first));
    for (const response of responses.slice(1)) assert.deepEqual(await response.json(), first);
    for (const [key, value] of Object.entries(expected)) assert.equal(key === 'warning' ? first.warning : first.item[key], value);
  }
  assert.equal(check(await member.from('movements').select('id').eq('item_id', created.item.id)).length, 5);
  const ledger = check(await admin.from('inventory_operations').select('movement_id,actor').eq('actor', user.id));
  assert.equal(ledger.length, 5); assert.ok(ledger.every(row => row.movement_id && row.actor === user.id));
  console.log('PASS concurrent take/add/relocate/recategorize, floor/warning/status/low stock, audit link');

  const stale = await propose({ action: 'add', item_id: created.item.id, input: { n: 1 } });
  check(await member.rpc('mutate_item', { item_id: created.item.id, action: 'add', input: { n: 1 } }));
  const staleResult = await member.rpc('execute_inventory_operation', { operation_id: stale.proposal.id, payload: stale.proposal.operation, expires_at: new Date(stale.proposal.expiresAt).toISOString() });
  assert.equal(staleResult.error?.code, 'PT409', JSON.stringify(staleResult.error));
  assert.equal((await confirm(stale.ticket)).status, 409);
  for (const n of [-1, 1.5, null, 2147483648]) await assert.rejects(propose({ action: 'add', item_id: created.item.id, input: { n } }));
  await assert.rejects(propose({ action: 'relocate', item_id: created.item.id, input: { place: 'B01' } }));
  await assert.rejects(propose({ action: 'recategorize', item_id: created.item.id, input: { category: 'invented' } }));
  assert.ok((await tools().categories.execute({})).categories.includes('Tools'));
  assert.equal((await tools().history.execute({ id: created.item.id })).movements.length, 6);
  assert.equal((await tools().getItem.execute({ id: created.item.id })).item.body, 'Unidade: peças.');
  for (const [invalid, status, message] of [
    [operation, 409, /Já existe um Item/],
    [{ action: 'add', item_id: created.item.id, input: { n: 2147483647 } }, 422, /limite/],
  ]) {
    const rejected = await propose(invalid);
    const response = await confirm(rejected.ticket);
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.retryable, false);
    assert.match(body.message, message);
    assert.equal(check(await member.from('items').select('qty').eq('id', created.item.id).single()).qty, 4);
    assert.equal(check(await member.from('movements').select('id').eq('item_id', created.item.id)).length, 6);
    assert.equal(check(await admin.from('inventory_operations').select('operation_id').eq('actor', user.id).eq('operation_id', rejected.proposal.id)).length, 0);
  }
  console.log('PASS duplicate name/overflow are terminal; no movement or ledger entry committed');
  // Exercise the production client factory with two real, distinct Bearer JWTs.
  const otherEmail = `chat-other-${randomUUID()}@example.com`;
  const otherUser = check(await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true })).user;
  users.push(otherUser.id);
  const other = client();
  const otherSession = check(await other.auth.signInWithPassword({ email: otherEmail, password })).session;
  const realApi = (token, body) => chat(new Request('http://localhost/api/chat', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), {
    env: { ...env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, GEMINI_MODEL: 'fixture', GOOGLE_GENERATIVE_AI_API_KEY: 'fixture' },
    model: () => assert.fail('denied/confirmation must not call model'),
  });
  assert.equal((await realApi(otherSession.access_token, { messages: [{ role: 'user', parts: [{ type: 'text', text: 'Consultar' }] }] })).status, 403);
  check(await admin.from('access_members').insert({ user_id: otherUser.id, password_changed_at: '2020-01-01' }));
  const isolated = await Promise.all([
    realApi(session.access_token, { action: 'confirm', ticket: proposal.ticket }),
    realApi(otherSession.access_token, { action: 'confirm', ticket: proposal.ticket }),
  ]);
  assert.equal(isolated[0].status, 200);
  assert.deepEqual(await isolated[0].json(), created);
  assert.equal(isolated[1].status, 403);
  assert.equal(check(await member.from('movements').select('id').eq('item_id', created.item.id)).length, 6);
  console.log('PASS real endpoint client/Bearer isolation, other-user ticket denied, unlisted blocked before model');
  check(await admin.from('access_members').update({ password_changed_at: null }).eq('user_id', user.id));
  assert.equal((await confirm(proposal.ticket)).status, 403);
  assert.ok((await member.rpc('execute_inventory_operation', { operation_id: randomUUID(), payload: operation, expires_at: new Date(Date.now() + 60000).toISOString() })).error);
  check(await admin.from('access_members').update({ password_changed_at: new Date(Date.now() + 60000).toISOString() }).eq('user_id', user.id));
  assert.equal((await confirm(proposal.ticket)).status, 403);
  console.log('PASS stale proposal, validation, real JWT membership/password/freshness gates, scoped reads');
} finally {
  for (const id of items) check(await admin.from('items').delete().eq('id', id));
  for (const id of users) check(await admin.auth.admin.deleteUser(id));
}

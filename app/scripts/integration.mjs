import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testClients as localClients, check } from './local.mjs';

const { admin, client } = localClients();
const ids = [];
try {
  const password = randomBytes(24).toString('base64url');
  const email = `test-${randomBytes(8).toString('hex')}@example.com`;
  const { user } = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }));
  ids.push(user.id);
  const member = client();
  check(await member.auth.signInWithPassword({ email, password }));
  check(await admin.from('access_members').insert({ user_id: user.id, password_changed_at: '2020-01-01T00:00:00Z' }));
  const item = check(await member.rpc('create_item', { input: { name: `Teste ${user.id}`, shelf: 1, place: 'B003', qty: 5, category: 'Tools', minimum_safe_stock: 2, aliases: ['furadeira'] } }));
  assert.equal(item.place, 'B03');
  assert.equal(item.qty, 5);
  const taken = check(await member.rpc('mutate_item', { item_id: item.id, action: 'take', input: { n: 9 } }));
  assert.equal(taken.item.qty, 0);
  assert.equal(taken.item.status, 'out');
  assert.equal(taken.warning, true);
  console.log('PASS create → take excess → zero/status/warning');
  const anonymous = client();
  assert.ok((await anonymous.from('items').select('*')).error);
  assert.ok((await anonymous.rpc('mutate_item', { item_id: item.id, action: 'add', input: { n: 1 } })).error);
  assert.ok((await anonymous.auth.signUp({ email: `signup-${user.id}@example.com`, password })).error);
  const outsiderEmail = `test-outsider-${user.id}@example.com`;
  const outsiderUser = check(await admin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true })).user;
  ids.push(outsiderUser.id);
  const outsider = client();
  check(await outsider.auth.signInWithPassword({ email: outsiderEmail, password }));
  assert.deepEqual(check(await outsider.from('items').select('*')), []);
  assert.equal(check(await outsider.rpc('access_state')), 'denied');
  assert.ok((await outsider.rpc('mutate_item', { item_id: item.id, action: 'take', input: { n: 1 } })).error);
  check(await admin.from('access_members').update({ password_changed_at: null }).eq('user_id', user.id));
  assert.deepEqual(check(await member.from('items').select('*')), []);
  assert.ok((await member.rpc('mutate_item', { item_id: item.id, action: 'add', input: { n: 1 } })).error);
  assert.ok((await member.rpc('create_item', { input: {} })).error);
  check(await member.auth.updateUser({ data: { password_changed_at: '2020-01-01', role: 'admin' } }));
  assert.equal(check(await member.rpc('access_state')), 'password_required');
  assert.ok((await member.from('access_members').update({ password_changed_at: '2020-01-01' }).eq('user_id', user.id)).error);
  check(await admin.from('access_members').delete().eq('user_id', user.id));
  assert.equal(check(await member.rpc('access_state')), 'denied');
  assert.deepEqual(check(await member.from('items').select('*')), []);
  check(await admin.from('access_members').insert({ user_id: user.id, password_changed_at: '2020-01-01' }));
  assert.ok((await member.from('items').update({ qty: 999 }).eq('id', item.id)).error);
  assert.ok((await member.from('movements').delete().eq('item_id', item.id)).error);
  assert.ok((await member.from('source_snapshots').select('*')).error);
  assert.ok((await member.rpc('export_inventory')).error);
  console.log('PASS anonymous, unlisted, pending, metadata bypass, direct writes, snapshots, signup');
  for (const input of [{ n: -1 }, { n: 1.5 }, {}, { n: null }]) {
    assert.ok((await member.rpc('mutate_item', { item_id: item.id, action: 'add', input })).error);
  }
  assert.ok((await member.rpc('mutate_item', { item_id: item.id, action: 'relocate', input: { shelf: 2 } })).error);
  assert.ok((await member.rpc('mutate_item', { item_id: item.id, action: 'recategorize', input: { category: 'invented' } })).error);
  for (const result of await Promise.all(Array.from({ length: 20 }, () => member.rpc('mutate_item', { item_id: item.id, action: 'add', input: { n: 1 } })))) check(result);
  assert.equal(check(await member.from('items').select('qty').eq('id', item.id).single()).qty, 20);
  for (const result of await Promise.all(Array.from({ length: 20 }, () => member.rpc('mutate_item', { item_id: item.id, action: 'take', input: { n: 2 } })))) check(result);
  assert.equal(check(await member.from('items').select('qty').eq('id', item.id).single()).qty, 0);
  const history = check(await member.from('movements').select('*').eq('item_id', item.id).order('id'));
  assert.equal(history.length, 42);
  for (let index = 1; index < history.length; index++) assert.equal(history[index].before_value.qty, history[index - 1].after_value.qty);
  console.log('PASS atomic concurrent add/take, audit chain, invalid inputs');
  assert.ok((await member.rpc('create_item', { input: { name: `Teste ${user.id} invalid`, shelf: 1, place: 'B01', qty: 1, category: 'Tools', aliases: [null] } })).error);
  const moved = check(await member.rpc('mutate_item', { item_id: item.id, action: 'relocate', input: { shelf: 2, place: 'W005' } }));
  assert.equal(moved.item.shelf, 2); assert.equal(moved.item.place, 'W05'); assert.equal(moved.item.qty, 0);
  const categorized = check(await member.rpc('mutate_item', { item_id: item.id, action: 'recategorize', input: { category: 'Hardware' } }));
  assert.equal(categorized.item.category, 'Hardware'); assert.deepEqual(categorized.item.aliases, ['furadeira']);
  console.log('PASS canonical Place, aliases validation, full relocation and recategorization');
} finally {
  for (const id of ids) {
    check(await admin.from('items').delete().like('name', `Teste ${id}%`));
    check(await admin.auth.admin.deleteUser(id));
  }
}

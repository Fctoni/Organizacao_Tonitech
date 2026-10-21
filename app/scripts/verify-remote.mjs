import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { remoteClients } from './remote.mjs';
import { exportVault } from './import.mjs';
import { check } from './local.mjs';
const { admin } = remoteClients();
const payload = exportVault();
const backup = check(await admin.rpc('export_inventory'));
const expected = [...payload.items, ...payload.sources].sort((a,b) => a.filename.localeCompare(b.filename));
assert.equal(backup.items.length, 143);
assert.equal(backup.originals.length, expected.length);
for (const source of expected) {
  const actual = backup.originals.find(row => row.filename === source.filename);
  assert.equal(actual.sha256, source.sha256);
  assert.equal(createHash('sha256').update(Buffer.from(actual.original_base64, 'base64')).digest('hex'), source.sha256);
  if (source.projection) {
    const item = backup.items.find(item => item.name === source.projection.note);
    for (const field of ['shelf','place','qty','minimum_safe_stock','category','aliases','status']) assert.deepEqual(item[field], source.projection[field]);
    assert.equal(item.body, source.body);
    assert.deepEqual(item.extra_fields, source.frontmatter);
  }
}
const { users } = check(await admin.auth.admin.listUsers());
assert.equal(users.filter(user => /^(test|password|browser)-/.test(user.email ?? '')).length, 0);
const manifest = createHash('sha256').update(JSON.stringify(expected.map(({ filename, sha256 }) => ({ filename, sha256 })))).digest('hex');
console.log(JSON.stringify({ project: process.env.INVENTORY_PROJECT_REF, items: backup.items.length,
  originals: backup.originals.length, categories: new Set(backup.items.map(x => x.category)).size,
  shelves: new Set(backup.items.map(x => x.shelf)).size, locations: new Set(backup.items.map(x => `${x.shelf}/${x.place}`)).size,
  in_stock: backup.items.filter(x => x.status === 'in_stock').length, out: backup.items.filter(x => x.status === 'out').length,
  low_stock: backup.items.filter(x => x.low_stock).length, manifest_sha256: manifest, ephemeral_users: 0,
  owner_exists: users.some(user => user.email === 'felipetonietto@gmail.com') }));
const result = spawnSync('supabase', ['migration', 'list', '--linked'], { encoding: 'utf8' });
if (result.status) throw new Error('Falha ao verificar migrations remotas.');
console.log(result.stdout);

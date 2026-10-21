import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { testClients as localClients, check } from './local.mjs';
import { exportVault } from './import.mjs';

const { admin } = localClients();
const before = exportVault();
const name = `Import test ${randomUUID()}`;
const raw = Buffer.from('---\nqty: 5\n---\nBody original\r\n');
const entry = { filename: `${name}.md`, sha256: createHash('sha256').update(raw).digest('hex'), original_base64: raw.toString('base64'),
  projection: { note: name, shelf: 1, place: 'W01', qty: 5, minimum_safe_stock: 2, category: 'Tools', aliases: ['alias'] }, body: 'Body original\r\n', frontmatter: { custom: 'preserved' }, references: [] };
const payload = { version: 1, items: [entry], sources: [] };
try {
  assert.equal(check(await admin.rpc('import_inventory', { payload })).inserted, 1);
  const imported = check(await admin.from('items').select('*').eq('name', name).single());
  assert.equal(imported.shelf, 1); assert.equal(imported.place, 'W01'); assert.equal(imported.minimum_safe_stock, 2);
  assert.equal(imported.body, entry.body); assert.deepEqual(imported.aliases, ['alias']); assert.deepEqual(imported.extra_fields, entry.frontmatter);
  check(await admin.from('items').update({ qty: 17 }).eq('name', name));
  assert.equal(check(await admin.rpc('import_inventory', { payload })).inserted, 0);
  assert.equal(check(await admin.from('items').select('qty').eq('name', name).single()).qty, 17);
  const snapshot = check(await admin.from('source_snapshots').select('*').eq('filename', entry.filename).single());
  assert.deepEqual(Buffer.from(snapshot.original_base64, 'base64'), raw);
  const backup = check(await admin.rpc('export_inventory'));
  assert.ok(backup.items.some(item => item.name === name && item.qty === 17));
  assert.ok(backup.originals.some(source => source.filename === entry.filename && source.sha256 === entry.sha256));
  const changedRaw = Buffer.from('changed');
  const changed = { ...entry, original_base64: changedRaw.toString('base64'), sha256: createHash('sha256').update(changedRaw).digest('hex') };
  assert.ok((await admin.rpc('import_inventory', { payload: { ...payload, items: [changed] } })).error);
  assert.ok((await admin.rpc('import_inventory', { payload: { ...payload, items: [{ ...entry, sha256: '0'.repeat(64) }] } })).error);
  assert.deepEqual(exportVault(), before, 'Real vault bytes and projection unchanged');
  console.log('PASS idempotent import preserves app changes, changed-origin/hash refusal, exact-byte recovery, vault unchanged');
} finally {
  check(await admin.from('source_snapshots').delete().eq('filename', entry.filename));
  check(await admin.from('items').delete().eq('name', name));
}

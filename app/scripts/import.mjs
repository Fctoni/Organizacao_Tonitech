import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { localClients, check } from './local.mjs';

export function exportVault() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const payload = JSON.parse(execFileSync(resolve(root, '.claude/scripts/inventory.sh'), ['export'], {
    env: { ...process.env, VAULT_DIR: root }, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }));
  for (const source of [...payload.items, ...payload.sources]) {
    if (createHash('sha256').update(Buffer.from(source.original_base64, 'base64')).digest('hex') !== source.sha256) throw new Error('Hash inválido');
  }
  return payload;
}

export async function importVault(admin) {
  const payload = exportVault();
  const result = check(await admin.rpc('import_inventory', { payload }));
  const originals = check(await admin.from('source_snapshots').select('filename,sha256'));
  const hashes = new Map(originals.map(row => [row.filename, row.sha256]));
  for (const source of [...payload.items, ...payload.sources]) {
    if (hashes.get(source.filename) !== source.sha256) throw new Error('Reconciliação falhou');
  }
  console.log(JSON.stringify({ ...result, items: payload.items.length, sources: payload.sources.length,
    references: payload.items.flatMap(item => item.references).length, reconciled: true }));
  return payload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await importVault(localClients().admin);

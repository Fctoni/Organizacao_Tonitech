import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { exportVault } from './import.mjs';
const directory = await mkdtemp('/tmp/opencode/tonitech-backup-');
const path = `${directory}/backup.json`;
try {
  const env = { ...process.env };
  delete env.INVENTORY_PROJECT_REF;
  const result = spawnSync(process.execPath, ['scripts/backup.mjs', path], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Local backup command succeeds');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  const backup = JSON.parse(await readFile(path, 'utf8'));
  const expected = exportVault();
  for (const original of [...expected.items, ...expected.sources]) {
    const saved = backup.originals.find(row => row.filename === original.filename);
    assert.equal(createHash('sha256').update(Buffer.from(saved.original_base64, 'base64')).digest('hex'), original.sha256);
  }
  assert.notEqual(spawnSync(process.execPath, ['scripts/backup.mjs', path], { env, encoding: 'utf8' }).status, 0, 'Existing backup never overwritten');
  console.log('PASS private backup, all original hashes recoverable, existing file protected');
} finally {
  await rm(directory, { recursive: true, force: true });
}

// Permanent fault-injection check. The integration owns and verifies its local fixtures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const fault of ['prepare', 'close']) {
  const result = spawnSync(process.execPath, ['scripts/mcp-integration.mjs', `--cleanup-fault=${fault}`], { encoding: 'utf8' });
  // Never echo child diagnostics: assertions must not print captured provider payloads.
  assert.ok(!result.error && result.status === 1, `Expected injected ${fault} failure`);
  assert.ok(result.stdout.includes(`INJECT MCP cleanup ${fault}`), `Fault ${fault} was not reached`);
  assert.ok(result.stdout.includes('MCP fixture leftovers { databases: 0, roles: 0, containers: 0 }'), `Cleanup incomplete after ${fault}`);
  if (fault === 'prepare') {
    assert.ok(result.stderr.includes('FAIL MCP fixture {'), 'Preparation fault was not reached');
    assert.ok(!result.stderr.includes('FAIL MCP fixture cleanup'), 'Preparation cleanup failed');
  } else {
    assert.ok(result.stderr.includes("FAIL MCP fixture cleanup { steps: [ 'mcp-client' ] }"), 'Close fault did not stay isolated');
    assert.ok(!result.stderr.includes('FAIL MCP fixture {'), 'Integration failed before close fault');
  }
  console.log(`PASS MCP cleanup ${fault}: injected failure; databases=0 roles=0 containers=0`);
}

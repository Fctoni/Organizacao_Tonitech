import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const server = spawn(process.execPath, ['scripts/dev-local.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
let ready = false;
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:5173');
      const html = await response.text();
      if (html.includes('Inventário ToniTech')) { ready = true; break; }
    } catch { /* Wait for Vite, bounded by the loop. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Local HTTP server ready');
  assert.equal((await fetch('http://127.0.0.1:5173/api/change-password')).status, 405);
  const response = await fetch('http://127.0.0.1:5173/api/change-password', { method: 'POST', body: '{}' });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  console.log('PASS HTTP app shell and server endpoint method/auth/cache boundaries (not browser validation)');
} finally {
  server.kill('SIGTERM');
}

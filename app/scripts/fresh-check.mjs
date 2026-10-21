import { spawnSync } from 'node:child_process';
import { localClients } from './local.mjs';
// Fixed --local destination: never reset a linked remote project.
const reset = spawnSync('supabase', ['db', 'reset', '--local'], { encoding: 'utf8' });
if (reset.status) throw new Error('Reset local falhou; saída suprimida para proteger credenciais.');
console.log('PASS empty local database → complete migration chain');
const { admin } = localClients();
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  const result = await admin.from('categories').select('name');
  if (!result.error && result.data.length === 11) { ready = true; break; }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('Schema cache não ficou pronto em 30 segundos');
for (const script of ['integration.mjs', 'password-integration.mjs', 'import-integration.mjs', 'import.mjs', 'backup-integration.mjs', 'verify.mjs']) {
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit' });
  if (result.status) process.exit(result.status);
}

import { spawnSync } from 'node:child_process';
import { remoteClients } from './remote.mjs';
const cli = process.env.VERCEL_CLI_PATH;
if (!cli) throw new Error('Informe VERCEL_CLI_PATH da instalação autenticada.');
const { url, anonKey, admin } = remoteClients();
const scope = ['--scope', 'felipes-projects-93cc7c39'];
const project = 'tonitech-inventario';
const variables = {
  VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey,
  SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: admin.supabaseKey,
};
for (const [name, value] of Object.entries(variables)) {
  const result = spawnSync(process.execPath, [cli, 'env', 'add', name, '--environment', 'production',
    '--project', project, '--yes', '--force', name.startsWith('VITE_') ? '--no-sensitive' : '--sensitive', ...scope],
  { input: value, encoding: 'utf8' });
  if (result.status) throw new Error(`Falha ao configurar ${name}; saída suprimida.`);
  console.log(`Configured ${name} (value hidden)`);
}
const result = spawnSync(process.execPath, [cli, 'deploy', '--prod', '--project', project, '--yes', '--json', ...scope], { encoding: 'utf8' });
if (result.status) {
  let text = `${result.stdout}\n${result.stderr}`;
  for (const value of Object.values(variables)) text = text.replaceAll(value, '[REDACTED]');
  // Only diagnostic error lines, never the full administrative response.
  console.error(text.split('\n').filter(line => /error|failed/i.test(line)).join('\n'));
  process.exit(1);
}
let data;
try { data = JSON.parse(result.stdout); } catch { throw new Error('Deploy executado; consultar Vercel para confirmar URL.'); }
console.log(JSON.stringify({ id: data.id, url: data.url, alias: data.alias, readyState: data.readyState, status: data.status }));

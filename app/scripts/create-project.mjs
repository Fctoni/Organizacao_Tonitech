// Captures all provider output; generated database password never reaches logs or disk.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const password = randomBytes(32).toString('hex');
const listing = spawnSync('supabase', ['projects', 'list', '-o', 'json'], { encoding: 'utf8' });
if (listing.status || JSON.parse(listing.stdout).some(project => project.name === 'Tonitech-Inventario')) {
  throw new Error('Não foi possível confirmar ausência de projeto dedicado. Revise antes de criar.');
}
const result = spawnSync('supabase', ['projects', 'create', 'Tonitech-Inventario',
  '--org-id', 'msxuixhofofwiecxcvkr', '--region', 'sa-east-1', '--size', 'micro',
  '--db-password', password, '-o', 'json'], { encoding: 'utf8' });
if (result.status !== 0) {
  // Only report recognized operational causes, never raw output containing credentials.
  const output = result.stdout + result.stderr;
  const quota = output.match(/[^\n]*(?:maximum|quota|limit)[^\n]*/gi);
  if (quota) console.error(quota.join('\n').replaceAll(password, '[REDACTED]'));
  console.error(/limit|quota|maximum/i.test(output) ? 'Project creation blocked: quota/limit.' :
    /permission|forbidden|unauthorized/i.test(output) ? 'Project creation blocked: permission.' : 'Project creation failed; inspect provider dashboard.');
  process.exitCode = 1;
} else {
  const value = JSON.parse(result.stdout);
  console.log(JSON.stringify({ id: value.id, name: value.name, region: value.region, status: value.status }));
  if (!/^[a-z]{20}$/.test(value.id ?? '') || value.name !== 'Tonitech-Inventario') throw new Error('Resposta inesperada; conferir criação no dashboard antes de repetir.');
  const linked = spawnSync('supabase', ['link', '--project-ref', value.id, '--password', password], { encoding: 'utf8' });
  if (linked.status) throw new Error('Projeto criado; vínculo local falhou. Conferir dashboard antes de repetir.');
  console.log('Projeto dedicado vinculado. Nenhuma migration remota aplicada.');
}

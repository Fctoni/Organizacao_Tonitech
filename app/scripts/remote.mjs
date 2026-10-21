import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

// Administrative output is always captured and never included in thrown errors.
export function remoteClients() {
  const ref = process.env.INVENTORY_PROJECT_REF;
  if (!/^[a-z]{20}$/.test(ref ?? '')) throw new Error('Confirme INVENTORY_PROJECT_REF do projeto dedicado.');
  const listing = spawnSync('supabase', ['projects', 'list', '-o', 'json'], { encoding: 'utf8' });
  if (listing.status) throw new Error('Não foi possível conferir projeto remoto.');
  const project = JSON.parse(listing.stdout).find(project => project.id === ref);
  if (!project || project.name !== 'Tonitech-Inventario' || project.organization_id !== 'msxuixhofofwiecxcvkr') throw new Error('Destino não é o projeto dedicado autorizado.');
  const result = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8' });
  if (result.status) throw new Error('Não foi possível obter credenciais administrativas.');
  const keys = JSON.parse(result.stdout);
  const key = keys.find(key => key.name === 'service_role')?.api_key;
  if (!key) throw new Error('Service role indisponível; nenhuma alternativa automática.');
  const anonKey = keys.find(key => key.name === 'anon')?.api_key;
  if (!anonKey) throw new Error('Chave pública indisponível.');
  const url = `https://${ref}.supabase.co`;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return { url, anonKey, admin: createClient(url, key, options), client: () => createClient(url, anonKey, options) };
}

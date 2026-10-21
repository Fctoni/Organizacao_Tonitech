import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { remoteClients } from './remote.mjs';

export function testClients() {
  return process.env.INVENTORY_PROJECT_REF ? remoteClients() : localClients();
}

export function localClients() {
  const result = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  if (result.status) throw new Error('Supabase local indisponível');
  const config = JSON.parse(result.stdout);
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    url: config.API_URL,
    anonKey: config.ANON_KEY,
    admin: createClient(config.API_URL, config.SERVICE_ROLE_KEY, options),
    client: () => createClient(config.API_URL, config.ANON_KEY, options),
  };
}

export function check(result) {
  if (result.error) throw new Error(`${result.error.code ?? 'API'}: ${result.error.message}`);
  return result.data;
}

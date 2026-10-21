import { spawnSync } from 'node:child_process';
import { localClients } from './local.mjs';
const { url, anonKey } = localClients();
const result = spawnSync('npm', ['run', 'build'], { env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey }, stdio: 'inherit' });
process.exitCode = result.status ?? 1;

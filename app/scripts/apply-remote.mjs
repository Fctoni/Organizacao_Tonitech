import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { remoteClients } from './remote.mjs';
remoteClients(); // Confirm identity before any DDL or Auth configuration write.
const ref = process.env.INVENTORY_PROJECT_REF;
if (readFileSync('supabase/.temp/project-ref', 'utf8').trim() !== ref) throw new Error('CLI vinculada a outro projeto.');
for (const args of [['db', 'push', '--linked', '--yes'], ['config', 'push', '--project-ref', ref, '--yes']]) {
  const result = spawnSync('supabase', args, { encoding: 'utf8' });
  if (result.status) {
    console.error(`Falha em ${args.slice(0, 2).join(' ')}; saída administrativa suprimida.`);
    process.exit(1);
  }
  console.log(`${args.slice(0, 2).join(' ')}: OK (${ref})`);
}

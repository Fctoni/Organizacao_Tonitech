import { spawnSync } from 'node:child_process';
for (const args of [['stop'], ['start']]) {
  const result = spawnSync('supabase', args, { encoding: 'utf8' });
  if (result.status) {
    console.error(`Supabase ${args[0]} falhou (saída suprimida para proteger credenciais).`);
    process.exit(1);
  }
  console.log(`Supabase ${args[0]} OK`);
}

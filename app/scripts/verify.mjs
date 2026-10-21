import { spawnSync } from 'node:child_process';
import { localClients, check } from './local.mjs';
const { admin } = localClients();
const sql = `select version from supabase_migrations.schema_migrations order by version;
select table_name, count(*) columns from information_schema.columns where table_schema='public' group by table_name order by table_name;
select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename;`;
const result = spawnSync('docker', ['exec', 'supabase_db_tonitech-inventory', 'psql', '-U', 'postgres', '-d', 'postgres', '-c', sql], { encoding: 'utf8' });
if (result.status) throw new Error('Verificação SQL local falhou');
console.log(result.stdout);
const items = check(await admin.from('items').select('qty,category,shelf,place,status,low_stock'));
const snapshots = check(await admin.from('source_snapshots').select('filename'));
console.log(JSON.stringify({ items: items.length, categories: new Set(items.map(x => x.category)).size,
  shelves: new Set(items.map(x => x.shelf)).size, locations: new Set(items.map(x => `${x.shelf}/${x.place}`)).size,
  in_stock: items.filter(x => x.status === 'in_stock').length, out: items.filter(x => x.status === 'out').length,
  low_stock: items.filter(x => x.low_stock).length, originals: snapshots.length }));
const { users } = check(await admin.auth.admin.listUsers());
if (users.some(user => /^(test|password)-/.test(user.email ?? ''))) throw new Error('Usuário de teste não foi removido');
console.log('PASS no ephemeral test users remain');

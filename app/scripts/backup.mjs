// Explicit path, exclusive creation and private permissions. No credentials in backup.
import { writeFile } from 'node:fs/promises';
import { localClients, check } from './local.mjs';
import { remoteClients } from './remote.mjs';
const path = process.argv[2];
if (!path) throw new Error('Informe um caminho privado para o backup JSON.');
const { admin } = process.env.INVENTORY_PROJECT_REF ? remoteClients() : localClients();
const backup = check(await admin.rpc('export_inventory'));
const { items, movements, originals } = backup;
await writeFile(path, JSON.stringify(backup), { mode: 0o600, flag: 'wx' });
console.log(`Backup privado criado: ${items.length} Itens, ${movements.length} movimentos, ${originals.length} originais.`);

import { remoteClients } from './remote.mjs';
import { importVault } from './import.mjs';
await importVault(remoteClients().admin);

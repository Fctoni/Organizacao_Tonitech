import { createServer } from 'vite';
import { localClients } from './local.mjs';
import { changePassword } from '../server/change-password.mjs';
const { url, anonKey, admin, client } = localClients();
process.env.VITE_SUPABASE_URL = url;
process.env.VITE_SUPABASE_ANON_KEY = anonKey;
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, plugins: [{
  name: 'inventory-password-endpoint',
  configureServer(server) {
    server.middlewares.use('/api/change-password', async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) { res.statusCode = 413; res.end(); return; }
    }
    const response = await changePassword(new Request('http://localhost/api/change-password', {
      method: req.method, headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' },
      ...(req.method === 'POST' ? { body } : {}),
    }), admin, client);
    res.statusCode = response.status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(await response.text());
  } catch { res.statusCode = 500; res.end('{"message":"Falha no servidor local."}'); }
    });
  },
}] });
await server.listen();
console.log('Inventário local: http://127.0.0.1:5173');

import { createServer } from 'vite';
import { localClients } from './local.mjs';
import { changePassword } from '../server/change-password.mjs';
import chatHandler from '../api/chat.mjs';
import mcpHandler from '../api/mcp.mjs';
const { url, anonKey, admin, client } = localClients();
process.env.VITE_SUPABASE_URL = url;
process.env.VITE_SUPABASE_ANON_KEY = anonKey;
process.env.SUPABASE_URL = url;
process.env.SUPABASE_ANON_KEY = anonKey;
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, plugins: [{
  name: 'inventory-password-endpoint',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (['/api/mcp', '/.well-known/oauth-protected-resource/api/mcp'].includes(req.url?.split('?')[0])) void mcpHandler(req, res);
      else next();
    });
    server.middlewares.use('/api/chat', (req, res) => void chatHandler(req, res));
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

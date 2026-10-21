import { createClient } from '@supabase/supabase-js';
import { changePassword } from '../server/change-password.mjs';

export default async function handler(req, res) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_ANON_KEY) {
    res.status(503).json({ message: 'Configuração do servidor indisponível.' });
    return;
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
  const client = () => createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, options);
  const request = new Request('https://inventory.invalid/api/change-password', {
    method: req.method,
    headers: { authorization: req.headers.authorization ?? '', 'content-type': 'application/json' },
    ...(req.method === 'POST' ? { body: JSON.stringify(req.body) } : {}),
  });
  const response = await changePassword(request, admin, client);
  res.setHeader('Cache-Control', 'no-store');
  res.status(response.status).json(await response.json());
}

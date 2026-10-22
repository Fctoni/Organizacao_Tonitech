import pg from 'pg';
import { itemFields } from './inventory-repository.mjs';

export function mcpPool(env = process.env) {
  const url = new URL(env.MCP_DATABASE_URL);
  const local = env.NODE_ENV !== 'production' && url.hostname === '127.0.0.1';
  if (!/^inventory_mcp(?:\.[a-z]+)?$/.test(decodeURIComponent(url.username)) || url.search || (!local && (!url.hostname.endsWith('.pooler.supabase.com') || url.port !== '6543'))) throw new Error('Conexão MCP inválida.');
  const pool = new pg.Pool({ connectionString: url.href, ssl: local ? false : { rejectUnauthorized: true, ...(env.MCP_DATABASE_CA ? { ca: env.MCP_DATABASE_CA } : {}) },
    max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, statement_timeout: 8000, query_timeout: 10000, allowExitOnIdle: true });
  pool.on('error', () => {}); // Never log connection strings or provider errors.
  return pool;
}

export async function withInventory(pool, identity, work, { write = false, signal } = {}) {
  if (typeof write !== 'boolean') throw new Error('Modo de transação inválido.');
  signal?.throwIfAborted();
  const connection = await pool.connect();
  let failed = false;
  let committing = false;
  const onError = () => { failed = true; };
  connection.on('error', onError);
  try {
    signal?.throwIfAborted();
    await connection.query(write ? 'BEGIN' : 'BEGIN READ ONLY');
    await connection.query('SET LOCAL ROLE authenticated');
    await connection.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('statement_timeout', '8000', true), set_config('idle_in_transaction_session_timeout', '10000', true)",
      [JSON.stringify({ sub: identity.sub, iat: identity.iat, exp: identity.exp, session_id: identity.session_id, client_id: identity.client_id, role: 'authenticated' }), identity.sub]);
    const access = await connection.query('select public.access_state() as state');
    if (access.rows[0].state !== 'ready') throw Object.assign(new Error('Acesso não liberado.'), { status: 403 });
    const rows = async (text, values, signal) => {
      signal?.throwIfAborted();
      const result = await connection.query(text, values);
      signal?.throwIfAborted();
      return result.rows;
    };
    const one = async (...args) => { const result = await rows(...args); if (result.length !== 1) throw new Error('Item ou categoria indisponível.'); return result[0]; };
    // Cast timestamps to text before pg sees them: Date loses Postgres microseconds.
    const fields = itemFields.replace('updated_at', "to_jsonb(updated_at) #>> '{}' as updated_at");
    const repository = {
      page: (start, signal) => rows(`select ${fields} from public.items order by id limit 500 offset $1`, [start], signal),
      item: (id, signal) => one(`select ${fields},body from public.items where id = $1`, [id], signal),
      categories: signal => rows('select name from public.categories order by name limit 50', [], signal),
      category: (name, signal) => one('select name from public.categories where name = $1', [name], signal),
      history: async (id, before, signal) => (await rows("select id::text,item_id,action,requested,to_jsonb(created_at) #>> '{}' as created_at,before_value,after_value from public.movements where item_id = $1 and ($2::bigint is null or id < $2) order by id desc limit 21", [id, before ?? null], signal)).map(row => {
        const id = Number(row.id);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Histórico excede o limite de identificadores.');
        return { ...row, id };
      }),
    };
    if (write) repository.execute = async proposal => (await one(
      'select public.execute_inventory_operation($1::uuid, $2::jsonb, $3::timestamptz) as result',
      [proposal.id, JSON.stringify(proposal.operation), new Date(proposal.expiresAt).toISOString()], signal)).result;
    const result = await work(repository);
    signal?.throwIfAborted();
    committing = true;
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    failed = true;
    let rolledBack = false;
    try { await connection.query('ROLLBACK'); rolledBack = true; } catch { /* Discard uncertain connection below. */ }
    // A lost COMMIT acknowledgement cannot prove rollback. Retry the same ticket.
    error.outcome = !committing && rolledBack ? 'transient' : 'uncertain';
    throw error;
  } finally { connection.off('error', onError); connection.release(failed); }
}

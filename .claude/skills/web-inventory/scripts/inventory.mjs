import { mkdir, realpath, lstat, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface, emitKeypressEvents } from 'node:readline';
import { selectItems } from '../../../../app/src/inventory.ts';

const productionUrl = 'https://pfhfhrypxncgzmnmlztm.supabase.co';
const help = `Inventário operacional — Node 22.18+, sem instalação npm
Uso: node .claude/skills/web-inventory/scripts/inventory.mjs COMANDO
  --help
  auth configure [--stdin]  prompts: URL Supabase e chave pública anon/publishable
  auth login [--stdin]      prompts: e-mail e senha oculta
  auth status              verifica sessão e permissão atual
  auth logout              revoga somente esta sessão e apaga cópia local
  find TEXTO [filtros] [--limit N] [--offset N]
  list [filtros] [--limit N] [--offset N]
  show UUID
  categories
  history UUID [--limit N] [--offset N]
  create --name TEXTO --shelf N --place B03 --qty N --category TEXTO
         [--aliases JSON_ARRAY] [--minimum-safe-stock N] [--body TEXTO]
  take UUID --n N
  add UUID --n N
  relocate UUID --shelf N --place W03
  recategorize UUID --category TEXTO
Filtros: --category TEXTO --shelf N --place B03 --surface B|W
         --status in_stock|out --low-stock
Inteiros: 0..2147483647; shelf >= 1; limit 1..1000 (padrão 100); offset padrão 0.
Place: B ou W + 2..9 dígitos, posição positiva. Categoria validada pelo servidor.
--stdin: JSON em pipe privado, nunca argumento/arquivo no repo.
configure recebe {"url":"https://…supabase.co","publicKey":"…"}.
login recebe {"email":"…","password":"…"}; senha nunca é salva.
Configuração: $XDG_CONFIG_HOME/tonitech-inventory/session.json ou ~/.config/tonitech-inventory/session.json.
Diretório 0700, arquivo 0600 fora do repo. Não sincronize sessões entre máquinas.
Saída: JSON {ok:true,data:…}; listas incluem total/limit/offset/has_more.
Erros: JSON {ok:false,error:{code,message,…}} em stderr, saída 1.
Escritas não têm retry. Resultado incerto exige conferir show/history antes de agir.
Timeout HTTP: 15s. HTTP sem TLS somente em loopback para testes locais.
`;

class Failure extends Error {
  constructor(code, message, extra = {}) { super(message); this.detail = { code, message, ...extra }; }
}
const fail = (code, message, extra) => { throw new Failure(code, message, extra); };
const invalid = () => fail('invalid_args', 'Argumentos inválidos. Consulte --help.');
const integer = (value, min = 0, max = 2147483647) => {
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) invalid();
  return Number(value);
};
function parse(args) {
  const command = args.shift();
  const action = command === 'auth' ? args.shift() : command;
  const filters = ['category', 'shelf', 'place', 'surface', 'status', 'low-stock', 'limit', 'offset'];
  const schema = command === 'auth' ? { configure: ['stdin'], login: ['stdin'], status: [], logout: [] } : {
    find: filters, list: filters, show: [], categories: [], history: ['limit', 'offset'],
    create: ['name', 'shelf', 'place', 'qty', 'category', 'aliases', 'minimum-safe-stock', 'body'],
    take: ['n'], add: ['n'], relocate: ['shelf', 'place'], recategorize: ['category'],
  };
  if (!Object.hasOwn(schema, action)) invalid();
  const options = {}, positional = [];
  while (args.length) {
    const arg = args.shift();
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (!schema[action].includes(key) || Object.hasOwn(options, key)) invalid();
    options[key] = ['stdin', 'low-stock'].includes(key) ? true : args.shift();
    if (options[key] === undefined) invalid();
  }
  const needsPosition = command !== 'auth' && ['find', 'show', 'history', 'take', 'add', 'relocate', 'recategorize'].includes(action);
  if (positional.length !== Number(needsPosition)) invalid();
  if (needsPosition && (action === 'find' ? !positional[0].trim() : !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(positional[0]))) invalid();
  const required = { create: ['name', 'shelf', 'place', 'qty', 'category'], take: ['n'], add: ['n'], relocate: ['shelf', 'place'], recategorize: ['category'] };
  if (command !== 'auth') for (const key of required[action] ?? []) if (!Object.hasOwn(options, key)) invalid();
  for (const key of ['shelf', 'qty', 'n', 'minimum-safe-stock', 'limit', 'offset']) if (Object.hasOwn(options, key)) options[key] = integer(options[key], ['shelf', 'limit'].includes(key) ? 1 : 0, key === 'limit' ? 1000 : 2147483647);
  if ('place' in options && (!/^[BW]\d{2,9}$/.test(options.place) || Number(options.place.slice(1)) === 0)) invalid();
  if ('place' in options) options.place = options.place[0] + String(Number(options.place.slice(1))).padStart(2, '0');
  if ('surface' in options && !['B', 'W'].includes(options.surface)) invalid();
  if ('status' in options && !['in_stock', 'out'].includes(options.status)) invalid();
  for (const key of ['name', 'category']) if (key in options && (!options[key].trim() || options[key].length > 200)) invalid();
  if ('aliases' in options) {
    try { options.aliases = JSON.parse(options.aliases); } catch { invalid(); }
    if (!Array.isArray(options.aliases) || options.aliases.some(value => typeof value !== 'string')) invalid();
  }
  return { command, action, options, value: positional[0] };
}

function validateConfig(config) {
  let url;
  try { url = new URL(config.url); } catch { fail('config', 'URL Supabase inválida.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) fail('config', 'Use uma origem HTTPS; HTTP somente em loopback.');
  const key = config.publicKey;
  let anon = false;
  try { anon = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role === 'anon'; } catch { /* publishable keys are opaque */ }
  if (typeof key !== 'string' || (!/^sb_publishable_[\w-]+$/.test(key) && !anon)) fail('config', 'Use somente chave pública anon/publishable.');
  return { ...config, url: url.origin };
}

async function store() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  if (!isAbsolute(base)) fail('config', 'XDG_CONFIG_HOME precisa ser absoluto.');
  await mkdir(base, { recursive: true, mode: 0o700 });
  const dir = join(await realpath(base), 'tonitech-inventory');
  const root = await realpath(fileURLToPath(new URL('../../../../', import.meta.url)));
  const inside = relative(root, dir);
  if (!inside || (!inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(inside))) fail('config', 'A sessão deve ficar fora do repositório.');
  await mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700 || info.uid !== process.getuid()) fail('config', 'Diretório privado precisa pertencer ao usuário e ter modo 0700.');
  const path = join(dir, 'session.json');
  let lock;
  try { lock = await open(join(dir, 'session.lock'), 'wx', 0o600); }
  catch { fail('session_busy', 'Sessão em uso. Se o processo terminou abruptamente, remova session.lock do diretório privado.'); }
  return {
    async load() {
      let file;
      try {
        file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await file.stat();
        if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid()) fail('config', 'Arquivo de sessão precisa pertencer ao usuário e ter modo 0600.');
        return validateConfig(JSON.parse(await file.readFile('utf8')));
      } catch (error) { if (error.code === 'ENOENT') fail('not_configured', 'Execute auth configure no terminal.'); throw error; }
      finally { await file?.close(); }
    },
    async save(config) {
      const temp = join(dir, 'session.new');
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(config)); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, path);
    },
    async close() { await lock.close(); await unlink(join(dir, 'session.lock')); },
  };
}

async function credentials(action, piped) {
  if (piped) {
    if (process.stdin.isTTY) fail('input', '--stdin exige pipe privado.');
    let text = '';
    for await (const chunk of process.stdin) { text += chunk; if (text.length > 16384) fail('input', 'Entrada muito grande.'); }
    try { return JSON.parse(text); } catch { fail('input', 'Entrada JSON inválida.'); }
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) fail('input', 'Execute no terminal interativo ou use --stdin com pipe privado.');
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const first = await new Promise(resolve => rl.question(action === 'login' ? 'E-mail: ' : `URL Supabase [${productionUrl}]: `, resolve));
  rl.close();
  const secret = await new Promise((resolve, reject) => {
    let value = '';
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true); process.stdin.resume();
    const finish = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('keypress', onKey); process.stderr.write('\n'); };
    function onKey(text, key) {
      if (key?.ctrl && key.name === 'c') { finish(); reject(new Failure('cancelled', 'Entrada cancelada.')); }
      else if (key?.name === 'return' || key?.name === 'enter') { finish(); resolve(value); }
      else if (key?.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(text)) value += text;
    }
    process.stdin.on('keypress', onKey);
    process.stderr.write(action === 'login' ? 'Senha (oculta): ' : 'Chave pública anon/publishable (oculta): ');
  });
  return action === 'login' ? { email: first, password: secret } : { url: first || productionUrl, publicKey: secret };
}

async function request(config, path, { body, token, mutation = false, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  let response, data;
  try {
    response = await fetch(`${config.url}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: config.publicKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    data = response.status === 204 ? null : await response.json();
  } catch {
    fail(mutation ? 'uncertain_result' : 'transport', mutation ? 'Resultado incerto. Não repita a escrita. Confira show/history; no cadastro, use find antes do histórico.' : 'Falha de transporte ou resposta inválida. Nenhum retry automático.', { uncertain: mutation });
  }
  if (!response.ok) {
    if (mutation && (response.status >= 500 || response.status === 408)) fail('uncertain_result', 'Resultado incerto. Confira show/history antes de qualquer nova escrita.', { uncertain: true, status: response.status });
    const known = { '23505': 'Já existe um Item com esse nome.', '23503': 'Categoria inexistente.', '23514': 'Campos violam as regras do inventário.', '42501': 'Acesso negado.', '22003': 'Quantidade excede o limite inteiro.' };
    // Never echo upstream messages: auth errors and proxy bodies can contain credentials.
    fail('http_error', known[data?.code] || 'Requisição rejeitada. Confira os dados e a autorização.', { status: response.status, ...(known[data?.code] ? { server_code: data.code } : {}) });
  }
  return data;
}

function sessionFrom(data) {
  if (typeof data?.access_token !== 'string' || typeof data?.refresh_token !== 'string' || !Number.isFinite(data.expires_in)) fail('auth_response', 'Resposta de autenticação inválida.');
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
}
async function access(config) {
  const state = await request(config, '/rest/v1/rpc/access_state', { body: {}, token: config.session.access_token });
  if (state !== 'ready') fail(state === 'password_required' ? state : 'access_denied', state === 'password_required' ? 'Troque a senha no app e faça novo login no terminal.' : 'Usuário sem acesso autorizado ao inventário.');
  return state;
}
async function rows(config, table, filters = {}) {
  const field = table === 'categories' ? 'name' : 'id';
  const descending = table === 'movements';
  const result = [];
  let cursor;
  for (;;) {
    const query = new URLSearchParams({ select: '*', order: `${field}.${descending ? 'desc' : 'asc'}`, limit: '500', ...filters });
    if (cursor !== undefined) query.set(field, `${descending ? 'lt' : 'gt'}.${cursor}`);
    const page = await request(config, `/rest/v1/${table}?${query}`, { token: config.session.access_token });
    if (!Array.isArray(page)) fail('response', 'Resposta de consulta inválida.');
    if (!page.length) return result;
    const next = page.at(-1)[field];
    if (next === undefined || next === cursor) fail('pagination', 'Servidor não avançou a paginação.');
    result.push(...page);
    cursor = next;
    // Continue until empty, even when the server caps the requested page size.
  }
}
function pageResult(values, key, options) {
  const limit = options.limit ?? 100, offset = options.offset ?? 0;
  return { [key]: values.slice(offset, offset + limit), total: values.length, limit, offset, has_more: offset + limit < values.length };
}
async function operate(config, { action, options, value }) {
  if (action === 'categories') return rows(config, 'categories');
  if (action === 'show') {
    const query = new URLSearchParams({ select: '*', id: `eq.${value}` });
    const result = await request(config, `/rest/v1/items?${query}`, { token: config.session.access_token });
    if (!Array.isArray(result) || result.length !== 1) fail('not_found', 'Item não encontrado.');
    return result[0];
  }
  if (action === 'history') return pageResult(await rows(config, 'movements', { item_id: `eq.${value}` }), 'movements', options);
  if (action === 'find' || action === 'list') {
    // ponytail: O(n) transfer/memory, sharing the app's exact accent/alias semantics.
    // Move search to a database RPC when the inventory outgrows a full scan.
    const items = selectItems(await rows(config, 'items'), { ...options, query: value, lowStock: options['low-stock'] });
    return pageResult(items, 'items', options);
  }
  const input = action === 'create' ? {
    name: options.name, shelf: options.shelf, place: options.place, qty: options.qty, category: options.category,
    aliases: options.aliases ?? [], minimum_safe_stock: options['minimum-safe-stock'] ?? 0, body: options.body ?? '',
  } : options;
  const result = await request(config, `/rest/v1/rpc/${action === 'create' ? 'create_item' : 'mutate_item'}`, {
    body: action === 'create' ? { input } : { item_id: value, action, input }, token: config.session.access_token, mutation: true,
  });
  const item = action === 'create' ? result : result?.item;
  if (typeof item?.id !== 'string' || !Number.isInteger(item.qty) || (action !== 'create' && typeof result?.warning !== 'boolean')) fail('uncertain_result', 'Resposta de escrita incompleta. Confira show/history antes de qualquer nova escrita.', { uncertain: true });
  return action === 'create' ? { item, warning: false } : result;
}
async function main(parsed) {
  const { command, action, options } = parsed;
  const storage = await store();
  try {
    if (command === 'auth' && action === 'configure') {
      const input = await credentials(action, options.stdin);
      const config = validateConfig({ url: input?.url, publicKey: input?.publicKey });
      await storage.save(config);
      return { configured: true, url: config.url };
    }
    let config = await storage.load();
    if (command === 'auth' && action === 'login') {
      const input = await credentials(action, options.stdin);
      if (typeof input?.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) || typeof input.password !== 'string' || !input.password) fail('input', 'Informe e-mail e senha válidos.');
      const data = await request(config, '/auth/v1/token?grant_type=password', { body: { email: input.email, password: input.password } });
      config.session = sessionFrom(data);
      await access(config);
      await storage.save(config);
      return { authenticated: true, access: 'ready' };
    }
    if (command === 'auth' && action === 'logout') {
      try {
        if (config.session) await request(config, '/auth/v1/logout?scope=local', { method: 'POST', token: config.session.access_token });
      } finally { delete config.session; await storage.save(config); }
      return { authenticated: false };
    }
    if (!config.session) fail('login_required', 'Execute auth login no terminal.');
    if (config.session.expires_at <= Date.now() + 60000) {
      const data = await request(config, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: config.session.refresh_token } });
      config.session = sessionFrom(data);
      await storage.save(config);
    }
    await access(config);
    if (command === 'auth') return { authenticated: true, access: 'ready', url: config.url };
    return await operate(config, parsed);
  } finally { await storage.close(); }
}

try {
  if (process.argv.length === 2 || process.argv.slice(2).join(' ') === '--help') process.stdout.write(help);
  else process.stdout.write(`${JSON.stringify({ ok: true, data: await main(parse(process.argv.slice(2))) })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Failure ? error.detail : { code: 'local_error', message: 'Falha local. Confira configuração, permissões e arquivos de sessão temporários.' } })}\n`);
  process.exitCode = 1;
}
